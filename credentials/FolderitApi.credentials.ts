import { createHash } from 'crypto';
import { UserError } from 'n8n-workflow';
import type {
	IAuthenticate,
	ICredentialDataDecryptedObject,
	ICredentialType,
	IDataObject,
	IHttpRequestHelper,
	IHttpRequestOptions,
	INodeProperties,
	Icon,
} from 'n8n-workflow';
import {
	deployment,
	pinnedRequest,
	verifyDiscovery,
	isPublicAddress,
} from '../nodes/Folderit/deployment';

export function binding(credentials: ICredentialDataDecryptedObject): string {
	return createHash('sha256')
		.update(
			JSON.stringify([
				deployment(credentials).apiOrigin,
				credentials.clientId,
				credentials.clientSecret,
				credentials.accountUid || '',
			]),
		)
		.digest('hex');
}

export function assertBinding(credentials: ICredentialDataDecryptedObject): void {
	if (credentials.sessionBinding && credentials.sessionBinding !== binding(credentials))
		throw new UserError(
			'This saved connection targets different deployment, account or client settings. Create a separate Folderit connection; the saved session was not retargeted.',
		);
}

export type NetworkProof = { apiAddress: string; authAddress: string };
export function networkProof(credentials: ICredentialDataDecryptedObject): NetworkProof {
	const proof = credentials._folderitNetwork as unknown as NetworkProof;
	if (!proof || !isPublicAddress(proof.apiAddress) || !isPublicAddress(proof.authAddress))
		throw new UserError(
			'Verify this credential using the Folderit Connection / Get operation. The node must establish public network routing before authentication.',
		);
	return proof;
}

function uid(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
		throw new UserError('Enter an exact Folderit account UID.');
	return value;
}

export class FolderitApi implements ICredentialType {
	name = 'folderitApi';
	displayName = 'Folderit Connection API';
	documentationUrl = 'https://www.folderit.com/knowledge-base/connect-folderit-to-n8n/';
	icon: Icon = {
		light: 'file:../nodes/Folderit/folderit.svg',
		dark: 'file:../nodes/Folderit/folderit.svg',
	};
	supportedNodes = [
		'n8n-nodes-folderit.folderit',
		'n8n-nodes-folderit.folderitTrigger',
		'n8n-nodes-folderit.folderitTool',
	];
	restrictToSupportedNodes = true as const;
	properties: INodeProperties[] = [
		{
			displayName:
				'Save this credential, then run Folderit → Connection → Get to verify routing and account access. Use a new credential for each deployment/account.',
			name: 'setupNotice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'API or Documentation URL',
			name: 'apiUrl',
			type: 'string',
			default: 'https://api.folderit.com',
			description:
				'Public API origin or supported API documentation URL. Leave the cloud default for standard Folderit.',
		},
		{ displayName: 'Client ID', name: 'clientId', type: 'string', required: true, default: '' },
		{
			displayName: 'Client Secret',
			name: 'clientSecret',
			type: 'string',
			required: true,
			typeOptions: { password: true },
			default: '',
		},
		{
			displayName: 'Account UID',
			name: 'accountUid',
			type: 'string',
			default: '',
			description:
				'Optional exact account UID. Leave blank only when this client has exactly one accessible account; multiple accounts require an explicit choice.',
		},
		{
			displayName: 'Browser or Sign-in URL',
			name: 'browserUrl',
			type: 'string',
			default: '',
			description:
				'Independent browser origin or normal login URL. Required for links outside standard cloud; a blank unknown origin produces no generated links.',
		},
		{
			displayName: 'Additional Storage Origins',
			name: 'storageOrigins',
			type: 'string',
			typeOptions: { rows: 3 },
			default: '',
			description:
				'Optional exact public HTTPS storage origins, one per line, for this deployment. S3 is supported by default. No wildcard, paths, private addresses or signed URLs.',
		},
		...[
			'sessionToken',
			'sessionBinding',
			'selectedAccountUid',
			'sessionExpiresAt',
			'verifiedApiAddress',
		].map((name) => ({
			displayName: name,
			name,
			type: 'hidden' as const,
			default: '',
			...(name === 'sessionToken' ? { typeOptions: { expirable: true, password: true } } : {}),
		})),
	];

