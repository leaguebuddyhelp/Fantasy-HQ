const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createFantasyHQRepository}=require('../src/fantasyhq/repository');
const {initializePostseason}=require('../src/fantasyhq/postseason-state');
const {createGameSubmissionService}=require('../src/fantasyhq/game-submissions');
const {createDiscordPostseason}=require('../src/fantasyhq/discord-postseason');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lb-post-discord-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const repository=createFantasyHQRepository({dataRoot:root});
  const teams=['East','West'].flatMap(conference=>Array.from({length:15},(_,i)=>({teamId:conference+i,teamName:conference+i,abbreviation:conference+i,conference})));
  repository.saveLeague('l',{currentPhase:'PLAYOFFS',currentSeasonId:'1',commissionerUserId:'c',guildId:'g'});repository.saveTeams('l',teams);repository.saveGuildLeagueBinding('g',{leagueId:'l',seasonId:'1'});repository.saveOwners('l',[]);repository.saveSettings('l',{channelIds:{staff:'staff',games:'games'}});
  const seeds=Object.fromEntries(['East','West'].map(c=>[c,teams.filter(t=>t.conference===c).slice(0,10)]));
  repository.commitPostseason({leagueId:'l',playoffs:initializePostseason({leagueId:'l',seasonId:'1',seeds,teams}),auditEntry:{action:'init'}});
  let serial=0,created=0;const channels=new Map();
  function channel(id,type) {
    const messages=new Map();return {id,type,guildId:'g',messages:{fetch:async id=>{if(!messages.has(id))throw Object.assign(Error('missing'),{code:10008});return messages.get(id);}},members:{add:async()=>{}},setArchived:async()=>{},send:async payload=>{const m={id:'message'+serial++,payload,pin:async()=>{},edit:async value=>m.payload=value};messages.set(m.id,m);return m;},permissionsFor:()=>({has:()=>true}),setArchived:async()=>{}};
  }
  const parent=channel('games',0);parent.threads={create:async()=>{const ch=channel('thread'+serial++,12);channels.set(ch.id,ch);created++;return ch;}};channels.set('games',parent);channels.set('staff',channel('staff',0));
  const guild={id:'g',members:{me:{}},channels:{fetch:async id=>channels.get(id)}};
  const submissions=createGameSubmissionService({repository});
  const manager=createDiscordPostseason({submissions,syncOwners:async()=>({staffUserIds:['c','a'],staffRoleIds:['cr','ar'],teamMemberIds:{},teamRoleIds:{}})});
  const actor={id:'c',authorized:true};
  async function forfeit(seriesId) {const r=submissions.records().filter(r=>r.game.seriesId===seriesId).sort((a,b)=>a.game.seriesGameNumber-b.game.seriesGameNumber).at(-1);const p=manager.service.prepareGameForfeit('l',actor,r.game.gameId,r.game.team1Id,'Verified test forfeit');await manager.service.confirmGameForfeit('l',actor,p.token);}
  return {repository,submissions,manager,guild,actor,forfeit,created:()=>created};
}
test('four initial private threads are idempotent; final Play-In threads are explicit',async t=>{
  const f=fixture(t);await Promise.all([f.manager.createThreads(f.guild),f.manager.createThreads(f.guild)]);await f.manager.createThreads(f.guild);
  assert.equal(f.created(),4);assert.equal(f.submissions.records().length,4);
  assert.ok(f.submissions.records().every(r=>r.game.staffRoleIds.includes('ar')));
  await f.forfeit('East:7-8');await f.forfeit('East:9-10');await f.manager.createThreads(f.guild);assert.equal(f.created(),4);
  f.manager.service.createFinalPlayIn('l','East',f.actor);await f.manager.createThreads(f.guild);assert.equal(f.created(),5);
  assert.ok(f.submissions.records().every(r=>!r.playerGameStats?.length));
});
test('series reuses one thread and opens only the next approved game',async t=>{
  const f=fixture(t);await f.manager.createThreads(f.guild);
  for(const s of f.manager.service.inspect('l').series)await f.forfeit(s.id);
  for(const c of ['East','West']){f.manager.service.createFinalPlayIn('l',c,f.actor);await f.manager.createThreads(f.guild);await f.forfeit(c+':final');}
  const p=f.manager.service.prepareAdvance('l',f.actor);f.manager.service.advance('l',f.actor,p.token);await f.manager.createThreads(f.guild);
  const s=f.manager.service.inspect('l').series.find(s=>s.stage==='FIRST_ROUND');
  const before=f.submissions.records().filter(r=>r.game.seriesId===s.id);assert.equal(before.length,1);
  await f.manager.createThreads(f.guild);assert.equal(f.submissions.records().filter(r=>r.game.seriesId===s.id).length,1);
  await f.forfeit(s.id);await f.manager.createThreads(f.guild);
  const after=f.submissions.records().filter(r=>r.game.seriesId===s.id).sort((a,b)=>a.game.seriesGameNumber-b.game.seriesGameNumber);assert.equal(after.length,2);assert.equal(after[0].game.discordThreadId,after[1].game.discordThreadId);
  assert.equal(f.submissions.findThread('g',after[0].game.discordThreadId).game.gameId,after[1].game.gameId);
  await f.forfeit(s.id);await f.manager.createThreads(f.guild);assert.equal(f.submissions.records().filter(r=>r.game.seriesId===s.id).length,2);
});
test('unauthorized Discord postseason controls do not mutate state',async t=>{
  const f=fixture(t);const old=f.manager.service.inspect('l').revision;let response;
  await f.manager.handle({guildId:'g',user:{id:'coach'},member:{roles:[]},guild:{roles:{cache:new Map()}},customId:'post:advance',reply:async p=>response=p});
  assert.match(response.content,/Commish|Manage Server/);assert.equal(f.manager.service.inspect('l').revision,old);
});
