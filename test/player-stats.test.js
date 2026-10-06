const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { createPlayerStatsService } = require('../src/fantasyhq/player-stats-service');

const cleanStats = overrides => ({
    MIN: 24, PTS: 20, REB: 6, AST: 4, STL: 1, BLK: 1, TO: 2,
    FGM: 5, FGA: 10, '3PM': 2, '3PA': 5, FTM: 8, FTA: 10, OR: 1, FLS: 2,
    ...overrides,
});

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-player-stats-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const repository = createFantasyHQRepository({ dataRoot: root });
    const teams = [
        { teamId: 'atl', teamName: 'Atlanta Hawks', abbreviation: 'ATL', conference: 'East' },
        { teamId: 'bos', teamName: 'Boston Celtics', abbreviation: 'BOS', conference: 'East' },
        { teamId: 'chi', teamName: 'Chicago Bulls', abbreviation: 'CHI', conference: 'East' },
    ];
    repository.saveLeague('league-a', { leagueName: 'A', currentPhase: 'REGULAR_SEASON', currentSeasonId: '1', seasonNumber: 1, currentWeek: 3 });
    repository.saveTeams('league-a', teams);
    repository.saveGuildLeagueBinding('guild-a', { leagueId: 'league-a', seasonId: '1' });
    repository.savePlayers('league-a', [
        { playerId: 'traded-player', name: 'Traded Player' },
        { playerId: 'zero-player', name: 'Zero Attempt Player' },
        { playerId: 'no-games', name: 'No Games Player' },
    ]);
    repository.saveRosterMemberships('league-a', [
        { playerId: 'traded-player', teamId: 'bos', seasonId: '1' },
        { playerId: 'zero-player', teamId: 'chi', seasonId: '1' },
        { playerId: 'no-games', teamId: 'atl', seasonId: '1' },
    ]);
    const schedule = {
        leagueId: 'league-a', seasonId: '1', weeks: [
            { week: 1, weekId: 'w1', status: 'COMPLETED', games: [{ team1Id: 'atl', team2Id: 'bos' }] },
            { week: 2, weekId: 'w2', status: 'COMPLETED', games: [{ team1Id: 'bos', team2Id: 'chi' }] },
            { week: 3, weekId: 'w3', status: 'ACTIVE', games: [{ team1Id: 'bos', team2Id: 'chi' }, { team1Id: 'atl', team2Id: 'chi' }] },
        ],
    };
    repository.saveSchedule(schedule);
    const records = [];
    function game({ id, week, team1Id, team2Id, rows = [], dnps = [], scores = {}, overrides = {} }) {
        const game = {
            gameId: id, leagueId: 'league-a', seasonId: '1', weekId: `w${week}`, weekNumber: week,
            team1Id, team2Id, team1Name: teams.find(team => team.teamId === team1Id).teamName,
            team2Name: teams.find(team => team.teamId === team2Id).teamName,
            status: 'FINAL', finalizedAt: `2026-10-0${week}T00:00:00.000Z`, inGameDate: `10/0${week}/2026`,
            result: { submissionId: `sub-${id}`, extractionId: `ext-${id}`, scores: { [team1Id]: 110, [team2Id]: 100 }, ...overrides.result },
            ...overrides.game,
        };
        Object.assign(game.result.scores, scores);
        records.push({
            game,
            submissions: [{ submissionId: `sub-${id}`, status: 'FINAL' }],
            extractions: [{ extractionId: `ext-${id}`, submissionId: `sub-${id}`, status: 'READY_FOR_REVIEW', issues: [] }],
            playerGameStats: rows.map(row => ({ gameId: id, ...row })),
            dnpPlayers: dnps.map(row => ({ gameId: id, ...row })),
        });
        return records.at(-1);
    }
    const first = game({
        id: 'game-1', week: 1, team1Id: 'atl', team2Id: 'bos', scores: { atl: 100, bos: 95 }, rows: [
            { playerId: 'traded-player', teamId: 'atl', stats: cleanStats({ MIN: 20, PTS: 10, REB: 4, AST: 2, STL: 1, BLK: 0, TO: 1, FGM: 1, FGA: 2, '3PM': 0, '3PA': 1, FTM: 8, FTA: 10 }) },
        ]
    });
    game({
        id: 'game-2', week: 2, team1Id: 'bos', team2Id: 'chi', scores: { bos: 99, chi: 100 }, rows: [
            { playerId: 'traded-player', teamId: 'bos', stats: cleanStats({ MIN: 40, PTS: 30, REB: 10, AST: 8, STL: 3, BLK: 2, TO: 5, FGM: 8, FGA: 10, '3PM': 4, '3PA': 5, FTM: 2, FTA: 10 }) },
        ]
    });
    const dnpGame = game({
        id: 'game-3', week: 3, team1Id: 'bos', team2Id: 'chi', scores: { bos: 100, chi: 95 }, dnps: [
            { playerId: 'traded-player', teamId: 'bos' },
        ], rows: [
            { playerId: 'zero-player', teamId: 'chi', stats: cleanStats({ MIN: 1, PTS: 0, REB: 0, AST: 0, STL: 0, BLK: 0, TO: 0, FGM: 0, FGA: 0, '3PM': 0, '3PA': 0, FTM: 0, FTA: 0, OR: 0, FLS: 0 }) },
        ]
    });
    const submissions = { repository, records: () => records };
    const service = createPlayerStatsService({ repository, submissions });
    return { repository, schedule, records, first, dnpGame, service, game };
}

