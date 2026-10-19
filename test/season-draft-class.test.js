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
    assert.equal(seasonDraftClass(files, 5), '2k27_CUS05 - Big Board.json');
    assert.throws(() => seasonDraftClass(files, 5, 'Early Top Ten'), /CUS05/);
    assert.equal(seasonDraftClass(files, 6), '2k27_CUS06 - Big Board.json');
    assert.throws(() => seasonDraftClass(files, 7), /CUS07/);
    assert.throws(() => seasonDraftClass(files, 0), /invalid/);
    assert.throws(() => seasonDraftClass([...files, 'other_CUS01 - Big Board.json'], 1), /requires one/);
});

test('website boards follow every season and phase, rejecting closed boards and ignoring old class URLs', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-season-web-'));
    const prior = { FANTASYHQ_DATA_ROOT: process.env.FANTASYHQ_DATA_ROOT, GUILD_ID: process.env.GUILD_ID, WEBSITE_ADMIN_KEY: process.env.WEBSITE_ADMIN_KEY, WEBSITE_ADMIN_KEYS: process.env.WEBSITE_ADMIN_KEYS };
    process.env.FANTASYHQ_DATA_ROOT = root; process.env.GUILD_ID = 'season-guild';
    t.after(() => { for (const [key, value] of Object.entries(prior)) { if (value == null) delete process.env[key]; else process.env[key] = value; } fs.rmSync(root, { recursive: true, force: true }); });
    const repository = require('../src/fantasyhq/repository').createFantasyHQRepository();
    repository.saveTeams('season-test', []);
    repository.saveGuildLeagueBinding('season-guild', { leagueId: 'season-test', seasonId: '1' });
    const { requestHandler } = require('../src/web');
    function get(url, headers = {}) {
        let status, body;
        requestHandler({ url, method: 'GET', headers }, { writeHead(code) { status = code; }, end(data) { body = JSON.parse(data); } });
        return { status, body };
    }
    for (let season = 1; season <= 4; season++) {
        for (const phase of ['SETUP', 'PRESEASON', 'REGULAR_SEASON', 'PLAYOFFS', 'OFFSEASON', 'DRAFT', 'FREE_AGENCY']) {
            repository.saveLeague('season-test', { seasonNumber: season, currentSeasonId: '1', currentPhase: phase });
            const active = ['SETUP', 'PRESEASON'].includes(phase) ? 'top-ten' : 'big-board';
            const list = get('/api/draft-classes');
            assert.equal(list.status, 200); assert.equal(list.body.seasonNumber, season);
            assert.equal(list.body.prospectStatsAvailable, ['OFFSEASON', 'DRAFT'].includes(phase));
            assert.equal(list.body.activeBoard, active); assert.equal(list.body.boards.length, 1);
            const board = list.body.boards[0];
            assert.equal(board.id, active); assert.equal(board.classes[0].label, `2k27_CUS0${season}`);
            for (const url of [`/api/prospects?board=${active}&class=2k27_CUS04`, '/api/prospects']) {
                const result = get(url);
                assert.equal(result.status, 200); assert.equal(result.body.draftClass.label, `2k27_CUS0${season}`);
                assert.ok(result.body.prospects.length > 0);
                assert.equal(result.body.prospectStatsAvailable, ['OFFSEASON', 'DRAFT'].includes(phase));
                const original = Object.values(JSON.parse(fs.readFileSync(path.join('draft_class', result.body.draftClass.file), 'utf8')));
                for (const prospect of result.body.prospects) {
                    const raw = original.find(p => p.name === prospect.name);
                    for (const field of ['pts', 'rbs', 'ast', 'stls', 'blks']) {
                        if (result.body.prospectStatsAvailable) assert.equal(prospect[field], raw[field]);
                        else assert.equal(Object.hasOwn(prospect, field), false);
                    }
                }
                if (active === 'top-ten') assert.equal(result.body.prospects.length, 10);
            }
            assert.equal(get(`/api/prospects?board=${active === 'top-ten' ? 'big-board' : 'top-ten'}`).status, 403);
        }
    }
    repository.saveLeague('season-test', { seasonNumber: 1, currentSeasonId: '1', currentPhase: 'PRESEASON', commissionerUserId: 'commish' });
    process.env.WEBSITE_ADMIN_KEY = 'isolated-key'; delete process.env.WEBSITE_ADMIN_KEYS;
    const key = { 'x-leaguebuddy-admin-key': 'isolated-key' };
    assert.equal(get('/api/league/admin/session').status,403);
    assert.equal(get('/api/league/admin/session',{'x-leaguebuddy-admin-key':'wrong'}).status,403);
    assert.equal(get('/api/league/admin/session',key).body.authenticated,true);
    const unlocked = get('/api/draft-classes', key);
    assert.equal(unlocked.body.canBrowseAll, true);
    assert.equal(unlocked.body.boards.find(b=>b.id==='big-board').classes.length, 6);
    const fifth = get('/api/prospects?board=big-board&class=2k27_CUS05',key);
    assert.equal(fifth.status,200);assert.equal(fifth.body.prospects.length,75);
    assert.equal(fifth.body.prospectStatsAvailable,false);
    assert.ok(fifth.body.prospects.every(p => !['pts','rbs','ast','stls','blks'].some(field => Object.hasOwn(p,field))));
    assert.equal(fifth.body.prospects.filter(p=>p.image).length,75);
    for (const prospect of fifth.body.prospects) {
      assert.ok(prospect.image.includes('/'+String(prospect.rank).padStart(3,'0')+'-'));
      assert.ok(prospect.image.includes('/'+prospect.position_1+'/'));
    }
    assert.equal(get('/api/prospects?board=big-board&class=../../.env',key).status,404);
    assert.equal(get('/api/prospects?board=big-board&class=2k27_CUS05').status,403);
    assert.equal(get('/api/draft-classes',{'x-leaguebuddy-admin-key':'wrong'}).body.canBrowseAll,false);
    process.env.WEBSITE_ADMIN_KEYS=JSON.stringify({commish:'commissioner-key',assistant:'assistant-key'});
    assert.equal(get('/api/draft-classes',{'x-leaguebuddy-admin-key':'assistant-key'}).body.canBrowseAll,false);
    assert.equal(get('/api/draft-classes',{'x-leaguebuddy-admin-key':'commissioner-key'}).body.canBrowseAll,true);
    delete process.env.WEBSITE_ADMIN_KEYS;
    repository.saveLeague('season-test', { seasonNumber: 7, currentSeasonId: '1', currentPhase:'REGULAR_SEASON' });
    assert.equal(get('/api/draft-classes').status, 404);
    assert.equal(get('/api/prospects?board=big-board').status, 404);
});


test('scouting board fails closed for an unknown phase', () => {
    assert.throws(() => seasonDraftBoard('UNKNOWN'), /phase is invalid/);
    assert.throws(() => seasonDraftBoard(undefined), /phase is invalid/);
});
