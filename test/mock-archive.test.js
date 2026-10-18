const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./helpers/free-agency'),{archiveFinished}=require('../src/fantasyhq/mock-archive'),{atomicWrite}=require('../src/fantasyhq/mock-storage'),{createLiveMockService}=require('../src/fantasyhq/live-mock-service');
const now=Date.UTC(2026,9,18),old=new Date(now-86400000).toISOString();
function id(n){return `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;}
test('finished mock records leave the hot file but remain fully readable; active and pending recaps stay live',t=>{
 const f=fixture(t),root=path.join(f.root,'leagues','league','mock-draft');
 const base={createdAt:old,updatedAt:old,guildId:'g',seasonId:'1',input:{rosters:{a:[{name:'Keep History'}]}},selections:[{prospectId:'p1'}],participants:[{userId:'u'}],dmDelivery:{u:{delivered:true}},cleanup:{}};
 const mocks=Object.fromEntries(['CLEANED','ACTIVE','PAUSED','CANCELLED','FAILED','CLEANED','CLEANED'].map((status,n)=>[id(n),{...structuredClone(base),id:id(n),status}]));
 mocks[id(5)].dmDelivery.u={delivered:false,attempts:1};mocks[id(6)].dmDelivery={};
 atomicWrite(path.join(root,'live.json'),{schemaVersion:1,mocks});
 const service=createLiveMockService({repository:f.repository,now:()=>now});
 const result=archiveFinished(root,{now});assert.equal(result.archived.length,3);assert.ok(result.bytesAfter<result.bytesBefore);
 assert.deepEqual(service.get('league',id(0)),mocks[id(0)]);assert.equal(service.all('league').length,4);
 assert.equal(service.pollable('league')[0].input,undefined);assert.equal(service.pollable('league')[0].selections,undefined);
 assert.deepEqual(archiveFinished(root,{now}).archived,[]);
 assert.throws(()=>service.get('league','../../outside'),/no longer exists/);
});
test('mock polling caches only metadata and refreshes immediately after atomic state changes',t=>{
 const f=fixture(t),root=path.join(f.root,'leagues','league','mock-draft'),file=path.join(root,'live.json');
 atomicWrite(file,{mocks:{[id(0)]:{id:id(0),status:'ACTIVE',input:{large:'x'.repeat(200000)},cleanup:{},participants:[],dmDelivery:{}}}});
 const service=createLiveMockService({repository:f.repository});
 let reads=0;const original=fs.readFileSync;fs.readFileSync=function(name,...args){if(name===file)reads++;return original.call(this,name,...args);};t.after(()=>{fs.readFileSync=original;});
 const first=service.pollable('league');first[0].status='MUTATED';assert.equal(service.pollable('league')[0].status,'ACTIVE');assert.equal(reads,1);
 service.mutate('league',id(0),m=>{m.status='PAUSED';});assert.equal(service.pollable('league')[0].status,'PAUSED');assert.ok(reads>=3);
});
test('conflicting existing archive is preserved and the original remains in the live file',t=>{
 const f=fixture(t),root=path.join(f.root,'leagues','league','mock-draft'),mock={id:id(0),status:'FAILED',createdAt:old};
 atomicWrite(path.join(root,'live.json'),{mocks:{[mock.id]:mock}});atomicWrite(path.join(root,'archive',mock.id+'.json'),{...mock,failure:'different historical version'});
 assert.deepEqual(archiveFinished(root,{now}).archived,[]);assert.ok(JSON.parse(fs.readFileSync(path.join(root,'live.json'))).mocks[mock.id]);
});
