const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

test('website replaces draft class tabs with a season label and ignores stale class links', async t => {
    const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://draft.test/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: fs.readFileSync('web/index.html', 'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '') });
        if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: fs.readFileSync('web/styles.css', 'utf8') });
        if (url.pathname === '/api/prospects') { requests.push(url); return route.fulfill({ json: { prospects: [] } }); }
        return route.fulfill({ status: 404, body: '' });
    });
    await page.goto('http://draft.test/?class=2k27_CUS04');
    await page.addScriptTag({ content: fs.readFileSync('web/app.js', 'utf8').replace(/^initialize\(\);$/m, '').replace(/^refreshStandings\(\);$/m, '').replace(/^setInterval\(.*$/gm, '') });
    for (const season of [1, 2, 3, 4]) {
      for (const board of ['top-ten', 'big-board']) {
        const before = requests.length;
        await page.evaluate(async ({season, board}) => {
            state.leagueSite = { league: { seasonNumber: season } };
            state.boards = [{ id: board, classes: [{ label: `2k27_CUS0${season}`, file: `2k27_CUS0${season} - ${board === 'top-ten' ? 'Early Top Ten' : 'Big Board'}.json` }] }];
            await loadDraftClass('2k27_CUS04');
        }, {season, board});
        assert.equal(await page.locator('#class-switcher button').count(), 0);
        assert.equal(await page.locator('#class-switcher').textContent(), `Season ${season} · CUS0${season}`);
        assert.equal(await page.locator('#top-ten-class-label').textContent(), `2k27_CUS0${season}`);
        assert.equal(await page.locator('#big-board-class-label').textContent(), `2k27_CUS0${season}`);
        assert.equal(await page.locator('#early-top-ten').isVisible(), board === 'top-ten');
        assert.equal(await page.locator('#big-board').isVisible(), board === 'big-board');
        assert.equal(await page.locator('#draft-stats').isVisible(), board === 'big-board');
        assert.equal(await page.locator('a[href="#early-top-ten"]').isVisible(), false); // dropdown stays collapsed
        assert.equal(await page.locator('a[href="#early-top-ten"]').evaluate(el => el.hidden), board !== 'top-ten');
        assert.equal(await page.locator('a[href="#big-board"]').evaluate(el => el.hidden), board !== 'big-board');
        assert.equal(requests.length - before, 1);
        assert.equal(requests.at(-1).searchParams.get('board'), board);
        assert.ok(requests.at(-1).searchParams.get('class').startsWith(`2k27_CUS0${season}`));
        assert.equal(new URL(page.url()).searchParams.has('class'), false);
      }
    }
    await page.route('http://draft.test/api/league/admin/rosters/correction-preview', route => route.fulfill({ json: { token: 'preview-token', action: 'move', reason: 'Correct imported assignment', details: { playerId: 'p', toTeamId: 'b' } } }));
    const dialogs = [];
    page.on('dialog', async dialog => {
        dialogs.push(dialog.type());
        await dialog.accept(dialog.type() === 'prompt' ? 'Correct imported assignment' : undefined);
    });
    const correction = await page.evaluate(async () => {
        state.leagueSite = { league: { currentPhase: 'PLAYOFFS' } };
        state.adminKey = 'isolated-browser-test-key';
        return rosterCorrection('move', { playerId: 'p', toTeamId: 'b' });
    });
    assert.deepEqual(correction, { correctionToken: 'preview-token' });
    assert.deepEqual(dialogs, ['prompt', 'confirm']);
    assert.deepEqual(errors, []);
});
