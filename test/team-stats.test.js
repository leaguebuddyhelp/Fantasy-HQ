const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { createStandingsService } = require('../src/fantasyhq/standings-service');
const { createTeamStatsService } = require('../src/fantasyhq/team-stats-service');

function teamTotals(overrides = {}) {
    return {
        MIN: 240, PTS: 110, REB: 40, AST: 20, STL: 8, BLK: 4, TO: 10, FGM: 40, FGA: 80,
        '3PM': 10, '3PA': 30, FTM: 20, FTA: 25, OR: 10, FLS: 15, ...overrides,
    };
}

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-team-stats-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const repository = createFantasyHQRepository({ dataRoot: root });
    const teams = [
        { teamId: 'atl', teamName: 'Atlanta Hawks', abbreviation: 'ATL', conference: 'East' },
        { teamId: 'bos', teamName: 'Boston Celtics', abbreviation: 'BOS', conference: 'East' },
        { teamId: 'chi', teamName: 'Chicago Bulls', abbreviation: 'CHI', conference: 'East' },
        { teamId: 'den', teamName: 'Denver Nuggets', abbreviation: 'DEN', conference: 'West' },
    ];
    repository.saveLeague('league-a', { currentPhase: 'REGULAR_SEASON', currentSeasonId: '1', currentWeek: 3 });
    repository.saveTeams('league-a', teams);
    repository.saveGuildLeagueBinding('guild-a', { leagueId: 'league-a', seasonId: '1' });
    const schedule = {
        leagueId: 'league-a', seasonId: '1', weeks: [
            { week: 1, weekId: 'week-1', status: 'COMPLETED', games: [{ team1Id: 'atl', team2Id: 'bos' }] },
            { week: 2, weekId: 'week-2', status: 'COMPLETED', games: [{ team1Id: 'atl', team2Id: 'chi' }] },
            { week: 3, weekId: 'week-3', status: 'ACTIVE', games: [{ team1Id: 'bos', team2Id: 'den' }] },
        ]
    };
    repository.saveSchedule(schedule);
    const records = [];
    function game(id, week, team1Id, team2Id, score1, score2, stats1 = teamTotals({ PTS: score1 }), stats2 = teamTotals({ PTS: score2 })) {
        const game = {
            gameId: id, leagueId: 'league-a', seasonId: '1', weekId: `week-${week}`, weekNumber: week,
            team1Id, team2Id,
            team1Name: teams.find(team => team.teamId === team1Id).teamName,
            team2Name: teams.find(team => team.teamId === team2Id).teamName,
            status: 'FINAL', finalizedAt: `2026-10-0${week}T00:00:00.000Z`, inGameDate: `10/0${week}/2026`,
            result: { submissionId: `sub-${id}`, extractionId: `ext-${id}`, scores: { [team1Id]: score1, [team2Id]: score2 }, winnerTeamId: score1 > score2 ? team1Id : team2Id },
        };
        records.push({
            game,
            submissions: [{ submissionId: `sub-${id}`, status: 'FINAL' }],
            extractions: [{ extractionId: `ext-${id}`, submissionId: `sub-${id}`, status: 'READY_FOR_REVIEW', issues: [] }],
            teamGameStats: [
                { gameId: id, teamId: team1Id, ...stats1 },
                { gameId: id, teamId: team2Id, ...stats2 },
            ],
        });
        return records.at(-1);
    }
    const first = game('game-1', 1, 'atl', 'bos', 110, 100, teamTotals({ PTS: 110, REB: 40, AST: 20, STL: 8, BLK: 4, TO: 10, FGM: 40, FGA: 80, '3PM': 10, '3PA': 30, FTM: 20, FTA: 25, OR: 10, FLS: 15 }));
    game('game-2', 2, 'atl', 'chi', 120, 130, teamTotals({ PTS: 120, REB: 50, AST: 30, STL: 10, BLK: 6, TO: 14, FGM: 36, FGA: 40, '3PM': 20, '3PA': 40, FTM: 10, FTA: 10, OR: 12, FLS: 18 }));
    const submissions = { repository, records: () => records };
    const standingsService = createStandingsService({ repository, submissions });
    const statsService = createTeamStatsService({ repository, submissions, standingsService });
    return { repository, schedule, records, first, submissions, standingsService, statsService, game };
}

