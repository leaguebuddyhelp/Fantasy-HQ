const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { fixture } = require('./helpers/free-agency');
const { createDiscordFreeAgency, permanentPayload } = require('../src/fantasyhq/discord-free-agency');
const { myTeamPayload } = require('../src/fantasyhq/discord-preseason');
function discordFixture(t) {
  const f = fixture(t);
  const messages = new Map(), sends = [], dms = [], edits = [];
  let serial = 0;
  const guild = { id: 'guild', members: { me: { id: 'bot' } }, roles: { everyone: { id: 'everyone' }, cache: new Collection([['coach',{id:'coach',name:'LEAGUEbuddy Coach'}],['staff',{id:'staff',name:'LEAGUEbuddy Commish'}]]) } };
  function createChannel(id) {
    const store = new Collection(); messages.set(id,store);
    const channel = { id, guild, isTextBased:()=>true, permissionsFor:()=>({has:()=>false}) };
    function wrap(payload) {
      const data = payload.embeds?.map(e=>e.toJSON?e.toJSON():e) || [];
      const m={id:String(++serial),author:{id:'bot'},embeds:data,components:(payload.components||[]).map(r=>r.toJSON?r.toJSON():r),createdTimestamp:Date.now(),pinned:false,
        async edit(next){edits.push({id:m.id,channelId:id,payload:next});m.embeds=(next.embeds||[]).map(e=>e.toJSON?e.toJSON():e);m.components=(next.components||[]).map(r=>r.toJSON?r.toJSON():r);return m;},async pin(){m.pinned=true;},async unpin(){m.pinned=false;}};
      store.set(m.id,m);return m;
    }
    channel.messages={async fetch(query){if(typeof query==='string'){const m=store.get(query);if(!m)throw Object.assign(Error('Missing'),{code:10008});return m;}return new Collection([...store].reverse());}, async fetchPins(){return new Collection([...store].filter(([,m])=>m.pinned));}};
    channel.send=async payload=>{sends.push({channelId:id,payload});return wrap(payload);};return channel;
  }
  const channels=new Collection(['freeAgency','staff','announcements'].map(id=>[id,createChannel(id)]));
  guild.channels={fetch:async id=>channels.get(id)};
  const client={guilds:{cache:new Collection([['guild',guild]])},users:{fetch:async id=>({send:async payload=>{dms.push({id,payload});}})}};
  f.repository.saveSettings('league',{discordChannels:{freeAgency:'freeAgency',staff:'staff',announcements:'announcements'}});
  const workflow=createDiscordFreeAgency({repository:f.repository,service:f.service,client});
  return {...f,guild,client,channels,messages,sends,dms,edits,workflow};
}
test('Free Agency setup repairs one permanent pinned message and persists its IDs', async t=>{
 const f=discordFixture(t);const first=await f.workflow.ensurePin(f.guild,'league');const second=await f.workflow.ensurePin(f.guild,'league');assert.equal(first.id,second.id);assert.equal(f.sends.filter(s=>s.channelId==='freeAgency').length,1);assert.equal(first.pinned,true);
 assert.equal(f.repository.loadSettings('league').discordPins.freeAgencyMessageId,first.id);assert.equal(f.repository.loadSettings('league').discordChannels.freeAgencyProof,'staff');
 for(const r of permanentPayload().components)r.toJSON();
 assert.equal(f.workflow.uploadModal({id:'draft'}).toJSON().components[0].component.type,19);
});
test('first offer pings once; additional offers, reviews, withdrawal and recovery silently edit original', async t=>{
 const f=discordFixture(t);const a=f.submit();await f.workflow.tick();let announcement=f.sends.find(s=>s.channelId==='announcements');assert.equal(announcement.payload.content,'<@&coach>');assert.equal(f.sends.filter(s=>s.channelId==='staff').length,1);
 const original=f.state().windows[0].announcementMessageId;f.submit('b');await f.workflow.tick();assert.equal(f.sends.filter(s=>s.channelId==='announcements').length,1);assert.equal(f.state().windows[0].announcementMessageId,original);
 const last=f.edits.filter(e=>e.channelId==='announcements').at(-1);assert.match(last.payload.embeds[0].data.description,/Interested: \*\*2/);assert.equal(last.payload.content,'');assert.deepEqual(last.payload.allowedMentions,{parse:[]});
 f.service.withdraw('league',{windowId:a.windowId,teamId:'b',actorUserId:'coach-b'});await f.workflow.tick();assert.match(f.edits.filter(e=>e.channelId==='announcements').at(-1).payload.embeds[0].data.description,/Interested: \*\*1/);
 const restarted=createDiscordFreeAgency({repository:f.repository,service:f.service,client:f.client});await restarted.tick();assert.equal(f.sends.filter(s=>s.channelId==='announcements').length,1);
});
test('coach browser/active offers and open announcements never reveal opponents or numerical scores', t=>{
 const f=discordFixture(t);const a=f.submit();f.submit('b','fa-0',{details:{salary:19999000,years:'2',option:'None',structure:'Flat'}});
 const s=f.state(),context=f.repository.loadLeague('league');const publicView=JSON.stringify(f.workflow.publicPayload(context,s.windows[0],s.offers,f.repository.loadPlayers('league')));
 assert.ok(!publicView.includes('19999'));assert.ok(!publicView.includes('Team a'));assert.ok(!publicView.includes('Team b'));assert.ok(!publicView.includes('coach-a'));assert.ok(!publicView.toLowerCase().includes('score'));
 const active=JSON.stringify(f.workflow.activePayload({leagueId:'league',teamId:'a',id:'draft'}));assert.ok(!active.includes('19.99'));assert.ok(active.includes('6.66'));assert.ok(!active.toLowerCase().includes('score'));
 const browser=JSON.stringify(f.workflow.browser({leagueId:'league',position:'PG',id:'draft'}));assert.ok(!browser.includes('Team b'));assert.ok(!browser.toLowerCase().includes('score'));assert.ok(browser.includes('Offer window'));
});
test('public winner reveals signed contract only after completion, sends result DMs and keeps proof audit', async t=>{
 const f=discordFixture(t);const a=f.submit();const b=f.submit('b');await f.workflow.tick();f.review(a.id);f.review(b.id);f.advance(3600000);await f.workflow.tick();
 const final=f.edits.filter(e=>e.channelId==='announcements').at(-1).payload.embeds[0].data;
 assert.equal(final.title,'FREE AGENT SIGNING');assert.match(final.description,/Team a/);assert.match(final.description,/6.66M/);assert.match(final.description,/Player Option/);assert.ok(!final.description.includes('Score'));
 assert.equal(f.dms.length,2);const before=f.dms.length;await f.workflow.tick();assert.equal(f.dms.length,before);
 const proof=f.edits.filter(e=>e.channelId==='staff').at(-1);assert.equal(proof.payload.components.length,0);
});
test('Staff-only proof access is enforced and regular coaches cannot approve/correct/reject', async t=>{
 const f=discordFixture(t);const o=f.submit();f.channels.get('staff').permissionsFor=()=>({has:()=>true});await assert.rejects(()=>f.workflow.syncGuild(f.guild),/Staff-only/);assert.equal(f.sends.length,0);
 for(const action of ['approve','correct','reject','waiverapprove','waiverreject']){
  let response;
  await f.workflow.handle({guildId:'guild',guild:f.guild,customId:`fa:${action}:${o.id}`,user:{id:'coach-a'},member:{roles:{cache:new Collection([['coach',{name:'LEAGUEbuddy Coach'}]])}},reply:async p=>{response=p;}});
  assert.match(response.content,/Staff/);assert.equal(response.flags,64);
 }
});
test('waiver proof needs no screenshot, announces with one league ping and rejected waiver stays private', async t=>{
 const f=discordFixture(t);const w=f.service.requestWaiver('league',{teamId:'a',playerId:'a-0',actorUserId:'coach-a'});await f.workflow.tick();
 const proof=f.sends.find(s=>s.channelId==='staff');assert.equal(proof.payload.files,undefined);assert.equal(proof.payload.embeds[0].data.image,undefined);
 f.service.reviewWaiver('league',{waiverId:w.id,decision:'APPROVE',actorUserId:'staff',staffAuthorized:true});await f.workflow.tick();assert.equal(f.sends.filter(s=>s.channelId==='announcements').length,1);assert.equal(f.sends.find(s=>s.channelId==='announcements').payload.content,'<@&coach>');await f.workflow.tick();assert.equal(f.sends.filter(s=>s.channelId==='announcements').length,1);
 const reject=f.service.requestWaiver('league',{teamId:'b',playerId:'b-0',actorUserId:'coach-b'});f.service.reviewWaiver('league',{waiverId:reject.id,decision:'REJECT',actorUserId:'staff',staffAuthorized:true});await f.workflow.tick();assert.equal(f.sends.filter(s=>s.channelId==='announcements').length,1);
});
test('lost Discord acknowledgements recover marked messages without duplicate ping/proof and countdown silence', async t=>{
 const f=discordFixture(t);f.submit();await f.workflow.tick();const first=f.sends.length;
 f.service.update('league',s=>{delete s.windows[0].announcementMessageId;delete s.windows[0].publicRevision;delete s.offers[0].proofMessageId;delete s.offers[0].proofRevision;});
 await f.workflow.tick();assert.equal(f.sends.length,first);assert.ok(f.state().windows[0].announcementMessageId);assert.ok(f.state().offers[0].proofMessageId);
 f.advance(1800000);await f.workflow.tick();f.advance(1200000);await f.workflow.tick();assert.equal(f.sends.length,first);
});
test('MyTeam retains single dashboard with signing limits and persistent Waive Player control',()=>{
 const team={teamName:'Test',roster:[],schedule:[],draftPicks:[]};const context={league:{leagueName:'Test',currentPhase:'REGULAR_SEASON',currentWeek:1}};
 const payload=myTeamPayload(team,context,{completedSignings:4,activeTargets:1,allowedActiveTargets:1});assert.equal(payload.embeds.length,1);assert.match(JSON.stringify(payload.embeds[0].toJSON()),/4\/5/);assert.match(JSON.stringify(payload.embeds[0].toJSON()),/1\/1/);assert.deepEqual(payload.components[0].toJSON().components.map(b=>b.custom_id),['myweek:open','fa:waive']);
});

