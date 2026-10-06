const { chromium } = require('playwright');
const fs = require('fs');
const assert = require('node:assert/strict');
(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage(); const calls = [], errors = []; let rejectChannel = false;
        page.on('pageerror', e => errors.push(e.message));
        await page.route('http://admin.test/**', async route => {
            const req = route.request(), url = new URL(req.url());
            if (url.pathname === '/') { await route.fulfill({ contentType: 'text/html', body: fs.readFileSync('web/index.html', 'utf8').replace('<script src="/app.js" defer></script>', '') }); return; }
            if (url.pathname === '/styles.css') { await route.fulfill({ contentType: 'text/css', body: fs.readFileSync('web/styles.css', 'utf8') }); return; }
            if (!url.pathname.startsWith('/api/')) { await route.fulfill({ body: '' }); return; }
            const body = req.method() === 'POST' ? req.postDataJSON() : null; calls.push({ path: url.pathname, method: req.method(), body });
            if (url.pathname.endsWith('/data-issues')) return route.fulfill({ json: { issues: [] } });
            if (url.pathname.endsWith('/audit-log')) return route.fulfill({ json: { auditLog: [] } });
            if (url.pathname.endsWith('/game-threads')) {
                if (body?.action === 'configure' && rejectChannel) return route.fulfill({ status: 400, json: { error: 'Channel unavailable' } });
                return route.fulfill({ json: body ? body.action === 'create' ? { scheduled: 14, week: 1, existing: 0, created: 14, failed: 0 } : {} : { channels: [{ id: 'games', name: 'lb-game-threads' }], gamesChannelId: 'games', week: 1, games: [] } });
            }
            if (url.pathname.endsWith('/game-cleanup')) return route.fulfill({ json: { weeks: [{ week: 1, status: 'ACTIVE', threads: 14, cleaned: 0 }] } });
            if (url.pathname.endsWith('/week')) return route.fulfill({ json: { week: 1, total: 14, final: 0, unresolved: [] } });
            if (url.pathname.endsWith('/operator-test')) return route.fulfill({ json: { ok: true } });
            if (url.pathname.includes('/teams/')) { const id = url.pathname.split('/').pop(); if (id === 'slow') await new Promise(r => setTimeout(r, 150)); return route.fulfill({ json: { team: { teamId: id, teamName: id } } }); }
            await route.fulfill({ status: 404, json: { error: 'Unexpected API' } });
        });
        await page.goto('http://admin.test/');
        await page.evaluate(() => localStorage.setItem('leaguebuddyAdminKey', 'legacy-key'));
        let code = fs.readFileSync('web/app.js', 'utf8').replace(/^initialize\(\);$/m, '').replace(/^refreshStandings\(\);$/m, '').replace(/^setInterval\(.*$/gm, '');
        await page.addScriptTag({ content: code });
        await page.evaluate(() => {
            renderLeagueSite = () => { }; rosterManagerMarkup = t => `<p>${t.teamName}</p>`;
            state.leagueSite = { league: { currentPhase: 'REGULAR_SEASON' } };
            updateAdminPanelVisibility('REGULAR_SEASON', true);
            for (const id of ['first', 'slow', 'latest']) elements.rosterTeamSelect.append(new Option(id, id));
        });
        await page.evaluate(() => updateAdminPanelVisibility('PRESEASON', true));
        for (const id of ['week-advancement-panel', 'game-cleanup-panel', 'game-thread-panel']) assert.equal(await page.locator(`#${id}`).count(), 0);
        assert.equal(await page.locator('#roster-import-panel').isVisible(), true);
        await page.evaluate(() => updateAdminPanelVisibility('REGULAR_SEASON', true));
        for (const id of ['week-advancement-panel', 'game-cleanup-panel', 'game-thread-panel']) assert.equal(await page.locator(`#${id}`).count(), 0);
        assert.equal(await page.locator('#season-start-panel').isVisible(), false);
        await page.locator('#admin-operator').fill('Commissioner');
        assert.equal(await page.evaluate(() => sessionStorage.getItem('leaguebuddyReviewOperator')), 'Commissioner');
        assert.equal(await page.locator('#week-operator, #cleanup-operator').count(), 0);
        await page.locator('#admin-key').fill('test'); await page.locator('#admin-key').press('Enter');
        assert.equal(await page.evaluate(() => sessionStorage.getItem('leaguebuddyAdminKey')), 'test');
        assert.equal(await page.evaluate(() => localStorage.getItem('leaguebuddyAdminKey')), null);
        assert.ok(!calls.some(c => ['/api/league/admin/week', '/api/league/admin/game-cleanup', '/api/league/admin/game-threads'].includes(c.path)), 'Removed website panels must not call their admin APIs');
        const auditHtml = await page.evaluate(() => auditMarkup([{ action: 'player.updated', userId: 'discord-commissioner-id', commissionerUserId: 'discord-commissioner-id', operator: 'Commissioner Name' }]));
        assert.match(auditHtml, /Commissioner Name/);
        assert.match(auditHtml, /discord-commissioner-id/);
        await page.locator('#roster-manager').getByText('first', { exact: true }).waitFor();
        assert.ok(calls.every(c => c.method === 'GET'), 'Unlock must be read-only');
        await page.evaluate(async () => adminRequestJson('/api/operator-test', { method: 'POST', body: JSON.stringify({ value: 1 }) }));
        assert.equal(calls.find(c => c.path.endsWith('/operator-test')).body.operator, 'Commissioner');
        await page.locator('#roster-team-select').selectOption('slow'); await page.locator('#roster-team-select').selectOption('latest');
        await page.locator('#roster-manager').getByText('latest', { exact: true }).waitFor(); await page.waitForTimeout(200);
        assert.equal(await page.locator('#roster-manager').textContent(), 'latest');
        await page.locator('#league-admin').screenshot({ path: '/tmp/lb-admin-simplicity.png' });
        assert.deepEqual(errors, []); console.log('PASS: removed website week/cleanup/thread panels, no requests to removed APIs, Enter unlock, session key, operator audit label, and roster selection/race protection.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
