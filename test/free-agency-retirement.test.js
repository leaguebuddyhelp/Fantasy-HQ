const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {fixture}=require('./helpers/free-agency');
const {createFreeAgencyRetirement}=require('../src/fantasyhq/retire-free-agency');
function setup(t,options={}) {
 const f=fixture(t);f.repository.saveLeague('league',{commissionerUserId:'c'});f.repository.saveSettings('league',{discordChannels:{freeAgency:'123',freeAgencyProof:'456',staff:'456',submitTrade:'789'},discordPins:{freeAgencyMessageId:'old',tradeMessageId:'keep'}});
 f.repository.saveFreeAgencyState('league',{windows:[{id:'open',status:'OPEN'},{id:'done',status:'COMPLETED'}],offers:[{status:'APPROVED'},{status:'WON'}],waivers:[{status:'PENDING'}],offseason:{'1':{stages:[{status:'OPEN'}],offers:[{status:'ACTIVE'}]}}});
 const deleted=[],channels=new Map([['123',{id:'123',name:'lb-free-agency',threads:{fetchActive:async()=>({threads:new Map()}),fetchArchived:async options=>{assert.ok(options.limit>=2,'Discord archived-thread requests require at least two results');return{threads:new Map()};}},topic:'Old offer system',messages:{fetch:async()=>new Map([['m',{id:'m',toJSON:()=>({id:'m',content:'Historical offer'})}]])},delete:async()=>{if(options.failDelete)throw Error('Missing Manage Channels');deleted.push('123');channels.delete('123');}}],['456',{id:'456',name:'lb-staff'}]]);
 const guild={id:'guild',channels:{fetch:async id=>channels.get(id)||null}},actor={id:'c',authorized:true};let backups=0;
 const service=createFreeAgencyRetirement({repository:f.repository,backup:()=>{if(options.failBackup)throw Error('backup failed');backups++;return{id:'safe'};}});
 return {...f,guild,actor,service,deleted,backups:()=>backups};
}
test('retirement archives channels, cancels active work and preserves completed history, rosters and shared Staff',async t=>{
 const f=setup(t),players=f.repository.loadPlayers('league'),members=f.repository.loadRosterMemberships('league'),p=await f.service.prepare('league',f.actor,f.guild);
 assert.deepEqual(p.channels.map(c=>c.id),['123']);assert.equal(f.backups(),0);
 const result=await f.service.confirm('league',f.actor,f.guild,p.token);assert.equal(result.retired,true);assert.deepEqual(f.deleted,['123']);assert.equal(f.backups(),1);
 const state=f.repository.loadFreeAgencyState('league');assert.equal(state.windows[0].status,'CANCELLED');assert.equal(state.windows[1].status,'COMPLETED');assert.equal(state.offers[1].status,'WON');assert.equal(state.offseason['1'].offers[0].status,'CANCELLED');
 assert.deepEqual(f.repository.loadPlayers('league'),players);assert.deepEqual(f.repository.loadRosterMemberships('league'),members);
 const settings=f.repository.loadSettings('league');assert.equal(settings.discordChannels.staff,'456');assert.equal(settings.discordChannels.freeAgency,undefined);assert.equal(settings.discordPins.tradeMessageId,'keep');
 assert.ok(JSON.parse(fs.readFileSync(path.join(result.archive,'channel-123.json'))).messages.length);
});
test('retirement requires commissioner review and stale previews cannot delete channels',async t=>{
 const f=setup(t);await assert.rejects(f.service.prepare('league',{id:'other',authorized:true},f.guild),/commissioner/);const p=await f.service.prepare('league',f.actor,f.guild);f.repository.saveSettings('league',{discordChannels:{staff:'123'}});await assert.rejects(f.service.confirm('league',f.actor,f.guild,p.token),/changed/);assert.deepEqual(f.deleted,[]);
});
test('backup failure prevents all mutation; failed channel deletion can be retried after a new review',async t=>{
 const f=setup(t,{failBackup:true}),p=await f.service.prepare('league',f.actor,f.guild);await assert.rejects(f.service.confirm('league',f.actor,f.guild,p.token),/backup failed/);assert.equal(f.repository.loadFreeAgencyState('league').windows[0].status,'OPEN');assert.deepEqual(f.deleted,[]);
 const g=setup(t,{failDelete:true}),next=await g.service.prepare('league',g.actor,g.guild);await assert.rejects(g.service.confirm('league',g.actor,g.guild,next.token),/Manage Channels/);assert.equal(g.repository.loadSettings('league').discordChannels.freeAgency,'123');assert.equal(g.repository.loadFreeAgencyState('league').windows[0].status,'CANCELLED');assert.ok((await g.service.prepare('league',g.actor,g.guild)).token);
});
test('shared Staff proof messages retain their history while retired controls are removed',async t=>{
 const f=setup(t),state=f.repository.loadFreeAgencyState('league');state.offers[0].proofChannelId='456';state.offers[0].proofMessageId='proof';f.repository.saveFreeAgencyState('league',state);
 let edited;const proof={author:{id:'bot'},components:[{customId:'fa:review'}],toJSON:()=>({id:'proof',content:'Retained proof'}),edit:async body=>{edited=body;}};
 const fetch=f.guild.channels.fetch;f.guild.client={user:{id:'bot'}};f.guild.channels.fetch=async id=>id==='456'?{id:'456',name:'lb-staff',messages:{fetch:async()=>proof}}:fetch(id);
 const p=await f.service.prepare('league',f.actor,f.guild),result=await f.service.confirm('league',f.actor,f.guild,p.token);
 assert.deepEqual(edited.components,[]);assert.equal(edited.content,undefined);assert.deepEqual(result.clearedControlMessageIds,['456:proof']);assert.equal(JSON.parse(fs.readFileSync(path.join(result.archive,'controls-456-proof.json'))).message.content,'Retained proof');
});
