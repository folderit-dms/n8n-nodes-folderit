const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Expression } = require('n8n-workflow');
const { FolderitConnectionOAuth2Api } = require('../dist/credentials/FolderitConnectionOAuth2Api.credentials');
const { api, resolveAccount, storageRequest } = require('../dist/nodes/Folderit/api');
const credential = new FolderitConnectionOAuth2Api();
const nativeTest = credential.test;
function evaluate(value, credentials) {
  return new Expression('UTC').resolveSimpleParameterValue(value, { $credentials: credentials, $self: credentials });
}
function context(credentials = {}, respond = () => ({ uid: 'account' })) {
  const calls = [];
  const c = { apiUrl: 'https://api.my.chaffinch.com', accountUid: 'account', ...credentials };
  return {
    calls, getCredentials: async () => c,
    getNode: () => ({ name: 'Synthetic', type: 'n8n-nodes-folderit.folderit', parameters: { authentication: 'folderitConnectionOAuth2Api' }, credentials: { folderitConnectionOAuth2Api: { id: 'synthetic', name: 'Synthetic' } } }),
    helpers: {
      httpRequestWithAuthentication: async (type, options, extra) => { calls.push({ type, ...options, extra }); return respond(options); },
      httpRequest: async options => { calls.push(options); return Buffer.from('synthetic'); },
    },
  };
}
test('built-in OAuth2 receives the exact sibling token endpoint for cloud and nested deployments', () => {
  const field = credential.properties.find(p => p.name === 'accessTokenUrl');
  assert(field, 'Folderit connection must provide the inherited OAuth2 token endpoint');
  for (const [apiUrl, endpoint] of [
    [undefined, 'https://auth.folderit.com/oauth2/token'],
    ['https://api.apollo.folderit.com/v2/', 'https://auth.apollo.folderit.com/oauth2/token'],
    ['https://api.my.chaffinch.com/#description/introduction', 'https://auth.my.chaffinch.com/oauth2/token'],
    ['https://API.MY.CHAFFINCH.COM/doc/v2.scalar.yaml', 'https://auth.my.chaffinch.com/oauth2/token'],
  ]) assert.equal(evaluate(field.default, { apiUrl }), endpoint);
  assert.deepEqual(credential.extends, ['oAuth2Api']);
  assert.equal(credential.properties.find(p => p.name === 'grantType').default, 'clientCredentials');
  assert.equal(credential.properties.find(p => p.name === 'authentication').default, 'header');
});
test('invalid deployment input cannot produce an OAuth2 destination', () => {
  const field = credential.properties.find(p => p.name === 'accessTokenUrl');
  assert(field, 'Derived OAuth2 destination required');
  for (const apiUrl of ['http://api.example.org', 'https://user:secret@api.example.org', 'https://api.example.org:444', 'https://api.localhost', 'https://api.host.internal', 'https://api.example.org?host=evil', 'https://api.example.org/a/../v2', 'https://api.example.org/%76%32', 'https://api.example.org\\@evil.org', 'https://api.bad..org', 'https://api.example.org/other', 'https://api.example.org/#unknown']) {
    assert.equal(evaluate(field.default, { apiUrl }), undefined, apiUrl);
  }
});
test('first-save credential test is a normal deployment-scoped read without a bootstrap session', () => {
  assert(nativeTest, 'A standard credential test is needed on first save');
  assert.equal(evaluate(nativeTest.request.baseURL, { apiUrl: 'https://api.apollo.folderit.com/doc/' }), 'https://api.apollo.folderit.com/v2');
  assert.equal(evaluate(nativeTest.request.url, { accountUid: 'exact-account' }), '/accounts/exact-account');
  assert.equal(evaluate(nativeTest.request.url, {}), '/accounts');
  assert.equal(evaluate(nativeTest.request.url, { accountUid: '../other' }), undefined);
  assert.equal(credential.preAuthentication, undefined);
});
test('custom deployment read uses the inherited OAuth2 helper without requiring a saved manual session', async () => {
  const c = context(); await api(c, '/accounts/account/files/file');
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].type, 'folderitConnectionOAuth2Api');
  assert.equal(c.calls[0].url, 'https://api.my.chaffinch.com/v2/accounts/account/files/file');
  assert.equal(c.calls[0].disableFollowRedirect, true);
  assert.equal(c.calls[0].skipSslCertificateValidation, false);
  assert.equal(c.calls[0].extra.oauth2.tokenExpiredStatusCode, 401);
});
test('a different explicit account stops before any authenticated request', async () => {
  const c = context();
  await assert.rejects(api(c, '/accounts/other/files/file'), /account/i);
  assert.equal(c.calls.length, 0);
});
test('write authenticates with a read preflight and is never replayed on a rejected token', async () => {
  const c = context(); await api(c, '/accounts/account/folders', { method: 'POST', body: { name: 'Synthetic' } });
  assert.equal(c.calls.length, 2);
  assert.equal(c.calls[0].url, 'https://api.my.chaffinch.com/v2/accounts/account');
  assert.equal(c.calls[0].method, 'GET');
  assert.equal(c.calls[1].method, 'POST');
  assert.deepEqual(c.calls[1].extra.oauth2.tokenExpiredStatusCode, []);
  assert.equal(c.calls[1].extra.oauth2.skipTokenRefresh, true);
});
test('a failed account preflight cannot reach the write boundary', async () => {
  const c = context({}, () => { throw Object.assign(new Error('Rejected'), { statusCode: 401 }); });
  await assert.rejects(api(c, '/accounts/account/folders', { method: 'POST' }));
  assert.equal(c.calls.length, 1); assert.equal(c.calls[0].method, 'GET');
});
test('anonymous custom storage uses native transport and strips auth and cookies', async () => {
  const c = context({ storageOrigins: 'https://storage.my.chaffinch.com' });
  await storageRequest(c, { url: 'https://storage.my.chaffinch.com/file?sig=a%2Fb', headers: { Authorization: 'Bearer wrong', Cookie: 'private' } });
  assert.equal(c.calls[0].url, 'https://storage.my.chaffinch.com/file?sig=a%2Fb');
  assert.equal(c.calls[0].headers.Authorization, undefined); assert.equal(c.calls[0].headers.Cookie, undefined);
  assert.equal(c.calls[0].disableFollowRedirect, true); assert.equal(c.calls[0].skipSslCertificateValidation, false);
});
test('automatic account selection refuses more than one accessible account', async () => {
  const c = context({ accountUid: '' }, () => [{ uid: 'one' }, { uid: 'two' }]);
  await assert.rejects(resolveAccount(c, ''), /exact account|Several|multiple/i);
});

