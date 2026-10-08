const { createHash } = require('crypto');
const { officialRegularGames } = require('./official-game');
const { createPlayerStatsService } = require('./player-stats-service');
const CONFERENCES = ['East', 'West'];
const FORMULA_VERSION = 1;
const round = value => Math.round(value * 1000000) / 1000000;
function performanceScore(log) {
  const [FGM, FGA] = log.FG.split('-').map(Number), [threePM, threePA] = log['3PT'].split('-').map(Number), [FTM, FTA] = log.FT.split('-').map(Number);
  const margin = Number(log.score.split('-')[0]) - Number(log.score.split('-')[1]);
  const defensive = 2 * log.STL + 2 * log.BLK;
  const allAround = log.REB + log.AST + log.STL + log.BLK;
  const efficiency = FGA + .44 * FTA > 0 ? log.PTS / (2 * (FGA + .44 * FTA)) : 0;
  const individual = log.PTS + 1.2 * log.REB + 1.5 * log.AST + defensive - 2 * log.TO
    - .7 * (FGA - FGM) - .4 * (FTA - FTM) + .4 * threePM - .25 * (threePA - threePM);
  const team = (log.result === 'W' ? 2 : -1) + Math.max(-1.5, Math.min(1.5, margin / 20));
  return { score: round(individual + team), efficiency: round(efficiency), allAround, defensive, win: log.result === 'W' ? 1 : 0, margin,
    stats: { MIN: log.MIN, PTS: log.PTS, REB: log.REB, AST: log.AST, STL: log.STL, BLK: log.BLK, TO: log.TO, FGM, FGA, '3PM': threePM, '3PA': threePA, FTM, FTA, FGPercent: FGA ? round(FGM / FGA * 100) : null } };
}
function comparePerformances(a, b) {
  const scoreDifference = Math.round(b.score * 10000) - Math.round(a.score * 10000);
  if (scoreDifference) return scoreDifference;
  for (const key of ['efficiency', 'allAround', 'defensive', 'win', 'margin']) if (a[key] !== b[key]) return b[key] - a[key];
  return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
}
function explanation(winner) {
  const s = winner.stats;
  return `${winner.playerName} ${winner.win ? 'helped ' + winner.teamName + ' win' : 'led the conference despite a loss'} with ${s.PTS} points, ${s.REB} rebounds and ${s.AST} assists${s.FGPercent == null ? '' : ' on ' + Math.round(s.FGPercent) + '% field-goal shooting'}. ${s.STL} steals, ${s.BLK} blocks and ${s.TO} turnovers contributed to the all-around performance score.`;
}
function createPlayerOfWeekService({ repository, submissions, now = Date.now }) {
  submissions ||= require('./game-submissions').createGameSubmissionService({ repository });
  function list(leagueId, filters = {}) {
    const awards = repository.loadAwards(leagueId), settings = repository.loadSettings(leagueId) || {};
    const testMode = !!settings.simulationId;
    return Object.values(awards.seasons).flatMap(season => Object.values(season.PLAYER_OF_WEEK?.weeks || {}))
      .filter(record => !!record.testMode === testMode)
      .flatMap(record => record.winners.map(w => ({ ...w, seasonId: record.seasonId, week: record.week, createdAt: record.createdAt, discordMessageId: record.publication?.messageId || null, testMode: record.testMode || false })))
      .filter(w => (!filters.seasonId || w.seasonId === String(filters.seasonId)) && (!filters.week || w.week === Number(filters.week))
        && (!filters.conference || w.conference === filters.conference) && (!filters.teamId || w.teamId === filters.teamId) && (!filters.playerId || w.playerId === filters.playerId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.week - b.week || a.conference.localeCompare(b.conference));
  }
  function prepareWeek(leagueId, seasonId, weekNumber, schedule = repository.loadSchedule(leagueId, seasonId)) {
    const awards = repository.loadAwards(leagueId), previous = awards.seasons[seasonId]?.PLAYER_OF_WEEK?.weeks?.[weekNumber];
    if (previous) return { awards, record: previous, alreadyApplied: true };
    const week = schedule.weeks.find(w => w.week === Number(weekNumber));
    if (!week || week.status !== 'COMPLETED' || !week.completedAt) return null;
    const context = repository.loadLeague(leagueId, seasonId), allRecords = submissions.records();
    const official = officialRegularGames(allRecords, { leagueId, seasonId: String(seasonId), schedule });
    const games = official.games.filter(r => r.game.weekId === week.weekId);
    if (official.duplicates.some(r => r.game.weekId === week.weekId) || games.length !== week.games.length) return null;
    const gameMap = new Map(games.map(r => [r.game.gameId, r.game]));
    const players = new Map(repository.loadPlayers(leagueId).map(p => [p.playerId, p]));
    const memberships = repository.loadRosterMemberships(leagueId), settings = repository.loadSettings(leagueId) || {};
    const stats = createPlayerStatsService({ repository, submissions: { records: () => games } }).getWeekPerformances(leagueId, String(seasonId), Number(weekNumber));
    const candidates = stats.flatMap(log => {
      const player = players.get(log.playerId), game = gameMap.get(log.gameId), team = context.teams.find(t => t.teamId === log.teamId);
      if (!player || !game || game.result.type === 'FORFEIT' || !CONFERENCES.includes(team?.conference)) return [];
      const represented = memberships.some(member => require('./historical-membership').representedAt(member,
        {playerId: log.playerId, teamId: log.teamId, seasonId, at: game.finalizedAt}));
      if (!represented) return [];
      return [{ playerId: log.playerId, playerName: player.name, teamId: log.teamId, teamName: log.teamName, conference: team.conference, gameId: log.gameId, ...performanceScore(log) }];
    });
    const winners = CONFERENCES.flatMap(conference => {
      const winner = candidates.filter(p => p.conference === conference).sort(comparePerformances)[0];
      if (!winner) return [];
      winner.awardId = `${leagueId}:${seasonId}:W${weekNumber}:${conference.toUpperCase()}`;
      winner.explanation = explanation(winner); return [winner];
    });
    const record = { leagueId, seasonId: String(seasonId), week: Number(weekNumber), weekId: week.weekId, formulaVersion: FORMULA_VERSION,
      winners, unavailableConferences: CONFERENCES.filter(c => !winners.some(w => w.conference === c)), createdAt: new Date(now()).toISOString(),
      sourceGameIds: games.map(r => r.game.gameId).sort(), sourceDigest: createHash('sha256').update(JSON.stringify(games.map(r => [r.game, r.playerGameStats, r.dnpPlayers]))).digest('hex'),
      ...(settings.simulationId ? { testMode: true, simulationId: settings.simulationId } : {}), publication: null };
    awards.seasons[seasonId] ||= {}; awards.seasons[seasonId].PLAYER_OF_WEEK ||= { weeks: {} };
    awards.seasons[seasonId].PLAYER_OF_WEEK.weeks[weekNumber] = record;
    return { awards, record, alreadyApplied: false };
  }
  function processWeek(leagueId, seasonId, week) {
    const prepared = prepareWeek(leagueId, String(seasonId), week);
    if (!prepared || prepared.alreadyApplied) return prepared?.record || null;
    repository.commitAwards({ leagueId, awards: prepared.awards, auditEntry: { action: 'player-of-week.calculated', seasonId: String(seasonId), week, timestamp: prepared.record.createdAt, metadata: { winners: prepared.record.winners.map(w => w.awardId) } } });
    return prepared.record;
  }
  function publication(leagueId, seasonId, week, value) {
    const awards = repository.loadAwards(leagueId), record = awards.seasons[seasonId]?.PLAYER_OF_WEEK?.weeks[week];
    if (!record) throw Error('Weekly awards have not been calculated.');
    record.publication = value;
    repository.commitAwards({ leagueId, awards, auditEntry: { action: 'player-of-week.publication', seasonId, week, timestamp: new Date(now()).toISOString(), metadata: value } });
  }
  return { list, prepareWeek, processWeek, publication };
}
module.exports = { createPlayerOfWeekService, performanceScore, comparePerformances, FORMULA_VERSION };
