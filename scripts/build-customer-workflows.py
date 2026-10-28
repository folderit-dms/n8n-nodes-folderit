"""Build self-contained customer workflows. Python is only used by maintainers."""
import copy
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'examples' / 'deployments'
OUT.mkdir(parents=True, exist_ok=True)
KB = 'https://www.folderit.com/knowledge-base/connect-folderit-to-n8n/'
SCHEMA = ['key', 'state', 'owner', 'payloadHash', 'targetUid', 'sourceRef']
CURRENT = ''


def node(name, kind, params=None, x=0, y=400, version=1, **extra):
    return dict(id=str(uuid.uuid5(uuid.NAMESPACE_URL, CURRENT + '/' + name)), name=name,
                type=kind, typeVersion=version, position=[x, y], parameters=params or {}, **extra)


def code(name, text, x=0, y=400):
    return node(name, 'n8n-nodes-base.code', dict(mode='runOnceForAllItems', jsCode=text.strip()), x, y, 2)


def cfg(values):
    return node('Settings', 'n8n-nodes-base.set', dict(mode='raw', jsonOutput=json.dumps(values, indent=2), options={}), 240, version=3.4)


def note(title, text, x=0, y=-170, width=650, height=500):
    return node('Guide: ' + title, 'n8n-nodes-base.stickyNote', dict(content='# ' + title + '\n' + text, width=width, height=height), x, y)


def wire(con, a, b, output=0):
    edges = con.setdefault(a, {}).setdefault('main', [])
    while len(edges) <= output:
        edges.append([])
    edges[output].append(dict(node=b, type='main', index=0))


def chain(con, nodes):
    for a, b in zip(nodes, nodes[1:]):
        wire(con, a['name'], b['name'])


def condition(name, expression, value, x=0, y=400):
    return node(name, 'n8n-nodes-base.if', dict(conditions=dict(options=dict(caseSensitive=True, leftValue='', typeValidation='strict', version=2), conditions=[dict(id=str(uuid.uuid5(uuid.NAMESPACE_URL, CURRENT + '/' + name + '/condition')), leftValue=expression, rightValue=value, operator=dict(type='string', operation='equals'))], combinator='and'), options={}), x, y, 2.2)


def table(name, operation, filters=None, values=None, table_id=None, x=0, y=400):
    params = dict(resource='row', operation=operation, dataTableId=dict(__rl=True, mode='id', value=table_id or "={{ $('Settings').first().json.ledgerTableId }}"), matchType='allConditions', filters=dict(conditions=[dict(keyName=k, condition='eq', keyValue=v) for k, v in (filters or [])]))
    if operation == 'get':
        params.update(returnAll=False, limit=2)
    if values is not None:
        params.update(columns=dict(mappingMode='defineBelow', value=values, matchingColumns=[], schema=[dict(id=k, displayName=k, required=False, defaultMatch=False, display=True, type='string', readOnly=False, removed=False) for k in SCHEMA]), options={})
    return node(name, 'n8n-nodes-base.dataTable', params, x, y, 1.1, alwaysOutputData=True)


def save(filename, name, nodes, con, **settings):
    services = [n for n in nodes if n['type'].startswith('n8n-nodes-folderit.')]
    if services:
        for n in services:
            n['parameters']['authentication'] = 'folderitApi'
            if n['type'] == 'n8n-nodes-folderit.folderit':
                n['parameters']['expectedConnectionScope'] = "={{ $('Read connection context').first().json.connectionScope }}"
        context = node('Read connection context', 'n8n-nodes-folderit.folderit', dict(authentication='folderitApi', resource='connection', operation='get', accountUid="={{ $('Settings').first().json.accountUid }}"), 360, y=640)
        nodes.append(context)
        con[context['name']] = con['Settings']
        con['Settings'] = {'main': [[dict(node=context['name'],type='main',index=0)]]}
    obj = dict(name=name, nodes=nodes, connections=con, active=False, settings=dict(executionOrder='v1', saveDataErrorExecution='all', saveDataSuccessExecution='all', saveExecutionProgress=True, **settings), pinData={})
    (OUT / filename).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n')


