const {test}=require('node:test');
const assert=require('node:assert/strict');
const {FolderitApi,binding}=require('../dist/credentials/FolderitApi.credentials');
const {Folderit}=require('../dist/nodes/Folderit/Folderit.node');
const {FolderitTrigger}=require('../dist/nodes/Folderit/FolderitTrigger.node');
const {loadOptions}=require('../dist/nodes/Folderit/discovery');
const {api,connectionInfo,storageRequest,resolveAccount}=require('../dist/nodes/Folderit/api');
const D=require('../dist/nodes/Folderit/deployment');
const credential=new FolderitApi();
const addresses={apiAddress:'8.8.8.8',authAddress:'1.1.1.1'};
const base={apiUrl:'https://api.my.chaffinch.com/#description/introduction',browserUrl:'https://my.chaffinch.com/en/login/',clientId:'synthetic-client',clientSecret:'synthetic-secret',sessionToken:'',_folderitNetwork:addresses};
const discovery={issuer:'https://auth.my.chaffinch.com',token_endpoint:'https://auth.my.chaffinch.com/oauth2/token',grant_types_supported:['client_credentials'],token_endpoint_auth_methods_supported:['client_secret_basic']};
function harness(overrides={},respond){
 const c={...base,...overrides},calls=[];
 const helper={helpers:{httpRequest:async o=>{calls.push(o);if(respond)return respond(o,calls);if(o.url.includes('openid-configuration'))return {statusCode:200,body:discovery};if(o.url.includes('oauth2/token'))return {statusCode:200,body:{access_token:'synthetic-bearer',expires_in:3600}};return {statusCode:200,body:[{uid:'same-account',name:'Synthetic account'}],headers:{}};}}};
 return {c,calls,connect:()=>credential.preAuthentication.call(helper,c)};
}
test('deployment normalization preserves nested domains and independent browser origins',()=>{
 const d=D.deployment(base);assert.equal(d.apiOrigin,'https://api.my.chaffinch.com');assert.equal(d.authOrigin,'https://auth.my.chaffinch.com');assert.equal(d.browserOrigin,'https://my.chaffinch.com');
 assert.equal(D.apiOrigin('https://api.apollo.folderit.com/v2/'),'https://api.apollo.folderit.com');assert.equal(D.deployment({}).browserOrigin,D.CLOUD_WEB);assert.equal(D.deployment({apiUrl:base.apiUrl}).browserOrigin,null);
 for(const u of ['http://api.example.org','https://user:secret@api.example.org','https://127.0.0.1','https://[::1]','https://api.localhost','https://api.host.internal','https://api.example.org:444','https://api.example.org/v2/v2','https://api.example.org/a/../v2','https://api.example.org?host=evil','https://api.example.org/%76%32'])assert.throws(()=>D.apiOrigin(u));
});
test('exact metadata is checked before Basic credentials are sent',async()=>{
 const h=harness();const session=await h.connect();assert.equal(session.selectedAccountUid,'same-account');assert.equal(h.calls.length,3);
 assert.equal(h.calls[0].headers.Authorization,undefined);assert.equal(h.calls[0].url,'https://1.1.1.1/.well-known/openid-configuration');
 assert.equal(h.calls[1].headers.Host,'auth.my.chaffinch.com');assert.equal(h.calls[1].agentOptions.servername,'auth.my.chaffinch.com');assert.match(h.calls[1].headers.Authorization,/^Basic /);assert.equal(h.calls[1].body,'grant_type=client_credentials');
 assert.equal(h.calls[2].url,'https://8.8.8.8/v2/accounts');assert.equal(h.calls[2].headers.Authorization,'Bearer synthetic-bearer');
 for(const o of h.calls){assert.equal(o.disableFollowRedirect,true);assert.equal(o.skipSslCertificateValidation,false);assert.equal(o.agentOptions.rejectUnauthorized,true);}
 assert(!Object.hasOwn(session,'_folderitNetwork'));assert(!Object.values(session).includes('synthetic-secret'));
});
test('redirects, wrong issuers/token endpoints/grants/methods fail before token exchange',async()=>{
 const variants=[{...discovery,issuer:'https://auth.folderit.com'},{...discovery,token_endpoint:'https://auth.chaffinch.com/oauth2/token'},{...discovery,token_endpoint:'https://auth.my.chaffinch.com:443/oauth2/token'},{...discovery,grant_types_supported:['authorization_code']},{...discovery,token_endpoint_auth_methods_supported:['client_secret_post']}];
 for(const metadata of variants){const h=harness({},()=>({statusCode:200,body:metadata}));await assert.rejects(h.connect(),/discovery/);assert.equal(h.calls.length,1);assert.equal(h.calls[0].headers.Authorization,undefined);}
 const h=harness({},()=>({statusCode:302,headers:{location:'https://auth.folderit.com'},body:{}}));await assert.rejects(h.connect(),/discovery/);assert.equal(h.calls.length,1);
});
test('no routing proof or unsafe proof can cause a credential request',async()=>{
 for(const proof of [undefined,{apiAddress:'127.0.0.1',authAddress:'1.1.1.1'},{apiAddress:'8.8.8.8',authAddress:'169.254.169.254'}]){const h=harness({_folderitNetwork:proof});await assert.rejects(h.connect());assert.equal(h.calls.length,0);}
});
test('saved sessions cannot be retargeted even when record IDs overlap',async()=>{
 const h=harness();const session=await h.connect();
 for(const change of [{apiUrl:'https://api.apollo.folderit.com'},{accountUid:'another-account'},{clientId:'different-client'},{clientSecret:'rotated-secret'}]){const other=harness({...session,...change});await assert.rejects(other.connect(),/separate/);assert.equal(other.calls.length,0);}
 const renewed=harness({...session});assert.equal((await renewed.connect()).sessionBinding,session.sessionBinding);assert.equal(renewed.calls[0].headers.Authorization,undefined);
});
test('account discovery never chooses the first of several accounts',async()=>{
 const h=harness({},o=>o.url.includes('openid')?{statusCode:200,body:discovery}:o.url.includes('token')?{statusCode:200,body:{access_token:'test'}}:{statusCode:200,body:[{uid:'one',name:'One'},{uid:'two',name:'Two'}],headers:{}});
 await assert.rejects(h.connect(),/Several accounts.*one.*two/);
 const empty=harness({},o=>o.url.includes('openid')?{statusCode:200,body:discovery}:o.url.includes('token')?{statusCode:200,body:{access_token:'test'}}:{statusCode:200,body:[],headers:{}});await assert.rejects(empty.connect(),/No accessible/);
});
test('explicit account is independently verified without enumerating other accounts',async()=>{
 const h=harness({accountUid:'one'},o=>o.url.includes('openid')?{statusCode:200,body:discovery}:o.url.includes('token')?{statusCode:200,body:{access_token:'test'}}:{statusCode:200,body:{uid:'one'}});assert.equal((await h.connect()).selectedAccountUid,'one');assert(h.calls[2].url.endsWith('/accounts/one'));assert.equal(h.calls.length,3);
});
test('account discovery rejects partial/repeated pagination and changed auto-selected scope',async()=>{
 const responder=(o)=>o.url.includes('openid')?{statusCode:200,body:discovery}:o.url.includes('token')?{statusCode:200,body:{access_token:'test'}}:{statusCode:200,body:Array.from({length:100},(_,i)=>({uid:'account'+i})),headers:{}};
 const h=harness({},responder);await assert.rejects(h.connect(),/repeated/);
 const changed=harness({selectedAccountUid:'previous'});await assert.rejects(changed.connect(),/account changed/);
});
function filter(ips=['8.8.8.8']){return {validateUrl:async()=>({ok:true,value:undefined}),createSecureLookup:()=> (_host,_options,cb)=>cb(null,ips.map(address=>({address,family:address.includes(':')?6:4}))) };}
test('private DNS, mixed answers and blocked hosts fail before any request',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','100.64.0.1','169.254.169.254','172.16.1.1','192.168.0.1','192.0.2.1','198.18.0.1','203.0.113.2','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1']){assert.equal(D.isPublicAddress(ip),false,ip);await assert.rejects(D.pinHost(filter(['8.8.8.8',ip]),'https://api.example.org'));}
 await assert.rejects(D.pinHost({...filter(),validateUrl:async()=>({ok:false,error:new Error('blocked')})},'https://api.example.org'),/blocked/);
});
test('public-address validation rejects malformed and reserved IPv6 even with an operator allowlist',()=>{
 for(const ip of ['8.008.8.8','192.88.99.1','2001:db8::1','2001:20::1','2002:c000:0201::1','3fff::1','3ffe::1','2606:invalid::1','2606:4700:','2606:4700::1%lo0'])assert.equal(D.isPublicAddress(ip),false,ip);
 for(const ip of ['8.8.8.8','2001:4860:4860::8888','2606:4700:4700::1111'])assert.equal(D.isPublicAddress(ip),true,ip);
});
test('validated DNS answers are pinned while TLS hostname, path and signature bytes remain intact',async()=>{
 const address=await D.pinHost(filter(),'https://api.example.org');const original='https://api.example.org/path?signature=a%2Fb%3D';const r=D.pinnedRequest({url:original,headers:{Authorization:'must-strip',Cookie:'test'}},'https://api.example.org',address);
 assert.equal(r.url,'https://8.8.8.8/path?signature=a%2Fb%3D');assert.equal(r.headers.Host,'api.example.org');assert.equal(r.headers.Authorization,undefined);assert.equal(r.agentOptions.servername,'api.example.org');assert.equal(r.agentOptions.rejectUnauthorized,true);
 assert.throws(()=>D.pinnedRequest({url:'https://other.example.org'},'https://api.example.org',address));
});
test('a saved token is attached only to the selected API/account and never to auth/storage',async()=>{
 const c={...base,sessionToken:'synthetic-bearer',selectedAccountUid:'same-account'};c.sessionBinding=binding(c);
 const good=D.pinnedRequest({url:'https://api.my.chaffinch.com/v2/accounts/same-account/files/file'},'https://api.my.chaffinch.com',addresses.apiAddress);
 assert.equal((await credential.authenticate(c,good)).headers.Authorization,'Bearer synthetic-bearer');
 for(const r of [{...good,url:'https://1.1.1.1/oauth2/token'},{...good,url:good.url.replace('same-account','other')},{...good,headers:{Host:'evil.example.org'}},{...good,agentOptions:{servername:'auth.my.chaffinch.com'}}])await assert.rejects(credential.authenticate(c,r));
});
test('generated Folderit links use the independent browser origin and leave sources/storage alone',()=>{
 const record={uid:'file',type:'file',url:'https://my.folderit.com/file/view/?uid=file',sourceUrl:'https://source.example.org/x',downloadUrl:'https://bucket.s3.amazonaws.com/x?signature=opaque'};
 const d=D.deployment(base),r=D.withLinks(record,d);assert.equal(r.url,'https://my.chaffinch.com/file/view/?uid=file');assert.equal(r.folderitUrl,r.url);assert.equal(r.sourceUrl,record.sourceUrl);assert.equal(r.downloadUrl,record.downloadUrl);
 const unknown=D.withLinks(record,{...d,browserOrigin:null});assert.equal(unknown.url,undefined);assert.equal(unknown.folderitUrl,undefined);
});
function nodeContext(overrides={},respond=()=>({uid:'same-account'})){
 const data={...base,sessionToken:'synthetic-bearer',selectedAccountUid:'same-account',sessionExpiresAt:Date.now()+3600000};data.sessionBinding=binding(data);const calls=[];let filters=0;
 const parameters={authentication:'folderitApi',...overrides};
 return {calls,get filters(){return filters;},getNode:()=>({name:'Folderit',type:'n8n-nodes-folderit.folderit',typeVersion:1,position:[0,0],parameters,credentials:{folderitApi:{id:'private-connection',name:'Synthetic'}}}),getNodeParameter:(n,_i,f)=>parameters[n]??f,getCredentials:async()=>data,getInputData:()=>[{json:{}}],continueOnFail:()=>false,helpers:{getSecureEgressFilter:p=>{assert.equal(p,'enforced');filters++;return filter();},httpRequestWithAuthentication:async(t,o,extra)=>{calls.push({type:t,...o,extra});return respond(o);},httpRequest:async o=>{calls.push(o);return Buffer.from('synthetic file');}}};
}
test('nodes route calls using credential settings, pin public DNS and disable automatic write retry',async()=>{
 const c=nodeContext();await api(c,'/accounts/same-account/files/file');await api(c,'/accounts/same-account/files/file',{method:'POST',body:{name:'synthetic'}});assert.equal(c.calls[0].url,'https://8.8.8.8/v2/accounts/same-account/files/file');assert.equal(c.calls[0].headers.Host,'api.my.chaffinch.com');assert.equal(c.calls[0].extra.preAuthenticationRetryStatusCode,401);assert.deepEqual(c.calls[1].extra.preAuthenticationRetryStatusCode,[]);
 for(const path of ['https://other.example.org/x','//other.example.org/x','/accounts/../other','/accounts?url=evil'])await assert.rejects(api(c,path));assert.equal(c.calls.length,2);
});
test('missing secure egress capability fails closed rather than using an unchecked transport',async()=>{
 const c=nodeContext();delete c.helpers.getSecureEgressFilter;await assert.rejects(api(c,'/accounts'),/secure egress/);assert.equal(c.calls.length,0);
});
test('custom storage is explicit, anonymous, pinned and never receives the Folderit token',async()=>{
 const c=nodeContext();const original=c.getCredentials;c.getCredentials=async()=>({...await original(),storageOrigins:'https://storage.my.chaffinch.com'});
 await storageRequest(c,{url:'https://storage.my.chaffinch.com/file?sig=a%2Fb',headers:{Authorization:'Bearer wrong',Cookie:'private'},encoding:'stream'});const o=c.calls[0];assert.equal(o.headers.Authorization,undefined);assert.equal(o.headers.Cookie,undefined);assert.equal(o.headers.Host,'storage.my.chaffinch.com');assert.equal(o.url,'https://8.8.8.8/file?sig=a%2Fb');assert.equal(o.disableFollowRedirect,true);
 await assert.rejects(storageRequest(c,{url:'https://unlisted.example.org/file'}));assert.equal(c.calls.length,1);
});
test('connection context exposes deployment/account identity without secrets',async()=>{
 const c=nodeContext();const r=await connectionInfo(c,'same-account');assert.deepEqual(r,{apiOrigin:'https://api.my.chaffinch.com',browserOrigin:'https://my.chaffinch.com',accountUid:'same-account',connectionScope:'["https://api.my.chaffinch.com","same-account"]'});assert.doesNotMatch(JSON.stringify(r),/synthetic-secret|synthetic-bearer/);assert.equal(await resolveAccount(c,''),'same-account');
});
test('account and folder selectors use the selected deployment',async()=>{
 const c=nodeContext({accountUid:'same-account'},o=>o.url.endsWith('/accounts/same-account')?{uid:'same-account',name:'Selected'}:o.url.endsWith('/accounts')?[{uid:'same-account',name:'Selected'},{uid:'other',name:'Other'}]:{body:[{uid:'folder',type:'folder',name:'Folder'}],headers:{}});
 assert.deepEqual((await loadOptions.getAccounts.call(c)).map(x=>x.value),['same-account']);assert.equal((await loadOptions.getFolders.call(c))[0].value,'folder');assert(c.calls.every(o=>o.headers.Host==='api.my.chaffinch.com'));
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

test('credential modal test uses a verified public route and never guesses auth routing',async()=>{
 const {testFolderitConnection}=require('../dist/nodes/Folderit/connection-test');
 let calls=0;const context={helpers:{request:async o=>{calls++;assert.equal(o.uri,'https://8.8.8.8/v2/accounts/same-account');assert.equal(o.headers.Host,'api.my.chaffinch.com');assert.equal(o.agentOptions.servername,'api.my.chaffinch.com');assert.equal(o.followRedirect,false);return {statusCode:200,body:{uid:'same-account'}};}}};
 assert.equal((await testFolderitConnection.call(context,{data:{...base}})).status,'Error');assert.equal(calls,0);
 const h=harness();const session=await h.connect();assert.equal((await testFolderitConnection.call(context,{data:{...base,...session}})).status,'OK');assert.equal(calls,1);
 assert.equal((await testFolderitConnection.call(context,{data:{...base,...session,verifiedApiAddress:'127.0.0.1'}})).status,'Error');assert.equal(calls,1);
});