test('official player totals, averages, weighted percentages, DNP and historical/current teams', t => {
    const f = fixture(t), stats = f.service.getPlayerSeasonStats('league-a', '1', 'traded-player');
    assert.deepEqual([stats.GP, stats.MIN, stats.MPG, stats.PTS, stats.PPG, stats.REB, stats.RPG, stats.AST, stats.APG, stats.STL, stats.SPG, stats.BLK, stats.BPG, stats.TOV],
        [2, 60, 30, 40, 20, 14, 7, 10, 5, 4, 2, 2, 1, 3]);
    assert.equal(stats.TO, 6);
    assert.equal(stats.FGM, 9); assert.equal(stats.FGA, 12); assert.equal(stats.FGPercent, 75);
    assert.equal(stats['3PM'], 4); assert.equal(stats['3PA'], 6); assert.ok(Math.abs(stats.threePPercent - (100 * 4 / 6)) < 1e-9);
    assert.equal(stats.FTM, 10); assert.equal(stats.FTA, 20); assert.equal(stats.FTPercent, 50);
    assert.equal(stats.OR, 2); assert.equal(stats.OREB, 2); assert.equal(stats.FLS, 4);
    assert.equal(stats.teamId, 'bos'); assert.equal(stats.teamName, 'Boston Celtics');
    const log = f.service.getPlayerGameLog('league-a', '1', 'traded-player');
    assert.deepEqual(log.map(game => game.week), [1, 2, 3]);
    assert.deepEqual(log.map(game => game.teamId), ['atl', 'bos', 'bos']);
    assert.deepEqual(log.map(game => game.opponentId), ['bos', 'chi', 'chi']);
    assert.deepEqual(log.map(game => game.result), ['W', 'L', 'W']);
    assert.deepEqual(log.map(game => game.DNP), [false, false, true]);
    assert.equal(log[0].score, '100-95'); assert.equal(log[0].date, '10/01/2026'); assert.equal(log[2].PTS, null);
    assert.equal(log[0].FG, '1-2'); assert.equal(log[0]['3PT'], '0-1'); assert.equal(log[0].FT, '8-10');
    assert.deepEqual(f.service.getTeamPlayerStats('league-a', '1', 'bos').map(player => player.playerId), ['traded-player']);
    const team = require('../src/fantasyhq/team-service').createTeamService({ repository: f.repository, playerStatsService: f.service }).getTeam('league-a', '1', 'bos');
    assert.equal(team.roster.find(entry => entry.playerId === 'traded-player').seasonStats.PPG, 20);
});

test('zero-game players are returned safely and percentages are null at zero attempts', t => {
    const f = fixture(t), noGames = f.service.getPlayerSeasonStats('league-a', '1', 'no-games');
    assert.equal(noGames.GP, 0); assert.equal(noGames.PPG, 0); assert.equal(noGames.MPG, 0);
    assert.equal(noGames.FGPercent, null); assert.equal(noGames.threePPercent, null); assert.equal(noGames.FTPercent, null);
    const zero = f.service.getPlayerSeasonStats('league-a', '1', 'zero-player');
    assert.equal(zero.GP, 1); assert.equal(zero.FGPercent, null); assert.equal(zero.threePPercent, null); assert.equal(zero.FTPercent, null);
    assert.ok(JSON.stringify(zero).indexOf('NaN') < 0); assert.ok(JSON.stringify(zero).indexOf('Infinity') < 0);
});