COMMON = f'''For **Folderit Tailor-plan users** with API credentials. Requires Folderit connector 0.5.0 or later, Data Table node v1.1 and the secure egress helper (native test target: n8n 2.42.5). Use Folderit Connection API credentials in every Folderit node; these support standard cloud and public custom deployments. [Install and connect Folderit]({KB})

To create the credential, use **Credential → Create new credential → Setup credential → Folderit Connection (Cloud or Custom Deployment)**. Save it. In workflows containing **Read connection context**, configure Settings and execute that read to verify this deployment/account before activation. The ledger setup and failure-alert workflows contain no Folderit connection.

Run **folderit-ledger-setup.json** once in the same n8n project. Copy its table ID into Settings. All copies processing the same source/destination must use the SAME table. Choose Folderit credentials in every Folderit node. Never put secrets in Settings.

Import **folderit-failure-alert-email.json**, configure its SMTP connection, save it, then select it in this workflow's **⋯ → Settings → Error workflow**. Error workflows must be tested using an activated workflow; manual runs do not trigger them.
'''
RECOVERY = '''The table contains a single processing lock plus durable receipts. Only a run owning the lock may perform an upload or send a message. A completed receipt suppresses repeats for its key. The lock has NO automatic expiry: a crash, failed readback or uncertain API response keeps work blocked for inspection.

Competing runs wait and retry lock acquisition for about one minute; uploads/messages are never automatically retried. If a run still reports a busy lock, retry that FAILED execution after the owner finishes. Do not discard its input. On other failures, inspect saved executions, receipt state and the actual destination. Never clear the lock while its owner may still be running. Reconcile pending rows before clearing it. See CUSTOMER-WORKFLOWS.md for recovery steps.

This is duplicate protection with explicit recovery, not an exactly-once guarantee across n8n and an external service. Keep failed execution/binary data long enough for recovery and monitor the failure-alert workflow itself. Production provider delivery and fresh Cloud behavior require validation in your environment.'''


