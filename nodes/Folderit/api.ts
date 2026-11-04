import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, UserError } from 'n8n-workflow';
import {
	deployment,
	CLOUD_API,
	CLOUD_WEB,
	LEGACY_CREDENTIAL,
	INSTANCE_CREDENTIAL,
	withLinks,
	publicUrl,
} from './deployment';
import { assertBinding } from '../../credentials/FolderitApi.credentials';
export type Context = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;
export function credentialType(context: Context): string {
	const type = context.getNode().parameters.authentication || LEGACY_CREDENTIAL;
	if (type !== LEGACY_CREDENTIAL && type !== INSTANCE_CREDENTIAL)
		throw new UserError('Select a supported Folderit connection type.');
	return type;
}
export const connectionProperty = {
	displayName: 'Connection Type',
	name: 'authentication',
	type: 'options' as const,
	noDataExpression: true,
	default: LEGACY_CREDENTIAL,
	options: [
		{ name: 'Standard Cloud OAuth2 (Existing Connections)', value: LEGACY_CREDENTIAL },
		{ name: 'Folderit Connection (Cloud or Custom Deployment)', value: INSTANCE_CREDENTIAL },
	],
};

export async function connectionDeployment(context: Context) {
	if (credentialType(context) === LEGACY_CREDENTIAL)
		return {
			apiOrigin: CLOUD_API,
			authOrigin: 'https://auth.folderit.com',
			browserOrigin: CLOUD_WEB,
			storageOrigins: [],
		};
	const credentials = await context.getCredentials(INSTANCE_CREDENTIAL);
	assertBinding(credentials);
	return deployment(credentials);
}

export async function accessibleAccounts(context: Context): Promise<IDataObject[]> {
	const rows: IDataObject[] = [],
		seen = new Set<string>();
	let cursor: string | undefined;
	for (let page = 1; page <= 5; page++) {
		const response = await api(context, '/accounts', {
			returnFullResponse: true,
			qs: { page, 'per-page': 100, fields: 'uid,name', ...(cursor ? { cursor } : {}) },
			headers: { 'X-Pagination': '1' },
		});
		const current = collection(response.body ?? response);
		if (current.length > 100)
			throw new UserError(
				'Account discovery returned an incomplete list. Enter an exact Account UID.',
			);
		for (const row of current) {
			const uid = validateUid(String(row.uid || ''));
			if (seen.has(uid))
				throw new UserError('Account discovery repeated an identity; no account was selected.');
			seen.add(uid);
			rows.push(row);
		}
		const next = response.headers?.['x-pagination-cursor'];
		if (!next && current.length < 100) return rows;
		if (next && (typeof next !== 'string' || next === cursor))
			throw new UserError('Account discovery repeated an invalid cursor.');
		cursor = next;
	}
	throw new UserError('Account discovery reached its bound. Enter an exact Account UID.');
}

export async function resolveAccount(context: Context, value: unknown): Promise<string> {
	if (value) return validateUid(String(value));
	if (credentialType(context) === INSTANCE_CREDENTIAL) {
		const c = await context.getCredentials(INSTANCE_CREDENTIAL);
		assertBinding(c);
		if (c.accountUid || c.selectedAccountUid)
			return validateUid(String(c.accountUid || c.selectedAccountUid));
	}
	const accounts =
		credentialType(context) === INSTANCE_CREDENTIAL
			? await accessibleAccounts(context)
			: collection(await api(context, '/accounts'));
	if (accounts.length !== 1)
		throw new UserError(
			'Select an exact account. Automatic selection is allowed only when exactly one accessible account exists.',
		);
	return validateUid(String(accounts[0].uid));
}

export async function connectionInfo(context: Context, account: string): Promise<IDataObject> {
	const d = await connectionDeployment(context);
	const record = await request(context, account, 'GET', '');
	if (record.uid !== account)
		throw new UserError('The connection did not verify the exact account.');
	return {
		apiOrigin: d.apiOrigin,
		browserOrigin: d.browserOrigin,
		accountUid: account,
		connectionScope: JSON.stringify([d.apiOrigin, account]),
	};
}

