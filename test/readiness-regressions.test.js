const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./helpers/free-agency');
const { createPlayerService } = require('../src/fantasyhq/player-service');
const { createTradeService } = require('../src/fantasyhq/trade-service');

test('corrupt canonical picks are preserved and block an unrelated FA transaction', t => {
  const f = fixture(t, { count: 14 });
  const file = f.repository.loadLeague('league').paths.draftPicksFile;
  const bytes = '[{"pickId":"preserve-me"'; fs.writeFileSync(file, bytes);
  assert.throws(() => f.submit(), /Cannot read league storage/);
  assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  assert.equal(f.state().offers.length, 0);
  fs.writeFileSync(file, '{}');
  assert.throws(() => f.submit(), /expected an array/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{}');
});

test('departed coach FA and waiver consent cannot execute after replacement', t => {
  const f = fixture(t, { count: 14 });
  const offer = f.submit(); f.review(offer.id);
  const waiver = f.service.requestWaiver('league', { teamId: 'a', playerId: 'a-0', actorUserId: 'coach-a' });
  f.repository.saveOwners('league', [{ teamId: 'a', userId: 'replacement' }]);
  f.advance(3600001); f.service.tick('league');
  assert.equal(f.state().offers[0].status, 'INVALIDATED');
  assert.equal(f.service.reviewWaiver('league', { waiverId: waiver.id, decision: 'APPROVE', actorUserId: 'staff', staffAuthorized: true }).status, 'INVALIDATED');
  assert.equal(f.roster('a').length, 14);
});

test('trade final approval rejects departed-coach consent and leaves roster intact', t => {
  const f = fixture(t), service = createTradeService({ repository: f.repository, now: f.time });
  const d = service.createDraft({ leagueId: 'league', seasonId: '1', initiatingUserId: 'coach-a', initiatingTeamId: 'a', secondTeamId: 'b' });
  service.updateDraft({ leagueId: 'league', tradeId: d.tradeId, actorUserId: 'coach-a', transfers: [
    { assetType: 'PLAYER', assetId: 'a-0', fromTeamId: 'a', toTeamId: 'b' },
    { assetType: 'PLAYER', assetId: 'b-0', fromTeamId: 'b', toTeamId: 'a' },
  ] });
  service.submitTrade({ leagueId: 'league', tradeId: d.tradeId, actorUserId: 'coach-a' });
  service.decideGM({ leagueId: 'league', tradeId: d.tradeId, version: 1, actorUserId: 'coach-b', actorTeamId: 'b', decision: 'APPROVE', eligibleVoterIds: ['voter'] });
  service.voteCommittee({ leagueId: 'league', tradeId: d.tradeId, version: 1, actorUserId: 'voter', decision: 'APPROVE' });
  service.submitProof({ leagueId: 'league', tradeId: d.tradeId, actorUserId: 'coach-b', actorTeamId: 'b', attachment: { url: 'https://example.org/proof.jpg', name: 'proof.jpg' } });
  f.repository.saveOwners('league', [{ teamId: 'a', userId: 'replacement' }, { teamId: 'b', userId: 'coach-b' }]);
  assert.equal(service.reviewProof({ leagueId: 'league', tradeId: d.tradeId, version: 1, actorUserId: 'staff', approve: true }).status, 'INVALIDATED');
  assert.equal(f.repository.loadPlayers('league').find(p => p.playerId === 'a-0').teamId, 'a');
});

test('completed regular season rejects new offers and waiver requests', t => {
  const f = fixture(t, { count: 14 });
  f.repository.saveLeague('league', { regularSeasonStatus: 'COMPLETED', currentWeek: 15 });
  assert.throws(() => f.submit(), /REGULAR_SEASON/);
  assert.throws(() => f.service.requestWaiver('league', { teamId: 'a', playerId: 'a-0', actorUserId: 'coach-a' }), /REGULAR_SEASON/);
});

test('admin player move recovers after interruption without losing rating, roster or audit', t => {
  const f = fixture(t), service = createPlayerService({ repository: f.repository });
  const original = fs.renameSync; let interrupted = false;
  fs.renameSync = (from, to) => { if (!interrupted && to.endsWith('roster-memberships.json')) { interrupted = true; throw Error('Disk failure'); } return original(from, to); };
  try { assert.throws(() => service.updatePlayer({ leagueId: 'league', seasonId: '1', playerId: 'a-0', patch: { teamId: 'b', overall: 90 }, actingUserId: 'staff' }), /Disk failure/); }
  finally { fs.renameSync = original; }
  const recovered = f.repository.loadPlayers('league').find(p => p.playerId === 'a-0');
  assert.equal(recovered.teamId, 'b'); assert.equal(recovered.overall, 90);
  assert.equal(f.repository.loadRosterMemberships('league').find(m => m.playerId === 'a-0').teamId, 'b');
  assert.equal(f.repository.loadAuditLog('league').filter(e => e.action === 'player.updated').length, 1);
  assert.equal(fs.existsSync(path.join(f.repository.loadLeague('league').paths.leagueRoot, 'trade-transaction.json')), false);
});

test('public malformed path responds without throwing and shared query keys cannot authorize', () => {
  const { requestHandler } = require('../src/web');
  let status, body; const response = { writeHead(s) { status = s; }, end(b) { body = JSON.parse(b); } };
  assert.doesNotThrow(() => requestHandler({ url: '/draft-assets/%', method: 'GET', headers: {} }, response));
  assert.equal(status, 400); assert.match(body.error, /URL/);
  const prior = process.env.WEBSITE_ADMIN_KEY; process.env.WEBSITE_ADMIN_KEY = 'audit-test-key';
  try { requestHandler({ url: '/api/league/admin/weekly?adminKey=audit-test-key', method: 'GET', headers: {} }, response); assert.equal(status, 403); }
  finally { if (prior === undefined) delete process.env.WEBSITE_ADMIN_KEY; else process.env.WEBSITE_ADMIN_KEY = prior; }
});

test('backup restore verifies checksums, preserves originals, and refuses existing destinations', t => {
  const f = fixture(t), { createStorageBackup, restoreStorageBackup } = require('../src/fantasyhq/storage-safety');
  const backup = createStorageBackup(f.root);
  const restored = path.join(f.root, 'restored');
  assert.equal(restoreStorageBackup(backup.directory, restored).files, backup.files);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restored,'leagues/league/owners.json'))), f.repository.loadOwners('league'));
  assert.throws(() => restoreStorageBackup(backup.directory, restored), /nonexistent/);
  fs.appendFileSync(path.join(backup.directory,'leagues/league/owners.json'), ' ');
  assert.throws(() => restoreStorageBackup(backup.directory, path.join(f.root,'tampered')), /checksum/);
  assert.equal(fs.existsSync(path.join(f.root,'tampered')), false);
});

