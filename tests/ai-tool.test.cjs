const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Folderit}=require('../dist/nodes/Folderit/Folderit.node');
const {NodeHelpers}=require('n8n-workflow');
function context(operation,tool=true){
 const calls=[];const params={resource:'file',operation,accountUid:'account',query:'synthetic',queryFields:['name'],filters:{parentUid:'demo-folder'},returnAll:false,limit:5};
 return {calls,getInputData:()=>[{json:{}}],getNodeParameter:(n,i,f)=>params[n]??f,getNode:()=>({name:'Folderit Search',type:tool?'n8n-nodes-folderit.folderitTool':'n8n-nodes-folderit.folderit',typeVersion:1,position:[0,0],parameters:params}),continueOnFail:()=>false,helpers:{httpRequestWithAuthentication:async(c,o)=>{calls.push(o);return {entities:[{uid:'synthetic-id',type:'file',name:'Synthetic demo.txt'}]};}}};
}
test('AI tools reject every binary action before any API call, even with edited workflow JSON',async()=>{
 for(const operation of ['upload','addVersion','download']){
  const c=context(operation);await assert.rejects(Folderit.prototype.execute.call(c),/Binary file operations require a normal Folderit/);assert.equal(c.calls.length,0);
 }
});
test('native tool search uses real request handling and preserves configured folder restriction',async()=>{
 const c=context('search');const [result]=await Folderit.prototype.execute.call(c);assert.equal(result[0].json.uid,'synthetic-id');assert.equal(c.calls[0].body.parentUid,'demo-folder');assert.equal(c.calls[0].body.query,'synthetic');
});
test('n8n displays supported file actions for tools and retains binary actions for normal nodes',()=>{
 const desc=new Folderit().description;assert.equal(desc.usableAsTool,true);
 for(const tool of [false,true]){
  const d={...desc,name:tool?'folderitTool':'folderit'};
  const node={name:'Folderit',type:'n8n-nodes-folderit.'+d.name,typeVersion:1,position:[0,0],parameters:{resource:'file'}};
  const visible=desc.properties.filter(p=>p.name==='operation'&&NodeHelpers.displayParameter(node.parameters,p,node,d));
  assert.equal(visible.length,1);const values=visible[0].options.map(x=>x.value);
  assert(values.includes('search'));for(const binary of ['upload','addVersion','download'])assert.equal(values.includes(binary),!tool);
 }
});