test('full private coach upload workflow reaches confirmation, conditional release and Staff correction',async t=>{
 const f=discordFixture(t);
 const fs=require('node:fs'),path=require('node:path');
 fs.writeFileSync(path.join(f.repository.buildLeaguePaths(f.root,'league').leagueRoot,'role-ownership.json'),JSON.stringify({roleIds:{a:'team-a',b:'team-b',c:'team-c'}}));
 const bytes=await require('sharp')({create:{width:100,height:100,channels:3,background:'#ffffff'}}).png().toBuffer();
 const workflow=createDiscordFreeAgency({repository:f.repository,service:f.service,client:f.client,ocr:async()=> 'Salary: $6.66M\nYears: 3+1\nContract Type: Front (-5%)\nOption: Player\nPromise: Starter',fetcher:async()=>({ok:true,arrayBuffer:async()=>bytes})});
 function interaction(id, extra={}) {
  const i={guildId:'guild',guild:f.guild,customId:id,user:{id:'coach-a'},member:{roles:{cache:new Collection([['team-a',{name:'Atlanta Hawks Coach'}],['coach',{name:'LEAGUEbuddy Coach'}]])}},
   async deferReply(){i.deferred=true;},async deferUpdate(){i.deferred=true;},async reply(p){i.payload=p;i.replied=true;},async editReply(p){i.payload=p;},async update(p){i.payload=p;i.replied=true;},async followUp(p){i.error=p;},async showModal(m){i.modal=m;},...extra};return i;
 }
 let i=interaction('fa:sign');await workflow.handle(i);assert.equal(i.error,undefined);const first=f.state().drafts.at(-1);
 i=interaction(`fa:position:${first.id}`,{values:['PG']});await workflow.handle(i);assert.equal(i.error,undefined);assert.ok(i.payload.components[0].toJSON().components.some(c=>c.options.length===9));
 i=interaction(`fa:player:${first.id}`,{values:['fa-0']});await workflow.handle(i);assert.equal(i.error,undefined);const uploadId=i.modal.toJSON().custom_id;
 i=interaction(uploadId,{fields:{getUploadedFiles:()=>new Collection([['file',{size:bytes.length,url:'https://example.org/screenshot.png',name:'screenshot.png',contentType:'image/png'}]])}});await workflow.handle(i);assert.equal(i.error,undefined);const draft=f.state().drafts.at(-1);assert.ok(fs.existsSync(draft.screenshot.path));assert.equal(draft.details.years,'3+1');assert.ok(!JSON.stringify(draft).includes('Promise'));
 i=interaction(`fa:submit:${draft.id}`);await workflow.handle(i);assert.equal(i.error,undefined);assert.equal(f.state().offers.length,0);
 i=interaction(`fa:release:${draft.id}`,{values:['a-0']});await workflow.handle(i);assert.equal(i.error,undefined);assert.equal(f.state().offers.length,1);assert.equal(f.roster('a').length,15);
 const o=f.state().offers[0];
 i=interaction(`fa:correct:${o.id}`,{user:{id:'staff'},member:{roles:{cache:new Collection([['staff',{name:'LEAGUEbuddy Commish'}]])}}});await workflow.handle(i);assert.equal(i.error,undefined);assert.equal(i.modal.toJSON().components.length,4);
 i=interaction(`fa:correctsave:${o.id}`,{user:{id:'staff'},member:{roles:{cache:new Collection([['staff',{name:'LEAGUEbuddy Commish'}]])}},fields:{getTextInputValue:k=>({salary:'$7M',years:'3+1',structure:'Flat',option:'Player'})[k]}});await workflow.handle(i);assert.equal(i.error,undefined);assert.equal(f.state().offers[0].details.salary,7000000);assert.equal(f.state().offers[0].ocrOriginal.salary,'$6.66M');
 i=interaction(`fa:approve:${o.id}`,{user:{id:'staff'},member:{roles:{cache:new Collection([['staff',{name:'LEAGUEbuddy Commish'}]])}}});await workflow.handle(i);assert.equal(i.error,undefined);assert.equal(f.state().offers[0].status,'APPROVED');
});
test('MyTeam waiver interaction requires an explicit review then submit and no upload',async t=>{
 const f=discordFixture(t);const fs=require('node:fs'),path=require('node:path');fs.writeFileSync(path.join(f.repository.buildLeaguePaths(f.root,'league').leagueRoot,'role-ownership.json'),JSON.stringify({roleIds:{a:'team-a'}}));
 let last;
 const base={guildId:'guild',guild:f.guild,user:{id:'coach-a'},member:{roles:{cache:new Collection([['team-a',{name:'Team a'}]])}},deferReply:async()=>{},deferUpdate:async()=>{},reply:async p=>{last=p;},editReply:async p=>{last=p;},update:async p=>{last=p;},followUp:async p=>{last=p;}};
 await f.workflow.handle({...base,customId:'fa:waive'});const draft=f.state().drafts.at(-1);
 await f.workflow.handle({...base,customId:`fa:waiveplayer:${draft.id}`,values:['a-0']});assert.equal(f.state().waivers.length,0);assert.equal(last.embeds[0].data.title,'REVIEW WAIVER');
 await f.workflow.handle({...base,customId:`fa:waiversubmit:${draft.id}`});assert.equal(f.state().waivers.length,1);assert.equal(f.state().waivers[0].status,'PENDING');assert.equal(f.roster('a').length,15);
});

