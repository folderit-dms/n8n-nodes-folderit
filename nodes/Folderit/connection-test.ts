import type { ICredentialTestFunction } from 'n8n-workflow';
import { assertBinding } from '../../credentials/FolderitApi.credentials';
import { deployment, isPublicAddress, pinnedRequest } from './deployment';

// CredentialTestContext has only the legacy request helper, not secure DNS.
// Bootstrap routing in Connection/Get; then the modal can independently read
// the selected account over that public, certificate-checked pinned route.
export const testFolderitConnection: ICredentialTestFunction = async function (credential) {
	try {
		const data = credential.data || {};
		assertBinding(data);
		const d = deployment(data);
		if (
			!data.sessionToken ||
			!data.sessionBinding ||
			!isPublicAddress(String(data.verifiedApiAddress)) ||
			Number(data.sessionExpiresAt) <= Date.now()
		)
			return {
				status: 'Error',
				message:
					'Save this credential, run Folderit → Connection → Get once to verify public routing and account access, then retest here. Expired tokens renew automatically in Folderit nodes.',
			};
		const uid = String(data.selectedAccountUid || '');
		if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid))
			return {
				status: 'Error',
				message: 'No verified account scope is saved. Run Folderit → Connection → Get.',
			};
		const request = pinnedRequest(
			{ url: `${d.apiOrigin}/v2/accounts/${uid}`, method: 'GET', qs: { fields: 'uid,name' } },
			d.apiOrigin,
			String(data.verifiedApiAddress),
		);
		// CredentialTestContext exposes only this documented transport; normal node calls use httpRequest.
		const { request: requestCredentialTest } = this.helpers;
		const response = await requestCredentialTest({
			uri: request.url,
			method: 'GET',
			qs: request.qs,
			headers: { ...request.headers, Authorization: `Bearer ${data.sessionToken}` },
			agentOptions: request.agentOptions,
			strictSSL: true,
			followRedirect: false,
			followAllRedirects: false,
			resolveWithFullResponse: true,
			json: true,
			timeout: 15000,
		});
		return response.statusCode === 200 && response.body?.uid === uid
			? {
					status: 'OK',
					message:
						'The selected deployment and exact account passed a live read using the verified public route.',
				}
			: {
					status: 'Error',
					message:
						'The selected deployment did not verify the saved account. Run Connection → Get to check current routing and renew the token.',
				};
	} catch {
		return {
			status: 'Error',
			message:
				'Folderit connection verification failed. Check this deployment and account, or create a separate connection if its settings changed.',
		};
	}
};
