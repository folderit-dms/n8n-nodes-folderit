import { UserError } from 'n8n-workflow';
import type {
	IDataObject,
	ICredentialDataDecryptedObject,
	IHttpRequestOptions,
	NodeEgressFilter,
} from 'n8n-workflow';

export const CLOUD_API = 'https://api.folderit.com';
export const CLOUD_WEB = 'https://my.folderit.com';
export const CLOUD_AUTH = 'https://auth.folderit.com';
export const INSTANCE_CREDENTIAL = 'folderitApi';
export const LEGACY_CREDENTIAL = 'folderitOAuth2Api';
export type Deployment = {
	apiOrigin: string;
	authOrigin: string;
	browserOrigin: string | null;
	storageOrigins: string[];
};

export function publicUrl(value: unknown): URL {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		/[\\\s]/.test(value.trim()) ||
		value.split('').some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
	)
		throw new UserError('Enter a public HTTPS URL without credentials or whitespace.');
	let url: URL | undefined;
	try {
		url = new URL(value.trim());
	} catch {
		url = undefined;
	}
	if (!url) throw new UserError('Enter a valid public HTTPS URL.');
	const labels = url.hostname.split('.');
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.port ||
		labels.length < 2 ||
		labels.some((x) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(x)) ||
		/(?:^|\.)(?:localhost|local|internal|home|test|invalid|example)$/.test(url.hostname) ||
		/^\d+(?:\.\d+)*$/.test(url.hostname)
	)
		throw new UserError(
			'Only public HTTPS hostnames with valid certificates are supported. Private hosts, IP literals and custom ports are not supported.',
		);
	const raw = value
		.trim()
		.split('#')[0]
		.replace(/^https:\/\//i, '');
	if (raw.includes('%') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(raw))
		throw new UserError('Encoded hostnames and relative URL paths are not supported.');
	return url;
}

export function apiOrigin(value: unknown = CLOUD_API): string {
	const url = publicUrl(value || CLOUD_API);
	if (
		url.search ||
		!['/', '/v2', '/v2/', '/doc', '/doc/', '/doc/v2.scalar.yaml'].includes(url.pathname) ||
		(url.hash && !/^#(?:description|tag|operation|model)\//i.test(url.hash))
	)
		throw new UserError('Enter the API origin or a supported API documentation URL.');
	return url.origin;
}

export function browserOrigin(value: unknown, api: string): string | null {
	if (!value) return api === CLOUD_API ? CLOUD_WEB : null;
	const url = publicUrl(value);
	if (
		url.search ||
		url.hash ||
		(url.pathname !== '/' && !/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?login\/?$/i.test(url.pathname))
	)
		throw new UserError('Enter the browser origin or its normal sign-in URL.');
	return url.origin;
}

export function deployment(credentials: ICredentialDataDecryptedObject): Deployment {
	const api = apiOrigin(credentials.apiUrl);
	const host = new URL(api).hostname;
	if (!host.startsWith('api.') || host.slice(4).split('.').length < 2)
		throw new UserError(
			'The API hostname must follow api.<deployment-domain> so authentication discovery can be verified.',
		);
	const storage = String(credentials.storageOrigins || '')
		.split(/[\n,]/)
		.map((x) => x.trim())
		.filter(Boolean)
		.map((x) => {
			const url = publicUrl(x);
			if (url.pathname !== '/' || url.search || url.hash)
				throw new UserError(
					'Storage origins must be exact HTTPS origins, without paths or signatures.',
				);
			return url.origin;
		});
	return {
		apiOrigin: api,
		authOrigin: `https://auth.${host.slice(4)}`,
		browserOrigin: browserOrigin(credentials.browserUrl, api),
		storageOrigins: [...new Set(storage)],
	};
}

export function verifyDiscovery(metadata: IDataObject, d: Deployment): void {
	if (
		!metadata ||
		![d.authOrigin, d.authOrigin + '/'].includes(String(metadata.issuer)) ||
		metadata.token_endpoint !== `${d.authOrigin}/oauth2/token` ||
		!Array.isArray(metadata.grant_types_supported) ||
		!metadata.grant_types_supported.some((x) => x === 'client_credentials') ||
		!Array.isArray(metadata.token_endpoint_auth_methods_supported) ||
		!metadata.token_endpoint_auth_methods_supported.some((x) => x === 'client_secret_basic')
	)
		throw new UserError(
			'Authentication discovery does not match this deployment and client-credentials method. No client credentials were sent.',
		);
}

// A second explicit IP check keeps operator allowlists from enabling private deployments.
export function isPublicAddress(address: string): boolean {
	if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) {
		if (!address.split('.').every((x) => /^(?:0|[1-9]\d{0,2})$/.test(x))) return false;
		const n = address.split('.').map(Number);
		if (n.some((x) => x > 255)) return false;
		const [a, b, c] = n;
		return !(
			a === 0 ||
			a === 10 ||
			a === 127 ||
			a >= 224 ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && (b === 168 || b === 0 || b === 2 || (b === 88 && c === 99))) ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
			(a === 203 && b === 0 && c === 113)
		);
	}
	// Accept ordinary global-unicast IPv6 only; exclude transition and documentation ranges.
	if (address.includes('.') || address.includes('%')) return false;
	let normalized: string;
	try {
		normalized = new URL(`https://[${address}]/`).hostname.slice(1, -1);
	} catch {
		return false;
	}
	const [first, second] = normalized.split(':').map((x) => parseInt(x || '0', 16));
	return (
		first >= 0x2000 &&
		first <= 0x3fff &&
		first !== 0x2002 &&
		first !== 0x3ffe &&
		first !== 0x3fff &&
		!(first === 0x2001 && (second < 0x200 || second === 0xdb8))
	);
}

