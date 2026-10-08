const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { createLeagueService } = require('../src/fantasyhq/league-service');
const { generateSchedule } = require('../src/fantasyhq/schedule-generator');
const { createGameSubmissionService } = require('../src/fantasyhq/game-submissions');
const { createWeekAdvancementService } = require('../src/fantasyhq/week-advancement');
const { createPlayerOfWeekService, performanceScore, comparePerformances } = require('../src/fantasyhq/player-of-week');
function log(patch = {}) { return { playerId: 'p', FG: '12-18', '3PT': '2-4', FT: '4-4', score: '110-100', result: 'W', MIN: 35, PTS: 30, REB: 12, AST: 9, STL: 2, BLK: 2, TO: 2, ...patch }; }
function fixture(t, simulation = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-pow-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = createFantasyHQRepository({ dataRoot: root });
  const teams = ['East','West'].flatMap(conference => Array.from({ length: 15 }, (_, i) => ({ teamId: conference + i, teamName: conference + ' Team ' + i, conference, abbreviation: conference[0] + i })));
  repository.saveLeague('l', { currentSeasonId: '1', currentPhase: 'PRESEASON', commissionerUserId: 'commissioner' }); repository.saveTeams('l', teams); repository.saveGuildLeagueBinding('g', { leagueId: 'l', seasonId: '1' });
  repository.saveSchedule(generateSchedule({ leagueId: 'l', seasonId: '1', teams }));
  const players = teams.flatMap(team => Array.from({ length: 3 }, (_, i) => ({ playerId: team.teamId + 'p' + i, name: team.teamId + ' Player ' + i, teamId: team.teamId, imageUrl: 'https://example.com/' + team.teamId + i + '.jpg' })));
  repository.savePlayers('l', players); repository.saveRosterMemberships('l', players.map(p => ({ playerId: p.playerId, teamId: p.teamId, seasonId: '1', active: true })));
  repository.saveSettings('l', { discordChannels: { playerOfWeek: 'pow' }, ...(simulation ? { simulationId: 'test-sim' } : {}) });
  createLeagueService({ repository }).startRegularSeason({ leagueId: 'l', seasonId: '1', validator: () => ({ ready: true }) });
  const submissions = createGameSubmissionService({ repository }), now = () => Date.parse('2026-10-08T12:00:00Z');
  const service = createPlayerOfWeekService({ repository, submissions, now });
  async function finals(number = 14, weekNumber = 1) {
    const week = repository.loadSchedule('l', '1').weeks.find(w => w.week === weekNumber);
    for (const match of week.games.slice(0, number)) {
      const record = submissions.ensureGame({ guildId: 'g', weekNumber, teamQuery: match.team1Id });
      await submissions.mutate(record.game.gameId, r => {
        r.submissions = [{ submissionId: 's', status: 'FINAL' }]; r.extractions = [{ extractionId: 'e', submissionId: 's', status: 'READY_FOR_REVIEW', issues: [] }];
        Object.assign(r.game, { status: 'FINAL', finalizedAt: '2026-10-08T10:00:00Z', result: { submissionId: 's', extractionId: 'e', scores: { [match.team1Id]: 110, [match.team2Id]: 100 } } });
        r.playerGameStats = [match.team1Id,match.team2Id].flatMap(teamId => [
          { playerId: teamId + 'p0', teamId, gameId: r.game.gameId, MIN: 35, PTS: 30, REB: 12, AST: 9, STL: 2, BLK: 2, TO: 2, FGM: 12, FGA: 18, '3PM': 2, '3PA': 4, FTM: 4, FTA: 4, OR: 3, FLS: 2 },
          { playerId: teamId + 'p1', teamId, gameId: r.game.gameId, MIN: 35, PTS: 45, REB: 1, AST: 1, STL: 0, BLK: 0, TO: 7, FGM: 17, FGA: 45, '3PM': 3, '3PA': 14, FTM: 8, FTA: 15, OR: 0, FLS: 2 }
        ]);
        r.dnpPlayers = [match.team1Id, match.team2Id].map(teamId => ({ playerId: teamId + 'p2', teamId, gameId: r.game.gameId }));
      });
    }
  }
  async function advance(force = false) { const week = createWeekAdvancementService({ submissions, threads: { create: async () => ({ created: 0 }) }, now }); const actor = { id: 'commissioner', authorized: true }; return week.advance({ id: 'g' }, actor, week.prepare('g', actor, force).token); }
  return { repository, submissions, service, finals, advance, now };
}
test('efficient all-around production beats inefficient scoring; win and margin bonuses remain modest', () => {
  const complete = performanceScore(log()), scorer = performanceScore(log({ PTS: 45, FG: '17-45', '3PT': '3-14', FT: '8-15', REB: 1, AST: 1, STL: 0, BLK: 0, TO: 7 }));
  assert.ok(complete.score > scorer.score);
  const loss = performanceScore(log({ score: '100-140', result: 'L' })), win = performanceScore(log({ score: '140-100' })); assert.ok(win.score - loss.score <= 6); assert.ok(loss.score > scorer.score);
  assert.deepEqual(performanceScore(log()), complete);
});
test('tiebreakers follow efficiency, all-around production, defense, win, margin then permanent ID', () => {
  const base = { playerId: 'b', score: 40, efficiency: .5, allAround: 20, defensive: 4, win: 0, margin: -5 };
  for (const key of ['efficiency','allAround','defensive','win','margin']) assert.ok(comparePerformances({ ...base, [key]: base[key] + 1 }, base) < 0);
  assert.ok(comparePerformances({ ...base, playerId: 'a' }, base) < 0);
  assert.ok(comparePerformances({ ...base, score: 40.000001, playerId: 'a' }, base) < 0);
});
test('week finalization atomically stores exactly East/West winners using only that single verified game', async t => {
  const f = fixture(t); await f.finals(); assert.equal(f.service.processWeek('l','1',1), null); assert.equal(f.service.list('l').length, 0);
  await f.advance(); const winners = f.service.list('l'); assert.equal(winners.length, 2); assert.deepEqual(new Set(winners.map(w => w.conference)), new Set(['East','West']));
  for (const w of winners) { assert.match(w.playerId,/p0$/); assert.equal(w.stats.PTS,30); assert.match(w.awardId,/l:1:W1:(EAST|WEST)/); assert.equal(w.week,1); assert.ok(w.gameId); }
  const prior = f.repository.loadAwards('l'); const restart = createPlayerOfWeekService({ repository: f.repository, submissions: f.submissions }); restart.processWeek('l','1',1); assert.deepEqual(f.repository.loadAwards('l'), prior);
  await f.finals(14,2); assert.equal(f.service.list('l').length,2); await f.advance(); assert.equal(f.service.list('l').length,4);
  assert.equal(f.service.list('l',{ seasonId:'1',week:1,conference:'East' }).length,1);
});
test('unfinalized games and forced incomplete weeks do not create awards until all games are verified', async t => {
  const f = fixture(t); await f.finals(13); await f.advance(true); assert.equal(f.service.list('l').length,0); assert.equal(f.service.processWeek('l','1',1),null);
  await f.finals(14); assert.equal(f.service.processWeek('l','1',1).winners.length,2);
});
test('unknown players, zero minutes, duplicate stat rows, DNP and unrostered free agents cannot win', async t => {
  const f = fixture(t); await f.finals(); const first = f.submissions.records()[0];
  await f.submissions.mutate(first.game.gameId, r => { const row = r.playerGameStats[0]; row.MIN = 0; row.PTS = 1000; r.playerGameStats.push({ ...row, playerId:'unknown' }); r.playerGameStats.push({ ...r.playerGameStats[1] }); });
  const members = f.repository.loadRosterMemberships('l'); f.repository.saveRosterMemberships('l',members.filter(m => m.playerId !== first.playerGameStats[2].playerId));
  await f.advance(); assert.ok(f.service.list('l').every(w => ![first.playerGameStats[0].playerId,first.playerGameStats[1].playerId,first.playerGameStats[2].playerId].includes(w.playerId)));
});
test('historical awards and profile achievements survive trades and season changes', async t => {
  const f = fixture(t); await f.finals(); await f.advance(); const original = f.service.list('l')[0];
  const members = f.repository.loadRosterMemberships('l'); const m = members.find(m => m.playerId===original.playerId); m.active=false; m.endedAt='2026-10-09T00:00:00Z'; members.push({ ...m, teamId:'West1', active:true, endedAt:null }); f.repository.saveRosterMemberships('l',members);
  f.repository.saveLeague('l',{ currentSeasonId:'2' }); const profile = require('../src/fantasyhq/player-service').createPlayerService({ repository:f.repository }).getPlayer('l','2',original.playerId);
  assert.equal(profile.playerOfWeek.length,1); assert.equal(profile.playerOfWeek[0].teamId,original.teamId); assert.deepEqual(f.service.list('l')[0],original);
});
test('Discord sends one weekly permanent post with correct portraits and reconciles an interrupted delivery after restart', async t => {
  const f = fixture(t); await f.finals(); await f.advance(); let sent=0, failReceipt=true; const messages=new Map();
  const channel={ messages:{fetch:async () => messages}, send:async payload=>{sent++;const message={id:'m'+sent,embeds:payload.embeds.map(e=>e.toJSON()),createdTimestamp:f.now()};messages.set(message.id,message);return message;} }, guild={channels:{fetch:async()=>channel}};
  const original=f.repository.commitAwards;
  f.repository.commitAwards = args => { if (args.auditEntry.action==='player-of-week.publication' && args.auditEntry.metadata.status==='DELIVERED' && failReceipt) {failReceipt=false;throw Error('Crash after send');} return original(args); };
  const make=()=>require('../src/fantasyhq/discord-player-of-week').createDiscordPlayerOfWeek({repository:f.repository,submissions:f.submissions,now:f.now});
  await assert.rejects(make().publish(guild,'l','1',1),/Crash/); assert.equal(sent,1);
  await Promise.all([make().publish(guild,'l','1',1),make().publish(guild,'l','1',1)]); assert.equal(sent,1);
  const winners=f.service.list('l'); assert.equal(winners[0].discordMessageId,'m1');
  for(const embed of messages.get('m1').embeds){const winner=winners.find(w=>embed.title.includes(w.conference.toUpperCase()));const player=f.repository.loadPlayers('l').find(p=>p.playerId===winner.playerId);assert.equal(embed.thumbnail.url,player.imageUrl);}
  await f.finals(14,2);await f.advance();await make().publish(guild,'l','1',2);assert.equal(sent,2);assert.equal(messages.size,2);
});
test('simulation awards remain isolated and never publish in live Discord', async t => {
  const live=fixture(t),sim=fixture(t,true);await sim.finals();await sim.advance();assert.equal(sim.service.list('l').length,2);assert.equal(live.service.list('l').length,0);
  let sent=0; const manager=require('../src/fantasyhq/discord-player-of-week').createDiscordPlayerOfWeek({repository:sim.repository,submissions:sim.submissions});
  await manager.publish({channels:{fetch:async()=>{sent++;}}},'l','1',1);assert.equal(sent,0);
});
