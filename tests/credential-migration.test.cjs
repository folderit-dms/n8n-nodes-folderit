const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { api } = require('../dist/nodes/Folderit/api');
const manifest = require('../package.json');

const current = 'folderitConnectionOAuth2Api';
function context(authentication, references) {
	const calls = [];
	return {
		calls,
		getNode: () => ({
			name: 'Migration test',
			type: 'n8n-nodes-folderit.folderit',
			parameters: authentication === undefined ? {} : { authentication },
			credentials: references,
		}),
		getCredentials: async (type) => {
			calls.push({ boundary: 'credentials', type });
			return { apiUrl: 'https://api.folderit.com', accountUid: 'account' };
		},
		helpers: {
			httpRequestWithAuthentication: async (type, options) => {
				calls.push({ boundary: 'http', type, options });
				return { uid: 'account' };
			},
		},
	};
}

test('registered deployment credential has the OAuth2 machine and class names required by n8n', () => {
	const registered = manifest.n8n.credentials.flatMap((file) => {
		const module = require(path.join('..', file));
		return Object.values(module)
			.filter((value) => typeof value === 'function' && value.prototype)
			.filter((value) => value.name.endsWith('Api'))
			.map((Type) => new Type());
	});
	const deployment = registered.find((type) => type.name === current);
	assert.ok(deployment, 'Register the new OAuth2-named deployment credential');
	assert.equal(deployment.constructor.name, 'FolderitConnectionOAuth2Api');
	assert.deepEqual(deployment.extends, ['oAuth2Api']);
	assert.ok(registered.some((type) => type.name === 'folderitOAuth2Api'));
	assert.ok(!registered.some((type) => type.name === 'folderitApi'));
});

test('retired deployment authentication stops before credential access or writes', async () => {
	const c = context('folderitApi', { folderitApi: { id: 'old', name: 'Retained old connection' } });
	await assert.rejects(
		api(c, '/accounts/account/folders', { method: 'POST', body: { name: 'Synthetic' } }),
		/migration|recreate|new.*connection/i,
	);
	assert.deepEqual(c.calls, []);
});

test('an export with only a retired deployment reference cannot fall back to cloud authentication', async () => {
	const c = context(undefined, { folderitApi: { id: 'old', name: 'Retained old connection' } });
	await assert.rejects(
		api(c, '/accounts/account/files/file'),
		/migration|recreate|new.*connection/i,
	);
	assert.deepEqual(c.calls, []);
});

test('new deployment selection uses only its new credential despite a stale retired reference', async () => {
	const c = context(current, {
		folderitApi: { id: 'old', name: 'Retained old connection' },
		[current]: { id: 'new', name: 'Replacement connection' },
	});
	await api(c, '/accounts/account/files/file');
	assert.ok(c.calls.length > 0);
	assert.ok(c.calls.every((call) => call.type === current));
});

for (const [className, file] of [
  ['Folderit', '../dist/nodes/Folderit/Folderit.node'],
  ['FolderitTrigger', '../dist/nodes/Folderit/FolderitTrigger.node'],
]) {
  test(`${className} normalized old-only imports stop before credential access or requests`, async () => {
    const { Workflow } = require('n8n-workflow');
    const Type = require(file)[className];
    const type = new Type();
    const node = {
      id: 'migration-import', name: 'Migration test',
      type: `n8n-nodes-folderit.${type.description.name}`, typeVersion: 1,
      position: [0, 0], parameters: { accountUid: 'account' },
      credentials: { folderitApi: { id: 'old', name: 'Retained old connection' } },
    };
    const workflow = new Workflow({
      nodes: [node], connections: {}, active: false,
      nodeTypes: { getByNameAndVersion: () => type },
    });
    const normalized = workflow.getNode(node.name);
    assert.equal(normalized.parameters.authentication, 'folderitOAuth2Api');
    const c = context(undefined, {});
    c.getNode = () => normalized;
    await assert.rejects(api(c, '/accounts/account/files/file'), /migration|recreate/i);
    assert.deepEqual(c.calls, []);
  });
}

test('a valid cloud reference remains usable alongside a stale retired reference', async () => {
  const c = context('folderitOAuth2Api', {
    folderitOAuth2Api: { id: 'cloud', name: 'Existing standard cloud connection' },
    folderitApi: { id: 'old', name: 'Retained old connection' },
  });
  await api(c, '/accounts/account/files/file');
  assert.ok(c.calls.length > 0);
  assert.ok(c.calls.every(call => call.type === 'folderitOAuth2Api'));
});