test('writer lease refuses a second writer and checks ownership before canonical writes', t => {
  const f = fixture(t), { acquireWriterLease } = require('../src/fantasyhq/storage-safety');
  const lease = acquireWriterLease(f.root); t.after(() => lease.release());
  assert.throws(() => acquireWriterLease(f.root), /already has a writer/);
  const file = path.join(f.root,'.writer-lock/owner.json');
  fs.writeFileSync(file, JSON.stringify({ ...lease.owner, token: 'other-writer' }));
  assert.throws(() => f.repository.savePlayers('league', []), /lease was lost/);
  assert.notEqual(f.repository.loadPlayers('league').length, 0);
  fs.writeFileSync(file, JSON.stringify(lease.owner)); lease.release();
  acquireWriterLease(f.root).release();
});

test('one corrupt archived game is preserved and does not hide unrelated healthy records', t => {
  const f = fixture(t), { randomUUID } = require('crypto');
  const { createGameSubmissionService } = require('../src/fantasyhq/game-submissions');
  const healthy = randomUUID(), corrupt = randomUUID();
  for (const id of [healthy,corrupt]) fs.mkdirSync(path.join(f.root,'game-history',id), { recursive: true });
  fs.writeFileSync(path.join(f.root,'game-history',healthy,'record.json'), JSON.stringify({ game: { gameId:healthy,leagueId:'other' }, submissions:[] }));
  fs.writeFileSync(path.join(f.root,'game-history',corrupt,'record.json'), '{preserve');
  const service = createGameSubmissionService({ repository:f.repository });
  assert.equal(service.records().length, 1); assert.equal(service.storageIssues()[0].gameId, corrupt);
  assert.throws(() => service.load(corrupt)); assert.equal(fs.readFileSync(path.join(f.root,'game-history',corrupt,'record.json'),'utf8'), '{preserve');
});

test('failed upgrade delivery survives restart and only a successful retry creates a receipt', async t => {
  const f = fixture(t), { createPlayerUpgradeService } = require('../src/fantasyhq/player-upgrades-service');
  const service = createPlayerUpgradeService({ repository:f.repository, now:f.time, onUpgradeAvailable:() => { throw Error('DM closed'); } });
  service.syncOwnerSnapshot({leagueId:'league',seasonId:'1',phase:'REGULAR_SEASON',owners:f.repository.loadOwners('league')});
  const owners = [{teamId:'a',userId:'replacement'}]; f.repository.saveOwners('league',owners);
  service.syncOwnerSnapshot({leagueId:'league',seasonId:'1',phase:'REGULAR_SEASON',owners});
  await service.flushNotifications('league');
  const failed = f.repository.loadPlayerUpgradeState('league').notificationOutbox[0];
  assert.equal(failed.status,'FAILED'); assert.equal(failed.deliveredAt,undefined);
  const notices = []; f.advance(20000);
  const restarted = createPlayerUpgradeService({repository:f.repository,now:f.time,onUpgradeAvailable:n => notices.push(n)});
  await restarted.flushNotifications('league'); await restarted.flushNotifications('league');
  assert.equal(notices.length,1); assert.equal(f.repository.loadPlayerUpgradeState('league').notificationOutbox[0].status,'DELIVERED');
});

