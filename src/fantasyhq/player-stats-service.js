const { createGameSubmissionService } = require('./game-submissions');
const { officialRegularGame, publishedRegularGame, publishedThroughWeek } = require('./official-game');
const { activeMemberships } = require('./service-helpers');
const { createFantasyHQRepository } = require('./repository');

const TOTAL_FIELDS = ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FGM', 'FGA', '3PM', '3PA', 'FTM', 'FTA', 'OR', 'FLS'];
const INTEGER_FIELDS = TOTAL_FIELDS.filter(field => field !== 'MIN');

function emptyTotals() {
    return Object.fromEntries(TOTAL_FIELDS.map(field => [field, 0]));
}

function numericValue(value, integer = false) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || (integer && !Number.isInteger(number))) return null;
    return number;
}

function percentage(makes, attempts) {
    return attempts > 0 ? (makes / attempts) * 100 : null;
}

function createPlayerStatsService({ repository, submissions, publishedOnly = false, scope = 'REGULAR_SEASON' } = {}) {
    require('./stat-scope').normalizeStatScope(scope);
    submissions ||= createGameSubmissionService(repository ? { repository } : {});
    repository ||= submissions.repository || createFantasyHQRepository();

    function buildSnapshot(leagueId, seasonId) {
        const context = repository.loadLeague(leagueId, seasonId);
        const resolvedSeasonId = String(context.seasonId);
        const schedule = repository.scheduleExists(leagueId, resolvedSeasonId)
            ? repository.loadSchedule(leagueId, resolvedSeasonId)
            : null;
        const teams = new Map(context.teams.map(team => [team.teamId, team]));
        const playersById = new Map(repository.loadPlayers(leagueId).map(player => [String(player.playerId), player]));
        const membershipsByPlayer = new Map();
        const warnings = [];
        for (const membership of activeMemberships(repository.loadRosterMemberships(leagueId), resolvedSeasonId)) {
            const id = String(membership.playerId || '');
            if (!id) continue;
            const memberships = membershipsByPlayer.get(id) || [];
            memberships.push(membership);
            membershipsByPlayer.set(id, memberships);
        }
        const currentTeamByPlayer = new Map();
        for (const [playerId, memberships] of membershipsByPlayer) {
            if (memberships.length === 1) currentTeamByPlayer.set(playerId, memberships[0].teamId);
            else warnings.push({ type: 'duplicate-current-membership', playerId });
        }

        const totalsByPlayer = new Map();
        const logsByPlayer = new Map();
        function ensurePlayer(playerId) {
            if (!totalsByPlayer.has(playerId)) totalsByPlayer.set(playerId, emptyTotals());
            if (!logsByPlayer.has(playerId)) logsByPlayer.set(playerId, []);
            return totalsByPlayer.get(playerId);
        }
        for (const [playerId, memberships] of membershipsByPlayer) {
            if (memberships.length === 1 && playersById.has(playerId)) ensurePlayer(playerId);
        }

        const scopeRecords = publishedOnly && scope==='REGULAR_SEASON' && schedule?.statsPublication?.snapshots ? schedule.statsPublication.snapshots : submissions.records();
        const eligible = scope==='REGULAR_SEASON' ? {games:scopeRecords.filter(record=>(publishedOnly ? publishedRegularGame : officialRegularGame)(record,{leagueId,seasonId:resolvedSeasonId,schedule}))} : require('./stat-scope').officialScopeGames(scopeRecords,{repository,leagueId,seasonId:resolvedSeasonId,schedule,publishedOnly,scope});
        for (const record of eligible.games) {
            const game = record.game || {};

            const gameTeamIds = [String(game.team1Id || ''), String(game.team2Id || '')];
            const seen = new Map();
            const duplicates = new Set();
            const gameWarnings = [];
            function addGameRow(source, dnp) {
                const playerId = String(source?.playerId || '');
                const teamId = String(source?.teamId || '');
                if (!playerId) { gameWarnings.push({ type: 'missing-player-id', gameId: game.gameId }); return; }
                if (String(source.gameId || '') !== String(game.gameId || '')) { gameWarnings.push({ type: 'game-id-mismatch', gameId: game.gameId, playerId }); return; }
                if (!gameTeamIds.includes(teamId)) { gameWarnings.push({ type: 'invalid-game-team', gameId: game.gameId, playerId }); return; }
                if (!playersById.has(playerId)) { gameWarnings.push({ type: 'unknown-player-id', gameId: game.gameId, playerId }); return; }
                if (!dnp) {
                    // Finalized box scores store stats flat on the row; older fixtures nest them under `stats`.
                    const raw = source.stats || source;
                    const stats = {
                        MIN: numericValue(raw.MIN), PTS: numericValue(raw.PTS, true), REB: numericValue(raw.REB, true),
                        AST: numericValue(raw.AST, true), STL: numericValue(raw.STL, true), BLK: numericValue(raw.BLK, true),
                        TO: numericValue(raw.TO ?? raw.TOV, true), FGM: numericValue(raw.FGM, true), FGA: numericValue(raw.FGA, true),
                        '3PM': numericValue(raw['3PM'], true), '3PA': numericValue(raw['3PA'], true),
                        FTM: numericValue(raw.FTM, true), FTA: numericValue(raw.FTA, true),
                        OR: numericValue(raw.OR ?? raw.OREB, true), FLS: numericValue(raw.FLS, true),
                    };
                    if (Object.values(stats).some(value => value === null)
                        || stats.FGM > stats.FGA || stats['3PM'] > stats['3PA'] || stats.FTM > stats.FTA
                        || stats['3PM'] > stats.FGM) {
                        gameWarnings.push({ type: 'invalid-player-stat-row', gameId: game.gameId, playerId });
                        return;
                    }
                    source = { playerId, teamId, gameId: game.gameId, stats };
                }
                if (seen.has(playerId)) {
                    duplicates.add(playerId);
                    gameWarnings.push({ type: 'duplicate-player-game-row', gameId: game.gameId, playerId });
                    return;
                }
                seen.set(playerId, { source, dnp });
            }
            for (const row of record.playerGameStats || []) addGameRow(row, false);
            for (const row of record.dnpPlayers || []) addGameRow(row, true);
            warnings.push(...gameWarnings);

            const scores = game.result?.scores || {};
            const teamNames = {
                [gameTeamIds[0]]: game.team1Name || teams.get(gameTeamIds[0])?.teamName || gameTeamIds[0],
                [gameTeamIds[1]]: game.team2Name || teams.get(gameTeamIds[1])?.teamName || gameTeamIds[1],
            };
            for (const [playerId, entry] of seen) {
                if (duplicates.has(playerId)) continue;
                const { source, dnp } = entry;
                ensurePlayer(playerId);
                const teamId = String(source.teamId), opponentId = gameTeamIds.find(id => id !== teamId);
                const ownScore = numericValue(scores[teamId], true), opponentScore = numericValue(scores[opponentId], true);
                if (ownScore === null || opponentScore === null || ownScore === opponentScore) {
                    warnings.push({ type: 'invalid-game-score', gameId: game.gameId, playerId });
                    continue;
                }
                const log = {
                    gameId: game.gameId,
                    submissionId: game.result.submissionId || null,
                    week: Number(game.weekNumber || game.seriesGameNumber),
                    stage: game.stage || null,
                    date: game.inGameDate || null,
                    teamId,
                    teamName: teamNames[teamId],
                    opponentId,
                    opponent: teamNames[opponentId],
                    result: ownScore > opponentScore ? 'W' : 'L',
                    score: `${ownScore}-${opponentScore}`,
                    MIN: dnp ? null : source.stats.MIN,
                    PTS: dnp ? null : source.stats.PTS,
                    REB: dnp ? null : source.stats.REB,
                    AST: dnp ? null : source.stats.AST,
                    STL: dnp ? null : source.stats.STL,
                    BLK: dnp ? null : source.stats.BLK,
                    TO: dnp ? null : source.stats.TO,
                    FG: dnp ? null : `${source.stats.FGM}-${source.stats.FGA}`,
                    '3PT': dnp ? null : `${source.stats['3PM']}-${source.stats['3PA']}`,
                    FT: dnp ? null : `${source.stats.FTM}-${source.stats.FTA}`,
                    OREB: dnp ? null : source.stats.OR,
                    FLS: dnp ? null : source.stats.FLS,
                    DNP: dnp,
                };
                logsByPlayer.get(playerId)?.push(log);
                if (dnp) continue;
                const total = ensurePlayer(playerId);
                for (const field of TOTAL_FIELDS) total[field] += source.stats[field];
                total.GP = (total.GP || 0) + 1;
            }
        }

        const playerIds = new Set([...playersById.keys(), ...totalsByPlayer.keys(), ...logsByPlayer.keys()]);
        const stats = [...playerIds].map(playerId => {
            const player = playersById.get(playerId) || { playerId, name: 'Unknown player' };
            const totals = totalsByPlayer.get(playerId) || emptyTotals();
            const logs = logsByPlayer.get(playerId) || [];
            const GP = totals.GP || 0;
            const teamId = currentTeamByPlayer.get(playerId) || null;
            const team = teamId ? teams.get(teamId) : null;
            return {
                playerId,
                name: player.name || 'Unknown player',
                teamId,
                teamName: team?.teamName || null,
                conference: team?.conference || null,
                GP,
                MIN: totals.MIN,
                PTS: totals.PTS,
                REB: totals.REB,
                AST: totals.AST,
                STL: totals.STL,
                BLK: totals.BLK,
                TO: totals.TO,
                TOV: GP ? totals.TO / GP : 0,
                FGM: totals.FGM,
                FGA: totals.FGA,
                '3PM': totals['3PM'],
                '3PA': totals['3PA'],
                FTM: totals.FTM,
                FTA: totals.FTA,
                OR: totals.OR,
                OREB: totals.OR,
                FLS: totals.FLS,
                MPG: GP ? totals.MIN / GP : 0,
                PPG: GP ? totals.PTS / GP : 0,
                RPG: GP ? totals.REB / GP : 0,
                APG: GP ? totals.AST / GP : 0,
                SPG: GP ? totals.STL / GP : 0,
                BPG: GP ? totals.BLK / GP : 0,
                FGPercent: percentage(totals.FGM, totals.FGA),
                threePPercent: percentage(totals['3PM'], totals['3PA']),
                FTPercent: percentage(totals.FTM, totals.FTA),
                lastGame: logs.at(-1) || null,
            };
        });
        stats.sort((left, right) => left.name.localeCompare(right.name) || left.playerId.localeCompare(right.playerId));
        for (const logs of logsByPlayer.values()) logs.sort((left, right) => left.week - right.week
            || String(left.date || '').localeCompare(String(right.date || '')) || left.gameId.localeCompare(right.gameId));
        return { leagueId, seasonId: resolvedSeasonId, players: stats, logsByPlayer, warnings, publishedThroughWeek: publishedThroughWeek(schedule) };
    }

    function getSeasonSnapshot(leagueId, seasonId) {
        const { leagueId: resolvedLeague, seasonId: resolvedSeason, players, warnings, publishedThroughWeek } = buildSnapshot(leagueId, seasonId);
        return { leagueId: resolvedLeague, seasonId: resolvedSeason, scope, players, warnings, publishedThroughWeek };
    }

    function getPlayerSeasonStats(leagueId, seasonId, playerId) {
        return buildSnapshot(leagueId, seasonId).players.find(player => player.playerId === String(playerId)) || null;
    }

    function getSeasonPlayerStats(leagueId, seasonId) {
        return buildSnapshot(leagueId, seasonId).players;
    }

    function getPlayerGameLog(leagueId, seasonId, playerId) {
        const snapshot = buildSnapshot(leagueId, seasonId);
        return snapshot.logsByPlayer.get(String(playerId)) || [];
    }

    function getPlayerStatsAndGameLog(leagueId, seasonId, playerId) {
        const snapshot = buildSnapshot(leagueId, seasonId), id = String(playerId);
        return {
            stats: snapshot.players.find(player => player.playerId === id) || null,
            games: snapshot.logsByPlayer.get(id) || [],
            warnings: snapshot.warnings,
        };
    }

    function getTeamPlayerStats(leagueId, seasonId, teamId) {
        const context = repository.loadLeague(leagueId, seasonId);
        if (!context.teams.some(team => team.teamId === teamId)) throw new Error(`Unknown team "${teamId}".`);
        return buildSnapshot(leagueId, context.seasonId).players.filter(player => player.teamId === teamId);
    }

    return { getSeasonSnapshot, getSeasonPlayerStats, getPlayerSeasonStats, getPlayerGameLog, getPlayerStatsAndGameLog, getTeamPlayerStats, repository };
}

module.exports = { createPlayerStatsService, TOTAL_FIELDS, percentage };