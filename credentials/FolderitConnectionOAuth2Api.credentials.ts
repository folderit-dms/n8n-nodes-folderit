import { createHash } from 'crypto';
import { UserError } from 'n8n-workflow';
import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';
import { deployment } from '../nodes/Folderit/deployment';

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

// This expression is evaluated by n8n before its built-in OAuth2 transport.
// Accept the same API/documentation forms as deployment(), never a caller-provided auth URL.
const apiOriginExpression = String.raw`(() => {
  const raw = String($credentials.apiUrl || 'https://api.folderit.com');
  if (raw.split('').some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new Error('Enter a public HTTPS API URL');
  const match = raw.trim().match(/^https:\/\/(api\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\/(?:v2\/?|doc\/?|doc\/v2\.scalar\.yaml)?)?(?:#(?:description|tag|operation|model)\/[^\\\s]*)?$/i);
  if (!match || /(?:^|\.)(?:localhost|local|internal|home|test|invalid|example)$/i.test(match[1])) throw new Error('Enter a public HTTPS API origin or supported documentation URL');
  return 'https://' + match[1].toLowerCase();
})()`;

export class FolderitConnectionOAuth2Api implements ICredentialType {
	name = 'folderitConnectionOAuth2Api';
	displayName = 'Folderit Connection OAuth2 API';
	extends = ['oAuth2Api'];
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
	properties: INodeProperties[] = [
		{ displayName: 'Grant Type', name: 'grantType', type: 'hidden', default: 'clientCredentials' },
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			// Credential defaults resolve their own fields through $self; $credentials is for request expressions.
			default: `={{ ${apiOriginExpression.split('$credentials').join('$self')}.replace('https://api.', 'https://auth.') + '/oauth2/token' }}`,
		},
		{ displayName: 'Authentication', name: 'authentication', type: 'hidden', default: 'header' },
		{ displayName: 'Scope', name: 'scope', type: 'hidden', default: '' },
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
		{ displayName: 'Ignore SSL Issues', name: 'ignoreSSLIssues', type: 'hidden', default: false },
		{
			displayName: 'API or Documentation URL',
			name: 'apiUrl',
			type: 'string',
			default: 'https://api.folderit.com',
			description:
				'Public API origin or supported API documentation URL. Leave the cloud default for standard Folderit.',
		},
		{
			displayName: 'Account UID',
			name: 'accountUid',
			type: 'string',
			default: '',
			description:
				'Optional exact account UID. Leave blank only when this client has exactly one accessible account. Multiple accounts require an explicit choice.',
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
		// n8n drops undeclared stored fields. Keep these to enforce existing 0.5.0 scope bindings.
		{
			displayName: 'Saved Connection Binding',
			name: 'sessionBinding',
			type: 'hidden',
			default: '',
		},
		{ displayName: 'Saved Account UID', name: 'selectedAccountUid', type: 'hidden', default: '' },
	];
	test: ICredentialTestRequest = {
		request: {
			baseURL: `={{ ${apiOriginExpression} + '/v2' }}`,
			url: "={{ (() => { const uid = $credentials.accountUid; if (!uid) return '/accounts'; if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('Enter an exact Folderit account UID'); return '/accounts/' + uid; })() }}",
			method: 'GET',
			qs: { fields: 'uid,name', 'per-page': 1 },
			disableFollowRedirect: true,
			skipSslCertificateValidation: false,
		},
	};
}