test('only official games count and corrected source games immediately rebuild stats', t => {
    const f = fixture(t);
    f.records.push({ ...structuredClone(f.first), game: { ...f.first.game, gameId: 'pending', status: 'SCHEDULED', finalizedAt: null } });
    f.records.push({ ...structuredClone(f.first), game: { ...f.first.game, gameId: 'flagged', result: { ...f.first.game.result, extractionId: 'flagged-ext' } }, extractions: [{ extractionId: 'flagged-ext', submissionId: 'sub-game-1', status: 'REVIEW_REQUIRED', issues: [{ code: 'CONFIDENCE' }] }] });
    f.records.push({ ...structuredClone(f.first), game: { ...f.first.game, gameId: 'wrong-season', seasonId: '2' } });
    let stats = f.service.getPlayerSeasonStats('league-a', '1', 'traded-player');
    assert.equal(stats.GP, 2);
    f.first.game.result.scores.atl = 80;
    f.first.playerGameStats[0].stats.PTS = 24;
    stats = f.service.getPlayerSeasonStats('league-a', '1', 'traded-player');
    assert.equal(stats.GP, 2); assert.equal(stats.PTS, 54); assert.equal(stats.PPG, 27);
    assert.equal(f.service.getPlayerGameLog('league-a', '1', 'traded-player')[0].result, 'L');
});

test('league scoping prevents another league result from contributing', t => {
    const f = fixture(t);
    const foreign = structuredClone(f.first); foreign.game.leagueId = 'league-b'; foreign.playerGameStats[0].stats.PTS = 500;
    f.records.push(foreign);
    assert.equal(f.service.getPlayerSeasonStats('league-a', '1', 'traded-player').PTS, 40);
});

test('malformed stat rows and duplicate player-game rows are excluded with warnings', t => {
    const f = fixture(t);
    const invalid = f.game({
        id: 'invalid', week: 3, team1Id: 'atl', team2Id: 'chi', rows: [
            { playerId: 'traded-player', teamId: 'atl', stats: cleanStats({ MIN: -2 }) },
            { playerId: '', teamId: 'atl', stats: cleanStats() },
            { playerId: 'traded-player', teamId: '', stats: cleanStats() },
            { playerId: 'traded-player', teamId: 'atl', stats: cleanStats({ FGM: 12, FGA: 10 }) },
            { gameId: 'wrong-game-id', playerId: 'traded-player', teamId: 'atl', stats: cleanStats() },
        ]
    });
    const duplicate = f.game({
        id: 'duplicate', week: 3, team1Id: 'atl', team2Id: 'chi', rows: [
            { playerId: 'traded-player', teamId: 'atl', stats: cleanStats() },
            { playerId: 'traded-player', teamId: 'atl', stats: cleanStats({ PTS: 45 }) },
        ]
    });
    duplicate.playerGameStats[1].gameId = 'duplicate';
    const snapshot = f.service.getSeasonSnapshot('league-a', '1');
    assert.equal(snapshot.players.find(player => player.playerId === 'traded-player').GP, 2);
    assert.ok(snapshot.warnings.some(warning => warning.type === 'invalid-player-stat-row' && warning.gameId === invalid.game.gameId));
    assert.ok(snapshot.warnings.some(warning => warning.type === 'missing-player-id' && warning.gameId === invalid.game.gameId));
    assert.ok(snapshot.warnings.some(warning => warning.type === 'invalid-game-team' && warning.gameId === invalid.game.gameId));
    assert.ok(snapshot.warnings.some(warning => warning.type === 'game-id-mismatch' && warning.gameId === invalid.game.gameId));
    assert.ok(snapshot.warnings.some(warning => warning.type === 'duplicate-player-game-row' && warning.gameId === duplicate.game.gameId));
});

test('website stats and game-log endpoints use the bound league season and permanent player ID', t => {
    const f = fixture(t), previousRoot = process.env.FANTASYHQ_DATA_ROOT, previousGuild = process.env.GUILD_ID;
    for (const [index, source] of f.records.entries()) {
        const record = structuredClone(source), gameId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
        record.game.gameId = gameId;
        for (const row of [...record.playerGameStats, ...record.dnpPlayers]) row.gameId = gameId;
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
    const stats = get('/api/league/stats');
    const player = stats.players.find(entry => entry.playerId === 'traded-player');
    assert.equal(stats.leagueId, 'league-a');
    assert.equal(player.teamId, 'bos');
    assert.equal(player.PPG, 20);
    const log = get('/api/league/stats/players/traded-player/games');
    assert.equal(log.player.playerId, 'traded-player');
    assert.deepEqual(log.games.map(game => game.teamId), ['atl', 'bos', 'bos']);
    assert.deepEqual(log.games.map(game => game.DNP), [false, false, true]);
});