def receipt_flow(nodes, con, operation_nodes, operation_check, loop_name='Process one item', upload=False):
    """Serialize side effects using a conditional DB update of one precreated row."""
    own = '={{ String($execution.id) }}'
    start = [
        table('Read processing lock', 'get', [('key', '__mutex__')], x=1020),
        code('Check lock record', '''if (!$execution.id) throw new Error('No execution identity is available; processing was stopped before locking.');
const rows = $input.all().filter(x => x.json.id !== undefined);
if (rows.length !== 1 || rows[0].json.sourceRef !== 'folderit-ledger/v1') throw new Error('Ledger lock is missing, duplicated or has the wrong schema. Run the setup workflow once and inspect the table.');
return rows;''', 1260),
        table('Acquire processing lock', 'update', [('id', '={{ $json.id }}'), ('key', '__mutex__'), ('state', 'free'), ('owner', '')], dict(state='held', owner=own), x=1500),
        code('Confirm lock ownership', '''const rows = $input.all().filter(x => x.json.id !== undefined);
if (rows.length !== 1 || rows[0].json.owner !== String($execution.id) || rows[0].json.state !== 'held') throw new Error('Another run owns the processing lock. No destination write was attempted by this run. Retain this failed input and retry after the owner completes.');
return rows;''', 1740),
        table('Find processing receipt', 'get', [('key', "={{ $('Process one item').item.json.receiptKey }}")], x=1980),
        code('Decide whether to process', '''const item = $('Process one item').item;
const rows = $input.all().filter(x => x.json.id !== undefined);
if (rows.length > 1) throw new Error('Duplicate ledger keys need reconciliation. No destination write was attempted.');
if (rows.length === 1) {
  const receipt = rows[0].json;
  if (receipt.key !== item.json.receiptKey || (item.json.payloadHash && receipt.payloadHash !== item.json.payloadHash)) throw new Error('The receipt does not match this work item. Inspect before continuing.');
  if (receipt.state !== 'done' || !receipt.targetUid) throw new Error('A prior attempt is unresolved. Inspect the receipt, its owner execution and the destination before clearing the processing lock. Do not repeat the write.');
  return [{json: {...item.json, route: 'done', targetUid: receipt.targetUid, receiptRowId: receipt.id}, binary: item.binary, pairedItem: {item: 0}}];
}
return [{json: {...item.json, route: 'new'}, binary: item.binary, pairedItem: {item: 0}}];''', 2220),
        condition('Already completed?', '={{ $json.route }}', 'done', 2460),
    ]
    pending = table('Record pending attempt', 'insert', values=dict(key='={{ $json.receiptKey }}', state='pending', owner=own, payloadHash='={{ $json.payloadHash || "" }}', targetUid='', sourceRef='={{ $json.sourceRef }}'), x=2700, y=540)
    restore = code('Restore work item', '''const rows = $input.all().filter(x => x.json.id !== undefined);
const source = $('Process one item').item;
if (rows.length !== 1 || rows[0].json.state !== 'pending' || rows[0].json.owner !== String($execution.id) || rows[0].json.key !== source.json.receiptKey) throw new Error('Pending receipt was not saved as expected. No destination write was attempted.');
return [{json: {...source.json, receiptRowId: rows[0].json.id}, binary: source.binary, pairedItem: {item: 0}}];''', 2940, 540)
    check = code('Verify destination result', operation_check, 3660, 540)
    completed = table('Save completed receipt', 'update', [('id', '={{ $json.receiptRowId }}'), ('state', 'pending'), ('owner', own)], dict(state='done', targetUid='={{ $json.targetUid }}'), x=3900, y=540)
    confirm = code('Confirm completed receipt', '''const rows = $input.all().filter(x => x.json.id !== undefined);
const expected = $('Verify destination result').item.json;
if (rows.length !== 1 || rows[0].json.state !== 'done' || rows[0].json.targetUid !== expected.targetUid || rows[0].json.owner !== String($execution.id)) throw new Error('The destination action succeeded but its receipt could not be confirmed. Inspect before retrying.');
return [{json: {status: 'completed', targetUid: rows[0].json.targetUid, receiptKey: rows[0].json.key}, pairedItem: {item: 0}}];''', 4140, 540)
    skip = code('Report previous completion', "return [{json: {status: 'previously_completed', targetUid: $json.targetUid, receiptKey: $json.receiptKey}}];", 2700, 200)
    release = table('Release processing lock', 'update', [('key', '__mutex__'), ('state', 'held'), ('owner', own)], dict(state='free', owner=''), x=4380)
    verify_release = code('Confirm lock released', '''const rows = $input.all().filter(x => x.json.id !== undefined);
if (rows.length !== 1 || rows[0].json.state !== 'free' || rows[0].json.owner !== '' || rows[0].json.key !== '__mutex__') throw new Error('Could not confirm processing lock release. Inspect the table and owner execution.');
return [{json: {lockReleased: true}}];''', 4620)
    acquired = condition('Lock acquired?', "={{ ($json.owner === String($execution.id) && $json.state === 'held') ? 'yes' : 'no' }}", 'yes', 1620, 120)
    budget = code('Limit lock waiting', "if ($runIndex >= 11) throw new Error('Processing lock is still busy after bounded waiting. No destination action was repeated. Retain this failed input and inspect the owner execution.'); return [{json:{waitingForLock:true},pairedItem:{item:0}}];", 1800, 100)
    wait = node('Wait before checking lock', 'n8n-nodes-base.wait', dict(amount=5, unit='seconds'), 2000, y=100, version=1.1)
    nodes.extend(start + [pending, restore] + operation_nodes + [check, completed, confirm, skip, release, verify_release, acquired, budget, wait])
    wire(con, loop_name, start[0]['name'], 1)
    chain(con, start)
    con[start[2]['name']]['main'] = [[dict(node=acquired['name'], type='main', index=0)]]
    wire(con, acquired['name'], start[3]['name'], 0)
    wire(con, acquired['name'], budget['name'], 1)
    wire(con, budget['name'], wait['name'])
    wire(con, wait['name'], start[0]['name'])
    wire(con, start[-1]['name'], skip['name'], 0)
    wire(con, start[-1]['name'], pending['name'], 1)
    chain(con, [pending, restore] + operation_nodes + [check, completed, confirm, release, verify_release])
    wire(con, skip['name'], release['name'])
    wire(con, verify_release['name'], loop_name)


