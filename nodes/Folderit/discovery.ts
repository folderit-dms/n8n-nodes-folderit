import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';
import { UserError } from 'n8n-workflow';
import { api, collection, request, validateUid, resolveAccount, credentialType } from './api';
import type { Context } from './api';
export async function definitions(context: Context, account: string): Promise<IDataObject[]> {
	const output: IDataObject[] = [];
	const seen = new Set<string>();
	for (let page = 1; page <= 100; page++) {
		const rows = collection(
			await request(context, account, 'GET', '/meta', undefined, {
				page,
				'per-page': 100,
				sort: 'uid',
				fields: 'uid,name,type,multiple,decimalScale,data,permissions',
			}),
		);
		for (const row of rows) {
			if (typeof row.uid !== 'string' || seen.has(row.uid))
				throw new UserError('Metadata pagination returned an invalid or repeated UID.');
			seen.add(row.uid);
			output.push(row);
		}
		if (rows.length < 100) return output;
	}
	throw new UserError('Metadata catalog exceeded 10,000 fields. Use an exact field UID.');
}
export function folderOptions(rows: IDataObject[]): INodePropertyOptions[] {
	const folders = rows.filter(
		(r) =>
			r.type === 'folder' &&
			typeof r.uid === 'string' &&
			typeof r.name === 'string' &&
			r.deletedAt == null,
	);
	const byUid = new Map(folders.map((r) => [String(r.uid), r]));
	return folders
		.map((folder) => {
			const names = [String(folder.name)];
			const visited = new Set([String(folder.uid)]);
			let parent = folder.parentUid;
			while (typeof parent === 'string' && byUid.has(parent) && !visited.has(parent)) {
				visited.add(parent);
				const row = byUid.get(parent)!;
				names.unshift(String(row.name));
				parent = row.parentUid;
			}
			return { name: `${names.join(' / ')} (${folder.uid})`, value: String(folder.uid) };
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}
export const loadOptions = {
	async getAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const c =
			credentialType(this) === 'folderitApi' ? await this.getCredentials('folderitApi') : null;
		const exact = c?.accountUid || c?.selectedAccountUid;
		const all = exact
			? [await request(this, validateUid(String(exact)), 'GET', '')]
			: collection(await api(this, '/accounts'));
		return all
			.filter((r) => typeof r.uid === 'string')
			.map((r) => ({ name: `${r.name ?? r.uid} (${r.uid})`, value: String(r.uid) }))
			.sort((a, b) => a.name.localeCompare(b.name));
	},
	async getFolders(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const account = await resolveAccount(this, this.getNodeParameter('accountUid'));
		const rows: IDataObject[] = [];
		let cursor: string | undefined;
		const seen = new Set<string>();
		for (let page = 0; page < 10; page++) {
			const response = await api(this, `/accounts/${account}/entities/all`, {
				returnFullResponse: true,
				qs: { folders: true, files: false, 'per-page': 1000, ...(cursor ? { cursor } : {}) },
			});
			rows.push(...collection(response.body));
			const next = response.headers?.['x-pagination-cursor'];
			if (!next) return folderOptions(rows);
			if (typeof next !== 'string' || seen.has(next))
				throw new UserError('Folder pagination returned an invalid or repeated cursor.');
			seen.add(next);
			cursor = next;
		}
		throw new UserError(
			'Folder picker exceeded 10,000 folders. Enter the exact folder UID using an expression.',
		);
	},
	async getMetadata(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return (
			await definitions(this, await resolveAccount(this, this.getNodeParameter('accountUid')))
		)
			.map((r) => ({
				name: `${r.name ?? r.uid} [${r.type}${r.multiple ? ' array' : ''}] (${r.uid})`,
				value: String(r.uid),
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	},
	async getSelectOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const account = await resolveAccount(this, this.getNodeParameter('accountUid'));
		const uid = validateUid(this.getNodeParameter('metadataUid') as string);
		const def = await request(this, account, 'GET', `/meta/${uid}`);
		return Array.isArray(def.options)
			? def.options.map((r: IDataObject) => ({
					name: String(r.value ?? r.name ?? r.uid),
					value: String(r.uid),
				}))
			: [];
	},
};
