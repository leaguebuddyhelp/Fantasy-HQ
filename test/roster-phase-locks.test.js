const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/free-agency');
const { createRosterService } = require('../src/fantasyhq/roster-service');
const { createPlayerService } = require('../src/fantasyhq/player-service');
const { prepareRosterCorrection } = require('../src/fantasyhq/roster-corrections');

test('bulk import is limited to the current setup/preseason season, before scanner access', t => {
 const f=fixture(t);let scanned=0;
 const service=createRosterService({repository:f.repository,sourceRosterLoader:()=>{scanned++;throw Error('scanner called');}});
 for(const currentPhase of ['REGULAR_SEASON','PLAYOFFS','OFFSEASON','DRAFT','FREE_AGENCY']) {
  f.repository.saveLeague('league',{currentPhase});
  assert.throws(()=>service.applyRosterImport({leagueId:'league',seasonId:'1',teamId:'a'}),/requires phase/);
 }
 assert.equal(scanned,0);
 f.repository.saveLeague('league',{currentPhase:'PRESEASON'});
 assert.throws(()=>service.applyRosterImport({leagueId:'league',seasonId:'old',teamId:'a'}),/active league season/);
 assert.equal(scanned,0);
 assert.throws(()=>service.applyRosterImport({leagueId:'league',seasonId:'1',teamId:'a'}),/scanner called/);
});

test('live roster correction requires commissioner, reason, exact preview and unchanged source', t => {
 const f=fixture(t);f.repository.saveLeague('league',{commissionerUserId:'commish'});
 const service=createRosterService({repository:f.repository});
 const args={leagueId:'league',seasonId:'1',playerId:'a-0',fromTeamId:'a',toTeamId:'b',actingUserId:'commish'};
 assert.throws(()=>service.movePlayer(args),/Preview and confirm/);
 assert.throws(()=>prepareRosterCorrection(f.repository,'move',{...args,actingUserId:'coach-a'},'Repair wrong team'),/commissioner/);
 assert.throws(()=>prepareRosterCorrection(f.repository,'move',args,'no'),/3–1000/);
 const preview=prepareRosterCorrection(f.repository,'move',args,'Repair imported assignment');
 assert.throws(()=>service.movePlayer({...args,toTeamId:'c',correctionToken:preview.token}),/Preview and confirm/);
 f.repository.saveLeague('league',{currentWeek:5});
 assert.throws(()=>service.movePlayer({...args,correctionToken:preview.token}),/Preview and confirm/);
 const fresh=prepareRosterCorrection(f.repository,'move',args,'Repair imported assignment');
 const before=f.repository.loadRosterMemberships('league').length;
 service.movePlayer({...args,correctionToken:fresh.token});
 const memberships=f.repository.loadRosterMemberships('league');
 assert.equal(memberships.length,before+1);
 assert.ok(memberships.some(m=>m.playerId==='a-0'&&m.teamId==='a'&&m.active===false&&m.endedAt));
 assert.ok(memberships.some(m=>m.playerId==='a-0'&&m.teamId==='b'&&m.active));
 assert.equal(f.repository.loadAuditLog('league').at(-1).correction.reason,'Repair imported assignment');
 assert.throws(()=>service.movePlayer({...args,correctionToken:fresh.token}),/Preview and confirm/);
});

test('player patch and add cannot bypass the live roster correction requirement', t => {
 const f=fixture(t); const service=createPlayerService({repository:f.repository});
 assert.throws(()=>service.updatePlayer({leagueId:'league',seasonId:'1',playerId:'a-0',patch:{teamId:'b'}}),/Preview and confirm/);
 assert.throws(()=>service.addPlayer({leagueId:'league',seasonId:'1',teamId:'a',player:{name:'Test'}}),/Preview and confirm/);
});