test('external removal updates original announcement and notifies coaches without exposing offers',async t=>{
 const f=discordFixture(t);f.submit();await f.workflow.tick();const id=f.state().windows[0].announcementMessageId;
 f.repository.savePlayers('league',f.repository.loadPlayers('league').map(p=>p.playerId==='fa-0'?{...p,teamId:'c'}:p));f.repository.saveRosterMemberships('league',[...f.repository.loadRosterMemberships('league'),{seasonId:'1',playerId:'fa-0',teamId:'c',active:true}]);await f.workflow.tick();
 assert.equal(f.state().windows[0].status,'CANCELLED');assert.equal(f.sends.filter(s=>s.channelId==='announcements').length,1);assert.equal(f.state().windows[0].announcementMessageId,id);assert.equal(f.dms.length,1);assert.equal(f.service.getStatus('league','a').activeTargets,0);
 const last=f.edits.filter(e=>e.channelId==='announcements').at(-1).payload;assert.ok(!JSON.stringify(last).includes('6.66M'));
});
test('failed cut DM retains a private in-channel cut control and immutable cut deadline across restart',async t=>{
 const f=discordFixture(t);const a=f.submit();f.review(a.id); // Replace the original release externally so the winner needs a new cut.
 f.repository.saveRosterMemberships('league',f.repository.loadRosterMemberships('league').map(m=>m.playerId==='a-0'?{...m,playerId:'fa-8'}:m));
 f.client.users.fetch=async()=>({send:async()=>{throw Error('DMs disabled');}});f.advance(3600000);await f.workflow.tick();const w=f.state().windows[0];assert.equal(w.status,'AWAITING_WINNER_ROSTER_CUT');assert.equal(f.state().deliveries[0].failed,true);
 const payload=f.workflow.activePayload({leagueId:'league',teamId:'a',id:'private'});assert.ok(payload.components.some(r=>r.toJSON().components.some(c=>c.label==='CHOOSE ROSTER CUT')));
 await createDiscordFreeAgency({repository:f.repository,service:f.service,client:f.client}).tick();assert.equal(f.state().windows[0].cutDeadlineAt,w.cutDeadlineAt);
});
test('pin repair recovers an unpinned message after interrupted setup and shares concurrent setup lock',async t=>{
 const f=discordFixture(t);const message=await f.channels.get('freeAgency').send(permanentPayload());assert.equal(message.pinned,false);
 const second=createDiscordFreeAgency({repository:f.repository,client:f.client});
 const results=await Promise.all([f.workflow.ensurePin(f.guild,'league'),second.ensurePin(f.guild,'league')]);assert.equal(results[0].id,message.id);assert.equal(results[1].id,message.id);assert.equal(f.sends.filter(s=>s.channelId==='freeAgency').length,1);assert.equal(message.pinned,true);
});
test('solo Test Mode clock and playoff controls require Staff and protect assigned team owners',async t=>{
 const f=discordFixture(t);f.repository.saveSettings('league',{...f.repository.loadSettings('league'),testMode:true});f.repository.saveOwners('league',f.repository.loadOwners('league').filter(o=>o.teamId!=='b'));
 let last;const base={guildId:'guild',guild:f.guild,user:{id:'coach-a'},member:{roles:{cache:new Collection([['staff',{name:'LEAGUEbuddy Commish'}]])}},deferReply:async()=>{},reply:async p=>{last=p;},editReply:async p=>{last=p;},update:async p=>{last=p;},followUp:async p=>{last=p;}};
 await f.workflow.handle({...base,customId:'fa:sign'});const draft=f.state().drafts.at(-1);const options=last.components[0].toJSON().components[0].options;assert.deepEqual(options.map(o=>o.value),['a','b']);
 await f.workflow.handle({...base,customId:`fa:testclock:${draft.id}`});assert.equal(f.repository.loadSettings('league').freeAgencyTestWindowSeconds,60);
 f.submit();const deadline=f.state().windows[0].deadlineAt;
 await f.workflow.handle({...base,customId:`fa:testclock:${draft.id}`});assert.equal(f.repository.loadSettings('league').freeAgencyTestWindowSeconds,undefined);assert.equal(f.state().windows[0].deadlineAt,deadline);assert.equal(f.state().windows[0].durationMs,60000);assert.match(last.content,/1 hour/);

 await f.workflow.handle({...base,customId:`fa:testphase:${draft.id}:PLAYOFFS`});assert.equal(f.repository.loadLeague('league').league.currentPhase,'PLAYOFFS');assert.equal(f.state().windows[0].deadlineAt,deadline);
 await f.workflow.handle({...base,customId:`fa:testphase:${draft.id}:REGULAR_SEASON`});assert.equal(f.repository.loadLeague('league').league.currentPhase,'REGULAR_SEASON');
 f.repository.saveSettings('league',{...f.repository.loadSettings('league'),testMode:false});await f.workflow.handle({...base,customId:`fa:testphase:${draft.id}:PLAYOFFS`});assert.match(last.content,/Test Mode/);assert.equal(f.repository.loadLeague('league').league.currentPhase,'REGULAR_SEASON');
});