test('all fifteen weeks close with official forfeits, freeze publication and confirm ten playoff seeds per conference', async t => {
  const f = fixture(t), { generateSchedule } = require('../src/fantasyhq/schedule-generator');
  const { createLeagueService } = require('../src/fantasyhq/league-service');
  const { createGameSubmissionService } = require('../src/fantasyhq/game-submissions');
  const { recordForfeit } = require('../src/fantasyhq/administrative-results');
  const { createWeekAdvancementService } = require('../src/fantasyhq/week-advancement');
  const { createSeasonTransitionService } = require('../src/fantasyhq/season-transition');
  const { createStandingsService } = require('../src/fantasyhq/standings-service');
  const teams = ['East','West'].flatMap(conference => Array.from({length:15},(_,i) => ({teamId:`${conference}-${i}`,teamName:`${conference} ${i}`,abbreviation:`${conference[0]}${i}`,conference})));
  f.repository.saveLeague('league',{currentPhase:'PRESEASON',regularSeasonStatus:null,currentWeek:null,guildId:'guild',commissionerUserId:'staff'}); f.repository.saveTeams('league',teams);
  f.repository.saveSchedule(generateSchedule({leagueId:'league',seasonId:'1',teams}));
  createLeagueService({repository:f.repository}).startRegularSeason({leagueId:'league',seasonId:'1',validator:() => ({ready:true})});
  const submissions = createGameSubmissionService({repository:f.repository});
  const service = createWeekAdvancementService({submissions,threads:{create:async()=>({created:14})}}), actor = {id:'staff',authorized:true};
  for (let weekNumber = 1; weekNumber <= 15; weekNumber++) {
    const week = f.repository.loadSchedule('league','1').weeks[weekNumber-1];
    for (const match of week.games) {
      const record = submissions.ensureGame({guildId:'guild',weekNumber,teamQuery:match.team1Id});
      await submissions.mutate(record.game.gameId,r => recordForfeit(r,{winnerTeamId:match.team1Id,actorUserId:'staff',staffAuthorized:true,reason:'Verified league forfeit'}));
    }
    const preview = service.prepare('guild',actor); assert.equal(preview.final,14); assert.equal(preview.blocked,undefined);
    const result = await service.advance({id:'guild'},actor,preview.token); assert.equal(result.seasonComplete,weekNumber===15);
  }
  const standings = createStandingsService({submissions}).getStandings('league','1');
  assert.equal(standings.countedGames,210); assert.equal(Object.values(standings.conferences).flat().reduce((sum,r)=>sum+r.W,0),210);
  assert.ok(Object.values(standings.conferences).flat().every(r => r.scoringGP===0 && r.PF===0 && r.PA===0));
  const transition = createSeasonTransitionService({submissions}); const view = transition.prepare('guild',actor);
  assert.equal(view.blocked,false); assert.equal(view.seeds.East.length,10); assert.equal(view.seeds.West.length,10);
  assert.throws(() => transition.confirm('guild',{id:'other',authorized:true},view.token),/another|expired|commissioner/);
  const playoffs = transition.confirm('guild',actor,view.token);
  assert.deepEqual(transition.confirm('guild',actor,view.token),playoffs);
  assert.equal(f.repository.loadLeague('league').league.currentPhase,'PLAYOFFS');
  assert.equal(f.repository.loadSchedule('league','1').statsPublication.snapshots.length,210);
  assert.equal(f.repository.loadAuditLog('league').filter(e=>e.action==='season.playoffs.started').length,1);
  assert.throws(() => service.prepare('guild',actor),/REGULAR_SEASON/);
  // Explicitly migrate an older eight-seed record without changing the regular standings.
  const legacy={leagueId:'league',seasonId:'1',seeds:{East:view.seeds.East.slice(0,8),West:view.seeds.West.slice(0,8)},startedAt:'legacy'};
  fs.writeFileSync(path.join(f.repository.loadLeague('league').paths.leagueRoot,'playoffs.json'),JSON.stringify(legacy));
  const migration=transition.prepare('guild',actor);assert.equal(migration.legacyMigration,true);assert.equal(f.repository.loadPlayoffs('league').version,undefined);
  const migrated=transition.confirm('guild',actor,migration.token);assert.equal(migrated.version,2);assert.deepEqual(migrated.legacySeeding,legacy);
  assert.deepEqual(migrated.seeds.East.slice(0,8),legacy.seeds.East);assert.equal(migrated.seeds.East.length,10);
  assert.deepEqual(createStandingsService({submissions}).getStandings('league','1').conferences,standings.conferences);

});

