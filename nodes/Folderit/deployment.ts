import { UserError } from 'n8n-workflow';
import type { IDataObject, ICredentialDataDecryptedObject } from 'n8n-workflow';

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
			'The API hostname must follow api.<deployment-domain> so the sibling OAuth2 token endpoint can be derived.',
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