def setup():
    global CURRENT
    CURRENT = 'folderit-ledger-setup'
    tid = "={{ $('Create or reuse ledger').first().json.id }}"
    nodes = [node('Set up ledger', 'n8n-nodes-base.manualTrigger'), cfg(dict(tableName='Folderit Automation Receipts')),
             node('Create or reuse ledger', 'n8n-nodes-base.dataTable', dict(resource='table', operation='create', tableName="={{ $('Settings').first().json.tableName }}", columns=dict(column=[dict(name=k, type='string') for k in SCHEMA]), options=dict(createIfNotExists=True)), 480, version=1.1),
             code('Validate table schema', "const table=$input.first().json; const expected=" + json.dumps(SCHEMA) + "; if(!table.id || !Array.isArray(table.columns) || expected.some(k=>!table.columns.some(c=>c.name===k && c.type==='string'))) throw new Error('Existing table has an incompatible schema. Choose a new table name; do not replace customer data.'); return [{json:table}];", 720),
             table('Find existing lock', 'get', [('key', '__mutex__')], table_id=tid, x=960),
             code('Check setup state', "const rows=$input.all().filter(x=>x.json.id!==undefined); if(rows.length>1) throw new Error('Duplicate mutex rows need manual reconciliation.'); if(rows.length===1 && rows[0].json.sourceRef!=='folderit-ledger/v1') throw new Error('Unexpected lock schema.'); return [{json:{exists:rows.length?'yes':'no',tableId:$('Create or reuse ledger').first().json.id}}];", 1200),
             condition('Lock already exists?', '={{ $json.exists }}', 'yes', 1440),
             table('Create initial lock', 'insert', values=dict(key='__mutex__', state='free', owner='', payloadHash='', targetUid='', sourceRef='folderit-ledger/v1'), table_id=tid, x=1680, y=550),
             code('Ledger is ready', "return [{json:{ledgerTableId:$('Create or reuse ledger').first().json.id, note:'Copy this ID into Settings in the customer workflows. Setup never resets an existing lock. Run setup once, not concurrently.'}}];", 1920),
             note('Create the receipt ledger', COMMON + '\nChoose a table name in Settings, execute this setup ONCE, and copy ledgerTableId from the final output. Rerunning setup reuses an existing table and preserves its lock/receipts. Do not run setup concurrently. Keep all related workflows and this table in the SAME n8n project.', width=1000),
             note('What gets stored', 'The ledger stores processing keys, hashes, source references, execution IDs and destination IDs. It never stores document bytes or credentials. Restrict access to the project. Do not delete completed receipts while old inputs can still be replayed.', 1080, width=800),]
    con = {}; chain(con, nodes[:7]); wire(con, nodes[6]['name'], nodes[8]['name'], 0); wire(con, nodes[6]['name'], nodes[7]['name'], 1); wire(con, nodes[7]['name'], nodes[8]['name'])
    save(CURRENT + '.json', 'Folderit — Set up a durable processing ledger', nodes, con)


SPLIT = r'''
const cfg=$('Settings').first().json;
const connection=$('Read connection context').first().json;
if(connection.accountUid!==cfg.accountUid||!connection.apiOrigin)throw new Error('Connection deployment/account does not match Settings.');
const deploymentKey=connection.apiOrigin==='https://api.folderit.com'?[]:[connection.apiOrigin];

for(const key of ['accountUid','folderUid','ledgerTableId','mailboxScope']) if(typeof cfg[key]!=='string'||!cfg[key].trim()||cfg[key].startsWith('YOUR_')) throw new Error(`Replace ${key} in Settings.`);
const allowed=String(cfg.allowedExtensions||'').split(',').map(x=>x.trim().toLowerCase().replace(/^\./,'')).filter(Boolean);
if(!allowed.length)throw new Error('Set allowedExtensions, for example pdf,docx,txt.');
const out=[]; const mail=$('New email with attachments').all();
for(let i=0;i<mail.length;i++){
 const messageId=String(mail[i].json.messageId||mail[i].json.internetMessageId||mail[i].json.id||'').trim();
 const parts=Object.entries(mail[i].binary||{}).filter(([k])=>k.startsWith('attachment_'));
 if(parts.length&&!messageId)throw new Error('Email has no stable Message-ID/provider ID. Inspect it before archiving.');
 for(const [field,b] of parts){
  const fileName=String(b.fileName||'').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g,'').trim();
  const ext=fileName.includes('.')?fileName.split('.').pop().toLowerCase():'';
  if(!fileName||!allowed.includes(ext))continue;
  out.push({json:{apiOrigin:connection.apiOrigin,accountUid:cfg.accountUid,folderUid:cfg.folderUid,mailboxScope:cfg.mailboxScope,messageId,sourceAttachment:field,fileName},binary:{data:{...b,fileName}},pairedItem:{item:i}});
 }
}
return out;
'''


