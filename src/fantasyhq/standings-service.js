const { createGameSubmissionService } = require('./game-submissions');
function createStandingsService({ repository, submissions, publishedOnly = false, scope = 'REGULAR_SEASON' } = {}) {
    submissions ||= createGameSubmissionService(repository ? { repository } : {}); repository ||= submissions.repository;
    function getStandings(leagueId, seasonId, records = null, scheduleOverride = undefined) {
        const context = repository.loadLeague(leagueId, seasonId);
        const rows = new Map(context.teams.map(t => [t.teamId, { teamId: t.teamId, teamName: t.teamName, abbreviation: t.abbreviation, conference: t.conference, division: require('./standings-tiebreakers').teamDivision(t), GP: 0, scoringGP: 0, W: 0, L: 0, PCT: 0, PF: 0, PA: 0, DIFF: 0 }]));
        const schedule = scheduleOverride === undefined
            ? repository.scheduleExists(leagueId, context.seasonId) ? repository.loadSchedule(leagueId, context.seasonId) : null
            : scheduleOverride;
        let countedGames = 0;
        const games = [];
        const eligible = require('./stat-scope').officialScopeGames(records || submissions.records(), { repository,leagueId,seasonId:context.seasonId,schedule,publishedOnly,scope });
        for (const record of eligible.games) {
            const g = record.game, result = g.result;
            const a = rows.get(g.team1Id), b = rows.get(g.team2Id), pa = result.scores?.[g.team1Id], pb = result.scores?.[g.team2Id];
            if (!a || !b || a === b) continue;
            if (result.type === 'FORFEIT') { games.push({team1Id:g.team1Id,team2Id:g.team2Id,winnerTeamId:result.winnerTeamId}); for (const team of [a,b]) { team.GP++; team.W += team.teamId === result.winnerTeamId ? 1 : 0; team.L += team.teamId === result.winnerTeamId ? 0 : 1; team.PCT = team.W / team.GP; } countedGames++; continue; }
            if (!a || !b || a === b || ![pa, pb].every(n => Number.isInteger(n) && n >= 0) || pa === pb) continue;
            for (const [team, pf, against] of [[a, pa, pb], [b, pb, pa]]) { team.GP++; team.scoringGP++; team.W += pf > against ? 1 : 0; team.L += pf < against ? 1 : 0; team.PF += pf; team.PA += against; team.DIFF = team.PF - team.PA; team.PCT = team.W / team.GP; }
            games.push({team1Id:g.team1Id,team2Id:g.team2Id,winnerTeamId:pa>pb?g.team1Id:g.team2Id});
            countedGames++;
        }
        const drawSeed = repository.loadSettings(leagueId)?.standingsDrawSeeds?.[context.seasonId];
        const ranking = require('./standings-tiebreakers').rankStandings([...rows.values()], games, { drawSeed });
        return { leagueId, seasonId: context.seasonId, currentWeek: context.league.currentWeek || null, countedGames, ...ranking, publishedThroughWeek: require('./official-game').publishedThroughWeek(schedule) };
    }
    return { getStandings };
}
function formatPct(value) { return value.toFixed(3).replace(/^0\./, '.'); }
module.exports = { createStandingsService, formatPct };
