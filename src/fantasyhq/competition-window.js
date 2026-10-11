// Shared by uploads, stream links and wager confirmations. History/review paths
// intentionally do not call this guard: correcting results is a separate action.
function requireCompetitionGame(repository, game, submissions) {
  const context = repository.loadLeague(game.leagueId);
  const { league, seasonId } = context;
  if (seasonId !== String(game.seasonId)) throw Error('This game belongs to an archived season.');
  if (game.seriesId) {
    if (league.currentPhase !== 'PLAYOFFS') throw Error('Postseason game actions require PLAYOFFS.');
    const state = require('./postseason-service').createPostseasonService({ repository, submissions }).inspect(game.leagueId);
    const series = state.series.find(row => row.id === game.seriesId);
    if (state.conflicts.length || state.stage !== game.stage || !series || series.winnerTeamId
      || series.gameIds.at(-1) !== game.gameId) throw Error('This postseason game is not open for submissions or betting.');
    return;
  }
  if (league.currentPhase !== 'REGULAR_SEASON' || league.regularSeasonStatus === 'COMPLETED') {
    throw Error('Regular-season game actions require an active REGULAR_SEASON.');
  }
  const schedule = repository.loadSchedule(game.leagueId, seasonId);
  const active = schedule.weeks.filter(row => row.status === 'ACTIVE');
  if (active.length !== 1 || active[0].week !== league.currentWeek || active[0].week !== game.weekNumber || active[0].weekId !== game.weekId
    || !active[0].games.some(row => [row.team1Id, row.team2Id].includes(game.team1Id)
      && [row.team1Id, row.team2Id].includes(game.team2Id) && game.team1Id !== game.team2Id)) {
    throw Error('This game is not in the active league week.');
  }
}
module.exports = { requireCompetitionGame };