def archive(outlook=False):
    global CURRENT
    CURRENT = 'outlook-attachments-to-folderit-safe' if outlook else 'email-attachments-to-folderit-safe'
    trigger = node('New email with attachments', 'n8n-nodes-base.microsoftOutlookTrigger', dict(authentication='microsoftOutlookOAuth2Api', event='messageReceived', output='raw', filters=dict(hasAttachments=True, readStatus='both'), options=dict(downloadAttachments=True, attachmentsPrefix='attachment_'), pollTimes=dict(item=[dict(mode='everyMinute')]))) if outlook else node('New email with attachments', 'n8n-nodes-base.emailReadImap', dict(mailbox='INBOX', postProcessAction='nothing', downloadAttachments=True, format='simple', dataPropertyAttachmentsPrefixName='attachment_', options=dict(trackLastMessageId=True)), version=2.2)
    nodes = [trigger, cfg(dict(accountUid='YOUR_ACCOUNT_UID', folderUid='YOUR_DESTINATION_FOLDER_UID', ledgerTableId='YOUR_LEDGER_TABLE_ID', mailboxScope='YOUR_STABLE_MAILBOX_LABEL', allowedExtensions='pdf,docx,txt')),
             code('Split and validate attachments', SPLIT, 480),
             node('Hash attachment bytes', 'n8n-nodes-base.crypto', dict(action='hash', binaryData=True, binaryPropertyName='data', type='SHA256', dataPropertyName='payloadHash', encoding='hex'), 720, version=2),
             code('Build attachment receipt keys', """const attachments=$('Split and validate attachments').all();
return $input.all().map((x,i)=>{
 if(!/^[a-f0-9]{64}$/.test(x.json.payloadHash||''))throw new Error('Missing attachment SHA-256.');
 if(x.json.payloadHash==='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')throw new Error('Empty attachments cannot be archived.');
 const binary=attachments[i]?.binary;
 if(!binary?.data)throw new Error('The source attachment binary is unavailable; no upload was attempted.');
 const j=x.json;
 if(typeof j.apiOrigin!=='string'||!/^https:\/\/api\.[a-z0-9.-]+$/.test(j.apiOrigin))throw new Error('Verified deployment context is missing; no upload was attempted.');
 return {json:{...j,receiptKey:JSON.stringify(['archive-v1',...(j.apiOrigin==='https://api.folderit.com'?[]:[j.apiOrigin]),j.accountUid,j.folderUid,j.mailboxScope,j.messageId,j.sourceAttachment,j.fileName,j.payloadHash]),sourceRef:JSON.stringify([j.mailboxScope,j.messageId,j.sourceAttachment])},binary,pairedItem:{item:i}};
});""", 900),
             node('Process one item', 'n8n-nodes-base.splitInBatches', dict(batchSize=1, options={}), 1020, y=760, version=3)]
    con={}; chain(con,nodes)
    operations=[node('Upload attachment', 'n8n-nodes-folderit.folderit', dict(resource='file',operation='upload',accountUid='={{ $json.accountUid }}',folderUid='={{ $json.folderUid }}',binaryPropertyName='data'),3180,y=540),node('Read uploaded document', 'n8n-nodes-folderit.folderit', dict(resource='file',operation='get',accountUid="={{ $('Settings').first().json.accountUid }}",fileUid='={{ $json.uid }}'),3420,y=540),
                node('Download stored attachment', 'n8n-nodes-folderit.folderit', dict(resource='file',operation='download',accountUid="={{ $('Settings').first().json.accountUid }}",fileUid='={{ $json.uid }}',outputBinaryField='verifiedFile'),3540,y=760),
                node('Hash stored attachment bytes','n8n-nodes-base.crypto',dict(action='hash',binaryData=True,binaryPropertyName='verifiedFile',type='SHA256',dataPropertyName='verifiedHash',encoding='hex'),3780,y=760,version=2)]
    check='''const expected=$('Restore work item').item.json; const actual=$('Read uploaded document').item.json; const verifiedHash=$input.first().json.verifiedHash;
if(!actual.uid || actual.name!==expected.fileName || actual.folderUid!==expected.folderUid || verifiedHash!==expected.payloadHash) throw new Error('Uploaded file readback/hash did not match. Keep the pending receipt and inspect the destination before retrying.');
return [{json:{receiptRowId:expected.receiptRowId,targetUid:actual.uid},pairedItem:{item:0}}];'''
    receipt_flow(nodes,con,operations,check,upload=True)
    provider = 'Connect **Microsoft Outlook OAuth2** in the trigger. This uses delegated mailbox access. Use an intake mailbox/folder and test with one synthetic email. The template leaves read/unread status unchanged. The provider mailbox ID is a fallback when the RFC Message-ID is missing; moving mail may change provider IDs.' if outlook else 'Connect your IMAP credential in the trigger. Use a dedicated intake mailbox with TLS; existing unseen messages can be fetched on the first run. Read/unread status is unchanged. Messages without a stable Message-ID are held for inspection.'
    nodes += [note('Archive attachments with saved receipts', COMMON+'\n'+provider+'\n\nSet all Settings placeholders, then select the same Folderit Connection credential in Read connection context, Upload attachment, Read uploaded document and Download stored attachment. mailboxScope must remain a stable label for this mailbox. Configure allowedExtensions. Multiple permitted attachments are processed one at a time. Test a replay and confirm no second file appears.',width=1100,height=650),note('Recovery and limits', RECOVERY+'\n\nOne receipt key includes deployment, account, destination, mailbox, message ID, attachment field, filename and SHA-256. A new email can intentionally archive identical content. Every new upload is downloaded again and its bytes hashed before completion is recorded; this adds download traffic and avoids depending on asynchronously populated server hash metadata. Empty files and files over 100 MiB fail. Extension checks do not replace malware scanning. No automatic upload retries.',1180,width=1050,height=650)]
    save(CURRENT+'.json', 'Folderit — '+('Outlook' if outlook else 'Email')+' attachment archive with durable receipts',nodes,con)


