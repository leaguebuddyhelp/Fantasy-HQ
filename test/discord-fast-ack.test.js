const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('events');
const {createFastTradeAcknowledgment}=require('../src/shared/discord-fast-ack');
const {runDiscordInteraction}=require('../src/shared/discord-interaction-error');
function setup(t){const worker=new EventEmitter();worker.ref=()=>{};worker.unref=()=>{};worker.terminate=async()=>{};let posted;worker.postMessage=data=>posted=data;const ack=createFastTradeAcknowledgment({workerFactory:()=>worker,logger:{info(){}}});t.after(()=>ack.close());return {worker,ack,posted:()=>posted};}
test('trade build callback is delegated without bot credentials and acknowledged before roles or builder work',async t=>{
 const f=setup(t),i={id:'123',token:'private-token',customId:'trade:build',isButton:()=>true,guild:{},member:{},deferUpdate:async()=>{throw Error('double acknowledgement');},followUp:async()=>{}};
 const awaiting=f.ack.acknowledge(i);assert.equal(f.posted().id,'123');assert.equal(f.posted().botToken,undefined);assert.equal(i.deferred,undefined);
 f.worker.emit('message',{id:'123',ok:true});await awaiting;assert.equal(i.deferred,true);
 const order=[];await runDiscordInteraction(i,async()=>order.push('builder'),{refreshActor:async()=>order.push('roles')});assert.deepEqual(order,['roles','builder']);
});
test('worker failure or expired callback never starts a trade and never reports a false acknowledgement',async t=>{
 const f=setup(t),i={id:'456',token:'secret',customId:'trade:build',isButton:()=>true};const promise=f.ack.acknowledge(i);f.worker.emit('message',{id:'456',ok:false,code:10062});await assert.rejects(promise,e=>e.code===10062);assert.equal(i.deferred,undefined);
});
test('other controls and already acknowledged interactions retain their normal response and modal behavior',async t=>{
 const f=setup(t);for(const i of [{customId:'mock:search',isButton:()=>true},{customId:'trade:build',isButton:()=>true,deferred:true},{isButton:()=>false}])await f.ack.acknowledge(i);assert.equal(f.posted(),undefined);
});
test('a preacknowledged public trade button reports role errors privately without editing its permanent message',async t=>{
 const f=setup(t);let edited=false,reply;const i={id:'789',token:'secret',customId:'trade:build',isButton:()=>true,guild:{},member:{},deferUpdate:async()=>{},editReply:async()=>{edited=true;},followUp:async p=>reply=p};
 const promise=f.ack.acknowledge(i);f.worker.emit('message',{id:'789',ok:true});await promise;
 await runDiscordInteraction(i,async()=>{throw Error('should not run');},{refreshActor:async()=>{throw Error('roles unavailable');},logger:{error(){}}});assert.equal(edited,false);assert.equal(reply.flags,64);
});
test('acknowledgement transport can progress while the main event loop is blocked',async t=>{
 const {Worker}=require('worker_threads'),{once}=require('events');const worker=new Worker(`const {parentPort}=require('worker_threads');parentPort.on('message',m=>{setTimeout(()=>parentPort.postMessage({id:m.id,ok:true,elapsedMs:Date.now()-m.queuedAt,workerDelayMs:0}),10);});`,{eval:true});await once(worker,'online');
 let duration;const ack=createFastTradeAcknowledgment({workerFactory:()=>worker,logger:{info:(_,m)=>duration=m.elapsedMs}});t.after(()=>ack.close());const i={id:'900',token:'secret',customId:'trade:build',isButton:()=>true},pending=ack.acknowledge(i);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);await pending;assert.equal(i.deferred,true);assert.ok(duration<450,`worker response took ${duration}ms`);
});
test('callback transport uses Discord deferred-update responses without bot authorization or token logging',()=>{
 const {sendAcknowledgment}=require('../src/shared/discord-ack-worker');let options,body,result;
 const fake=(o,respond)=>{options=o;const request=new EventEmitter();request.setTimeout=()=>{};request.end=text=>{body=JSON.parse(text);const response=new EventEmitter();response.statusCode=204;respond(response);response.emit('end');};return request;};
 sendAcknowledgment({id:'123',token:'secret',queuedAt:Date.now()},r=>result=r,fake);assert.equal(options.hostname,'discord.com');assert.equal(options.headers.Authorization,undefined);assert.deepEqual(body,{type:6});assert.equal(result.ok,true);assert.doesNotMatch(JSON.stringify(result),/secret/);
});
test('roster upload command is deferred privately before OCR and role checks, preserving normal command errors',async t=>{
 const f=setup(t),i={id:'999',token:'secret',commandName:'rostersync',isChatInputCommand:()=>true,isButton:()=>false,guild:{},member:{},editReply:async()=>{}};const promise=f.ack.acknowledge(i);assert.equal(f.posted().type,5);f.worker.emit('message',{id:'999',ok:true});await promise;assert.equal(i.ephemeral,true);assert.equal(i.deferred,true);
 const {sendAcknowledgment}=require('../src/shared/discord-ack-worker');let body;sendAcknowledgment({id:'999',token:'secret',queuedAt:Date.now(),type:5},()=>{},(options,respond)=>{const request=new EventEmitter();request.setTimeout=()=>{};request.end=text=>{body=JSON.parse(text);const response=new EventEmitter();response.statusCode=204;respond(response);response.emit('end');};return request;});assert.deepEqual(body,{type:5,data:{flags:64}});
});
test('trade-block commands and Trade for buttons defer privately while autocomplete remains a choice response',async t=>{
 const f=setup(t);
 for(const i of [
  {id:'1201',token:'secret',commandName:'tradeblock',isChatInputCommand:()=>true},
  {id:'1202',token:'secret',customId:'tradeblock:tradefor',isButton:()=>true}
 ]){
  const promise=f.ack.acknowledge(i);assert.equal(f.posted().type,5);
  f.worker.emit('message',{id:i.id,ok:true});await promise;assert.equal(i.deferred,true);assert.equal(i.ephemeral,true);
 }
 const i={id:'1203',token:'secret',commandName:'tradeblock',isAutocomplete:()=>true,isChatInputCommand:()=>false};
 await f.ack.acknowledge(i);assert.equal(i.deferred,undefined);
 const choices=[{name:'Player',value:'p1'}],promise=f.ack.respondAutocomplete(i,choices);
 assert.equal(f.posted().type,8);assert.deepEqual(f.posted().choices,choices);
 f.worker.emit('message',{id:i.id,ok:true});await promise;assert.equal(i.responded,true);assert.equal(i.deferred,undefined);
});
test('autocomplete transport sends choices rather than a deferred response',()=>{
 const {sendAcknowledgment}=require('../src/shared/discord-ack-worker');let body;
 const choices=[{name:'Player',value:'p1'}];
 sendAcknowledgment({id:'1204',token:'secret',queuedAt:Date.now(),type:8,choices},()=>{},(options,respond)=>{
  const request=new EventEmitter();request.setTimeout=()=>{};request.end=text=>{body=JSON.parse(text);const response=new EventEmitter();response.statusCode=204;respond(response);response.emit('end');};return request;
 });assert.deepEqual(body,{type:8,data:{choices}});
});
test('all slash commands are acknowledged early with their established public or private visibility',async t=>{
 const f=setup(t);
 for(const [index,name] of ['team','scout','stats','availableteams','promo'].entries()){
  const i={id:String(2000+index),token:'secret',commandName:name,isChatInputCommand:()=>true};
  const p=f.ack.acknowledge(i);assert.equal(f.posted().payload.type,5);
  assert.equal(f.posted().payload.data.flags,['availableteams','promo'].includes(name)?0:64);
  f.worker.emit('message',{id:i.id,ok:true});await p;
  assert.equal(i.ephemeral,!['availableteams','promo'].includes(name));
 }
});
test('SDK modal, autocomplete and message callbacks use the worker without changing callback type or rate-limit errors',async t=>{
 const {REST,Routes}=require('discord.js');const f=setup(t);let fallback=0;
 const rest=new REST({makeRequest:async()=>{fallback++;return new Response(null,{status:204});}});
 rest.setToken('bot-secret');const uninstall=f.ack.install(rest);t.after(uninstall);
 for(const [index,type] of [4,7,8,9].entries()){
  const id=String(2100+index),body={type,data:type===8?{choices:[]}:{content:'test'}};
  const p=rest.post(Routes.interactionCallback(id,'callback-secret'),{auth:false,body});
  while(f.posted()?.id!==id)await new Promise(setImmediate);
  assert.deepEqual(f.posted().payload,body);assert.equal(f.posted().Authorization,undefined);
  f.worker.emit('message',{id,ok:true,status:204,headers:{},body:''});await p;
 }
 const p=rest.post(Routes.interactionCallback('2200','callback-secret'),{auth:false,body:{type:8,data:{choices:[]}}});
 while(f.posted()?.id!=='2200')await new Promise(setImmediate);
 f.worker.emit('message',{id:'2200',ok:false,status:404,headers:{'content-type':'application/json'},body:JSON.stringify({code:10062,message:'Unknown interaction'})});
 await assert.rejects(p,e=>e.code===10062);
 await rest.get('/gateway');assert.equal(fallback,1);
 // Multipart uploads keep SDK file handling rather than crossing the JSON bridge.
 await rest.options.makeRequest('https://discord.com/api/v10/interactions/2300/token/callback',{method:'POST',body:new FormData()});assert.equal(fallback,2);
 rest.clearHashSweeper();rest.clearHandlerSweeper();
});
