const { createGameSubmissionService } = require('./game-submissions');
const { officialRegularGames, publishedRegularGames } = require('./official-game');
const { createStandingsService } = require('./standings-service');
const { createFantasyHQRepository } = require('./repository');

const TEAM_FIELDS = ['MIN', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FGM', 'FGA', '3PM', '3PA', 'FTM', 'FTA', 'OR', 'FLS'];
const COUNT_FIELDS = TEAM_FIELDS.filter(field => field !== 'MIN');

function emptyTeamTotals() {
    return Object.fromEntries(TEAM_FIELDS.map(field => [field, 0]));
}

function numeric(value, integer = false) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || (integer && !Number.isInteger(number))) return null;
    return number;
}

function percentage(makes, attempts) {
    return attempts > 0 ? 100 * makes / attempts : null;
}

function createTeamStatsService({ repository, submissions, standingsService, publishedOnly = false, scope = 'REGULAR_SEASON' } = {}) {
    submissions ||= createGameSubmissionService(repository ? { repository } : {});
    repository ||= submissions.repository || createFantasyHQRepository();
    standingsService ||= createStandingsService({ repository, submissions, publishedOnly, scope });

    function buildSnapshot(leagueId, seasonId) {
        const context = repository.loadLeague(leagueId, seasonId), resolvedSeason = context.seasonId;
        const records = submissions.records();
        const schedule = repository.scheduleExists(leagueId, resolvedSeason) ? repository.loadSchedule(leagueId, resolvedSeason) : null;
        const official = require('./stat-scope').officialScopeGames(records,{repository,leagueId,seasonId:resolvedSeason,schedule,publishedOnly,scope});
        const standings = standingsService.getStandings(leagueId, resolvedSeason, records, schedule);
        const teams = Object.values(standings.conferences).flat().map(team => ({
            ...team,
            PTS: team.PF,
            PTS_ALLOWED: team.PA,
            PPG: team.scoringGP ? team.PF / team.scoringGP : 0,
            OPP_PPG: team.scoringGP ? team.PA / team.scoringGP : 0,
            TOTAL_DIFF: team.DIFF,
            AVG_DIFF: team.scoringGP ? (team.PF - team.PA) / team.scoringGP : 0,
            totals: { ...emptyTeamTotals(), PTS: team.PF, PTS_ALLOWED: team.PA },
        }));
        const totalsByTeam = new Map(teams.map(team => [team.teamId, team.totals]));
        const logsByTeam = new Map(teams.map(team => [team.teamId, []]));
        const warnings = official.duplicates.map(record => ({ type: 'duplicate-official-game', gameId: record.game.gameId }));

        for (const record of official.games) {
            const game = record.game || {};
            const teamIds = [String(game.team1Id || ''), String(game.team2Id || '')];
            const rowsByTeam = new Map(), duplicateTeams = new Set();
            for (const row of record.teamGameStats || []) {
                const teamId = String(row?.teamId || '');
                if (!teamId) { warnings.push({ type: 'missing-team-id', gameId: game.gameId }); continue; }
                if (String(row.gameId || '') !== String(game.gameId || '')) { warnings.push({ type: 'game-id-mismatch', gameId: game.gameId, teamId }); continue; }
                if (!teamIds.includes(teamId) || !totalsByTeam.has(teamId)) { warnings.push({ type: 'invalid-game-team', gameId: game.gameId, teamId }); continue; }
                if (rowsByTeam.has(teamId)) {
                    duplicateTeams.add(teamId);
                    warnings.push({ type: 'duplicate-team-game-row', gameId: game.gameId, teamId });
                    continue;
                }
                const raw = row;
                const stats = {
                    MIN: numeric(raw.MIN), REB: numeric(raw.REB, true), AST: numeric(raw.AST, true),
                    STL: numeric(raw.STL, true), BLK: numeric(raw.BLK, true), TO: numeric(raw.TO ?? raw.TOV, true),
                    FGM: numeric(raw.FGM, true), FGA: numeric(raw.FGA, true), '3PM': numeric(raw['3PM'], true),
                    '3PA': numeric(raw['3PA'], true), FTM: numeric(raw.FTM, true), FTA: numeric(raw.FTA, true),
                    OR: numeric(raw.OR ?? raw.OREB, true), FLS: numeric(raw.FLS, true),
                };
                if (Object.values(stats).some(value => value === null)
                    || stats.FGM > stats.FGA || stats['3PM'] > stats['3PA'] || stats.FTM > stats.FTA || stats['3PM'] > stats.FGM) {
                    warnings.push({ type: 'invalid-team-stat-row', gameId: game.gameId, teamId });
                    continue;
                }
                rowsByTeam.set(teamId, { stats, row });
            }
            for (const teamId of teamIds) {
                const totals = totalsByTeam.get(teamId);
                if (game.result?.type === 'FORFEIT') { logsByTeam.get(teamId).push({ gameId: game.gameId, submissionId: game.result.submissionId, week: game.weekNumber, date: game.inGameDate || null, teamId, opponentId: teamIds.find(id => id !== teamId), opponent: context.teams.find(t => t.teamId !== teamId && teamIds.includes(t.teamId))?.teamName, result: game.result.winnerTeamId === teamId ? 'W' : 'L', score: 'Forfeit', administrative: true }); continue; }
                const opponentId = teamIds.find(id => id !== teamId), scores = game.result?.scores || {};
                const points = numeric(scores[teamId], true), allowed = numeric(scores[opponentId], true);
                if (points === null || allowed === null || points === allowed) continue;
                const teamName = game[teamId === game.team1Id ? 'team1Name' : 'team2Name'] || context.teams.find(team => team.teamId === teamId)?.teamName || teamId;
                const opponent = game[opponentId === game.team1Id ? 'team1Name' : 'team2Name'] || context.teams.find(team => team.teamId === opponentId)?.teamName || opponentId;
                const box = duplicateTeams.has(teamId) ? null : rowsByTeam.get(teamId)?.stats || null;
                const log = {
                    gameId: game.gameId,
                    submissionId: game.result?.submissionId || null,
                    week: Number(game.weekNumber || game.seriesGameNumber),
                    stage: game.stage || null,
                    date: game.inGameDate || null,
                    teamId,
                    teamName,
                    opponentId,
                    opponent,
                    result: points > allowed ? 'W' : 'L',
                    score: `${points}-${allowed}`,
                    PTS: points,
                    PTS_ALLOWED: allowed,
                    MIN: box?.MIN ?? null,
                    REB: box?.REB ?? null,
                    AST: box?.AST ?? null,
                    STL: box?.STL ?? null,
                    BLK: box?.BLK ?? null,
                    TO: box?.TO ?? null,
                    FG: box ? `${box.FGM}-${box.FGA}` : null,
                    '3PT': box ? `${box['3PM']}-${box['3PA']}` : null,
                    FT: box ? `${box.FTM}-${box.FTA}` : null,
                    OREB: box?.OR ?? null,
                    FLS: box?.FLS ?? null,
                };
                logsByTeam.get(teamId).push(log);
                if (!box) {
                    warnings.push({ type: 'missing-team-stat-row', gameId: game.gameId, teamId });
                    continue;
                }
                for (const field of TEAM_FIELDS) totals[field] += box[field];
            }
        }

        for (const team of teams) {
            const totals = team.totals;
            Object.assign(team, totals);
            team.PTS = team.PF;
            team.PTS_ALLOWED = team.PA;
            team.OREB = totals.OR;
            team.RPG = team.scoringGP ? totals.REB / team.scoringGP : 0;
            team.APG = team.scoringGP ? totals.AST / team.scoringGP : 0;
            team.SPG = team.scoringGP ? totals.STL / team.scoringGP : 0;
            team.BPG = team.scoringGP ? totals.BLK / team.scoringGP : 0;
            team.TOV = team.scoringGP ? totals.TO / team.scoringGP : 0;
            team.FGPercent = percentage(totals.FGM, totals.FGA);
            team.threePPercent = percentage(totals['3PM'], totals['3PA']);
            team.FTPercent = percentage(totals.FTM, totals.FTA);
            totals.PTS = team.PF;
            totals.PTS_ALLOWED = team.PA;
        }
        for (const log of logsByTeam.values()) log.sort((left, right) => left.week - right.week
            || String(left.date || '').localeCompare(String(right.date || '')) || left.gameId.localeCompare(right.gameId));
        teams.sort((left, right) => left.conference.localeCompare(right.conference) || left.teamName.localeCompare(right.teamName));
        return { leagueId, seasonId: resolvedSeason, teams, logsByTeam, warnings };
    }

    function getSeasonSnapshot(leagueId, seasonId) {
        const { leagueId: resolvedLeague, seasonId: resolvedSeason, teams, warnings } = buildSnapshot(leagueId, seasonId);
        return { leagueId: resolvedLeague, seasonId: resolvedSeason, teams, warnings };
    }

    function getSeasonTeamStats(leagueId, seasonId) {
        return buildSnapshot(leagueId, seasonId).teams;
    }

    function getTeamSeasonStats(leagueId, seasonId, teamId) {
        const snapshot = buildSnapshot(leagueId, seasonId);
        return snapshot.teams.find(team => team.teamId === teamId) || null;
    }

    function getTeamGameLog(leagueId, seasonId, teamId) {
        const snapshot = buildSnapshot(leagueId, seasonId);
        if (!snapshot.logsByTeam.has(teamId)) throw new Error(`Unknown team "${teamId}".`);
        return snapshot.logsByTeam.get(teamId);
    }

    function getTeamStatsAndGameLog(leagueId, seasonId, teamId) {
        const snapshot = buildSnapshot(leagueId, seasonId), team = snapshot.teams.find(row => row.teamId === teamId);
        if (!team) return null;
        return { team, games: snapshot.logsByTeam.get(teamId) || [], warnings: snapshot.warnings };
    }

    return { getSeasonSnapshot, getSeasonTeamStats, getTeamSeasonStats, getTeamGameLog, getTeamStatsAndGameLog };
}

module.exports = { createTeamStatsService, TEAM_FIELDS, percentage };