def teams_action():
    return node('Send Teams notification','n8n-nodes-base.microsoftTeams',dict(authentication='microsoftTeamsOAuth2Api',resource='channelMessage',operation='create',teamId=dict(__rl=True,mode='id',value="={{ $('Settings').first().json.teamId }}"),channelId=dict(__rl=True,mode='id',value="={{ $('Settings').first().json.channelId }}"),contentType='text',message='={{ $json.notificationText }}',options=dict(includeLinkToWorkflow=False)),3180,y=540,version=2)


TEAM_CHECK="""const expected=$('Restore work item').item.json; const result=$input.first().json;
if(!result.id || typeof result.id!=='string')throw new Error('No Teams message ID was returned. Inspect the channel before repeating this notification.');
return [{json:{receiptRowId:expected.receiptRowId,targetUid:result.id},pairedItem:{item:0}}];"""


def notifications():
    global CURRENT
    CURRENT='folderit-new-files-to-teams'
    nodes=[node('New Folderit file','n8n-nodes-folderit.folderitTrigger',dict(accountUid='',event='newFile',recordUid='',pollTimes=dict(item=[dict(mode='everyMinute')]))),cfg(dict(accountUid='YOUR_ACCOUNT_UID',folderUid='',ledgerTableId='YOUR_LEDGER_TABLE_ID',teamId='YOUR_TEAM_ID',channelId='YOUR_CHANNEL_ID')),
           node('Read new document details','n8n-nodes-folderit.folderit',dict(resource='file',operation='get',accountUid="={{ $('Settings').first().json.accountUid }}",fileUid="={{ $('New Folderit file').item.json.entityUid }}"),480),
           code('Prepare arrival notifications', '''const cfg=$('Settings').first().json;
const connection=$('Read connection context').first().json;
if(connection.accountUid!==cfg.accountUid||!connection.apiOrigin)throw new Error('Connection deployment/account does not match Settings.');
const deploymentKey=connection.apiOrigin==='https://api.folderit.com'?[]:[connection.apiOrigin];

for(const key of ['ledgerTableId','teamId','channelId'])if(!cfg[key]||cfg[key].startsWith('YOUR_'))throw new Error(`Replace ${key} in Settings.`);
const events=$('New Folderit file').all();const seen=new Set();const out=[];
for(const [i,item]of $input.all().entries()){
 const e=events[i]?.json;if(!e?.auditUid||e.entityUid!==item.json.uid)throw new Error('File details do not match the audit event.');
 if(seen.has(e.auditUid))continue;seen.add(e.auditUid);if(cfg.folderUid&&item.json.folderUid!==cfg.folderUid)continue;
 const name=String(item.json.name||'').replace(/[\\r\\n]/g,' ');
 out.push({json:{receiptKey:JSON.stringify(['teams-arrival-v1',...deploymentKey,cfg.accountUid,e.auditUid,cfg.teamId,cfg.channelId]),sourceRef:e.auditUid,notificationText:`New document in Folderit: ${name}\\nDocument UID: ${item.json.uid}\\nAudit UID: ${e.auditUid}`},pairedItem:{item:i}});
}return out;''',720),node('Process one item','n8n-nodes-base.splitInBatches',dict(batchSize=1,options={}),1020,y=760,version=3)]
    con={};chain(con,nodes);receipt_flow(nodes,con,[teams_action()],TEAM_CHECK)
    nodes += [note('New Folderit files → Microsoft Teams',COMMON+'\nSelect the account/credential in New Folderit file and the same account UID in Settings. Select the same Folderit Connection credential in Read connection context and Read new document details. Connect a delegated Microsoft Teams OAuth2 credential in Send Teams notification. Enter the exact team/channel IDs. The signed-in Microsoft user must be able to post there. App-only Graph message sending is not used.\n\nA blank folderUid watches accessible account events; an exact folder UID excludes child folders. Messages include name, document UID and audit UID, never document content.',width=1100,height=650),note('Activation, recovery and limits',RECOVERY+'\n\nActivate, then upload a synthetic document and inspect the actual Teams channel. Activation starts a baseline. Manual previews can notify about historical events. Poll at least hourly; interruptions over 23 hours or scan-limit errors need reconciliation. The ledger suppresses repeated audit UID/destination pairs; it does not repair missing audit history.',1180,width=1050,height=650)]
    save(CURRENT+'.json','Folderit — New document notifications in Microsoft Teams',nodes,con)