test('MINIMUM confirmation requires an exact dollar correction before enabling submit', async t => {
 const f=discordFixture(t), fs=require('node:fs'), path=require('node:path');
 fs.writeFileSync(path.join(f.repository.buildLeaguePaths(f.root,'league').leagueRoot,'role-ownership.json'),JSON.stringify({roleIds:{a:'team-a'}}));
 const bytes=await require('sharp')({create:{width:20,height:20,channels:3,background:'#ffffff'}}).png().toBuffer();
 const workflow=createDiscordFreeAgency({repository:f.repository,service:f.service,client:f.client,ocr:async()=> 'Salary: MINIMUM\nYears: 1\nType: Back (+5%)\nOption: None',fetcher:async()=>({ok:true,arrayBuffer:async()=>bytes})});
 const act=(customId, extra={})=>{
  const i={customId,guildId:'guild',guild:f.guild,user:{id:'coach-a'},member:{roles:{cache:new Collection([['team-a',{name:'Atlanta Hawks'}]])}},
   deferReply:async()=>{},deferUpdate:async()=>{},reply:async p=>{i.payload=p;},editReply:async p=>{i.payload=p;},update:async p=>{i.payload=p;},followUp:async p=>{i.payload=p;},showModal:async m=>{i.modal=m;},...extra};return i;
 };
 await workflow.handle(act('fa:sign'));const d=f.state().drafts.at(-1);
 await workflow.handle(act(`fa:position:${d.id}`,{values:['PG']}));
 const pick=act(`fa:player:${d.id}`,{values:['fa-0']});await workflow.handle(pick);
 const upload=act(pick.modal.toJSON().custom_id,{fields:{getUploadedFiles:()=>new Collection([['image',{size:bytes.length,url:'https://example.org/image.png',name:'image.png',contentType:'image/png'}]])}});
 await workflow.handle(upload);
 assert.match(upload.payload.embeds[0].data.description,/MINIMUM without a dollar amount/);
 assert.equal(upload.payload.components[0].toJSON().components[0].disabled,true);
 assert.equal(f.state().offers.length,0);
 const corrected=act(`fa:editdetails:${d.id}`,{fields:{getTextInputValue:k=>({salary:'$3M',years:'1',structure:'Back (+5%)',option:'None'})[k]}});
 await workflow.handle(corrected);
 assert.equal(corrected.payload.components[0].toJSON().components[0].disabled,false);
 assert.equal(f.state().drafts.at(-1).ocrOriginal.salary,'MINIMUM');
});
