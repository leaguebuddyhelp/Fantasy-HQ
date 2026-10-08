const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {createFantasyHQRepository} = require('../src/fantasyhq/repository');
const {initializePostseason,STAGES} = require('../src/fantasyhq/postseason-state');
const {createPostseasonService} = require('../src/fantasyhq/postseason-service');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'lb-postseason-')); t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const repository = createFantasyHQRepository({dataRoot:root});
  const teams = ['East','West'].flatMap(conference => Array.from({length:15},(_,i) => ({teamId:conference+i,conference,teamName:conference+i,abbreviation:conference+i})));
  const seeds = Object.fromEntries(['East','West'].map(c => [c,teams.filter(t => t.conference === c).slice(0,10)]));
  repository.saveLeague('l',{currentPhase:'PLAYOFFS',currentSeasonId:'1',commissionerUserId:'commish'}); repository.saveTeams('l',teams);
  repository.commitPostseason({leagueId:'l',playoffs:initializePostseason({leagueId:'l',seasonId:'1',seeds,teams,now:0}),auditEntry:{action:'test'}});
  let clock = 0; const records = [], actor = {id:'commish',authorized:true}, staff = {id:'assistant',staffAuthorized:true};
  const submissions = {records:() => structuredClone(records),load:id => structuredClone(records.find(r => r.game.gameId === id))};
  const service = createPostseasonService({repository,submissions,now:() => clock});
  function game(seriesId,winner,approve=true) {
    const state = service.inspect('l'), s = state.series.find(s => s.id === seriesId), id = randomUUID();
    const r = {game:{gameId:id,leagueId:'l',seasonId:'1',seriesId,stage:s.stage,seriesGameNumber:s.gameIds.length+1,team1Id:s.team1Id,team2Id:s.team2Id,status:'SCHEDULED'},submissions:[],extractions:[],playerGameStats:[],teamGameStats:[]};
    records.push(r); service.registerGame('l',seriesId,id,staff);
    if (approve) official(r,winner || s.team1Id);
    return r;
  }
  function official(r,winner) {
    r.game.status = 'FINAL'; r.game.finalizedAt = '2026-10-08T00:00:00Z'; r.game.approval = {operator:'Staff'};
    r.game.result = {submissionId:'s',extractionId:'e',winnerTeamId:winner,scores:{[r.game.team1Id]:winner===r.game.team1Id?100:90,[r.game.team2Id]:winner===r.game.team2Id?100:90}};
    r.submissions = [{submissionId:'s',status:'FINAL',mode:'TEAM_SIDES'}]; r.extractions = [{submissionId:'s',extractionId:'e',status:'READY_FOR_REVIEW',issues:[]}];
  }
  function playIn() { for (const s of service.inspect('l').series) game(s.id,s.team1Id); for(const c of ['East','West']) {service.createFinalPlayIn('l',c,staff);game(`${c}:final`);} }
  function advance() { const view = service.prepareAdvance('l',actor); return service.advance('l',actor,view.token); }
  return {repository,service,records,game,official,actor,staff,playIn,advance,setClock:v=>clock=v};
}
test('Play-In finals require approval and explicit creation; duplicates are safe', t => {
  const f = fixture(t); assert.throws(() => f.service.createFinalPlayIn('l','East',f.staff),/Approve/);
  f.game('East:7-8','East7'); f.game('East:9-10','East8');
  assert.equal(f.service.inspect('l').series.length,4);
  const s = f.service.createFinalPlayIn('l','East',f.staff).series.at(-1);
  assert.deepEqual([s.team1Id,s.team2Id],['East6','East8']);
  f.service.createFinalPlayIn('l','East',f.staff); assert.equal(f.service.inspect('l').series.length,5);
  f.game(s.id,'East8'); assert.deepEqual(f.service.inspect('l').qualifiedSeeds.East.slice(6),['East7','East8']);
});
test('sequential approval gating prevents early submissions and games after a series ends', t => {
  const f = fixture(t), r = f.game('East:7-8',null,false);
  assert.throws(() => f.game('East:7-8'),/preceding/);
  f.official(r,'East6'); assert.throws(() => f.game('East:7-8'),/complete/);
});
test('fixed bracket, BO3/BO5/BO7 endings, manual advancement and deadlines', t => {
  const f = fixture(t);f.playIn();f.setClock(10000);
  assert.throws(() => f.service.prepareAdvance('l',{id:'assistant',authorized:true}),/commissioner/);
  let state = f.advance();
  assert.deepEqual(state.series.filter(s => s.stage==='FIRST_ROUND'&&s.conference==='East').map(s=>[s.team1Id,s.team2Id]),[['East0','East7'],['East3','East4'],['East2','East5'],['East1','East6']]);
  for (const stage of ['FIRST_ROUND','SECOND_ROUND','CONFERENCE_FINALS','NBA_FINALS']) {
    const matches = f.service.inspect('l').series.filter(s => s.stage===stage);
    for (const s of matches) {
      for(let i=0;i<STAGES[stage].wins;i++)f.game(s.id,s.team1Id);
      assert.throws(()=>f.game(s.id),/complete/);
      assert.equal(f.service.inspect('l').series.find(x=>x.id===s.id).wins[s.team1Id],STAGES[stage].wins);
    }
    assert.equal(f.service.inspect('l').stage,stage);
    if(stage!=='NBA_FINALS') { f.setClock(20000);state=f.advance();assert.equal(Date.parse(state.rounds.at(-1).deadlineAt)-20000,STAGES[state.stage].hours*3600000); }
  }
  assert.equal(f.service.inspect('l').roundComplete,true);
  assert.throws(()=>f.service.prepareAdvance('l',f.actor),/championship/);
  assert.throws(()=>f.service.prepareChampionship('l',f.actor),/Finals MVP/);
  f.repository.saveLeague('l',{regularSeasonStatus:'COMPLETED'});
  f.repository.savePlayers('l',[{playerId:'mvp',name:'Finals Winner',teamId:'East0'}]);
  f.repository.saveRosterMemberships('l',[{playerId:'mvp',teamId:'East0',seasonId:'1',active:true}]);
  f.repository.saveOwners('l',[{teamId:'East0',userId:'champion-coach'}]);
  const awards=require('../src/fantasyhq/awards-service').createAwardsService({repository:f.repository,submissions:{records:()=>f.records}});
  const review=awards.prepare('l',f.staff,'NBA_FINALS',{FINALS_MVP:'mvp'});awards.confirm('l',f.staff,review.token);
  const championship=f.service.prepareChampionship('l',f.actor);
  const result=f.service.finalizeChampionship('l',f.actor,championship.token);
  assert.equal(result.champion.teamId,'East0');assert.equal(result.champion.finalsMvpPlayerId,'mvp');
  assert.equal(f.repository.loadLeague('l').league.currentPhase,'OFFSEASON');
  assert.deepEqual(f.service.finalizeChampionship('l',f.actor,championship.token),result);
  f.repository.saveOwners('l',[]);assert.equal(f.repository.loadChampionships('l').seasons['1'].coachUserId,'champion-coach');
  const lastFinal=f.records.find(r=>r.game.gameId===result.series.find(s=>s.stage==='NBA_FINALS').gameIds.at(-1));f.official(lastFinal,'West0');f.service.synchronize('l');assert.ok(f.service.inspect('l').conflicts.some(c=>/finalized championship/.test(c.reason)));f.service.synchronize('l');assert.ok(f.service.inspect('l').conflicts.length);assert.equal(f.repository.loadChampionships('l').seasons['1'].teamId,'East0');

});
test('expired clock does not award wins; Staff extends with audit reason', t => {
  const f=fixture(t);f.setClock(100000000);assert.equal(f.service.inspect('l').series[0].winnerTeamId,null);
  assert.throws(()=>f.service.extendDeadline('l',{id:'coach'},2,'extra time'),/Staff/);
  f.service.extendDeadline('l',f.staff,2,'Coaches requested more time');
  assert.equal(Date.parse(f.service.inspect('l').rounds[0].deadlineAt),100000000+7200000);
  assert.equal(f.repository.loadAuditLog('l').at(-1).action,'playoffs.deadline.extended');
});
test('series forfeit requires confirmation, records winner without invented stats', t => {
  const f=fixture(t), p=f.service.prepareSeriesForfeit('l',f.staff,'East:7-8','East7','Coach unavailable');
  assert.equal(f.service.inspect('l').series[0].winnerTeamId,null);
  f.service.confirmSeriesForfeit('l',f.staff,p.token);f.service.confirmSeriesForfeit('l',f.staff,p.token);
  assert.equal(f.service.inspect('l').series[0].winnerTeamId,'East7');assert.equal(f.records.length,0);
});
test('corrections recalculate series and flag incompatible downstream results', t => {
  const f=fixture(t);f.playIn();f.advance();
  const record=f.records.find(r=>r.game.seriesId==='East:7-8');f.official(record,'East7');f.service.synchronize('l');
  assert.ok(f.service.inspect('l').conflicts.some(c=>/correction|Winner changed/.test(c.reason)));
  assert.throws(()=>f.service.prepareAdvance('l',f.actor),/conflicts/);
  assert.equal(f.service.inspect('l').series.filter(s=>s.stage==='FIRST_ROUND').length,8);
  f.service.synchronize('l');assert.ok(f.service.inspect('l').conflicts.length,'Conflict must survive repeated reconciliation');
});
test('round confirmation is idempotent and rejects changed state', t => {
  const f=fixture(t);f.playIn();const p=f.service.prepareAdvance('l',f.actor);f.service.extendDeadline('l',f.staff,1,'More time requested');
  assert.throws(()=>f.service.advance('l',f.actor,p.token),/changed/);
  const next=f.service.prepareAdvance('l',f.actor);f.service.advance('l',f.actor,next.token);f.service.advance('l',f.actor,next.token);
  assert.equal(f.service.inspect('l').rounds.length,2);
});
