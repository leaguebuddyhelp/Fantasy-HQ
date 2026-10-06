const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { createScoutingService } = require('../src/fantasyhq/scouting-service');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-scouting-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dataRoot = path.join(root, 'data'), draftClassDir = path.join(root, 'draft_class');
    fs.mkdirSync(draftClassDir, { recursive: true });
    const prospect = boardNumber => ({ board_number: boardNumber, name: boardNumber === 1 ? 'Léandre Charbonneau' : `Prospect ${boardNumber}`, position_1: boardNumber === 1 ? 'PG' : boardNumber === 2 ? 'PF' : 'SF', position_2: boardNumber === 1 ? 'SG' : boardNumber === 2 ? 'C' : 'SG', overall: 80 + boardNumber, potential: 90 + boardNumber, 'draft score': 88 + boardNumber });
    for (const [season, value] of [[1, 10], [2, 20]]) {
        const board = Object.fromEntries(Array.from({ length: 25 }, (_, index) => {
            const boardNumber = index + 1;
            const player = prospect(boardNumber);
            return [String(boardNumber), boardNumber === 1 ? { ...player, overall: value, potential: value + 10, 'draft score': value + 20 } : player];
        }));
        fs.writeFileSync(path.join(draftClassDir, `2k27_CUS${String(season).padStart(2, '0')} - Big Board.json`), JSON.stringify(board));
    }
    const repository = createFantasyHQRepository({ dataRoot });
    const teams = ['East', 'West'].flatMap(conference => Array.from({ length: 15 }, (_, index) => ({ teamId: `${conference}-${index}`, teamName: `${conference} ${index}`, abbreviation: `${conference[0]}${index}`, conference })));
    repository.saveLeague('league', { currentPhase: 'REGULAR_SEASON', currentSeasonId: '1', seasonNumber: 1, currentWeek: 1 });
    repository.saveTeams('league', teams);
    repository.saveGuildLeagueBinding('guild', { leagueId: 'league', seasonId: '1' });
    repository.saveSettings('league', { discordChannels: { scouting: 'scouting-hub' } });
    const schedule = { leagueId: 'league', seasonId: '1', weeks: [1, 2].map(week => ({ week, weekId: `league:1:week:${week}`, status: week === 1 ? 'ACTIVE' : 'UPCOMING', games: [], byes: [] })) };
    repository.saveSchedule(schedule);
    return { repository, draftClassDir, schedule, service: createScoutingService({ repository, draftClassDir }) };
}

test('season number selects matching board and prospect autocomplete narrows by player name', t => {
    const f = fixture(t);
    assert.equal(f.service.inspect('guild', 'coach-a', 1).prospect['draft score'], 30);
    assert.equal(f.service.scoutingHubChannelId('guild'), 'scouting-hub');
    assert.deepEqual(f.service.prospects('guild', 'leandre'), [{ name: '#1 Léandre Charbonneau', value: '1' }]);
    assert.deepEqual(f.service.prospects('guild', '', 'PF'), [{ name: '#2 Prospect 2', value: '2' }]);
    assert.deepEqual(f.service.prospects('guild', 'leandre', 'PF'), []);
    f.repository.saveLeague('league', { seasonNumber: 2, currentSeasonId: '2', currentWeek: 1 });
    f.repository.saveGuildLeagueBinding('guild', { leagueId: 'league', seasonId: '2' });
    const seasonTwo = { ...f.schedule, seasonId: '2', weeks: f.schedule.weeks.map(week => ({ ...week, weekId: `league:2:week:${week.week}` })) };
    f.repository.saveSchedule(seasonTwo);
    assert.equal(f.service.inspect('guild', 'coach-a', 1).prospect['draft score'], 40);
    assert.equal(f.service.inspect('guild', 'coach-a', 1).prospect.overall, 20);
});

test('each coach gets 60 weekly points and each prospect reveals draft grade, OVR, potential for 10 points each', t => {
    const f = fixture(t);
    assert.equal(f.service.inspect('guild', 'coach-a', 1).remaining, 60);
    const draftGrade = f.service.scout('guild', 'coach-a', 1);
    assert.equal(draftGrade.remaining, 50);
    assert.deepEqual(draftGrade.reveals.map(reveal => reveal.unlocked), [true, false, false]);
    const overall = f.service.scout('guild', 'coach-a', 1);
    assert.equal(overall.remaining, 40);
    assert.deepEqual(overall.reveals.map(reveal => reveal.unlocked), [true, true, false]);
    const potential = f.service.scout('guild', 'coach-a', 1);
    assert.equal(potential.remaining, 30);
    assert.deepEqual(potential.reveals.map(reveal => reveal.unlocked), [true, true, true]);
    assert.throws(() => f.service.scout('guild', 'coach-a', 1), /already unlocked/);
    assert.throws(() => f.service.scout('guild', 'coach-b', 1, 'PF'), /does not match/);
    assert.equal(f.service.inspect('guild', 'coach-b', 1).remaining, 60);
    assert.deepEqual(f.service.inspect('guild', 'coach-b', 1).reveals.map(reveal => reveal.unlocked), [false, false, false]);
    const restored = createScoutingService({ repository: f.repository, draftClassDir: f.draftClassDir });
    assert.equal(restored.inspect('guild', 'coach-a', 1).remaining, 30);
});

test('Big Board returns ten prospects per page with coach-private unlocks', t => {
    const f = fixture(t);
    f.service.scout('guild', 'coach-a', 1);
    const first = f.service.boardPage('guild', 'coach-a');
    assert.equal(first.total, 25);
    assert.equal(first.totalPages, 3);
    assert.equal(first.prospects.length, 10);
    assert.equal(first.prospects[0].prospect.board_number, 1);
    assert.deepEqual(first.prospects[0].reveals.map(reveal => reveal.unlocked), [true, false, false]);
    assert.deepEqual(f.service.boardPage('guild', 'coach-b').prospects[0].reveals.map(reveal => reveal.unlocked), [false, false, false]);
    const last = f.service.boardPage('guild', 'coach-a', 2);
    assert.equal(last.prospects.length, 5);
    assert.equal(last.prospects[0].prospect.board_number, 21);
    assert.equal(f.service.boardPage('guild', 'coach-a', 99).page, 2);
});

test('scouting budget resets on league week advancement and refuses inactive leagues', t => {
    const f = fixture(t);
    f.service.scout('guild', 'coach-a', 1);
    f.repository.saveLeague('league', { currentWeek: 2 });
    f.repository.saveSchedule({ ...f.schedule, weeks: f.schedule.weeks.map(week => ({ ...week, status: week.week === 2 ? 'ACTIVE' : 'COMPLETED' })) });
    assert.equal(f.service.inspect('guild', 'coach-a', 1).remaining, 60);
    f.repository.saveLeague('league', { currentPhase: 'PRESEASON' });
    const board = f.service.inspect('guild', 'coach-a', 1);
    assert.equal(board.scoutingAvailable, false);
    assert.equal(board.remaining, null);
    assert.equal(f.service.boardPage('guild', 'coach-a').prospects.length, 10);
    assert.throws(() => f.service.scout('guild', 'coach-a', 1), /active regular-season week/);
});