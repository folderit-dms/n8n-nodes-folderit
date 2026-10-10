import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeApiError, UserError } from 'n8n-workflow';
export type Context = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;
export function validateUid(value: string): string {
	const uid = typeof value === 'string' ? value.trim() : '';
	if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid))
		throw new UserError('Enter a valid Folderit UID (letters, numbers, underscores and hyphens).');
	return uid;
}
export function collection(value: unknown): IDataObject[] {
	if (Array.isArray(value)) return value as IDataObject[];
	if (value && typeof value === 'object') {
		const obj = value as IDataObject;
		for (const key of [
			'data',
			'items',
			'results',
			'entities',
			'meta',
			'metas',
			'accounts',
			'versions',
			'progress',
		])
			if (Array.isArray(obj[key])) return obj[key] as IDataObject[];
	}
	throw new UserError('Folderit returned an unexpected collection response.');
}
export async function api(
	context: Context,
	path: string,
	options: Omit<IHttpRequestOptions, 'url'> = {},
) {
	try {
		return await context.helpers.httpRequestWithAuthentication.call(context, 'folderitOAuth2Api', {
			method: 'GET',
			url: `https://api.folderit.com/v2${path}`,
			json: true,
			timeout: 60000,
			disableFollowRedirect: true,
			...options,
		});
	} catch (error) {
		const status =
			(error as { statusCode?: number; response?: { status?: number } }).statusCode ??
			(error as { response?: { status?: number } }).response?.status;
		throw new NodeApiError(context.getNode(), {
			message: `Folderit API request failed${status ? ` (HTTP ${status})` : ''}. Check account access and node inputs.`,
		});
	}
}
export async function request(
	context: Context,
	account: string,
	method: IHttpRequestOptions['method'],
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
	headers?: IDataObject,
) {
	return await api(context, `/accounts/${validateUid(account)}${path}`, {
		method,
		body,
		qs,
		headers,
	});
}