test('individual website Staff credentials bind operator identity and disable the shared key', () => {
 const {websitePrincipal,bindWebsiteOperator} = require('../src/shared/website-auth');
 const previous=process.env.WEBSITE_ADMIN_KEYS, shared=process.env.WEBSITE_ADMIN_KEY;
 try {
  process.env.WEBSITE_ADMIN_KEYS=JSON.stringify({'Commissioner A':'individual-test-secret'});process.env.WEBSITE_ADMIN_KEY='legacy-test-secret';
  const request={headers:{'x-leaguebuddy-admin-key':'individual-test-secret'}};
  assert.equal(websitePrincipal(request).operator,'Commissioner A');assert.equal(bindWebsiteOperator(request,{operator:'Someone else'}).operator,'Commissioner A');
  assert.equal(websitePrincipal({headers:{'x-leaguebuddy-admin-key':'legacy-test-secret'}}),null);
  process.env.WEBSITE_ADMIN_KEYS='invalid';assert.equal(websitePrincipal(request),null);
 } finally { for(const [key,value] of [['WEBSITE_ADMIN_KEYS',previous],['WEBSITE_ADMIN_KEY',shared]]) { if(value===undefined)delete process.env[key];else process.env[key]=value; } }
});

test('real HTTP origin survives malformed public input and serves the following request', async t => {
 const server=require('http').createServer(require('../src/web').requestHandler);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(base+'/draft-assets/%')).status,400);
 assert.equal((await fetch(base+'/')).status,200);
});

test('malformed canonical collections cannot be replaced through direct repository saves', t => {
 const f=fixture(t), files=f.repository.loadLeague('league').paths;
 for(const [name,save] of [['playersFile',()=>f.repository.savePlayers('league',[])],['rosterMembershipsFile',()=>f.repository.saveRosterMemberships('league',[])],['draftPicksFile',()=>f.repository.saveDraftPicks('league',[])],['tradesFile',()=>f.repository.saveTrades('league',[])]]) {
  const before=fs.existsSync(files[name])?fs.readFileSync(files[name]):null;
  fs.writeFileSync(files[name],'{}');assert.throws(save,/expected an array/);assert.equal(fs.readFileSync(files[name],'utf8'),'{}');
  if(before)fs.writeFileSync(files[name],before);else fs.unlinkSync(files[name]);
 }
});

test('an unleased second process cannot bypass the running writer through repository APIs', t => {
 const f=fixture(t), {acquireWriterLease}=require('../src/fantasyhq/storage-safety');const lease=acquireWriterLease(f.root);t.after(()=>lease.release());
 const modulePath=path.resolve('src/fantasyhq/repository.js');
 const result=require('child_process').spawnSync(process.execPath,['-e',`require(${JSON.stringify(modulePath)}).createFantasyHQRepository({dataRoot:${JSON.stringify(f.root)}}).savePlayers('league',[])`],{encoding:'utf8'});
 assert.notEqual(result.status,0);assert.match(result.stderr,/already has a writer/);assert.notEqual(f.repository.loadPlayers('league').length,0);
});

test('Test Mode does not preserve departed real-coach consent as a vacant-team simulation', t => {
 const f=fixture(t,{testMode:true}), service=createTradeService({repository:f.repository,now:f.time});
 const d=service.createDraft({leagueId:'league',seasonId:'1',initiatingUserId:'coach-a',initiatingTeamId:'a',secondTeamId:'b'});
 service.updateDraft({leagueId:'league',tradeId:d.tradeId,actorUserId:'coach-a',transfers:[{assetType:'PLAYER',assetId:'a-0',fromTeamId:'a',toTeamId:'b'},{assetType:'PLAYER',assetId:'b-0',fromTeamId:'b',toTeamId:'a'}]});
 service.submitTrade({leagueId:'league',tradeId:d.tradeId,actorUserId:'coach-a'});
 f.repository.saveOwners('league',f.repository.loadOwners('league').filter(o=>o.teamId!=='a'));
 assert.deepEqual(service.reconcileOwnership('league'),[d.tradeId]); assert.equal(service.getTrade('league',d.tradeId).status,'INVALIDATED');
});
