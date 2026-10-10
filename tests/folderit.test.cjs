const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Folderit, validateUid, validateUploadUrl } = require('../dist/nodes/Folderit/Folderit.node.js');
function context(params, api, storage = async () => ({}), input = [{json:{}}]) {
 const calls = [];
 return {
  calls, getInputData: () => input,
  getNodeParameter: (name, i) => typeof params[name] === 'function' ? params[name](i) : params[name],
  getNode: () => ({ name: 'Folderit', type: 'n8n-nodes-folderit.folderit', typeVersion: 1, position:[0,0], parameters:{} }),
  continueOnFail: () => Boolean(params.continueOnFail),
  helpers: {
   httpRequestWithAuthentication: async (credential, options) => { calls.push({credential,...options}); return api(options); },
   httpRequest: storage,
   assertBinaryData: () => ({fileName:'example.txt',mimeType:'text/plain'}),
   getBinaryDataBuffer: async () => Buffer.from('hello'),
  },
 };
}
test('rejects path injection and untrusted storage URLs', () => {
 for (const uid of ['../other','a/b','a?b','a%2fb','']) assert.throws(() => validateUid(uid));
 assert.equal(validateUid(' abc_12-3 '),'abc_12-3');
 assert.equal(validateUid('-4ewV0UZce'),'-4ewV0UZce');
 assert.equal(validateUid('_RcBX0fhO1'),'_RcBX0fhO1');
 for(const url of ['http://bucket.s3.amazonaws.com/a','https://evil.example/a','https://s3.amazonaws.com.evil.example/a','https://user:secret@bucket.s3.amazonaws.com/a']) assert.throws(()=>validateUploadUrl(url));
});
test('paginates files and preserves pairing across inputs', async () => {
 const ctx=context({resource:'file',operation:'getAll',accountUid:'account',folderUid:i=>`folder${i}`,returnAll:false,limit:102}, o => Array.from({length:o.qs['per-page']},(_,i)=>({uid:`${o.qs.page}-${i}`})),undefined,[{json:{}},{json:{}}]);
 const [out]=await Folderit.prototype.execute.call(ctx);
 assert.equal(out.length,204); assert.equal(ctx.calls.length,4);
 assert.equal(ctx.calls[1].qs.page,2); assert.equal(ctx.calls[1].qs['per-page'],100);
 assert.deepEqual(out[102].pairedItem,{item:1});
});
test('empty lists produce no fake records', async () => {
 const ctx=context({resource:'folder',operation:'getAll',accountUid:'account',folderUid:'parent',returnAll:true},()=>[]);
 assert.deepEqual(await Folderit.prototype.execute.call(ctx),[[]]);
});
test('folder creation passes explicit duplicate behavior',async()=>{
 const ctx=context({resource:'folder',operation:'create',accountUid:'account',folderUid:'parent',name:' Contracts ',returnDuplicateFolder:true},o=>({uid:'new',...o.body}));
 await Folderit.prototype.execute.call(ctx);
 assert.deepEqual(ctx.calls[0].body,{name:'Contracts',parentUid:'parent',returnDuplicateFolder:true});
});
test('upload orders create, part, anonymous PUT, complete',async()=>{
 const order=[];
 const ctx=context({resource:'file',operation:'upload',accountUid:'account',folderUid:'parent',binaryPropertyName:'data'},o=>{
  order.push(o.body.action);
  if(o.body.action==='create') return {uploadId:'upload',key:'key'};
  if(o.body.action==='part') return {url:'https://bucket.s3.amazonaws.com/file?signature=example'};
  return {uid:'file'};
 },async o=>{order.push('PUT');assert.equal(o.headers.Authorization,undefined);assert.equal(o.disableFollowRedirect,true);assert.equal(o.body.toString(),'hello');});
 const [out]=await Folderit.prototype.execute.call(ctx);
 assert.deepEqual(order,['create','part','PUT','complete']);assert.equal(out[0].json.uid,'file');
});
test('failed storage transfer aborts and never completes',async()=>{
 const actions=[];
 const ctx=context({resource:'file',operation:'upload',accountUid:'account',folderUid:'parent',binaryPropertyName:'data',continueOnFail:true},o=>{
  actions.push(o.body.action);
  return o.body.action==='create'?{uploadId:'up',key:'key'}:{url:'https://bucket.s3.amazonaws.com/file'};
 },async()=>{throw new Error('signed-url-secret');});
 const [out]=await Folderit.prototype.execute.call(ctx);
 assert.deepEqual(actions,['create','part','abort']);assert(!JSON.stringify(out).includes('signed-url-secret'));
});
test('ambiguous completion is not retried or aborted',async()=>{
 const actions=[];
 const ctx=context({resource:'file',operation:'upload',accountUid:'account',folderUid:'parent',binaryPropertyName:'data',continueOnFail:true},o=>{
  actions.push(o.body.action); if(o.body.action==='complete') throw new Error('timeout');
  return o.body.action==='create'?{uploadId:'up',key:'key'}:{url:'https://bucket.s3.amazonaws.com/file'};
 });
 const [out]=await Folderit.prototype.execute.call(ctx);
 assert.deepEqual(actions,['create','part','complete']);assert.match(out[0].json.error,/before retrying/);
});
test('API failures never include raw credential details',async()=>{
 const ctx=context({resource:'file',operation:'get',accountUid:'account',fileUid:'file',continueOnFail:true},()=>{throw new Error('Bearer secret-token');});
 const [out]=await Folderit.prototype.execute.call(ctx);assert(!JSON.stringify(out).includes('secret-token'));assert.deepEqual(out[0].pairedItem,{item:0});
});
test('multipart upload uses consecutive parts and exact byte lengths',async()=>{
 const parts=[]; const sizes=[];
 const ctx=context({resource:'file',operation:'upload',accountUid:'account',folderUid:'parent',binaryPropertyName:'data'},o=>{
  if(o.body.action==='create') return {uploadId:'up',key:'key'};
  if(o.body.action==='part') {parts.push([o.body.partNumber,o.body.contentLength]);return {url:'https://bucket.s3.amazonaws.com/file'};}
  return {uid:'file'};
 },async o=>{sizes.push(o.body.length);});
 ctx.helpers.getBinaryDataBuffer=async()=>Buffer.alloc(21*1024*1024);
 await Folderit.prototype.execute.call(ctx);
 assert.deepEqual(parts,[[1,10*1024*1024],[2,10*1024*1024],[3,1024*1024]]);assert.deepEqual(sizes,parts.map(p=>p[1]));
});
test('untrusted storage URL aborts without any storage request',async()=>{
 let storageCalls=0;const actions=[];
 const ctx=context({resource:'file',operation:'upload',accountUid:'account',folderUid:'parent',binaryPropertyName:'data',continueOnFail:true},o=>{
  actions.push(o.body.action);return o.body.action==='create'?{uploadId:'up',key:'key'}:{url:'https://attacker.example/file'};
 },async()=>{storageCalls++;});
 await Folderit.prototype.execute.call(ctx);
 assert.equal(storageCalls,0);assert.deepEqual(actions,['create','part','abort']);
});
test('return all follows full pages until the final short page',async()=>{
 const ctx=context({resource:'file',operation:'getAll',accountUid:'account',folderUid:'folder',returnAll:true},o=>Array.from({length:o.qs.page===1?100:3},(_,i)=>({uid:String(i)})));
 const [out]=await Folderit.prototype.execute.call(ctx);assert.equal(out.length,103);assert.equal(ctx.calls.length,2);
});

