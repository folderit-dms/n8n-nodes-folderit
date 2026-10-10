const {test}=require('node:test');const assert=require('node:assert/strict');
const {Folderit}=require('../dist/nodes/Folderit/Folderit.node');
const {FolderitTrigger}=require('../dist/nodes/Folderit/FolderitTrigger.node');
function ctx(params, respond, state={}) { const calls=[];return {calls,getInputData:()=>[{json:{}}],getNodeParameter:(name,index,fallback)=>params[name]??fallback??(typeof index==='number'?undefined:index),getNode:()=>({name:'Folderit',type:'n8n-nodes-folderit.folderit',typeVersion:1,position:[0,0],parameters:{},credentials:{folderitOAuth2Api:{id:'test'}}}),continueOnFail:()=>false,getMode:()=>params.mode||'trigger',getActivationMode:()=>params.activation||'activate',getWorkflowStaticData:()=>state,helpers:{httpRequestWithAuthentication:async(cred,o)=>{calls.push(o);return respond(o)},assertBinaryData:()=>({fileName:'v2.txt',mimeType:'text/plain'}),getBinaryDataBuffer:async()=>Buffer.from('version two'),httpRequest:async()=>({})}};}
const run=c=>Folderit.prototype.execute.call(c);const poll=c=>FolderitTrigger.prototype.poll.call(c);
const file={resource:'file',operation:'addVersion',accountUid:'a',fileUid:'file',binaryPropertyName:'data',versionLockId:'held-lock'};
test('version upload targets existing file and carries lock on create and complete',async()=>{
 const c=ctx(file,o=>o.method==='GET'?{uid:'file'}:o.body.action==='create'?{uploadId:'up',key:'key'}:o.body.action==='part'?{url:'https://bucket.s3.amazonaws.com/part'}:{uid:'file',versionUid:'v2'});
 const [out]=await run(c);assert.equal(out[0].json.versionUid,'v2');for(const action of ['create','complete']){const o=c.calls.find(o=>o.body?.action===action);assert.equal(o.body.fileUid,'file');assert.equal(o.body.folderUid,undefined);assert.equal(o.headers['X-Folderit-Lock'],'held-lock');}
});
test('ambiguous version completion is never aborted or retried',async()=>{
 const c=ctx(file,o=>{if(o.method==='GET')return {uid:'file'};if(o.body.action==='create')return {uploadId:'up',key:'key'};if(o.body.action==='part')return {url:'https://bucket.s3.amazonaws.com/part'};throw Error('secret');});await assert.rejects(run(c),/version history before retrying/);assert.deepEqual(c.calls.filter(o=>o.body).map(o=>o.body.action),['create','part','complete']);
});
test('version listing uses constant page size and rejects wrong-file and repeated rows',async()=>{
 const params={...file,operation:'getVersions',returnAll:false,limit:101};
 const c=ctx(params,o=>Array.from({length:o.qs.page===1?100:1},(_,i)=>({uid:'v'+((o.qs.page-1)*100+i),fileUid:'file'})));const [out]=await run(c);assert.equal(out.length,101);assert(c.calls.every(o=>o.qs['per-page']===100));
 await assert.rejects(run(ctx(params,()=>[{uid:'v',fileUid:'other'}])),/different file/);
 await assert.rejects(run(ctx(params,()=>Array.from({length:100},()=>({uid:'v'})))),/repeated identifiers/);
});
const wf={resource:'workflow',operation:'start',accountUid:'a',workflowRecordUid:'file',workflowOption:'wf::3'};
const options=[{workflowUid:'wf',workflowName:'Test',startOptions:[{triggerId:3,name:'Start'}]}];
test('workflow starts only a currently offered option and returns queued, not complete',async()=>{
 const c=ctx(wf,o=>o.method==='GET'?options:{queued:true,workflowUid:'wf',triggerId:3});const [out]=await run(c);assert.deepEqual(c.calls[1].body,{workflowUid:'wf',triggerId:3});assert.equal(out[0].json.queued,true);assert.equal(out[0].json.status,undefined);
 const stale=ctx({...wf,workflowOption:'wf::4'},()=>options);await assert.rejects(run(stale),/no longer available/);assert(stale.calls.every(o=>o.method==='GET'));
});
test('workflow uncertainty never repeats a start or hides an explicit rejection',async()=>{
 const c=ctx(wf,o=>{if(o.method==='GET')return options;throw Error('timeout secret')});await assert.rejects(run(c),/Check workflow progress before retrying/);assert.equal(c.calls.filter(o=>o.method==='POST').length,1);
 await assert.rejects(run(ctx(wf,o=>o.method==='GET'?options:{queued:false,workflowUid:'wf'})),/Could not confirm/);
});
const params={accountUid:'a',event:'newFile',recordUid:''};
const entry=(id,event='fileNew',entity='file')=>({id,uid:'audit'+id,event,entityUid:'parent',time:1791628800,data:{uid:entity}});
test('scheduled first poll establishes baseline, then emits new events once in oldest-first order',async()=>{
 const state={};const c=ctx(params,()=>[entry(10)],state);assert.equal(await poll(c),null);assert.equal(state.cursor,'10');
 const [out]=await poll(ctx(params,()=>[entry(12),entry(11),entry(10)],state));assert.deepEqual(out.map(x=>x.json.id),['audit11','audit12']);assert.equal(state.cursor,'12');assert.equal(await poll(ctx(params,()=>[entry(12)],state)),null);
});
test('manual previews do not seed or advance state; account and filter changes rebaseline',async()=>{
 const state={};assert.equal((await poll(ctx({...params,mode:'manual'},()=>[entry(1)],state)))[0].length,1);assert.deepEqual(state,{});
 await poll(ctx(params,()=>[entry(2)],state));const snapshot=structuredClone(state);await poll(ctx({...params,mode:'manual'},()=>[entry(3)],state));assert.deepEqual(state,snapshot);
 assert.equal(await poll(ctx({...params,recordUid:'other'},()=>[entry(4)],state)),null);assert.equal(state.cursor,'4');
});
test('pagination gap, unsorted audit, and expired windows do not advance checkpoint',async()=>{
 const state={};await poll(ctx(params,()=>[entry(1)],state));const snapshot=structuredClone(state);
 await assert.rejects(poll(ctx(params,o=>Array.from({length:100},(_,i)=>entry(2000-(o.qs.page-1)*100-i)),state)),/1,000/);assert.deepEqual(state,snapshot);
 await assert.rejects(poll(ctx(params,()=>[entry(3),entry(4)],state)),/descending/);assert.deepEqual(state,snapshot);
 state.lastPoll=Date.now()-24*3600000;const expired=structuredClone(state);await assert.rejects(poll(ctx(params,()=>[],state)),/23 hours/);assert.deepEqual(state,expired);
});
test('filtered events advance checkpoint and empty polls never move it backwards',async()=>{
 const state={};const p={...params,recordUid:'file'};await poll(ctx(p,()=>[entry(5)],state));assert.equal(await poll(ctx(p,()=>[entry(6,'fileNew','other'),entry(5)],state)),null);assert.equal(state.cursor,'6');await poll(ctx(p,()=>[entry(4)],state));assert.equal(state.cursor,'6');await poll(ctx(p,()=>[],state));assert.equal(state.cursor,'6');
});
test('version events fetch exact historical version; enrichment errors retain checkpoint',async()=>{
 const p={...params,event:'newVersion',recordUid:'file'},state={};await poll(ctx(p,()=>[entry(10)],state));const baseline=structuredClone(state);
 const e={...entry(11,'fileVersionNew','v1'),entityUid:'file'};
 await assert.rejects(poll(ctx(p,o=>{if(o.url.endsWith('/audit/accountLog'))return [e,entry(10)];throw Error('403');},state)));assert.deepEqual(state,baseline);
 const c=ctx(p,o=>o.url.endsWith('/audit/accountLog')?[e,entry(10)]:[{uid:'v1',fileUid:'file',size:7}]);const [out]=await poll(Object.assign(c,{getWorkflowStaticData:()=>state}));assert.equal(out[0].json.version.uid,'v1');assert.equal(out[0].json.entityUid,'file');assert(c.calls[1].url.endsWith('/files/file/versions'));assert.equal(state.cursor,'11');
});
test('workflow task events use the target record and never expose arbitrary audit payload secrets',async()=>{
 const e={...entry(1,'taskAccept','task'),data:{uid:'task',targetEntityUid:'file',token:'hidden'}};
 const [out]=await poll(ctx({...params,event:'workflowEvent',recordUid:'file',mode:'manual'},()=>[e]));assert.equal(out[0].json.taskUid,'task');assert.equal(out[0].json.entityUid,'file');assert(!JSON.stringify(out).includes('hidden'));
});

