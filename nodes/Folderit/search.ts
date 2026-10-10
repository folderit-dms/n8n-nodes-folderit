import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { UserError } from 'n8n-workflow';
import { collection, request, validateUid } from './api';
export async function searchRecords(
	context: IExecuteFunctions,
	account: string,
	resource: string,
	index: number,
): Promise<IDataObject[]> {
	const query = String(context.getNodeParameter('query', index, '')).trim();
	const fields = context.getNodeParameter('queryFields', index, ['name']) as string[];
	if (
		!Array.isArray(fields) ||
		!fields.length ||
		fields.some((f) => !['name', 'content', 'meta', 'number', 'tag'].includes(f))
	)
		throw new UserError('Choose at least one supported search field.');
	const filters = context.getNodeParameter('filters', index, {}) as IDataObject;
	const parent = String(filters.parentUid ?? '').trim();
	const number = String(filters.number ?? '').trim();
	const extension = String(filters.extension ?? '')
		.trim()
		.replace(/^\./, '');
	if (!query && !parent && !number && !extension)
		throw new UserError('Supply a search query or at least one filter.');
	const all = context.getNodeParameter('returnAll', index, false) as boolean;
	const limit = all ? 10000 : (context.getNodeParameter('limit', index, 50) as number);
	if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
		throw new UserError('Search limit must be between 1 and 10,000.');
	const body: IDataObject = {
		itemType: resource,
		sort: [
			{ field: query ? 'score' : 'date', order: 'desc' },
			{ field: 'uid', order: 'asc' },
		],
		...(query ? { query, queryFilter: fields } : {}),
		...(parent ? { parentUid: validateUid(parent) } : {}),
		...(number ? { number } : {}),
		...(extension ? { extension: [extension] } : {}),
	};
	const result: IDataObject[] = [];
	const seen = new Set<string>();
	const cursors = new Set<string>();
	for (let page = 0; page < 100; page++) {
		const size = Math.min(100, limit - result.length);
		const rows = collection(
			await request(context, account, 'POST', '/search/entities', { ...body, limit: size }),
		);
		for (const row of rows) {
			if (typeof row.uid !== 'string' || row.type !== resource)
				throw new UserError('Search returned an unexpected record type or missing UID.');
			if (seen.has(row.uid))
				throw new UserError('Search returned repeated records. Narrow the query and try again.');
			seen.add(row.uid);
			result.push(row);
		}
		if (rows.length < size) return result;
		if (result.length >= limit) {
			if (all)
				throw new UserError(
					'Search reached 10,000 results. Narrow the query or use a specific limit.',
				);
			return result.slice(0, limit);
		}
		const next = rows.at(-1)?.sort;
		if (!Array.isArray(next) || !next.length)
			throw new UserError(
				'Folderit did not return a search cursor. Narrow the query or use a smaller limit.',
			);
		const key = JSON.stringify(next);
		if (cursors.has(key))
			throw new UserError('Folderit repeated a search cursor. Narrow the query.');
		cursors.add(key);
		body.searchAfter = next;
	}
	throw new UserError('Search exceeded 100 pages. Narrow the query.');
}