test('team stats derive official records and box-score averages; standings agree', t => {
    const f = fixture(t), atl = f.statsService.getTeamSeasonStats('league-a', '1', 'atl');
    assert.deepEqual([atl.GP, atl.W, atl.L, atl.PCT, atl.PF, atl.PA, atl.DIFF], [2, 1, 1, 0.5, 230, 230, 0]);
    assert.equal(atl.PTS, 230); assert.equal(atl.PTS_ALLOWED, 230);
    assert.deepEqual([atl.PPG, atl.OPP_PPG, atl.TOTAL_DIFF, atl.AVG_DIFF], [115, 115, 0, 0]);
    assert.deepEqual([atl.RPG, atl.APG, atl.SPG, atl.BPG, atl.TOV], [45, 25, 9, 5, 12]);
    assert.equal(atl.FGM, 76); assert.equal(atl.FGA, 120); assert.ok(Math.abs(atl.FGPercent - 100 * 76 / 120) < 1e-9);
    assert.equal(atl['3PM'], 30); assert.equal(atl['3PA'], 70); assert.ok(Math.abs(atl.threePPercent - 100 * 30 / 70) < 1e-9);
    assert.equal(atl.FTM, 30); assert.equal(atl.FTA, 35); assert.ok(Math.abs(atl.FTPercent - 100 * 30 / 35) < 1e-9);
    assert.equal(atl.OREB, 22); assert.equal(atl.OR, 22); assert.equal(atl.FLS, 33);
    const standings = f.standingsService.getStandings('league-a', '1').conferences.East.find(team => team.teamId === 'atl');
    assert.deepEqual([atl.GP, atl.W, atl.L, atl.PCT, atl.PF, atl.PA, atl.DIFF], [standings.GP, standings.W, standings.L, standings.PCT, standings.PF, standings.PA, standings.DIFF]);
    const zero = f.statsService.getTeamSeasonStats('league-a', '1', 'den');
    assert.equal(zero.GP, 0); assert.equal(zero.PPG, 0); assert.equal(zero.FGPercent, null); assert.equal(zero.DIFF, 0);
});

test('team game logs are chronological, preserve historical team/opponent/result and current team scope', t => {
    const f = fixture(t), log = f.statsService.getTeamGameLog('league-a', '1', 'atl');
    assert.deepEqual(log.map(game => game.week), [1, 2]);
    assert.deepEqual(log.map(game => [game.teamId, game.opponentId, game.result, game.score]), [['atl', 'bos', 'W', '110-100'], ['atl', 'chi', 'L', '120-130']]);
    assert.equal(log[0].date, '10/01/2026'); assert.equal(log[0].FG, '40-80'); assert.equal(log[0]['3PT'], '10-30'); assert.equal(log[0].OREB, 10);
});

test('a later player roster move does not change historical team box-score totals', t => {
    const f = fixture(t);
    f.repository.savePlayers('league-a', [{ playerId: 'traded-player', name: 'Traded Player' }]);
    f.repository.saveRosterMemberships('league-a', [{ playerId: 'traded-player', teamId: 'atl', seasonId: '1' }]);
    const before = f.statsService.getTeamSeasonStats('league-a', '1', 'atl');
    f.repository.saveRosterMemberships('league-a', [{ playerId: 'traded-player', teamId: 'bos', seasonId: '1' }]);
    const after = f.statsService.getTeamSeasonStats('league-a', '1', 'atl');
    assert.equal(before.PF, 230);
    assert.equal(after.PF, 230);
    assert.equal(after.GP, 2);
});

test('corrected official game rebuilds team scores, winner, averages and standings', t => {
    const f = fixture(t);
    f.first.game.result.scores.atl = 90;
    f.first.game.result.winnerTeamId = 'bos';
    f.first.teamGameStats[0].PTS = 90;
    assert.equal(f.statsService.getTeamSeasonStats('league-a', '1', 'atl').W, 0);
    f.first.game.result.scores.atl = 121;
    f.first.game.result.winnerTeamId = 'atl';
    f.first.teamGameStats[0].PTS = 121;
    const atl = f.statsService.getTeamSeasonStats('league-a', '1', 'atl');
    const bos = f.statsService.getTeamSeasonStats('league-a', '1', 'bos');
    assert.deepEqual([atl.W, atl.L, atl.PF, atl.PPG], [1, 1, 241, 120.5]);
    assert.deepEqual([bos.W, bos.L, bos.PA], [0, 1, 121]);
    const standings = f.standingsService.getStandings('league-a', '1').conferences.East.find(team => team.teamId === 'atl');
    assert.deepEqual([atl.W, atl.L, atl.PF, atl.PA, atl.DIFF], [standings.W, standings.L, standings.PF, standings.PA, standings.DIFF]);
});

