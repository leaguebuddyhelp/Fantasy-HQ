const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seasonDraftClass, seasonDraftBoard } = require('../src/shared/season-draft-class');

test('each installed Big Board and Early Top Ten maps exclusively to its numbered season', () => {
    const files = fs.readdirSync('draft_class');
    for (let season = 1; season <= 4; season++) {
        for (const board of ['Big Board', 'Early Top Ten']) {
            assert.equal(seasonDraftClass(files, season, board), `2k27_CUS0${season} - ${board}.json`);
        }
    }
    assert.throws(() => seasonDraftClass(files, 5), /CUS05/);
    assert.throws(() => seasonDraftClass(files, 0), /invalid/);
    assert.throws(() => seasonDraftClass([...files, 'other_CUS01 - Big Board.json'], 1), /requires one/);
});

test('website boards follow every season and phase, rejecting closed boards and ignoring old class URLs', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-season-web-'));
    const prior = { FANTASYHQ_DATA_ROOT: process.env.FANTASYHQ_DATA_ROOT, GUILD_ID: process.env.GUILD_ID };
    process.env.FANTASYHQ_DATA_ROOT = root; process.env.GUILD_ID = 'season-guild';
    t.after(() => { for (const [key, value] of Object.entries(prior)) { if (value == null) delete process.env[key]; else process.env[key] = value; } fs.rmSync(root, { recursive: true, force: true }); });
    const repository = require('../src/fantasyhq/repository').createFantasyHQRepository();
    repository.saveTeams('season-test', []);
    repository.saveGuildLeagueBinding('season-guild', { leagueId: 'season-test', seasonId: '1' });
    const { requestHandler } = require('../src/web');
    function get(url) {
        let status, body;
        requestHandler({ url, method: 'GET', headers: {} }, { writeHead(code) { status = code; }, end(data) { body = JSON.parse(data); } });
        return { status, body };
    }
    for (let season = 1; season <= 4; season++) {
        for (const phase of ['SETUP', 'PRESEASON', 'REGULAR_SEASON', 'PLAYOFFS', 'OFFSEASON', 'DRAFT', 'FREE_AGENCY']) {
            repository.saveLeague('season-test', { seasonNumber: season, currentSeasonId: '1', currentPhase: phase });
            const active = ['SETUP', 'PRESEASON'].includes(phase) ? 'top-ten' : 'big-board';
            const list = get('/api/draft-classes');
            assert.equal(list.status, 200); assert.equal(list.body.seasonNumber, season);
            assert.equal(list.body.activeBoard, active); assert.equal(list.body.boards.length, 1);
            const board = list.body.boards[0];
            assert.equal(board.id, active); assert.equal(board.classes[0].label, `2k27_CUS0${season}`);
            for (const url of [`/api/prospects?board=${active}&class=2k27_CUS04`, '/api/prospects']) {
                const result = get(url);
                assert.equal(result.status, 200); assert.equal(result.body.draftClass.label, `2k27_CUS0${season}`);
                assert.ok(result.body.prospects.length > 0);
                if (active === 'top-ten') assert.equal(result.body.prospects.length, 10);
            }
            assert.equal(get(`/api/prospects?board=${active === 'top-ten' ? 'big-board' : 'top-ten'}`).status, 403);
        }
    }
    repository.saveLeague('season-test', { seasonNumber: 5, currentSeasonId: '1' });
    assert.equal(get('/api/draft-classes').status, 404);
    assert.equal(get('/api/prospects?board=big-board').status, 404);
});


test('scouting board fails closed for an unknown phase', () => {
    assert.throws(() => seasonDraftBoard('UNKNOWN'), /phase is invalid/);
    assert.throws(() => seasonDraftBoard(undefined), /phase is invalid/);
});
