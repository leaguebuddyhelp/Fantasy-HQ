const { createGameSubmissionService } = require('./game-submissions');
function createStandingsService({ repository, submissions, publishedOnly = false, scope = 'REGULAR_SEASON' } = {}) {
    submissions ||= createGameSubmissionService(repository ? { repository } : {}); repository ||= submissions.repository;
    function getStandings(leagueId, seasonId, records = null, scheduleOverride = undefined) {
        const context = repository.loadLeague(leagueId, seasonId);
        const rows = new Map(context.teams.map(t => [t.teamId, { teamId: t.teamId, teamName: t.teamName, abbreviation: t.abbreviation, conference: t.conference, GP: 0, scoringGP: 0, W: 0, L: 0, PCT: 0, PF: 0, PA: 0, DIFF: 0 }]));
        const schedule = scheduleOverride === undefined
            ? repository.scheduleExists(leagueId, context.seasonId) ? repository.loadSchedule(leagueId, context.seasonId) : null
            : scheduleOverride;
        let countedGames = 0;
        const eligible = require('./stat-scope').officialScopeGames(records || submissions.records(), { repository,leagueId,seasonId:context.seasonId,schedule,publishedOnly,scope });
        for (const record of eligible.games) {
            const g = record.game, result = g.result;
            const a = rows.get(g.team1Id), b = rows.get(g.team2Id), pa = result.scores?.[g.team1Id], pb = result.scores?.[g.team2Id];
            if (!a || !b || a === b) continue;
            if (result.type === 'FORFEIT') { for (const team of [a,b]) { team.GP++; team.W += team.teamId === result.winnerTeamId ? 1 : 0; team.L += team.teamId === result.winnerTeamId ? 0 : 1; team.PCT = team.W / team.GP; } countedGames++; continue; }
            if (!a || !b || a === b || ![pa, pb].every(n => Number.isInteger(n) && n >= 0) || pa === pb) continue;
            for (const [team, pf, against] of [[a, pa, pb], [b, pb, pa]]) { team.GP++; team.scoringGP++; team.W += pf > against ? 1 : 0; team.L += pf < against ? 1 : 0; team.PF += pf; team.PA += against; team.DIFF = team.PF - team.PA; team.PCT = team.W / team.GP; }
            countedGames++;
        }
        function rankConference(conference) {
          const base = [...rows.values()].filter(t => t.conference === conference).sort((a,b) => b.PCT - a.PCT || b.W - a.W);
          const ranked = [];
          for (let i = 0; i < base.length;) {
            const tied = []; const first = base[i];
            while (i < base.length && base[i].PCT === first.PCT && base[i].W === first.W) tied.push(base[i++]);
            const ids = new Set(tied.map(t => t.teamId)), head = new Map(tied.map(t => [t.teamId, { wins: 0, games: 0 }]));
            for (const record of eligible.games) {
              const g = record.game; if (!ids.has(g.team1Id) || !ids.has(g.team2Id)) continue;
              const winner = g.result.type === 'FORFEIT' ? g.result.winnerTeamId : (g.result.scores[g.team1Id] > g.result.scores[g.team2Id] ? g.team1Id : g.team2Id);
              for (const id of [g.team1Id,g.team2Id]) { head.get(id).games++; head.get(id).wins += id === winner ? 1 : 0; }
            }
            tied.sort((a,b) => (head.get(b.teamId).games ? head.get(b.teamId).wins/head.get(b.teamId).games : 0) - (head.get(a.teamId).games ? head.get(a.teamId).wins/head.get(a.teamId).games : 0) || b.DIFF - a.DIFF || b.PF - a.PF || a.teamId.localeCompare(b.teamId));
            ranked.push(...tied);
          }
          return ranked.map((t,i) => ({ ...t, rank: i+1 }));
        }
        const conferences = Object.fromEntries(['East','West'].map(c => [c,rankConference(c)]));
        return { leagueId, seasonId: context.seasonId, currentWeek: context.league.currentWeek || null, countedGames, conferences, publishedThroughWeek: require('./official-game').publishedThroughWeek(schedule) };
    }
    return { getStandings };
}
function formatPct(value) { return value.toFixed(3).replace(/^0\./, '.'); }
module.exports = { createStandingsService, formatPct };
