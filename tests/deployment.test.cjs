const {test}=require('node:test');
const assert=require('node:assert/strict');
const {FolderitApi,binding}=require('../dist/credentials/FolderitApi.credentials');
const {Folderit}=require('../dist/nodes/Folderit/Folderit.node');
const {FolderitTrigger}=require('../dist/nodes/Folderit/FolderitTrigger.node');
const {loadOptions}=require('../dist/nodes/Folderit/discovery');
const {api,connectionInfo,storageRequest,resolveAccount}=require('../dist/nodes/Folderit/api');
const D=require('../dist/nodes/Folderit/deployment');
const credential=new FolderitApi();
const base={apiUrl:'https://api.my.chaffinch.com/#description/introduction',browserUrl:'https://my.chaffinch.com/en/login/',clientId:'synthetic-client',clientSecret:'synthetic-secret'};
function nodeContext(overrides={},respond=()=>({uid:'same-account'})){
 const data={...base,selectedAccountUid:'same-account'};data.sessionBinding=binding(data);const calls=[];let filters=0;
 const parameters={authentication:'folderitApi',...overrides};
 return {calls,get filters(){return filters;},getNode:()=>({name:'Folderit',type:'n8n-nodes-folderit.folderit',typeVersion:1,position:[0,0],parameters,credentials:{folderitApi:{id:'private-connection',name:'Synthetic'}}}),getNodeParameter:(n,_i,f)=>parameters[n]??f,getCredentials:async()=>data,getInputData:()=>[{json:{}}],continueOnFail:()=>false,helpers:{getSecureEgressFilter:p=>{assert.equal(p,'enforced');filters++;return filter();},httpRequestWithAuthentication:async(t,o,extra)=>{calls.push({type:t,...o,extra});return respond(o);},httpRequest:async o=>{calls.push(o);return Buffer.from('synthetic file');}}};
}
test('deployment normalization preserves nested domains and independent browser origins',()=>{
 const d=D.deployment(base);assert.equal(d.apiOrigin,'https://api.my.chaffinch.com');assert.equal(d.authOrigin,'https://auth.my.chaffinch.com');assert.equal(d.browserOrigin,'https://my.chaffinch.com');
 assert.equal(D.apiOrigin('https://api.apollo.folderit.com/v2/'),'https://api.apollo.folderit.com');assert.equal(D.deployment({}).browserOrigin,D.CLOUD_WEB);assert.equal(D.deployment({apiUrl:base.apiUrl}).browserOrigin,null);
 for(const u of ['http://api.example.org','https://user:secret@api.example.org','https://127.0.0.1','https://[::1]','https://api.localhost','https://api.host.internal','https://api.example.org:444','https://api.example.org/v2/v2','https://api.example.org/a/../v2','https://api.example.org?host=evil','https://api.example.org/%76%32'])assert.throws(()=>D.apiOrigin(u));
});

test('generated Folderit links use the independent browser origin and leave sources/storage alone',()=>{
 const record={uid:'file',type:'file',url:'https://my.folderit.com/file/view/?uid=file',sourceUrl:'https://source.example.org/x',downloadUrl:'https://bucket.s3.amazonaws.com/x?signature=opaque'};
 const d=D.deployment(base),r=D.withLinks(record,d);assert.equal(r.url,'https://my.chaffinch.com/file/view/?uid=file');assert.equal(r.folderitUrl,r.url);assert.equal(r.sourceUrl,record.sourceUrl);assert.equal(r.downloadUrl,record.downloadUrl);
 const unknown=D.withLinks(record,{...d,browserOrigin:null});assert.equal(unknown.url,undefined);assert.equal(unknown.folderitUrl,undefined);
});
test('connection context exposes deployment/account identity without secrets',async()=>{
 const c=nodeContext();const r=await connectionInfo(c,'same-account');assert.deepEqual(r,{apiOrigin:'https://api.my.chaffinch.com',browserOrigin:'https://my.chaffinch.com',accountUid:'same-account',connectionScope:'["https://api.my.chaffinch.com","same-account"]'});assert.doesNotMatch(JSON.stringify(r),/synthetic-secret|synthetic-bearer/);assert.equal(await resolveAccount(c,''),'same-account');
});

test('account and folder selectors use the selected deployment',async()=>{
 const c=nodeContext({accountUid:'same-account'},o=>o.url.endsWith('/accounts/same-account')?{uid:'same-account',name:'Selected'}:o.url.endsWith('/accounts')?[{uid:'same-account',name:'Selected'},{uid:'other',name:'Other'}]:{body:[{uid:'folder',type:'folder',name:'Folder'}],headers:{}});
 assert.deepEqual((await loadOptions.getAccounts.call(c)).map(x=>x.value),['same-account']);assert.equal((await loadOptions.getFolders.call(c))[0].value,'folder');assert(c.calls.every(o=>o.url.startsWith('https://api.my.chaffinch.com/v2/')));
});

test('a normal file action routes through the deployment helper',async()=>{
 const c=nodeContext({resource:'file',operation:'get',accountUid:'same-account',fileUid:'same-file'},()=>({uid:'same-file',type:'file'}));const [[r]]=await Folderit.prototype.execute.call(c);assert.equal(r.json.folderitUrl,'https://my.chaffinch.com/file/view/?uid=same-file');assert(c.calls[0].url.endsWith('/files/same-file'));
});

test('a workflow scope guard stops a mismatched credential before any destination action',async()=>{
 const c=nodeContext({resource:'folder',operation:'create',accountUid:'same-account',folderUid:'same-folder',name:'synthetic',expectedConnectionScope:JSON.stringify(['https://api.apollo.folderit.com','same-account'])});
 await assert.rejects(Folderit.prototype.execute.call(c),/expected deployment\/account/);assert.equal(c.calls.length,0);
});

test('poll checkpoints are isolated by deployment even with overlapping account and audit IDs',async()=>{
 const state={};const c=nodeContext({event:'newFile',accountUid:'same-account',recordUid:''},()=>[]);Object.assign(c,{getMode:()=> 'trigger',getActivationMode:()=> 'activate',getWorkflowStaticData:()=>state});
 await FolderitTrigger.prototype.poll.call(c);assert(state.scope.includes('api.my.chaffinch.com'));
 const old=state.scope;const original=c.getCredentials;c.getCredentials=async()=>{const v={...await original(),apiUrl:'https://api.apollo.folderit.com',browserUrl:'https://apollo.folderit.com'};v.sessionBinding=binding(v);return v;};await FolderitTrigger.prototype.poll.call(c);assert.notEqual(state.scope,old);assert(state.scope.includes('api.apollo.folderit.com'));
});


test('saved 0.5 connection bindings still reject retargeting before an API request', async () => {
 for (const change of [{apiUrl:'https://api.apollo.folderit.com'},{accountUid:'another-account'},{clientId:'different-client'},{clientSecret:'rotated-secret'}]) {
  const c=nodeContext(); const original=c.getCredentials; c.getCredentials=async()=>({...await original(),...change});
  await assert.rejects(api(c,'/accounts/same-account'),/separate/); assert.equal(c.calls.length,0);
 }
});