test('implicit account selection completes pagination before choosing a sole account', async () => {
  const c = context({ accountUid: '' }, options => options.qs.page === 1 ? { body: [{ uid: 'one' }], headers: { 'x-pagination-cursor': 'next' } } : { body: [{ uid: 'two' }], headers: {} });
  await assert.rejects(resolveAccount(c, ''), /exact account|multiple/i);
  assert.equal(c.calls.length, 2);
  assert.equal(c.calls[1].qs.cursor, 'next');
});
test('repeated or incomplete account pages never silently pick an identity', async () => {
  const c = context({ accountUid: '' }, () => ({ body: [{ uid: 'one' }], headers: { 'x-pagination-cursor': 'repeated' } }));
  await assert.rejects(resolveAccount(c, ''), /repeated|incomplete|bound/i);
});

test('n8n normalization preserves saved 0.5 binding and selected account before any request', () => {
  const { NodeHelpers } = require('n8n-workflow');
  const normalized = NodeHelpers.getNodeParameters(credential.properties, {
    apiUrl: 'https://api.my.chaffinch.com', sessionBinding: 'saved-0.5-binding', selectedAccountUid: 'old-account',
  }, true, false, null, null);
  assert.equal(normalized.sessionBinding, 'saved-0.5-binding');
  assert.equal(normalized.selectedAccountUid, 'old-account');
});

test('existing standard-cloud account pickers keep their original request contract', async () => {
  const { loadOptions } = require('../dist/nodes/Folderit/discovery');
  const calls = [];
  const legacy = { getNode: () => ({ parameters: {} }), helpers: {
    httpRequestWithAuthentication: async (type, options) => { calls.push(options); return [{ uid: 'legacy-account', name: 'Legacy' }]; },
  } };
  assert.deepEqual(await loadOptions.getAccounts.call(legacy), [{name:'Legacy (legacy-account)',value:'legacy-account'}]);
  assert.equal(calls[0].returnFullResponse, undefined);
  assert.equal(calls[0].headers, undefined);
});

test('native credential defaults derive the token URL from credential self data', async () => {
  const { NodeHelpers, Workflow } = require('n8n-workflow');
  const node = { name: 'Credential test', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {} };
  const workflow = new Workflow({ nodes: [node], connections: {}, active: false, nodeTypes: { getByNameAndVersion: () => ({ description: { properties: [] } }) } });
  const data = NodeHelpers.getNodeParameters(credential.properties, { apiUrl: 'https://api.apollo.folderit.com' }, true, false, null, null);
  await workflow.expression.acquireIsolate();
  try {
    const resolved = workflow.expression.getComplexParameterValue(node, data, 'internal', {}, undefined, undefined, data);
    assert.equal(resolved.accessTokenUrl, 'https://auth.apollo.folderit.com/oauth2/token');
  } finally {
    await workflow.expression.releaseIsolate();
  }
});
