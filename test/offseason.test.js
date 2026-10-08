const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./helpers/free-agency');
const { createOffseasonService } = require('../src/fantasyhq/offseason-service');
const { STEPS, validateOffseason } = require('../src/fantasyhq/offseason-state');
function setup(t) {
  const f = fixture(t);
  f.repository.saveLeague('league', { commissionerUserId: 'commissioner', currentPhase: 'OFFSEASON' });
  const actor = { id: 'commissioner', authorized: true };
  let clock = 1000000, backups = 0;
  const options = { repository: f.repository, now: () => clock, backup: () => { backups++; return { id: 'test-backup' }; } };
  const service = createOffseasonService(options);
  function official() {
    f.repository.commitLeagueFiles({ leagueId: 'league', files: [
      { name: 'championships.json', value: { version: 1, seasons: { '1': { teamId: 'a', finalizedAt: 'date', confirmedBy: 'commissioner' } } } },
      { name: 'awards.json', value: { version: 1, seasons: { '1': Object.fromEntries(['REGULAR_SEASON', 'CONFERENCE_FINALS', 'NBA_FINALS'].map(g => [g, { confirmedAt: 'date', confirmedBy: 'commissioner' }])) } } },
    ] });
  }
  return { ...f, actor, service, options, official, advance: () => clock += 300001, backups: () => backups };
}
test('offseason blocks missing official results and requires the commissioner', t => {
  const f = setup(t);
  assert.equal(f.service.inspect('league').blockers.length, 4);
  assert.throws(() => f.service.prepare('league', { id: 'staff', authorized: true }), /commissioner/);
  assert.equal(f.service.prepare('league', f.actor).token, undefined);
  f.official();
  assert.equal(f.service.inspect('league').ready, true);
});
test('review survives restart; confirmation archives permanent data once and retries are idempotent', t => {
  const f = setup(t); f.official();
  const players = f.repository.loadPlayers('league'), members = f.repository.loadRosterMemberships('league');
  const review = f.service.prepare('league', f.actor);
  assert.equal(f.repository.loadSeasonArchive('league', '1'), null);
  const restarted = createOffseasonService(f.options);
  const next = restarted.confirm('league', f.actor, review.token);
  assert.equal(next.step, 'RETIREMENTS');
  assert.equal(next.ready, false);
  assert.deepEqual(f.repository.loadPlayers('league'), players);
  assert.deepEqual(f.repository.loadRosterMemberships('league'), members);
  const archive = f.repository.loadSeasonArchive('league', '1');
  assert.deepEqual(archive.players, players);
  assert.deepEqual(archive.memberships, members);
  restarted.confirm('league', f.actor, review.token);
  assert.equal(f.backups(), 1);
  assert.equal(f.repository.loadOffseason('league').seasons['1'].history.length, 1);
  assert.throws(() => f.repository.commitLeagueFiles({ leagueId: 'league', files: [{ name: 'season-archives/1.json', value: { changed: true } }] }), /immutable/);
  assert.deepEqual(f.repository.loadSeasonArchive('league', '1'), archive);
});
test('changes, expired confirmations and cancelled tokens cannot advance', t => {
  const f = setup(t); f.official();
  let review = f.service.prepare('league', f.actor);
  const players = f.repository.loadPlayers('league'); players[0].overall++; f.repository.savePlayers('league', players);
  assert.throws(() => f.service.confirm('league', f.actor, review.token), /changed/);
  review = f.service.prepare('league', f.actor); f.advance();
  assert.throws(() => f.service.confirm('league', f.actor, review.token), /expired/);
  review = f.service.prepare('league', f.actor); f.service.cancel('league', f.actor, review.token);
  assert.throws(() => f.service.confirm('league', f.actor, review.token), /expired/);
  assert.equal(f.service.inspect('league').step, 'WRAP_UP');
  assert.equal(f.backups(), 0);
});
test('journal replay completes interrupted lifecycle writes and rejects traversal before mutation', t => {
  const f = setup(t), root = path.join(f.root, 'leagues', 'league');
  const state = { version: 1, seasons: { '1': { seasonId: '1', step: 'RETIREMENTS', revision: 1, completedSteps: ['WRAP_UP'], history: [] } } };
  const file = path.join(root, 'trade-transaction.json');
  fs.writeFileSync(file, JSON.stringify({ leagueId: 'league', files: [{ name: 'offseason.json', value: state }] }));
  assert.deepEqual(f.repository.loadOffseason('league'), state);
  assert.equal(fs.existsSync(file), false);
  const players = f.repository.loadPlayers('league');
  fs.writeFileSync(file, JSON.stringify({ leagueId: 'league', files: [{ name: 'players.json', value: [] }, { name: '../outside.json', value: {} }] }));
  assert.throws(() => f.repository.loadLeague('league'), /invalid file/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'players.json'))), players);
});
test('ordered steps cannot be skipped or reordered', () => {
  const valid = { version: 1, seasons: { '1': { seasonId: '1', step: 'DRAFT', revision: 1, completedSteps: STEPS.slice(0, 4), history: [] } } };
  validateOffseason(valid);
  valid.seasons['1'].completedSteps = ['WRAP_UP', 'LOTTERY'];
  assert.throws(() => validateOffseason(valid), /required order/);
});
function rolloverFixture(t) {
  const f = setup(t);
  const { normalizeOffer } = require('../src/fantasyhq/offer-score');
  const teams = Array.from({ length: 30 }, (_, i) => ({ teamId: `t${i}`, teamName: `Team ${i}`, abbreviation: `T${i}`, conference: i < 15 ? 'East' : 'West' }));
  f.repository.saveTeams('league', teams);
  const players = [], memberships = [];
  for (const team of teams) for (let i = 0; i < 15; i++) {
    const playerId = `${team.teamId}-${i}`;
    players.push({ playerId, name: playerId, teamId: team.teamId, age: 36, birthdate: '1990-01-01', yearsInNBA: 10, overall: 80, contract: normalizeOffer({ salary: 1000000, years: '3', option: 'None', structure: 'Flat' }, { year: 2026 }).contract });
    memberships.push({ membershipId: `m-${playerId}`, playerId, teamId: team.teamId, seasonId: '1', active: true });
  }
  players[0].draftYear = 2027; players[0].yearsInNBA = 0;
  f.repository.savePlayers('league', players); f.repository.saveRosterMemberships('league', memberships);
  f.repository.commitLeagueFiles({ leagueId: 'league', files: [
    { name: 'offseason.json', value: { version: 1, seasons: { '1': { seasonId: '1', step: 'PREPARATION', revision: 1, completedSteps: STEPS.slice(0, 9), history: [], receipts: { PREPARATION: { confirmedAt: 'verified' } }, schedulePolicy: 'CONFERENCE_ROUND_ROBIN_15' } } } },
    { name: 'season-archives/1.json', value: { players: structuredClone(players), memberships: structuredClone(memberships) } },
  ] });
  return f;
}
test('verified rollover ages once, preserves rookie experience, archives and IDs, carries rosters and updates bindings atomically', t => {
  const f = rolloverFixture(t), players = f.repository.loadPlayers('league');
  const weeklyAwards = { version:1, seasons:{'1':{PLAYER_OF_WEEK:{weeks:{'1':{leagueId:'league',seasonId:'1',week:1,createdAt:'2026-10-08',winners:[{awardId:'league:1:W1:EAST',playerId:players[1].playerId,teamId:players[1].teamId,teamName:'Historical Team',conference:'East',stats:{PTS:30}}]}}}}}};
  f.repository.commitAwards({leagueId:'league',awards:weeklyAwards,auditEntry:{action:'test-award'}});
  const career={version:1,wallets:{coach:{userId:'coach',balanceCents:30000,createdAt:'2026-10-08'}},bets:[],markets:[],ledger:[{id:'initial:coach',userId:'coach',type:'INITIAL',amountCents:30000}],previews:[]};
  f.repository.commitLeagueFiles({leagueId:'league',files:[{name:'sportsbook.json',value:career}]});
  assert.equal(f.service.inspectRollover('league').ready, true);
  const review = f.service.prepareRollover('league', f.actor), receipt = f.service.confirmRollover('league', f.actor, review.token);
  assert.equal(receipt.nextSeasonId, '2');
  assert.deepEqual(f.repository.loadSportsbook('league'),career);
  assert.equal(f.repository.loadLeague('league').league.currentPhase, 'PRESEASON');
  assert.equal(f.repository.loadGuildLeagueBinding('guild').seasonId, '2');
  const updated = f.repository.loadPlayers('league');
  assert.equal(updated[0].yearsInNBA, 0); assert.equal(updated[1].yearsInNBA, 11); assert.equal(updated[1].age, 37);
  assert.deepEqual(updated.map(p => p.playerId), players.map(p => p.playerId));
  assert.deepEqual(updated[0].contract, players[0].contract);
  assert.deepEqual(f.repository.loadSeasonArchive('league', '1').players, players);
  const memberships = f.repository.loadRosterMemberships('league');
  assert.equal(memberships.filter(m => m.seasonId === '1' && m.active === false).length, 450);
  assert.equal(memberships.filter(m => m.seasonId === '2' && m.active).length, 450);
  assert.equal(f.repository.loadSchedule('league', '2').weeks.length, 15);
  assert.deepEqual(f.repository.loadAwards('league'), weeklyAwards);
  assert.equal(require('../src/fantasyhq/player-of-week').createPlayerOfWeekService({repository:f.repository}).list('league')[0].teamName, 'Historical Team');
  assert.deepEqual(f.service.confirmRollover('league', f.actor, review.token), receipt);
  assert.deepEqual(f.repository.loadPlayers('league'), updated);
  assert.equal(f.backups(), 1);
});
test('rollover blocks unfinished stages, unconfirmed schedule policy, wrong rosters, expired contracts and unresolved options', t => {
  const f = rolloverFixture(t), state = f.repository.loadOffseason('league');
  delete state.seasons['1'].schedulePolicy;
  f.repository.commitLeagueFiles({ leagueId: 'league', files: [{ name: 'offseason.json', value: state }] });
  assert.match(f.service.inspectRollover('league').blockers.join(' '), /schedule policy/);
  const players = f.repository.loadPlayers('league'); players[0].contract.seasons = []; players[1].contract.seasons[1].option = 'PLAYER';
  f.repository.savePlayers('league', players);
  const blockers = f.service.inspectRollover('league').blockers.join(' ');
  assert.match(blockers, /contract/); assert.match(blockers, /option decision/);
  assert.equal(f.service.prepareRollover('league', f.actor).token, undefined);
  assert.equal(f.repository.loadLeague('league').seasonId, '1');
});