test('workflow progress preserves multiple runs of the same workflow',async()=>{
 const c=ctx({...wf,operation:'status',workflowReturnAll:false,workflowLimit:10},()=>[{workflowUid:'wf',createdAt:1,status:'complete'},{workflowUid:'wf',createdAt:2,status:'active'}]);const [out]=await run(c);assert.equal(out.length,2);assert.equal(out[1].json.status,'active');
});
test('version enrichment follows history pages and refuses a missing version without advancing',async()=>{
 const p={...params,event:'newVersion',recordUid:'file'},state={};await poll(ctx(p,()=>[entry(10)],state));const baseline=structuredClone(state);const e={...entry(11,'fileVersionNew','old'),entityUid:'file'};
 const c=ctx(p,o=>o.url.endsWith('/audit/accountLog')?[e,entry(10)]:o.qs.page===1?Array.from({length:100},(_,i)=>({uid:'v'+i,fileUid:'file'})):[{uid:'old',fileUid:'file'}],state);
 assert.equal((await poll(c))[0][0].json.version.uid,'old');assert.equal(c.calls.filter(o=>o.url.endsWith('/versions')).length,2);
 const fail=structuredClone(baseline);await assert.rejects(poll(ctx(p,o=>o.url.endsWith('/audit/accountLog')?[e,entry(10)]:[],fail)),/missing, inaccessible/);assert.deepEqual(fail,baseline);
});
test('poll budget exhaustion preserves state before any request',async()=>{
 const state={};const c=ctx(params,()=>{throw Error('must not call')},state);c.getPollBudgetMs=()=>1;await assert.rejects(poll(c),/time limit/);assert.equal(c.calls.length,0);assert.deepEqual(state,{});
});

test('restart without a durable baseline fails closed before API access',async()=>{
 for(const activation of ['init','leadershipChange']) {
  const state={};const c=ctx({...params,activation},()=>{throw Error('must not call')},state);
  await assert.rejects(poll(c),/No saved Folderit checkpoint/);assert.deepEqual(state,{});assert.equal(c.calls.length,0);
 }
});
test('restart with a saved baseline catches up instead of rebaselining',async()=>{
 const state={};await poll(ctx(params,()=>[entry(10)],state));
 const [out]=await poll(ctx({...params,activation:'init'},()=>[entry(11),entry(10)],state));
 assert.equal(out[0].json.auditId,'11');assert.equal(state.cursor,'11');
});
