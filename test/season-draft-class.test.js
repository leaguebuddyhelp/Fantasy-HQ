const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seasonDraftClass } = require('../src/shared/season-draft-class');

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

test('website class list and both prospect endpoints follow the bound season, ignoring old class URLs', t => {
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
        repository.saveLeague('season-test', { seasonNumber: season, currentSeasonId: '1' });
        const list = get('/api/draft-classes'); assert.equal(list.status, 200); assert.equal(list.body.seasonNumber, season);
        for (const board of list.body.boards) {
            assert.equal(board.classes.length, 1); assert.equal(board.classes[0].label, `2k27_CUS0${season}`);
            const result = get(`/api/prospects?board=${board.id}&class=2k27_CUS04`);
            assert.equal(result.status, 200); assert.equal(result.body.draftClass.label, `2k27_CUS0${season}`);
            assert.ok(result.body.prospects.length > 0);
        }
    }
    repository.saveLeague('season-test', { seasonNumber: 5, currentSeasonId: '1' });
    assert.equal(get('/api/draft-classes').status, 404);
    assert.equal(get('/api/prospects?board=big-board').status, 404);
});
