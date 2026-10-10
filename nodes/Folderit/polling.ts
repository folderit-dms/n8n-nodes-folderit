import type { IDataObject, IPollFunctions, INodeExecutionData } from 'n8n-workflow';
import { UserError } from 'n8n-workflow';
import { collection, request, validateUid } from './api';
export const eventGroups: Record<string, string[]> = {
	newFile: ['fileNew'],
	newFolder: ['folderNew'],
	newVersion: ['fileVersionNew'],
	recordChanged: ['fileName', 'folderName', 'fileMove', 'folderMove', 'fileEdit', 'folderEdit'],
	metadataChanged: [
		'fileMetaNew',
		'fileMetaValue',
		'fileMetaDelete',
		'fileMetaRequired',
		'folderMetaNew',
		'folderMetaValue',
		'folderMetaDelete',
		'folderMetaRequired',
		'folderMetaRecursive',
	],
	workflowEvent: [
		'taskNew',
		'taskEdit',
		'taskDelete',
		'taskAccept',
		'taskReject',
		'taskFeedbackRequest',
		'taskFeedbackResponse',
		'taskDelegate',
		'taskDelegateClear',
	],
};
function auditId(value: unknown): bigint {
	if ((typeof value === 'number' && !Number.isSafeInteger(value)) || !/^\d+$/.test(String(value)))
		throw new UserError('Folderit returned an invalid audit sequence ID.');
	return BigInt(String(value));
}
export function normalizeEvent(row: IDataObject): IDataObject {
	const data =
		row.data && typeof row.data === 'object' && !Array.isArray(row.data)
			? (row.data as IDataObject)
			: {};
	const event = String(row.event);
	const created = ['fileNew', 'folderNew'].includes(event);
	const entityUid = event.startsWith('task')
		? (data.targetEntityUid ?? row.entityUid)
		: created
			? (data.uid ?? row.entityUid)
			: (data.fileUid ?? data.entityUid ?? row.entityUid);
	if (typeof entityUid !== 'string')
		throw new UserError('Folderit audit event is missing its record UID.');
	return {
		id: String(row.uid),
		auditUid: String(row.uid),
		auditId: String(row.id),
		event,
		entityUid,
		occurredAt: typeof row.time === 'number' ? new Date(row.time * 1000).toISOString() : null,
		...(event === 'fileVersionNew'
			? { versionUid: data.versionUid ?? data.fileVersionUid ?? data.uid ?? null }
			: {}),
		...(event.startsWith('task') ? { taskUid: data.taskUid ?? data.uid ?? null } : {}),
		...(event.includes('Meta') ? { metaUid: data.metaUid ?? data.uid ?? null } : {}),
	};
}
export async function pollEvents(context: IPollFunctions): Promise<INodeExecutionData[][] | null> {
	const account = validateUid(String(context.getNodeParameter('accountUid')));
	const event = String(context.getNodeParameter('event'));
	const filter = String(context.getNodeParameter('recordUid', '')).trim();
	if (filter) validateUid(filter);
	const allowed = eventGroups[event];
	if (!allowed) throw new UserError('Choose a supported Folderit event.');
	const manual = context.getMode() === 'manual';
	const state = context.getWorkflowStaticData('node');
	const scope = JSON.stringify([
		account,
		event,
		filter,
		context.getNode().credentials?.folderitOAuth2Api?.id ?? '',
	]);
	const seeded = state.scope === scope && typeof state.cursor === 'string';
	const activation = context.getActivationMode();
	if (!manual && !seeded && ['init', 'leadershipChange'].includes(activation))
		throw new UserError(
			'No saved Folderit checkpoint is available after restart. Reconcile events since activation before reactivating this trigger. Use n8n durable poll cursors to persist quiet polls.',
		);
	const started = Date.now();
	// This endpoint defaults to the last day. Refuse an unsafe catch-up beyond that window.
	if (
		!manual &&
		seeded &&
		(typeof state.lastPoll !== 'number' || started - state.lastPoll > 23 * 3600 * 1000)
	)
		throw new UserError(
			'Polling was interrupted for over 23 hours. Reconcile missed events before resetting this trigger checkpoint.',
		);
	const previous = seeded ? auditId(state.cursor) : BigInt(0);
	let newest = previous;
	const seen = new Set<string>();
	const pending: IDataObject[] = [];
	let finished = false;
	let lastId: bigint | undefined;
	for (let page = 1; page <= 10; page++) {
		// Older n8n versions do not expose a poll budget. Bound both versions by 10 pages.
		const budget =
			typeof context.getPollBudgetMs === 'function' ? context.getPollBudgetMs() : 60000;
		if (Date.now() - started >= Math.max(0, budget - 5000))
			throw new UserError(
				'Polling time limit reached. Checkpoint was not advanced; shorten the poll interval.',
			);
		const rows = collection(
			await request(context, account, 'GET', '/audit/accountLog', undefined, {
				page,
				'per-page': 100,
				sort: '-id',
			}),
		);
		if (page === 1 && rows.length)
			newest = auditId(rows[0].id) > previous ? auditId(rows[0].id) : previous;
		for (const row of rows) {
			const id = auditId(row.id);
			if (typeof row.uid !== 'string' || !row.uid)
				throw new UserError('Folderit audit event has no stable UID.');
			if (seen.has(row.uid)) continue; // Offset pages may overlap while new events arrive.
			seen.add(row.uid);
			if (lastId !== undefined && id >= lastId)
				throw new UserError('Folderit audit results were not in descending sequence order.');
			lastId = id;
			if (!manual && seeded && id <= previous) {
				finished = true;
				break;
			}
			if (allowed.includes(String(row.event))) {
				const normalized = normalizeEvent(row);
				if (!filter || normalized.entityUid === filter) pending.push(normalized);
			}
		}
		if ((!manual && !seeded) || finished || rows.length < 100 || (manual && pending.length >= 10)) {
			finished = true;
			break;
		}
	}
	if (!finished)
		throw new UserError(
			'More than 1,000 audit events require scanning. Checkpoint was not advanced; reconcile the backlog before resetting the trigger.',
		);
	if (!manual && !seeded) {
		Object.assign(state, { scope, cursor: String(newest), lastPoll: started });
		return null;
	}
	const selected = manual ? pending.slice(0, 10) : pending;
	// The API lists version details; it has no GET route for an individual version.
	const files = new Map<string, Set<string>>();
	for (const row of selected.filter((row) => row.event === 'fileVersionNew')) {
		if (typeof row.versionUid !== 'string')
			throw new UserError('New-version event has no version UID. Checkpoint was not advanced.');
		const file = validateUid(String(row.entityUid));
		const wanted = files.get(file) ?? new Set<string>();
		wanted.add(validateUid(row.versionUid));
		files.set(file, wanted);
	}
	const versions = new Map<string, IDataObject>();
	for (const [file, wanted] of files) {
		const seenVersions = new Set<string>();
		for (let page = 1; page <= 10; page++) {
			const budget =
				typeof context.getPollBudgetMs === 'function' ? context.getPollBudgetMs() : 60000;
			if (Date.now() - started >= Math.max(0, budget - 5000))
				throw new UserError('Version lookup time limit reached. Checkpoint was not advanced.');
			const rows = collection(
				await request(context, account, 'GET', `/files/${file}/versions`, undefined, {
					page,
					'per-page': 100,
					sort: '-createdAt,uid',
				}),
			);
			for (const version of rows) {
				if (
					typeof version.uid !== 'string' ||
					version.fileUid !== file ||
					seenVersions.has(version.uid)
				)
					throw new UserError(
						'Version history returned an invalid or repeated record. Checkpoint was not advanced.',
					);
				seenVersions.add(version.uid);
				if (wanted.has(version.uid)) {
					versions.set(`${file}:${version.uid}`, version);
					wanted.delete(version.uid);
				}
			}
			if (!wanted.size || rows.length < 100) break;
		}
		if (wanted.size)
			throw new UserError(
				'An event version is missing, inaccessible or beyond 1,000 versions. Reconcile it before resetting the checkpoint.',
			);
	}
	for (const row of selected.filter((row) => row.event === 'fileVersionNew'))
		row.version = versions.get(`${row.entityUid}:${row.versionUid}`)!;
	// Stage state only after the whole poll succeeds. Manual previews must never consume events.
	if (!manual) Object.assign(state, { scope, cursor: String(newest), lastPoll: started });
	return selected.length ? [selected.reverse().map((json) => ({ json }))] : null;
}
