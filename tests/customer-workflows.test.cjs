const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const files = ['folderit-ledger-setup.json', 'email-attachments-to-folderit-safe.json', 'outlook-attachments-to-folderit-safe.json', 'folderit-new-files-to-teams.json', 'folderit-expiry-reminders-to-teams.json', 'folderit-failure-alert-email.json'];
const workflows = Object.fromEntries(files.map(name => [name, JSON.parse(fs.readFileSync(path.join(__dirname, '../examples', name), 'utf8'))]));
function run(file, name, items, refs = {}, extra = {}) {
  const code = workflows[file].nodes.find(n => n.name === name).parameters.jsCode;
  return vm.runInNewContext('(function(){' + code + '\n})()', {
    $input: { all: () => items, first: () => items[0] },
    $execution: { id: 'execution-qa' },
    $: name => ({ first: () => refs[name]?.[0], all: () => refs[name] || [], item: refs[name]?.[0] }),
    ...extra,
  });
}
const archive = 'email-attachments-to-folderit-safe.json';
const settings = { accountUid: 'test-account', folderUid: 'test-folder', ledgerTableId: 'test-table', mailboxScope: 'test-mailbox', allowedExtensions: 'pdf,txt' };
const message = { json: { messageId: '<synthetic-message>' }, binary: { attachment_0: { fileName: 'one.txt', data: 'YQ==' }, attachment_1: { fileName: 'two.pdf', data: 'Yg==' }, attachment_2: { fileName: 'blocked.exe', data: 'Yw==' } } };
const refs = { Settings: [{ json: settings }], 'New email with attachments': [message] };

