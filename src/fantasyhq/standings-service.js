const { createGameSubmissionService } = require('./game-submissions');
function createStandingsService({ repository, submissions } = {}) {
    submissions ||= createGameSubmissionService(repository ? { repository } : {}); repository ||= submissions.repository;
    function getStandings(leagueId, seasonId, records = null, scheduleOverride = undefined) {
        const context = repository.loadLeague(leagueId, seasonId);
        const rows = new Map(context.teams.map(t => [t.teamId, { teamId: t.teamId, teamName: t.teamName, abbreviation: t.abbreviation, conference: t.conference, GP: 0, W: 0, L: 0, PCT: 0, PF: 0, PA: 0, DIFF: 0 }]));
        const schedule = scheduleOverride === undefined
            ? repository.scheduleExists(leagueId, context.seasonId) ? repository.loadSchedule(leagueId, context.seasonId) : null
            : scheduleOverride;
        let countedGames = 0;
        const eligible = require('./official-game').officialRegularGames(records || submissions.records(), { leagueId, seasonId: context.seasonId, schedule });
        for (const record of eligible.games) {
            const g = record.game, result = g.result;
            const a = rows.get(g.team1Id), b = rows.get(g.team2Id), pa = result.scores?.[g.team1Id], pb = result.scores?.[g.team2Id];
            if (!a || !b || a === b || ![pa, pb].every(n => Number.isInteger(n) && n >= 0) || pa === pb) continue;
            for (const [team, pf, against] of [[a, pa, pb], [b, pb, pa]]) { team.GP++; team.W += pf > against ? 1 : 0; team.L += pf < against ? 1 : 0; team.PF += pf; team.PA += against; team.DIFF = team.PF - team.PA; team.PCT = team.W / team.GP; }
            countedGames++;
        }
        const compare = (a, b) => b.PCT - a.PCT || b.W - a.W || (a.teamName < b.teamName ? -1 : a.teamName > b.teamName ? 1 : 0) || (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0);
        const conferences = Object.fromEntries(['East', 'West'].map(c => [c, [...rows.values()].filter(t => t.conference === c).sort(compare).map((t, i) => ({ ...t, rank: i + 1 }))]));
        return { leagueId, seasonId: context.seasonId, currentWeek: context.league.currentWeek || null, countedGames, conferences };
    }
    return { getStandings };
}
function formatPct(value) { return value.toFixed(3).replace(/^0\./, '.'); }
module.exports = { createStandingsService, formatPct };