EXPIRY_CODE=r'''
const cfg=$('Settings').first().json;
const connection=$('Read connection context').first().json;
if(connection.accountUid!==cfg.accountUid||!connection.apiOrigin)throw new Error('Connection deployment/account does not match Settings.');
const deploymentKey=connection.apiOrigin==='https://api.folderit.com'?[]:[connection.apiOrigin];

for(const key of ['ledgerTableId','teamId','channelId'])if(!cfg[key]||cfg[key].startsWith('YOUR_'))throw new Error(`Replace ${key} in Settings.`);
const tokens=String(cfg.reminderDays??'').split(',').map(x=>x.trim());
if(tokens.some(x=>!/^\d+$/.test(x)))throw new Error('reminderDays needs a non-empty comma-separated list of whole days.');
const milestones=tokens.map(Number);
if(!milestones.length||milestones.some(x=>!Number.isInteger(x)||x<0||x>365)||new Set(milestones).size!==milestones.length)throw new Error('reminderDays needs unique whole days from 0 to 365.');
milestones.sort((a,b)=>b-a);
const overdue=Number(cfg.overdueDays);if(!Number.isInteger(overdue)||overdue<0||overdue>365)throw new Error('overdueDays must be 0–365.');
const now=new Date();const today=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());const out=[];
for(const [i,item]of $input.all().entries()){
 const f=item.json;if(f.dueDate===null||f.dueDate===undefined||f.dueDate==='')continue;
 if(typeof f.dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(f.dueDate))throw new Error('A dueDate is not YYYY-MM-DD. Correct the record before continuing.');
 const d=new Date(f.dueDate+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==f.dueDate)throw new Error('A dueDate is not a valid calendar date.');
 const days=Math.round((d.getTime()-today)/86400000);if(days>milestones[0]||days < -overdue)continue;
 const milestone=days<=0 ? (milestones.includes(0)?0:null) : milestones.filter(x=>x>=days).at(-1);
 if(milestone===null||milestone===undefined)continue;
 if(!f.uid||f.type!=='file')throw new Error('Expected a Folderit file with UID.');
 const name=String(f.name||'').replace(/[\r\n]/g,' ');
 out.push({json:{receiptKey:JSON.stringify(['teams-expiry-v1',...deploymentKey,cfg.accountUid,f.uid,f.dueDate,milestone,cfg.teamId,cfg.channelId]),sourceRef:JSON.stringify([f.uid,f.dueDate,milestone]),notificationText:`Folderit expiry reminder: ${name}\nDue date: ${f.dueDate}\nDays remaining: ${days}\nDocument UID: ${f.uid}\nReminder milestone: ${milestone} days`},pairedItem:{item:i}});
}return out;
'''


def expiry():
    global CURRENT
    CURRENT='folderit-expiry-reminders-to-teams'
    nodes=[node('Check expiry dates daily','n8n-nodes-base.scheduleTrigger',dict(rule=dict(interval=[dict(field='days',daysInterval=1,triggerAtHour=9,triggerAtMinute=0)]))),cfg(dict(accountUid='YOUR_ACCOUNT_UID',folderUid='YOUR_CERTIFICATE_FOLDER_UID',ledgerTableId='YOUR_LEDGER_TABLE_ID',teamId='YOUR_TEAM_ID',channelId='YOUR_CHANNEL_ID',reminderDays='30,7,1,0',overdueDays=7)),
           node('List tracked documents','n8n-nodes-folderit.folderit',dict(resource='file',operation='getAll',accountUid="={{ $('Settings').first().json.accountUid }}",folderUid="={{ $('Settings').first().json.folderUid }}",returnAll=True),480),
           node('Read document expiry dates','n8n-nodes-folderit.folderit',dict(resource='file',operation='get',accountUid="={{ $('Settings').first().json.accountUid }}",fileUid='={{ $json.uid }}'),720),
           code('Select due reminders',EXPIRY_CODE,960),node('Process one item','n8n-nodes-base.splitInBatches',dict(batchSize=1,options={}),1020,y=760,version=3)]
    con={};chain(con,nodes);receipt_flow(nodes,con,[teams_action()],TEAM_CHECK)
    nodes += [note('Contract and certificate expiry reminders',COMMON+'\nUse a dedicated folder containing the documents to track. Set each document’s standard Folderit **Due date** to its actual expiry/renewal date. This template reads that field, not arbitrary custom metadata or dates inside document text. It does not decide legal expiry dates.\n\nSet Settings UIDs, team/channel and reminderDays. Connect the same Folderit Connection credential in Read connection context and both read nodes and delegated Microsoft Teams OAuth2 in the send node. No Folderit records are changed. Schedule defaults to 09:00 UTC; date calculations use UTC calendar days.',width=1100,height=650),note('Reminder behavior and recovery',RECOVERY+'\n\nDefault milestones are 30, 7, 1 and 0 days. The first run within a window sends that window’s reminder (for example, 20 days left sends the 30-day reminder). It does not send every missed milestone. The 0-day reminder can be sent once through 7 days overdue; adjust overdueDays. No due date means no reminder. Invalid dates fail visibly. One receipt is stored per account/document/due date/milestone/destination. A changed due date starts a new reminder cycle. This folder is not traversed recursively.',1180,width=1050,height=650)]
    save(CURRENT+'.json','Folderit — Contract and certificate expiry reminders to Teams',nodes,con,timezone='UTC')


