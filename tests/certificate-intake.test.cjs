const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '../examples/supplier-certificate-intake.json'), 'utf8'));
const original = JSON.parse(fs.readFileSync(path.join(__dirname, '../templates/notify-teams-on-new-documents.json'), 'utf8'));
const cfg = {accountUid: 'synthetic-account', folderUid: 'synthetic-intake', ledgerTableId: 'synthetic-ledger', teamId: 'synthetic-team', channelId: 'synthetic-channel', reviewOwner: 'Procurement reviewer', allowedExtensions: 'pdf', minimumValidityDays: 30};
class Today extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-11-03T23:59:59Z'])); }
}
const item = (values = {}) => ({json: {uid: 'synthetic-file', type: 'file', folderUid: cfg.folderUid, name: 'Supplier-certificate.pdf', dueDate: '2026-12-03', ...values}});
function run(items, config = cfg, events = items.map((x, i) => ({json: {auditUid: 'synthetic-audit-' + i, entityUid: x.json.uid}}))) {
  const code = workflow.nodes.find(n => n.name === 'Prepare arrival notifications').parameters.jsCode;
  return vm.runInNewContext('(function(){' + code + '\n})()', {
    Date: Today,
    $input: {all: () => items},
    $: name => ({first: () => ({json: config}), all: () => events}),
  });
}
test('minimum-validity boundary is ready for human review and never automatic approval', () => {
  const r = run([item()])[0].json;
  assert.equal(r.status, 'ready_for_review'); assert.equal(r.daysRemaining, 30);
  assert.match(r.notificationText, /READY FOR HUMAN REVIEW/);
  assert.match(r.nextAction, /Check supplier identity and certificate contents/);
  assert.match(r.notificationText, /does not approve/);
});
test('missing and malformed expiry produce corrective actions instead of losing the arrival', () => {
  for (const dueDate of [undefined, null, '', '2026-02-30', '03/11/2026', {secret: 'DO_NOT_SEND'}]) {
    const r = run([item({dueDate})])[0].json;
    assert.equal(r.status, 'needs_attention'); assert.equal(r.dueDate, null);
    assert.match(r.nextAction, /standard Folderit Due date/);
    assert.doesNotMatch(r.notificationText, /DO_NOT_SEND/);
  }
});
test('past and same-day expiry are urgent using UTC calendar days', () => {
  for (const [dueDate, days] of [['2026-11-02', -1], ['2026-11-03', 0]]) {
    const r = run([item({dueDate})])[0].json;
    assert.equal(r.priority, 'urgent'); assert.equal(r.daysRemaining, days);
    assert.match(r.nextAction, /supplier|renewed/);
  }
});
test('short validity requests a renewal or reviewer decision', () => {
  const r = run([item({dueDate: '2026-11-17'})])[0].json;
  assert.equal(r.status, 'needs_attention'); assert.equal(r.daysRemaining, 14);
  assert.match(r.notificationText, /at least 30/); assert.match(r.nextAction, /responsible reviewer/);
});
test('valid leap day remains a valid recorded date', () => {
  assert.equal(run([item({dueDate: '2028-02-29'})])[0].json.dueDate, '2028-02-29');
});
test('disallowed extension and misleading double extension need attention', () => {
  for (const name of ['Supplier.exe', 'Supplier.pdf.exe', 'Supplier']) {
    const r = run([item({name})])[0].json;
    assert.equal(r.status, 'needs_attention'); assert.match(r.nextAction, /permitted file format/);
  }
  assert.equal(run([item({name: 'Supplier.PDF'})])[0].json.status, 'ready_for_review');
});
test('all failed checks and corrective actions survive together', () => {
  const r = run([item({name: '', dueDate: null})])[0].json;
  assert.equal(r.reasons.length, 3); assert.match(r.nextAction, /meaningful name/);
  assert.match(r.nextAction, /permitted file format/); assert.match(r.nextAction, /actual expiry/);
});
test('other folders and descendants produce no notification', () => {
  assert.equal(run([item({folderUid: 'other-folder'})]).length, 0);
});
test('duplicate audit events are suppressed within a batch; item pairing survives mixed records', () => {
  const items = [item(), item({uid: 'other', dueDate: null}), item()];
  const events = [{json: {auditUid: 'a', entityUid: 'synthetic-file'}}, {json: {auditUid: 'b', entityUid: 'other'}}, {json: {auditUid: 'a', entityUid: 'synthetic-file'}}];
  const r = run(items, cfg, events);
  assert.equal(r.length, 2); assert.equal(r[1].pairedItem.item, 1);
  assert.notEqual(r[0].json.receiptKey, r[1].json.receiptKey);
});
test('empty batch has no work; bad event identity fails before sending', () => {
  assert.equal(run([]).length, 0);
  assert.throws(() => run([item()], cfg, [{json: {auditUid: 'a', entityUid: 'wrong'}}]), /audit event/);
  assert.throws(() => run([item({type: 'folder'})]), /audit event/);
});
test('destination is part of receipt identity, while date/policy changes do not repeat a completed arrival', () => {
  const first = run([item()])[0].json.receiptKey;
  assert.notEqual(first, run([item()], {...cfg, channelId: 'second-channel'})[0].json.receiptKey);
  assert.equal(first, run([item({dueDate: null})], {...cfg, minimumValidityDays: 90})[0].json.receiptKey);
  assert.equal(JSON.parse(first)[0], 'teams-certificate-intake-v1');
});
test('private record payloads and control characters are excluded from messages', () => {
  const r = run([item({name: 'Supplier\r\ncertificate.PDF', content: 'DO_NOT_SEND', apiToken: 'DO_NOT_SEND'})])[0].json;
  assert.equal(r.certificateName, 'Supplier certificate.PDF');
  assert.doesNotMatch(JSON.stringify(r), /DO_NOT_SEND/);
});
test('unsafe or unfinished configuration stops before any arrival can be sent', () => {
  for (const changes of [{folderUid: ''}, {folderUid: 'YOUR_FOLDER'}, {channelId: ''}, {minimumValidityDays: 0}, {minimumValidityDays: '30'}, {minimumValidityDays: 366}, {allowedExtensions: ''}, {allowedExtensions: 'pdf,.exe'}, {allowedExtensions: 'pdf,pdf'}, {reviewOwner: ''}]) {
    assert.throws(() => run([item()], {...cfg, ...changes}));
  }
});
test('candidate remains inactive and read-only in Folderit with the original receipt graph', () => {
  assert.equal(workflow.active, false); assert.deepEqual(workflow.pinData, {});
  assert.deepEqual(workflow.connections, original.connections);
  for (const node of workflow.nodes.filter(n => n.type.startsWith('n8n-nodes-folderit.'))) {
    assert.ok(node.type.endsWith('folderitTrigger') || node.parameters.operation === 'get');
    assert.ok(!node.credentials); assert.ok(!node.retryOnFail);
  }
  for (const node of workflow.nodes.filter(n => n.type === 'n8n-nodes-base.code')) {
    new vm.Script('(function(){' + node.parameters.jsCode + '\n})()');
    if (node.name !== 'Prepare arrival notifications') assert.deepEqual(node.parameters, original.nodes.find(n => n.name === node.name).parameters);
  }
  const teams = workflow.nodes.find(n => n.type === 'n8n-nodes-base.microsoftTeams');
  assert.equal(teams.parameters.contentType, 'text'); assert.ok(!teams.retryOnFail);
});