export async function pinHost(filter: NodeEgressFilter, origin: string): Promise<string> {
	const result = await filter.validateUrl(origin);
	if (!result.ok)
		throw new UserError(
			'The deployment host was blocked by n8n network protection. No credentials were sent.',
		);
	const hostname = new URL(origin).hostname;
	const addresses = await new Promise<Array<{ address: string; family: number }>>(
		(resolve, reject) => {
			filter.createSecureLookup()(hostname, { all: true }, (error, values) =>
				error
					? reject(error)
					: Array.isArray(values)
						? resolve(values)
						: reject(new Error('Incomplete public DNS result')),
			);
		},
	).catch(() => {
		throw new UserError('The public deployment hostname could not be safely resolved.');
	});
	if (!addresses.length || addresses.some((x) => !isPublicAddress(x.address)))
		throw new UserError(
			'Private, reserved or mixed public/private network destinations are not supported.',
		);
	return addresses.find((x) => x.family === 4)?.address || addresses[0].address;
}

export function pinnedRequest(
	options: IHttpRequestOptions,
	origin: string,
	address: string,
): IHttpRequestOptions {
	const url = new URL(options.url);
	if (url.origin !== origin || !isPublicAddress(address))
		throw new UserError('A request tried to leave its verified deployment.');
	const hostname = url.hostname;
	url.hostname = address.includes(':') ? `[${address}]` : address;
	const headers = Object.fromEntries(
		Object.entries(options.headers || {}).filter(
			([key]) => !/^(host|authorization|proxy-authorization)$/i.test(key),
		),
	);
	return {
		...options,
		url: url.toString(),
		headers: { ...headers, Host: hostname },
		agentOptions: { servername: hostname, rejectUnauthorized: true },
		skipSslCertificateValidation: false,
		disableFollowRedirect: true,
		sendCredentialsOnCrossOriginRedirect: false,
	};
}

export function recordLink(d: Deployment, type: unknown, uid: unknown): string | null {
	if (!d.browserOrigin || !['file', 'folder'].includes(String(type)) || typeof uid !== 'string')
		return null;
	return `${d.browserOrigin}/${type === 'folder' ? 'folder/index' : 'file/view'}/?uid=${encodeURIComponent(uid)}`;
}

export function withLinks(value: unknown, d: Deployment): unknown {
	if (Array.isArray(value)) return value.map((x) => withLinks(x, d));
	if (!value || typeof value !== 'object') return value;
	const obj = { ...(value as IDataObject) };
	for (const key of Object.keys(obj)) {
		const v = obj[key];
		if (typeof v === 'string' && ['url', 'webUrl', 'folderitUrl'].includes(key)) {
			let url: URL;
			try {
				url = new URL(v);
			} catch {
				continue;
			}
			if (url.origin === CLOUD_WEB && /^\/(?:file\/view|folder\/index)\/?$/.test(url.pathname)) {
				if (d.browserOrigin) obj[key] = d.browserOrigin + url.pathname + url.search;
				else delete obj[key];
			}
		} else if (v && typeof v === 'object') obj[key] = withLinks(v, d) as IDataObject;
	}
	const link = recordLink(d, obj.type, obj.uid);
	if (link) obj.folderitUrl = link;
	return obj;
}
