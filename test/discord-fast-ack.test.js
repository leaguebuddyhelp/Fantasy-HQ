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
