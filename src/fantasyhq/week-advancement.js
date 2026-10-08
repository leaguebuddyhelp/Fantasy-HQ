const { randomUUID } = require('crypto');
const confirmations = new Map(), jobs = new Map();
function createWeekAdvancementService({ submissions = require('./game-submissions').createGameSubmissionService(), threads, now = () => Date.now(), onAdvanced = null } = {}) {
  const repository = submissions.repository;
  function authorize(actor) { if (!actor?.authorized || !actor.id) throw Error('Commissioner authorization required.'); }
  function inspect(guildId) {
    const context = repository.loadLeagueContext({ guildId }), league = context.league, schedule = repository.loadSchedule(league.leagueId, context.seasonId);
    if (league.currentPhase !== 'REGULAR_SEASON') throw Error('League must be in REGULAR_SEASON.');
    const seasonComplete = league.regularSeasonStatus === 'COMPLETED';
    const active = schedule.weeks.filter(w => w.status === 'ACTIVE'), week = seasonComplete ? schedule.weeks.find(w => w.week === 15) : active[0];
    if ((seasonComplete ? active.length !== 0 : active.length !== 1) || !week || week.week !== league.currentWeek || schedule.weeks.length !== 15 || new Set(schedule.weeks.map(w => w.week)).size !== 15 || schedule.weeks.some(w => !Number.isInteger(w.week) || w.week < 1 || w.week > 15)) throw Error('Invalid regular-season week state.');
    if (week.games.length !== 14 || week.byes.length !== 2) throw Error('Expected 14 scheduled games and two bye teams.');
    if (schedule.weeks.some(w => w.status !== (seasonComplete || w.week < week.week ? 'COMPLETED' : w.week === week.week ? 'ACTIVE' : 'UPCOMING'))) throw Error('Week states are inconsistent.');
    const games = require('./weekly-dashboard-service').weekGames(context, schedule, week, submissions.records(), guildId, now());
    return { seasonComplete, week: week.week, weekId: week.weekId, seasonId: context.seasonId, leagueId: league.leagueId, deadlineAt: week.deadlineAt, total: 14, final: games.filter(g => g.final).length, unresolved: games.filter(g => !g.final), games };
  }
  function prepare(guildId, actor, force = false) {
    authorize(actor); const view = inspect(guildId);
    if (view.seasonComplete) throw Error('Regular season is already complete.');
    if (view.unresolved.length && !force) return { ...view, blocked: true };
    for (const [key, c] of confirmations) if (c.expiresAt < now()) confirmations.delete(key);
    const token = randomUUID(); confirmations.set(token, { guildId, actorId: actor.id, view, force: force === true, expiresAt: now() + 5 * 60000, root: repository.dataRoot });
    return { ...view, token, force: force === true, nextWeek: view.week === 15 ? null : view.week + 1 };
  }
  function cancel(token, actor) { authorize(actor); const c = confirmations.get(token); if (c?.actorId === actor.id) confirmations.delete(token); }
  function advance(guild, actor, token) {
    authorize(actor); const key = `${repository.dataRoot}:${guild.id}:${token}`;
    if (jobs.has(key)) return jobs.get(key).then(result => { const c = confirmations.get(token); if (c?.actorId !== actor.id) throw Error('Confirmation belongs to another commissioner.'); return result; });
    const job = run(guild, actor, token).finally(() => jobs.delete(key)); jobs.set(key, job); return job;
  }
  async function run(guild, actor, token) {
    const context = repository.loadLeagueContext({ guildId: guild.id }), leagueId = context.league.leagueId;
    const prior = repository.loadAuditLog(leagueId).find(e => e.action === 'week.advanced' && e.requestId === token);
    if (prior) { if (prior.userId !== actor.id) throw Error('Confirmation belongs to another commissioner.'); const saved = repository.loadSchedule(leagueId, context.seasonId); return { ...prior.result, deadlineAt: saved.weeks.find(w => w.week === prior.result.currentWeek)?.deadlineAt || null, alreadyApplied: true }; }
    const c = confirmations.get(token);
    if (!c || c.actorId !== actor.id || c.guildId !== guild.id || c.root !== repository.dataRoot || c.expiresAt < now()) throw Error('Confirmation expired or invalid. Refresh and confirm again.');
    const view = inspect(guild.id);
    if (view.seasonComplete || view.weekId !== c.view.weekId || view.seasonId !== c.view.seasonId) throw Error('Week changed. Refresh and confirm again.');
    if (view.unresolved.length && !c.force) throw Error(`${view.final}/14 games final. Resolve unfinished games first.`);
    if (c.force && JSON.stringify(view.unresolved.map(g => [g.team1Id, g.team2Id, g.gameId])) !== JSON.stringify(c.view.unresolved.map(g => [g.team1Id, g.team2Id, g.gameId]))) throw Error('Unresolved games changed. Review and confirm again.');
    const schedule = repository.loadSchedule(leagueId, view.seasonId), current = schedule.weeks.find(w => w.week === view.week), next = schedule.weeks.find(w => w.week === view.week + 1), timestamp = new Date(now()).toISOString();
    current.status = 'COMPLETED'; current.completedAt = timestamp;
    const publicationGames = require('./official-game').officialRegularGames(submissions.records(), { leagueId, seasonId: view.seasonId, schedule }).games.filter(r => r.game.weekNumber <= view.week);
    schedule.statsPublication = { throughWeek: view.week, publishedAt: timestamp, gameIds: publicationGames.map(r => r.game.gameId), snapshots: require('./official-game').publicationSnapshot(publicationGames) };
    if (c.force) current.unresolvedAtCompletion = view.unresolved.map(g => ({ gameId: g.gameId, team1Id: g.team1Id, team2Id: g.team2Id }));
    const league = { ...context.league, updatedAt: timestamp };
    if (next) { next.status = 'ACTIVE'; delete next.startedAt; delete next.deadlineAt; delete next.threadsStartedAt; league.currentWeek = next.week; }
    else { league.regularSeasonStatus = 'COMPLETED'; league.regularSeasonCompletedAt = timestamp; }
    const result = { previousWeek: view.week, currentWeek: next?.week || 15, seasonComplete: !next, deadlineAt: next?.deadlineAt || null, games: next?.games.length || 0, forced: c.force, unresolved: view.unresolved };
    require('./storage-safety').createStorageBackup(repository.dataRoot, { label: `before-week-${view.week}-advance` });
    const weeklyAward = require('./player-of-week').createPlayerOfWeekService({ repository, submissions, now }).prepareWeek(leagueId, view.seasonId, view.week, schedule);
    repository.commitWeekTransition({ leagueId, expectedWeek: view.week, schedule, league, awards: weeklyAward?.awards || null, auditEntry: { action: 'week.advanced', userId: actor.id, commissionerUserId: actor.commissionerUserId || null, operator: actor.operator || actor.id, timestamp, week: view.week, force: c.force, unresolved: view.unresolved, requestId: token, result } });
    if (next) { try { result.threads = await threads.create(guild); result.deadlineAt = result.threads.deadlineAt || null; } catch (error) { result.threadError = error.message; } }
    if (onAdvanced) {
      try { await onAdvanced({ guild, leagueId, seasonId: view.seasonId, result }); }
      catch (error) { console.error('Week advancement follow-up failed:', error.message); }
    }
    return result;
  }
  return { inspect, prepare, advance, cancel, submissions };
}
module.exports = { createWeekAdvancementService };
