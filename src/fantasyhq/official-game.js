// Shared eligibility rule for standings and week completion; Game.result is official.
function officialRegularGame(record, { leagueId, seasonId, schedule }) {
    const g = record.game, result = g.result;
    if (!g.gameId || g.leagueId !== leagueId || g.seasonId !== seasonId || g.status !== 'FINAL' || !g.finalizedAt || !result) return false;
    const submission = record.submissions.find(s => s.submissionId === result.submissionId);
    const extraction = record.extractions?.find(e => e.extractionId === result.extractionId && e.submissionId === result.submissionId);
    if (submission?.status !== 'FINAL' || extraction?.status !== 'READY_FOR_REVIEW' || !Array.isArray(extraction.issues) || extraction.issues.length) return false;
    const week = schedule?.weeks.find(w => w.week === g.weekNumber && w.weekId === g.weekId);
    if (!week || g.weekNumber < 1 || g.weekNumber > 15 || !week.games.some(m => m.team1Id === g.team1Id && m.team2Id === g.team2Id)) return false;
    const a = result.scores?.[g.team1Id], b = result.scores?.[g.team2Id];
    return g.team1Id !== g.team2Id && [a, b].every(n => Number.isInteger(n) && n >= 0) && a !== b;
}
function officialRegularGames(records, scope) {
    const matchups = new Map();
    for (const record of records || []) {
        if (!officialRegularGame(record, scope)) continue;
        const game = record.game, key = JSON.stringify([game.weekId, [game.team1Id, game.team2Id].sort()]);
        const group = matchups.get(key) || []; group.push(record); matchups.set(key, group);
    }
    const games = [], duplicates = [];
    for (const group of matchups.values()) if (group.length === 1) games.push(group[0]); else duplicates.push(...group);
    return { games, duplicates };
}
function publishedThroughWeek(schedule) {
    return schedule?.statsPublication?.throughWeek ?? Math.max(0, ...(schedule?.weeks || []).filter(w => w.status === 'COMPLETED').map(w => w.week));
}
function publishedRegularGame(record, scope) {
    if (!officialRegularGame(record, scope)) return false;
    const publication = scope.schedule?.statsPublication;
    return publication ? publication.gameIds.includes(record.game.gameId) : scope.schedule.weeks.some(w => w.weekId === record.game.weekId && w.status === 'COMPLETED');
}
function publishedRegularGames(records, scope) {
    const candidates = (records || []).filter(r => publishedRegularGame(r, scope));
    return officialRegularGames(candidates, scope);
}
function initializeStatsPublication(repository, records, guildId) {
    const binding = repository.loadGuildLeagueBinding(guildId);
    if (!binding) return;
    const context = repository.loadLeagueContext({ guildId });
    if (!repository.scheduleExists(context.league.leagueId, context.seasonId)) return;
    const schedule = repository.loadSchedule(context.league.leagueId, context.seasonId);
    if (schedule.statsPublication) return;
    const scope = { leagueId: context.league.leagueId, seasonId: context.seasonId, schedule };
    schedule.statsPublication = { throughWeek: publishedThroughWeek(schedule), publishedAt: new Date().toISOString(), gameIds: publishedRegularGames(records, scope).games.map(r => r.game.gameId) };
    repository.saveSchedule(schedule);
}
module.exports = { officialRegularGame, officialRegularGames, publishedRegularGame, publishedRegularGames, publishedThroughWeek, initializeStatsPublication };