ALERT_CODE=r'''
const cfg=$('Settings').first().json;
for(const k of ['fromEmail','toEmail'])if(typeof cfg[k]!=='string'||!cfg[k].includes('@')||/YOUR_|example\.invalid/.test(cfg[k])||/[\r\n]/.test(cfg[k]))throw new Error('Set valid alert sender/recipient addresses in Settings.');
const source=$('Workflow failed').first().json;const execution=source.execution||{};const workflow=source.workflow||{};
const clean=v=>String(v??'unknown').replace(/[\r\n\x00-\x1f]/g,' ').slice(0,180);
const base=String(cfg.n8nBaseUrl||'').replace(/\/$/,'');if(!/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i.test(base)||base.includes('YOUR_'))throw new Error('Set n8nBaseUrl to your HTTPS instance origin, without a path or credentials.');
const supplied=typeof execution.url==='string'?execution.url:'';const link=supplied.startsWith(base+'/')?supplied.split(/[?#]/)[0]:base;
return [{json:{fromEmail:cfg.fromEmail,toEmail:cfg.toEmail,subject:`Folderit automation failed: ${clean(workflow.name)}`,text:`A Folderit automation needs attention.\nWorkflow: ${clean(workflow.name)}\nWorkflow ID: ${clean(workflow.id)}\nExecution ID: ${clean(execution.id)}\nLast node: ${clean(execution.lastNodeExecuted||source.trigger?.error?.node?.name)}\nOpen n8n: ${link}\n\nInspect the failed execution, processing lock, receipts and actual destination. Do not blindly replay uploads or notifications. Raw error messages, stacks, document content and credentials are deliberately omitted.`}}];
'''


def alerts():
    global CURRENT
    CURRENT='folderit-failure-alert-email'
    nodes=[node('Workflow failed','n8n-nodes-base.errorTrigger'),cfg(dict(fromEmail='YOUR_SENDER@example.invalid',toEmail='YOUR_RECIPIENT@example.invalid',n8nBaseUrl='https://YOUR_INSTANCE.app.n8n.cloud')),code('Prepare minimal failure alert',ALERT_CODE,480),
           node('Email the workflow owner','n8n-nodes-base.emailSend',dict(fromEmail='={{ $json.fromEmail }}',toEmail='={{ $json.toEmail }}',subject='={{ $json.subject }}',emailFormat='text',text='={{ $json.text }}',options=dict(appendAttribution=False)),720,version=2.1),
           note('Shared failure alerts', 'For Tailor-plan Folderit automation operators. Connect an SMTP credential in Email the workflow owner. Set your real sender, recipient and HTTPS n8n instance origin in Settings. The sender must be permitted by your mail provider.\n\nSave this workflow. In EACH main workflow, open **⋯ → Settings → Error workflow**, choose this workflow and save. Create a controlled failure in an ACTIVATED test workflow and check the actual recipient mailbox. Manual executions do not automatically invoke Error Trigger.\n\nThis workflow sends only names/IDs and a same-origin execution link. It omits raw errors, stack traces, document content, API tokens and signed storage links. Trigger failures may not have an execution ID. Monitor SMTP delivery separately; an alert workflow can itself fail.',width=1100,height=600)]
    con={};chain(con,nodes[:4]);save(CURRENT+'.json','Folderit — Email alerts for failed automation workflows',nodes,con)


if __name__ == '__main__':
    setup();archive();archive(True);notifications();expiry();alerts()
    print('Built six self-contained workflows with no credentials or private identifiers.')
