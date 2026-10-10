import type { ICredentialType, INodeProperties, Icon } from 'n8n-workflow';

export class FolderitOAuth2Api implements ICredentialType {
	name = 'folderitOAuth2Api';
	icon: Icon = {
		light: 'file:../nodes/Folderit/folderit.svg',
		dark: 'file:../nodes/Folderit/folderit.svg',
	};
	displayName = 'Folderit OAuth2 API';
	extends = ['oAuth2Api'];
	documentationUrl = 'https://api.folderit.com/';
	properties: INodeProperties[] = [
		{ displayName: 'Grant Type', name: 'grantType', type: 'hidden', default: 'clientCredentials' },
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: 'https://auth.folderit.com/oauth2/token',
		},
		{ displayName: 'Authentication', name: 'authentication', type: 'hidden', default: 'header' },
		{ displayName: 'Scope', name: 'scope', type: 'hidden', default: '' },
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
	];
}
