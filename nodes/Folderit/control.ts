import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeProperties,
	INodePropertyOptions,
} from 'n8n-workflow';
import { NodeOperationError, UserError } from 'n8n-workflow';
import { collection, request, validateUid } from './api';
import type { Context } from './api';

export async function paged(
	context: Context,
	account: string,
	path: string,
	limit: number,
	sort?: string,
	uniqueRows = true,
): Promise<IDataObject[]> {
	if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
		throw new UserError('Limit must be between 1 and 10,000.');
	const output: IDataObject[] = [];
	const seen = new Set<string>();
	const size = Math.min(100, limit);
	const pages = new Set<string>();
	for (let page = 1; page <= 100; page++) {
		const rows = collection(
			await request(context, account, 'GET', path, undefined, {
				page,
				'per-page': size,
				...(sort ? { sort } : {}),
			}),
		);
		const signature = JSON.stringify(rows);
		if (rows.length && pages.has(signature))
			throw new UserError('Folderit pagination repeated a page.');
		pages.add(signature);
		for (const row of rows) {
			const uid = String(row.uid ?? row.workflowUid ?? '');
			if (uniqueRows && (!uid || seen.has(uid)))
				throw new UserError('Folderit pagination returned missing or repeated identifiers.');
			seen.add(uid);
			output.push(row);
		}
		if (rows.length < size) return output.slice(0, limit);
		if (output.length >= limit && limit < 10000) return output.slice(0, limit);
	}
	throw new UserError('Results reached the 10,000-record safety limit. Use a smaller limit.');
}
export async function listVersions(context: Context, account: string, uid: string, limit: number) {
	const rows = await paged(
		context,
		account,
		`/files/${validateUid(uid)}/versions`,
		limit,
		'-createdAt,uid',
	);
	if (rows.some((row) => row.fileUid && row.fileUid !== uid))
		throw new UserError('Version history returned a different file.');
	return rows.map((row) => ({ ...row, fileUid: uid, versionUid: row.uid }));
}
export async function available(context: Context, account: string, uid: string) {
	return collection(
		await request(
			context,
			account,
			'GET',
			`/entities/${validateUid(uid)}/workflows/manual-start-options`,
		),
	);
}
export function workflowOptions(rows: IDataObject[]): INodePropertyOptions[] {
	return rows.flatMap((row) => {
		const uid = validateUid(String(row.workflowUid ?? row.uid ?? ''));
		const options = Array.isArray(row.startOptions) ? (row.startOptions as IDataObject[]) : [];
		return options.map((option) => {
			const id = Number(option.triggerId);
			if (!Number.isSafeInteger(id) || id < 1)
				throw new UserError('Invalid workflow start option.');
			return {
				name: `${row.workflowName || uid} / ${option.name || id} (${uid})`,
				value: `${uid}::${id}`,
			};
		});
	});
}
export async function getWorkflows(this: ILoadOptionsFunctions) {
	return workflowOptions(
		await available(
			this,
			validateUid(String(this.getNodeParameter('accountUid'))),
			validateUid(String(this.getNodeParameter('workflowRecordUid'))),
		),
	);
}
export async function executeWorkflow(
	context: IExecuteFunctions,
	account: string,
	operation: string,
	index: number,
): Promise<IDataObject[]> {
	const uid = validateUid(String(context.getNodeParameter('workflowRecordUid', index)));
	if (operation === 'available') return available(context, account, uid);
	if (operation === 'status')
		return paged(
			context,
			account,
			`/entities/${uid}/workflows/progress`,
			context.getNodeParameter('workflowReturnAll', index)
				? 10000
				: Number(context.getNodeParameter('workflowLimit', index)),
			undefined,
			false,
		);
	if (operation !== 'start') throw new UserError('Unsupported workflow operation.');
	const selected = String(context.getNodeParameter('workflowOption', index));
	const options = workflowOptions(await available(context, account, uid));
	if (!options.some((option) => option.value === selected))
		throw new UserError(
			'This workflow start option is no longer available for the record. Refresh the selection.',
		);
	const [workflowUid, trigger] = selected.split('::');
	try {
		const result = await request(
			context,
			account,
			'POST',
			`/entities/${uid}/workflows/manual-start`,
			{ workflowUid, triggerId: Number(trigger) },
		);
		if (result.queued !== true || result.workflowUid !== workflowUid)
			throw new UserError('Unexpected workflow response.');
		return [{ ...result, entityUid: uid }];
	} catch {
		throw new NodeOperationError(
			context.getNode(),
			'Could not confirm workflow start. Check workflow progress before retrying; the request may already be queued.',
		);
	}
}
export const workflowOperation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	default: 'available',
	displayOptions: { show: { resource: ['workflow'] } },
	options: [
		{
			name: 'Get Available',
			value: 'available',
			action: 'Get available workflows',
			description: 'List manual starts available for a record',
		},
		{
			name: 'Get Status',
			value: 'status',
			action: 'Get workflow status',
			description: 'Read workflow progress for a record',
		},
		{
			name: 'Start',
			value: 'start',
			action: 'Start a workflow',
			description: 'Queue an available manual workflow for a record',
		},
	],
};
export const controlProperties: INodeProperties[] = [
	{
		displayName: 'Record UID',
		name: 'workflowRecordUid',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['workflow'] } },
	},
	{
		displayName: 'Workflow Name or ID',
		name: 'workflowOption',
		type: 'options',
		required: true,
		default: '',
		typeOptions: {
			loadOptionsMethod: 'getWorkflows',
			loadOptionsDependsOn: ['accountUid', 'workflowRecordUid'],
		},
		displayOptions: { show: { resource: ['workflow'], operation: ['start'] } },
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Return All',
		name: 'workflowReturnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: ['workflow'], operation: ['status'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'workflowLimit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1, maxValue: 10000 },
		displayOptions: {
			show: { resource: ['workflow'], operation: ['status'], workflowReturnAll: [false] },
		},
		description: 'Max number of results to return',
	},
	{
		displayName: 'File Lock ID',
		name: 'versionLockId',
		type: 'string',
		typeOptions: { password: true },
		default: '',
		displayOptions: { show: { resource: ['file'], operation: ['addVersion'] } },
		description:
			'Existing lock ID when your workflow holds a lock. Does not acquire or override a lock.',
	},
];