	async preAuthentication(
		this: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
	): Promise<IDataObject> {
		assertBinding(credentials);
		const d = deployment(credentials),
			proof = networkProof(credentials);
		if (
			!String(credentials.clientId || '').trim() ||
			!String(credentials.clientSecret || '').trim()
		)
			throw new UserError('Enter the Client ID and matching Client Secret from this deployment.');
		const send = async (
			options: IHttpRequestOptions,
			origin: string,
			address: string,
			authorization?: string,
		) => {
			const request = pinnedRequest(options, origin, address);
			if (authorization) request.headers = { ...request.headers, Authorization: authorization };
			try {
				return await this.helpers.httpRequest({
					...request,
					returnFullResponse: true,
					timeout: 15000,
					json: true,
				});
			} catch {
				throw new UserError(
					'Folderit connection verification failed. Check the selected deployment, certificate, network access and client credentials. No fallback or write retry was attempted.',
				);
			}
		};
		const discovery = await send(
			{ method: 'GET', url: `${d.authOrigin}/.well-known/openid-configuration` },
			d.authOrigin,
			proof.authAddress,
		);
		if (discovery.statusCode !== 200 || JSON.stringify(discovery.body).length > 65536)
			throw new UserError(
				'Authentication discovery was unavailable or exceeded its bound. No client credentials were sent.',
			);
		verifyDiscovery(discovery.body as IDataObject, d);
		const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString(
			'base64',
		);
		const token = await send(
			{
				method: 'POST',
				url: `${d.authOrigin}/oauth2/token`,
				body: 'grant_type=client_credentials',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			},
			d.authOrigin,
			proof.authAddress,
			`Basic ${basic}`,
		);
		if (
			token.statusCode !== 200 ||
			typeof token.body?.access_token !== 'string' ||
			!token.body.access_token.trim()
		)
			throw new UserError('The selected deployment did not return a valid access token.');
		const bearer = `Bearer ${token.body.access_token}`;
		let selected: string;
		if (credentials.accountUid) {
			selected = uid(credentials.accountUid);
			const account = await send(
				{
					method: 'GET',
					url: `${d.apiOrigin}/v2/accounts/${selected}`,
					qs: { fields: 'uid,name' },
				},
				d.apiOrigin,
				proof.apiAddress,
				bearer,
			);
			if (account.statusCode !== 200 || account.body?.uid !== selected)
				throw new UserError('This deployment did not verify the exact selected account.');
		} else {
			const accounts: IDataObject[] = [],
				seen = new Set<string>();
			let cursor: string | undefined,
				complete = false;
			for (let page = 1; page <= 5; page++) {
				const response = await send(
					{
						method: 'GET',
						url: `${d.apiOrigin}/v2/accounts`,
						qs: { page, 'per-page': 100, fields: 'uid,name', ...(cursor ? { cursor } : {}) },
						headers: { 'X-Pagination': '1' },
					},
					d.apiOrigin,
					proof.apiAddress,
					bearer,
				);
				if (
					response.statusCode !== 200 ||
					!Array.isArray(response.body) ||
					response.body.length > 100
				)
					throw new UserError(
						'Account discovery returned an invalid or incomplete list. No account was selected.',
					);
				for (const item of response.body) {
					const id = uid(item.uid);
					if (seen.has(id))
						throw new UserError('Account discovery repeated an identity; no account was selected.');
					seen.add(id);
					accounts.push(item);
				}
				const next = response.headers?.['x-pagination-cursor'];
				if (!next && response.body.length < 100) {
					complete = true;
					break;
				}
				if (next && (typeof next !== 'string' || next === cursor))
					throw new UserError('Account discovery repeated a cursor.');
				cursor = next;
			}
			if (!complete)
				throw new UserError(
					'Account discovery reached its bound. Enter an exact Account UID in a new connection.',
				);
			if (accounts.length !== 1)
				throw new UserError(
					accounts.length
						? `Several accounts are accessible. Enter one exact Account UID in this credential: ${accounts
								.slice(0, 10)
								.map(
									(x) =>
										`${String(x.name || '')
											.split('')
											.map((c) => (c.charCodeAt(0) < 32 ? ' ' : c))
											.join('')
											.slice(0, 70)} (${x.uid})`,
								)
								.join(', ')}. No account was selected.`
						: 'No accessible Folderit account was found.',
				);
			selected = uid(accounts[0].uid);
			if (credentials.selectedAccountUid && credentials.selectedAccountUid !== selected)
				throw new UserError(
					'The accessible account changed. Create a new connection; the previous account was not retargeted.',
				);
		}
		const expires = Number(token.body.expires_in);
		return {
			sessionToken: token.body.access_token,
			sessionBinding: binding(credentials),
			selectedAccountUid: selected,
			verifiedApiAddress: proof.apiAddress,
			sessionExpiresAt:
				Date.now() +
				(Number.isFinite(expires) && expires > 0 ? Math.min(expires, 86400) : 60) * 1000,
		};
	}

	authenticate: IAuthenticate = async (credentials, requestOptions) => {
		assertBinding(credentials);
		const d = deployment(credentials),
			proof = networkProof(credentials);
		const url = new URL(requestOptions.url);
		if (
			url.protocol !== 'https:' ||
			url.hostname.replace(/^\[|\]$/g, '') !== proof.apiAddress ||
			requestOptions.agentOptions?.servername !== new URL(d.apiOrigin).hostname ||
			requestOptions.headers?.Host !== new URL(d.apiOrigin).hostname ||
			!/^\/v2\/accounts(?:\/|$)/.test(url.pathname) ||
			Boolean(url.username || url.password || url.port || url.hash)
		)
			throw new UserError(
				'Folderit credentials can only be used for this connection’s verified API.',
			);
		const account = /^\/v2\/accounts\/([^/]+)/.exec(url.pathname)?.[1];
		if (account && account !== credentials.selectedAccountUid)
			throw new UserError(
				'The requested account does not match this connection. Create a separate account connection.',
			);
		if (!credentials.sessionToken || credentials.sessionBinding !== binding(credentials))
			throw new UserError('The Folderit connection has no verified session.');
		return {
			...requestOptions,
			headers: { ...requestOptions.headers, Authorization: `Bearer ${credentials.sessionToken}` },
		};
	};
}
