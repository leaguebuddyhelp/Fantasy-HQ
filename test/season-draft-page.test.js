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
        await page.evaluate(async season => {
            state.leagueSite = { league: { seasonNumber: season } };
            state.boards = ['top-ten', 'big-board'].map(id => ({ id, classes: [{ label: `2k27_CUS0${season}`, file: `2k27_CUS0${season} - ${id === 'top-ten' ? 'Early Top Ten' : 'Big Board'}.json` }] }));
            await loadDraftClass('2k27_CUS04');
        }, season);
        assert.equal(await page.locator('#class-switcher button').count(), 0);
        assert.equal(await page.locator('#class-switcher').textContent(), `Season ${season} · CUS0${season}`);
        assert.equal(await page.locator('#top-ten-class-label').textContent(), `2k27_CUS0${season}`);
        assert.equal(await page.locator('#big-board-class-label').textContent(), `2k27_CUS0${season}`);
        assert.ok(requests.slice(-2).every(url => url.searchParams.get('class').startsWith(`2k27_CUS0${season}`)));
        assert.equal(new URL(page.url()).searchParams.has('class'), false);
    }
    assert.deepEqual(errors, []);
});