test('pagination uses actual server offsets without repeating earlier records', async()=>{
 const rows=Array.from({length:180},(_,i)=>({uid:String(i)}));
 const ctx=context({resource:'file',operation:'getAll',accountUid:'account',folderUid:'folder',returnAll:false,limit:102},o=>{
  const size=o.qs['per-page'];return rows.slice((o.qs.page-1)*size,o.qs.page*size);
 });
 const [out]=await Folderit.prototype.execute.call(ctx);
 assert.deepEqual(out.map(x=>x.json.uid),rows.slice(0,102).map(x=>x.uid));
});
test('download isolates credentials and returns binary with item pairing',async()=>{
 const ctx=context({resource:'file',operation:'download',accountUid:'account',fileUid:'file',outputBinaryField:'document'},o=>{
  if(o.url.endsWith('/download')){
   assert.equal(o.disableFollowRedirect,true);
   return {statusCode:302,headers:{location:'https://bucket.s3.amazonaws.com/file?signature=private'}};
  }
  return {uid:'file',name:'example.txt'};
 }, async o=>{
  assert.equal(o.headers,undefined);assert.equal(o.disableFollowRedirect,true);
  assert.equal(o.encoding,'stream');return Buffer.from('downloaded content');
 });
 ctx.helpers.prepareBinaryData=async(data,name)=>({data:data.toString('base64'),fileName:name,mimeType:'text/plain'});
 const [out]=await Folderit.prototype.execute.call(ctx);
 assert.equal(Buffer.from(out[0].binary.document.data,'base64').toString(),'downloaded content');
 assert.equal(out[0].binary.document.fileName,'example.txt');
 assert.deepEqual(out[0].pairedItem,{item:0});
 assert(!JSON.stringify(out).includes('signature'));
});
test('download rejects unexpected redirects without leaking signed URLs',async()=>{
 let downloads=0;
 for(const response of [{statusCode:200,headers:{}},{statusCode:302,headers:{location:'https://attacker.example/private'}}]){
  const ctx=context({resource:'file',operation:'download',accountUid:'account',fileUid:'file',outputBinaryField:'data',continueOnFail:true},o=>o.url.endsWith('/download')?response:{uid:'file'},async()=>{downloads++});
  const [out]=await Folderit.prototype.execute.call(ctx);
  assert.match(out[0].json.error,/download failed/);assert(!JSON.stringify(out).includes('attacker'));
 }
 assert.equal(downloads,0);
});