test('customer exports have valid wiring and no saved credentials, private fixtures or pinned output', () => {
  for (const w of Object.values(workflows)) {
    assert.equal(w.active, false); assert.deepEqual(w.pinData, {});
    assert.ok(w.nodes.every(n => !n.credentials && !n.retryOnFail));
    const names = new Set(w.nodes.map(n => n.name)); assert.equal(names.size, w.nodes.length);
    for (const [source, types] of Object.entries(w.connections)) {
      assert.ok(names.has(source));
      for (const outputs of Object.values(types)) for (const edges of outputs) for (const edge of edges) assert.ok(names.has(edge.node));
    }
    assert.ok(w.nodes.some(n => n.type.endsWith('stickyNote')));
    assert.doesNotMatch(JSON.stringify(w), /J1kW50aDN5|FolderitDemoNative|127\.0\.0\.1:5690|X-Folderit-QA/);
  }
});
test('email split handles multiple attachments and filters unapproved file types', () => {
  const result = run(archive, 'Split and validate attachments', [], refs);
  assert.equal(result.length, 2); assert.equal(result[0].binary.data.data, 'YQ=='); assert.equal(result[1].json.fileName, 'two.pdf');
});
test('email with no attachments produces no work; multiple messages preserve item pairing', () => {
  assert.equal(run(archive, 'Split and validate attachments', [], { ...refs, 'New email with attachments': [{ json: {} }] }).length, 0);
  const result = run(archive, 'Split and validate attachments', [], { ...refs, 'New email with attachments': [message, message] });
  assert.equal(result.length, 4); assert.equal(result[2].pairedItem.item, 1);
});
test('missing message identity or configuration fails before acquiring the processing lock', () => {
  assert.throws(() => run(archive, 'Split and validate attachments', [], { ...refs, 'New email with attachments': [{ ...message, json: {} }] }), /stable/);
  assert.throws(() => run(archive, 'Split and validate attachments', [], { ...refs, Settings: [{ json: { ...settings, ledgerTableId: 'YOUR_ID' } }] }), /ledgerTableId/);
});
test('attachment keys distinguish mailbox, destination, message, part and content while remaining stable on replay', () => {
  const j = { ...run(archive, 'Split and validate attachments', [], refs)[0].json, payloadHash: 'a'.repeat(64) };
  const key = json => run(archive, 'Build attachment receipt keys', [{ json }], { 'Split and validate attachments': [{ json, binary: { data: { data: 'YQ==' } } }] })[0].json.receiptKey;
  assert.equal(key(j), key({ ...j }));
  for (const [k, value] of Object.entries({ mailboxScope: 'other', folderUid: 'other', messageId: 'other', sourceAttachment: 'other', payloadHash: 'b'.repeat(64) })) assert.notEqual(key(j), key({ ...j, [k]: value }));
  assert.throws(() => key({ ...j, payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }), /Empty/);
});
test('the archive restores attachment bytes after the Crypto node drops binary output', () => {
  const input = { json: { payloadHash: 'a'.repeat(64) } };
  const result = run(archive, 'Build attachment receipt keys', [input], { 'Split and validate attachments': [{ json: {}, binary: { data: { data: 'YQ==' } } }] });
  assert.equal(result[0].binary.data.data, 'YQ==');
  assert.throws(() => run(archive, 'Build attachment receipt keys', [input], { 'Split and validate attachments': [{ json: {} }] }), /binary is unavailable/);
});
test('only the current lock owner can continue, including stale readback and empty conditional-update cases', () => {
  assert.throws(() => run(archive, 'Confirm lock ownership', [{ json: {} }]), /Another run/);
  assert.throws(() => run(archive, 'Confirm lock ownership', [{ json: { id: 1, owner: 'other', state: 'held' } }]), /Another run/);
  assert.equal(run(archive, 'Confirm lock ownership', [{ json: { id: 1, owner: 'execution-qa', state: 'held' } }]).length, 1);
  assert.throws(() => run(archive, 'Check lock record', [{ json: { id: 1, sourceRef: 'folderit-ledger/v1' } }], {}, { $execution: {} }), /identity/);
});
test('unresolved, duplicated or mismatched receipts never repeat a destination action', () => {
  const source = { json: { receiptKey: 'key', payloadHash: 'hash' } }; const r = { 'Process one item': [source] };
  for (const state of ['pending', 'uncertain', 'error']) assert.throws(() => run(archive, 'Decide whether to process', [{ json: { id: 2, key: 'key', payloadHash: 'hash', state, targetUid: '' } }], r), /unresolved/);
  assert.throws(() => run(archive, 'Decide whether to process', [{ json: { id: 1 } }, { json: { id: 2 } }], r), /Duplicate/);
  assert.throws(() => run(archive, 'Decide whether to process', [{ json: { id: 1, key: 'different', state: 'done', targetUid: 'file' } }], r), /does not match/);
  assert.equal(run(archive, 'Decide whether to process', [{ json: { id: 2, key: 'key', payloadHash: 'hash', state: 'done', targetUid: 'file' } }], r)[0].json.route, 'done');
  assert.equal(run(archive, 'Decide whether to process', [{ json: {} }], r)[0].json.route, 'new');
});
test('upload readback must match destination, name and byte hash before completing the receipt', () => {
  const expected = { fileName: 'one.txt', folderUid: 'folder', payloadHash: 'hash', receiptRowId: 3 };
  const good = { uid: 'file', name: 'one.txt', folderUid: 'folder', hash: { sha256: '' } };
  const r = { 'Restore work item': [{ json: expected }], 'Read uploaded document': [{ json: good }] };
  assert.equal(run(archive, 'Verify destination result', [{ json: { verifiedHash: 'hash' } }], r)[0].json.targetUid, 'file');
  for (const j of [{ ...good, name: 'wrong' }, { ...good, folderUid: 'wrong' }]) assert.throws(() => run(archive, 'Verify destination result', [{ json: { verifiedHash: 'hash' } }], { ...r, 'Read uploaded document': [{ json: j }] }), /readback/);
  assert.throws(() => run(archive, 'Verify destination result', [{ json: { verifiedHash: 'wrong' } }], r), /readback/);
});
test('completion and unlock are conditional on the owning execution and both are read back', () => {
  for (const filename of files.filter(f => f.includes('safe') || f.includes('to-teams'))) {
    const w = workflows[filename];
    for (const name of ['Acquire processing lock', 'Save completed receipt', 'Release processing lock']) {
      const n = w.nodes.find(n => n.name === name);
      assert.equal(n.parameters.operation, 'update'); assert.equal(n.parameters.matchType, 'allConditions');
      assert.ok(n.parameters.filters.conditions.some(f => f.keyName === 'owner'));
    }
  }
  assert.throws(() => run(archive, 'Confirm completed receipt', [{ json: {} }], { 'Verify destination result': [{ json: { targetUid: 'file' } }] }), /could not be confirmed/);
  assert.throws(() => run(archive, 'Confirm lock released', [{ json: { id: 1, key: '__mutex__', owner: 'other', state: 'free' } }]), /lock release/);
});
const RealDate = Date; const day = '2026-10-27T12:00:00Z';
class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : [day])); } static now() { return new RealDate(day).getTime(); } }
const reminderFile = 'folderit-expiry-reminders-to-teams.json';
const reminderCfg = { accountUid: 'account', ledgerTableId: 'table', teamId: 'team', channelId: 'channel', reminderDays: '30,7,1,0', overdueDays: 7 };
const due = days => new RealDate(new RealDate(day).getTime() + days * 86400000).toISOString().slice(0, 10);
const remind = (days, config = reminderCfg) => run(reminderFile, 'Select due reminders', [{ json: { uid: 'file', type: 'file', name: 'Renewal certificate', dueDate: due(days) } }], { Settings: [{ json: config }] }, { Date: FixedDate });
test('expiry milestones catch up to one current window and stop beyond the configured overdue window', () => {
  for (const [days, milestone] of [[30, 30], [20, 30], [7, 7], [2, 7], [1, 1], [0, 0], [-7, 0]]) {
    const r = remind(days); assert.equal(r.length, 1); assert.ok(r[0].json.receiptKey.includes(',' + milestone + ','));
  }
  assert.equal(remind(31).length, 0); assert.equal(remind(-8).length, 0);
});
test('expiry keys repeat stably but change with expiry date, milestone or destination', () => {
  assert.equal(remind(20)[0].json.receiptKey, remind(20)[0].json.receiptKey);
  assert.notEqual(remind(20)[0].json.receiptKey, remind(19)[0].json.receiptKey);
  assert.notEqual(remind(20)[0].json.receiptKey, remind(20, { ...reminderCfg, channelId: 'other' })[0].json.receiptKey);
  assert.ok(remind(20)[0].json.notificationText.includes('Renewal certificate'));
});
test('expiry handles absent, malformed and impossible dates explicitly', () => {
  const r = { Settings: [{ json: reminderCfg }] };
  assert.equal(run(reminderFile, 'Select due reminders', [{ json: { uid: 'file', type: 'file' } }], r, { Date: FixedDate }).length, 0);
  for (const d of ['2026-02-30', 'not-a-date', '2026-10-27T00:00:00Z']) assert.throws(() => run(reminderFile, 'Select due reminders', [{ json: { uid: 'file', type: 'file', dueDate: d } }], r, { Date: FixedDate }), /dueDate/);
  assert.throws(() => remind(10, { ...reminderCfg, reminderDays: '30,7,7' }), /unique/);
  for (const value of ['', '30,,7', ' ', '7.5']) assert.throws(() => remind(10, { ...reminderCfg, reminderDays: value }), /whole days/);
});
test('Teams notification validates event identity, filters other folders and deduplicates one batch', () => {
  const file = 'folderit-new-files-to-teams.json'; const cfg = { accountUid: 'a', ledgerTableId: 'table', teamId: 't', channelId: 'c', folderUid: 'folder' };
  const input = [{ json: { uid: 'file', folderUid: 'folder', name: 'Renewal report' } }, { json: { uid: 'file', folderUid: 'folder', name: 'Renewal report' } }, { json: { uid: 'other', folderUid: 'other', name: 'Unrelated' } }];
  const r = { Settings: [{ json: cfg }], 'New Folderit file': [{ json: { auditUid: 'audit', entityUid: 'file' } }, { json: { auditUid: 'audit', entityUid: 'file' } }, { json: { auditUid: 'audit2', entityUid: 'other' } }] };
  const result = run(file, 'Prepare arrival notifications', input, r);
  assert.equal(result.length, 1); assert.ok(result[0].json.notificationText.includes('Renewal report'));
  assert.throws(() => run(file, 'Prepare arrival notifications', [{ json: { uid: 'wrong' } }], r), /do not match/);
});
test('failure email omits raw error details and strips foreign links and query secrets', () => {
  const file = 'folderit-failure-alert-email.json'; const cfg = { fromEmail: 'qa@folderit.test', toEmail: 'owner@folderit.test', n8nBaseUrl: 'https://n8n.folderit.test' };
  const source = { workflow: { id: 'workflow', name: 'Archive' }, execution: { id: '42', lastNodeExecuted: 'Upload', error: { message: 'SUPERSECRET', stack: 'SUPERSECRET' }, url: 'https://evil.test/?token=SUPERSECRET' } };
  let result = run(file, 'Prepare minimal failure alert', [], { Settings: [{ json: cfg }], 'Workflow failed': [{ json: source }] })[0].json;
  assert.ok(result.text.includes('Execution ID: 42')); assert.doesNotMatch(result.text, /SUPERSECRET|evil\.test/);
  source.execution.url = 'https://n8n.folderit.test/workflow/workflow/executions/42?token=SUPERSECRET';
  result = run(file, 'Prepare minimal failure alert', [], { Settings: [{ json: cfg }], 'Workflow failed': [{ json: source }] })[0].json;
  assert.doesNotMatch(result.text, /SUPERSECRET/);
  assert.throws(() => run(file, 'Prepare minimal failure alert', [], { Settings: [{ json: { ...cfg, toEmail: 'YOUR_RECIPIENT@example.invalid' } }] }), /addresses/);
});