export function validateStorageUrl(value: unknown, origins: string[] = []): string {
	if (typeof value !== 'string') throw new UserError('Folderit did not return a storage URL.');
	let url: URL | undefined;
	try {
		url = new URL(value);
		publicUrl(url.origin);
	} catch {
		url = undefined;
	}
	if (!url) throw new UserError('Folderit returned an unsupported storage URL.');
	if (
		url.username ||
		url.password ||
		url.port ||
		url.hash ||
		(!url.hostname.endsWith('.amazonaws.com') && !origins.includes(url.origin))
	)
		throw new UserError(
			'Folderit returned an unsupported storage URL. Configure only this deployment’s exact public HTTPS storage origins.',
		);
	return value;
}

export async function storageRequest(context: Context, options: IHttpRequestOptions) {
	const d = await connectionDeployment(context);
	validateStorageUrl(options.url, d.storageOrigins);
	const headers = Object.fromEntries(
		Object.entries(options.headers || {}).filter(
			([key]) => !/^(authorization|proxy-authorization|cookie)$/i.test(key),
		),
	);
	const request = {
		...options,
		headers: options.headers ? headers : undefined,
		disableFollowRedirect: true,
		sendCredentialsOnCrossOriginRedirect: false,
	};
	return await context.helpers.httpRequest({ ...request, skipSslCertificateValidation: false });
}
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
		if (
			!path.startsWith('/') ||
			path.startsWith('//') ||
			/[?#\\]/.test(path) ||
			path.split('/').some((x) => x === '..' || x === '.')
		)
			throw new UserError('Invalid Folderit API path.');
		const type = credentialType(context);
		const d = await connectionDeployment(context);
		const optionsForRequest: IHttpRequestOptions = {
			method: 'GET',
			json: true,
			timeout: 60000,
			...options,
			url: `${d.apiOrigin}/v2${path}`,
			disableFollowRedirect: true,
			sendCredentialsOnCrossOriginRedirect: false,
		};
		if (type === LEGACY_CREDENTIAL)
			return await context.helpers.httpRequestWithAuthentication.call(
				context,
				type,
				optionsForRequest,
			);
		const credentials = await context.getCredentials(type);
		const selectedAccount = credentials.accountUid || credentials.selectedAccountUid;
		const requestedAccount = /^\/accounts\/([^/]+)/.exec(path)?.[1];
		if (selectedAccount && requestedAccount && requestedAccount !== selectedAccount)
			throw new UserError(
				'The requested account does not match this connection. Create a separate account connection.',
			);
		const read = optionsForRequest.method === 'GET';
		if (!read && requestedAccount) {
			// A harmless read lets n8n renew a rejected token before a write. Never replay a write.
			const account = await context.helpers.httpRequestWithAuthentication.call(
				context,
				type,
				{
					method: 'GET',
					url: `${d.apiOrigin}/v2/accounts/${validateUid(requestedAccount)}`,
					qs: { fields: 'uid' },
					json: true,
					timeout: 15000,
					disableFollowRedirect: true,
					sendCredentialsOnCrossOriginRedirect: false,
					skipSslCertificateValidation: false,
				},
				{ oauth2: { tokenExpiredStatusCode: 401 } },
			);
			if (account.uid !== requestedAccount)
				throw new UserError('The connection did not verify the exact account before writing.');
		}
		const response = await context.helpers.httpRequestWithAuthentication.call(
			context,
			type,
			{ ...optionsForRequest, skipSslCertificateValidation: false },
			{ oauth2: { tokenExpiredStatusCode: read ? 401 : [], skipTokenRefresh: !read } },
		);
		return withLinks(response, d);
	} catch (error) {
		if (error instanceof UserError) throw new NodeOperationError(context.getNode(), error.message);
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
