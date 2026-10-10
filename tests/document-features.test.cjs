const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Folderit}=require('../dist/nodes/Folderit/Folderit.node.js');
const {loadOptions,folderOptions}=require('../dist/nodes/Folderit/discovery.js');
const {validateTypedValue,verifyReadback}=require('../dist/nodes/Folderit/metadata.js');
function ctx(params,respond){
 const calls=[];
 return {calls,getInputData:()=>[{json:{}}],getNodeParameter:(name,index,fallback)=>params[name]??fallback,getNode:()=>({name:'Folderit',type:'n8n-nodes-folderit.folderit',typeVersion:1,position:[0,0],parameters:{}}),continueOnFail:()=>false,helpers:{httpRequestWithAuthentication:async(cred,o)=>{assert.equal(cred,'folderitOAuth2Api');calls.push(o);return respond(o);}}};
}
const run=c=>Folderit.prototype.execute.call(c);
test('folder picker follows cursor pages, keeps duplicate names distinct and hides deleted files',async()=>{
 const c=ctx({accountUid:'a'},o=>o.qs.cursor?{body:[{uid:'child',name:'Contracts',type:'folder',parentUid:'root'},{uid:'other',name:'Contracts',type:'folder'},{uid:'deleted',type:'folder',name:'Gone',deletedAt:1}],headers:{}}:{body:[{uid:'root',name:'Team',type:'folder'},{uid:'file',name:'Not a folder',type:'file'}],headers:{'x-pagination-cursor':'next'}});
 const options=await loadOptions.getFolders.call(c);
 assert.deepEqual(options.map(x=>x.value),['other','root','child']);assert.equal(options[2].name,'Team / Contracts (child)');assert.equal(c.calls[1].qs.cursor,'next');
});
test('folder picker fails on repeated cursors and cyclic paths terminate',async()=>{
 const c=ctx({accountUid:'a'},()=>({body:[],headers:{'x-pagination-cursor':'same'}}));
 await assert.rejects(loadOptions.getFolders.call(c),/repeated cursor/);
 assert.equal(folderOptions([{uid:'a',name:'A',type:'folder',parentUid:'b'},{uid:'b',name:'B',type:'folder',parentUid:'a'}]).length,2);
});
test('account and metadata choices use exact stable UIDs',async()=>{
 const c=ctx({accountUid:'a'},o=>o.url.endsWith('/accounts')?[{uid:'a',name:'Test Account'}]:[{uid:'m',name:'Approval',type:'boolean',multiple:false}]);
 assert.deepEqual(await loadOptions.getAccounts.call(c),[{name:'Test Account (a)',value:'a'}]);
 assert.deepEqual(await loadOptions.getMetadata.call(c),[{name:'Approval [boolean] (m)',value:'m'}]);
});
test('search sends POST and uses the exact server cursor for its next page',async()=>{
 const c=ctx({resource:'file',operation:'search',accountUid:'a',query:'invoice',queryFields:['name','content'],filters:{parentUid:'parent'},returnAll:false,limit:102},o=>({entities:Array.from({length:o.body.limit},(_,i)=>({uid:String((o.body.searchAfter?100:0)+i),type:'file',sort:[1,String(i)]}))}));
 const [out]=await run(c);assert.equal(out.length,102);assert.equal(c.calls[0].method,'POST');assert.deepEqual(c.calls[1].body.searchAfter,[1,'99']);assert.equal(c.calls[1].body.limit,2);assert.equal(c.calls[0].body.parentUid,'parent');assert.deepEqual(out[101].pairedItem,{item:0});
});
test('search refuses blank broad queries, propagates denied access, and returns no fake rows',async()=>{
 const base={resource:'folder',operation:'search',accountUid:'a',query:'Test',queryFields:['name'],returnAll:false,limit:10};
 const blank=ctx({...base,query:''},()=>{throw Error('must not call')});await assert.rejects(run(blank),/query or at least one filter/);assert.equal(blank.calls.length,0);
 const denied=ctx(base,()=>{throw Object.assign(Error('Bearer hidden'),{statusCode:403})});await assert.rejects(run(denied),e=>/HTTP 403/.test(e.message)&&!e.message.includes('hidden'));
 assert.deepEqual(await run(ctx(base,()=>({hits:0,entities:[]}))),[[]]);
});
test('search never silently accepts repeated results or missing continuation cursors',async()=>{
 const base={resource:'file',operation:'search',accountUid:'a',query:'x',queryFields:['name'],returnAll:false,limit:101};
 await assert.rejects(run(ctx(base,()=>({entities:Array.from({length:100},(_,i)=>({uid:String(i),type:'file'}))}))),/search cursor/);
 await assert.rejects(run(ctx(base,()=>({entities:Array.from({length:100},()=>({uid:'same',type:'file',sort:[1]}))}))),/repeated records/);
});
test('metadata enforces types, decimal precision, real dates, timezone and multiplicity',()=>{
 for(const [type,value,extra] of [['integer','42'],['integer',Number.MAX_SAFE_INTEGER+1],['boolean','false'],['date','2026-02-30'],['datetime','2026-10-10T10:00:00'],['float','1.234',{decimalScale:2}],['float','1e3'],['time','25:00:00'],['email','invalid'],['url','file:///tmp/file'],['unknown',null],['boolean',[true],{multiple:true}]])assert.throws(()=>validateTypedValue({uid:'m',type,...extra},value));
 assert.equal(validateTypedValue({uid:'m',type:'integer'},42),42);
 assert.equal(validateTypedValue({uid:'m',type:'boolean'},false),false);
 assert.equal(validateTypedValue({uid:'m',type:'float',decimalScale:2},'12345678901234567890.12'),'12345678901234567890.12');
 assert.equal(validateTypedValue({uid:'m',type:'datetime'},'2026-10-10T10:00:00+03:00'),'2026-10-10T07:00:00.000Z');
 assert.equal(validateTypedValue({uid:'m',type:'string',multiple:true},null),null);
 assert.deepEqual(validateTypedValue({uid:'m',type:'integer',multiple:true},[1,2]),[1,2]);
});
test('select membership and table columns are validated before a write',()=>{
 assert.throws(()=>validateTypedValue({uid:'m',type:'select',options:[{uid:'yes'}]},'no'),/option UID/);
 const def={uid:'m',type:'table',data:{table:{columns:[{key:'name'},{key:'amount'}]}}};
 const v=validateTypedValue(def,{rows:[[{key:'amount',value:4},{key:'name',value:'A'}]]});
 assert.deepEqual(v,{rowCount:1,rows:[[{key:'name',value:'A'},{key:'amount',value:4}]]});
 assert.throws(()=>validateTypedValue(def,{rows:[[{key:'other',value:'X'}]]}),/column key/);
 assert.throws(()=>validateTypedValue(def,{rows:[[{key:'name',value:'A'},{key:'name',value:'B'}]]}),/column key/);
 assert.throws(()=>validateTypedValue(def,{rowCount:3,rows:[]}),/rowCount/);
 const two=validateTypedValue(def,{rows:[[{key:'name',value:'A'}],[{key:'name',value:'B'}]]});
 assert(!verifyReadback(two,[{rowCount:2,rows:[...two.rows].reverse()}],def));
});
const update={resource:'metadata',operation:'update',accountUid:'a',recordUid:'file',metadataUid:'m',valueInput:'json',valueJson:'42',fileLockId:''};
test('typed update writes once, carries only explicit lock, and verifies saved integer',async()=>{
 let saved=false;const c=ctx({...update,fileLockId:'lock-id'},o=>{
  if(o.url.endsWith('/meta/m'))return {uid:'m',type:'integer',name:'Count'};
  if(o.method==='PUT'){saved=true;assert.deepEqual(o.body,{fields:[{metaUid:'m',value:42}]});assert.equal(o.headers['X-Folderit-Lock'],'lock-id');return [];}
  return saved?[{meta:{uid:'m'},value:42}]:[];
 });
 const [out]=await run(c);assert.equal(out[0].json.verified,true);assert.equal(out[0].json.changed,true);assert.equal(c.calls.filter(o=>o.method==='PUT').length,1);
});
test('invalid typed values and denied metadata definitions cause no writes',async()=>{
 for(const [valueJson,permissions] of [['"42"',{}],['42',{canUpdate:false}]]){
  const c=ctx({...update,valueJson},()=>({uid:'m',type:'integer',permissions}));await assert.rejects(run(c));assert.equal(c.calls.filter(o=>o.method==='PUT').length,0);
 }
});
test('unchanged values are verified without writes; false is never confused with null',async()=>{
 const c=ctx({...update,valueJson:'false'},o=>o.url.endsWith('/meta/m')?{uid:'m',type:'boolean'}:[{metaUid:'m',value:false}]);
 const [out]=await run(c);assert.equal(out[0].json.changed,false);assert.equal(out[0].json.value,false);assert.equal(c.calls.length,2);
 assert.equal(verifyReadback(null,[false],{uid:'m',type:'boolean'}),false);
});
test('stale metadata readback fails clearly and never repeats the write',async()=>{
 const c=ctx(update,o=>o.url.endsWith('/meta/m')?{uid:'m',type:'integer'}:[]);
 await assert.rejects(run(c),/submitted but readback did not match/);assert.equal(c.calls.filter(o=>o.method==='PUT').length,1);
});
test('table schema hydrates from catalog and multiple clear sends explicit null',async()=>{
 const table={uid:'m',type:'table',data:{table:{columns:[{key:'name'}]}}};let saved;
 const c=ctx({...update,valueJson:'{"rows":[[{"key":"name","value":"A"}]]}'},o=>{
  if(o.url.endsWith('/meta/m'))return {uid:'m',type:'table'};
  if(o.url.endsWith('/accounts/a/meta'))return [table];
  if(o.method==='PUT'){saved=o.body.fields[0].value;return [];}
  return saved?[{metaUid:'m',value:saved}]:[];
 });await run(c);assert.equal(saved.rowCount,1);
 let clear=false;const c2=ctx({...update,valueInput:'clear'},o=>{if(o.url.endsWith('/meta/m'))return {uid:'m',type:'integer',multiple:true};if(o.method==='PUT'){assert.equal(o.body.fields[0].value,null);clear=true;return [];}return clear?[]:[{metaUid:'m',value:42}];});
 const [out]=await run(c2);assert.equal(out[0].json.verified,true);assert(clear);
});