test('wrong league/season, non-final records and malformed/duplicate team rows do not pollute totals', t => {
    const f = fixture(t);
    f.records.push({ ...structuredClone(f.first), game: { ...f.first.game, status: 'SCHEDULED', finalizedAt: null } });
    f.records.push({ ...structuredClone(f.first), game: { ...f.first.game, leagueId: 'league-b' } });
    f.records.push({ ...structuredClone(f.first), game: { ...f.first.game, seasonId: '2' } });
    const bad = f.game('game-bad', 3, 'bos', 'den', 120, 130, teamTotals({ FGM: 90, FGA: 80 }));
    bad.teamGameStats.push({ ...bad.teamGameStats[1] });
    bad.teamGameStats.push({ gameId: bad.game.gameId, teamId: '', ...teamTotals() });
    bad.teamGameStats.push({ gameId: 'wrong-game-id', teamId: 'bos', ...teamTotals() });
    bad.teamGameStats.push({ gameId: bad.game.gameId, teamId: 'den', ...teamTotals({ TO: -1 }) });
    const result = f.statsService.getSeasonSnapshot('league-a', '1');
    const atl = result.teams.find(team => team.teamId === 'atl');
    assert.equal(atl.GP, 2); assert.equal(atl.PF, 230); assert.ok(Math.abs(atl.FGPercent - 100 * 76 / 120) < 1e-9);
    assert.ok(result.warnings.some(warning => warning.type === 'invalid-team-stat-row' && warning.gameId === bad.game.gameId));
    assert.ok(result.warnings.some(warning => warning.type === 'duplicate-team-game-row' && warning.gameId === bad.game.gameId));
    assert.ok(result.warnings.some(warning => warning.type === 'missing-team-id' && warning.gameId === bad.game.gameId));
    assert.ok(result.warnings.some(warning => warning.type === 'game-id-mismatch' && warning.gameId === bad.game.gameId));
    assert.ok(result.warnings.some(warning => warning.type === 'invalid-team-stat-row' && warning.gameId === bad.game.gameId));
});

test('duplicate official scheduled matchups are excluded from both standings and team stats', t => {
    const f = fixture(t), duplicate = structuredClone(f.first);
    duplicate.game.gameId = 'game-duplicate';
    for (const row of duplicate.teamGameStats) row.gameId = duplicate.game.gameId;
    f.records.push(duplicate);
    const atl = f.statsService.getTeamSeasonStats('league-a', '1', 'atl');
    const standings = f.standingsService.getStandings('league-a', '1').conferences.East.find(team => team.teamId === 'atl');
    assert.equal(atl.GP, 1);
    assert.equal(atl.PF, 120);
    assert.deepEqual([atl.GP, atl.W, atl.L, atl.PCT, atl.PF, atl.PA, atl.DIFF], [standings.GP, standings.W, standings.L, standings.PCT, standings.PF, standings.PA, standings.DIFF]);
    assert.equal(f.statsService.getSeasonSnapshot('league-a', '1').warnings.filter(warning => warning.type === 'duplicate-official-game').length, 2);
});

test('website Team Stats endpoints return derived rows and historical team logs for the bound league', t => {
    const f = fixture(t), previousRoot = process.env.FANTASYHQ_DATA_ROOT, previousGuild = process.env.GUILD_ID;
    for (const [index, source] of f.records.entries()) {
        const record = structuredClone(source), gameId = `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
        record.game.gameId = gameId;
        for (const row of record.teamGameStats) row.gameId = gameId;
        const directory = path.join(f.repository.dataRoot, 'game-history', gameId);
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'record.json'), JSON.stringify(record));
    }
    process.env.FANTASYHQ_DATA_ROOT = f.repository.dataRoot;
    process.env.GUILD_ID = 'guild-a';
    t.after(() => {
        if (previousRoot === undefined) delete process.env.FANTASYHQ_DATA_ROOT;
        else process.env.FANTASYHQ_DATA_ROOT = previousRoot;
        if (previousGuild === undefined) delete process.env.GUILD_ID;
        else process.env.GUILD_ID = previousGuild;
    });
    const { requestHandler } = require('../src/web');
    function get(url) {
        let status, payload;
        requestHandler({ url, method: 'GET', headers: {} }, { writeHead: code => { status = code; }, end: body => { payload = JSON.parse(body); } });
        assert.equal(status, 200);
        return payload;
    }
    const snapshot = get('/api/league/team-stats');
    assert.equal(snapshot.leagueId, 'league-a');
    assert.equal(snapshot.teams.find(team => team.teamId === 'atl').PPG, 115);
    const log = get('/api/league/team-stats/atl/games');
    assert.deepEqual(log.games.map(game => game.opponentId), ['bos', 'chi']);
    assert.equal(log.games[0].teamId, 'atl');
    assert.equal(log.team.GP, 2);
});
