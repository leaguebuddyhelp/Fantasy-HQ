const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

test('league Stats page sorts, filters, paginates, and expands the existing game log', async t => {
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const players = Array.from({ length: 32 }, (_, index) => ({
        playerId: `player-${index}`,
        name: index === 0 ? 'Top Scorer' : index === 1 ? 'Top Rebounder' : `Player ${index}`,
        teamId: index % 2 ? 'den' : 'atl',
        teamName: index % 2 ? 'Denver Nuggets' : 'Atlanta Hawks',
        conference: index % 2 ? 'West' : 'East',
        GP: index === 2 ? 0 : 8,
        MPG: 30 + index,
        PPG: index === 0 ? 40 : index === 1 ? 20 : 10,
        RPG: index === 1 ? 15 : index === 0 ? 2 : 5,
        APG: 4, SPG: 1, BPG: 1,
        FGPercent: index === 2 ? null : 45 + index,
        threePPercent: 35,
        FTPercent: 80,
        TOV: 2,
        percentageQualification: { FGPercent: { eligible: index === 1 }, threePPercent: { eligible: index === 0 }, FTPercent: { eligible: false } },
    }));
    await page.route('http://stats.test/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/') {
            const html = fs.readFileSync('web/index.html', 'utf8').replace('<script src="/app.js" defer></script>', '');
            await route.fulfill({ contentType: 'text/html', body: html });
            return;
        }
        if (url.pathname === '/styles.css') {
            await route.fulfill({ contentType: 'text/css', body: fs.readFileSync('web/styles.css', 'utf8') });
            return;
        }
        if (url.pathname === '/api/league/stats') {
            await route.fulfill({ json: { leagueId: 'test', seasonId: '1', players, warnings: [] } });
            return;
        }
        if (url.pathname === '/api/league/stats/players/player-0/games') {
            await route.fulfill({
                json: {
                    player: { playerId: 'player-0', name: 'Top Scorer' }, stats: players[0], games: [
                        { gameId: 'game-1', submissionId: 'submission-1', week: 1, date: '10/01/2026', teamId: 'atl', teamName: 'Atlanta Hawks', opponent: 'Boston Celtics', result: 'W', score: '110-100', MIN: 36, PTS: 28, REB: 5, AST: 7, STL: 1, BLK: 0, TO: 2, FG: '10-20', '3PT': '3-8', FT: '5-6', OREB: 1, FLS: 2, DNP: false },
                        { gameId: 'game-2', submissionId: 'submission-2', week: 2, date: '10/08/2026', teamId: 'atl', teamName: 'Atlanta Hawks', opponent: 'Chicago Bulls', result: 'L', score: '95-100', DNP: true },
                    ], warnings: []
                }
            });
            return;
        }
        await route.fulfill({ status: 404, json: { error: `Unexpected request ${url.pathname}` } });
    });
    await page.goto('http://stats.test/#league-stats');
    let app = fs.readFileSync('web/app.js', 'utf8')
        .replace(/^initialize\(\);$/m, '')
        .replace(/^refreshStandings\(\);$/m, '')
        .replace(/^setInterval\(.*$/gm, '');
    await page.addScriptTag({ content: app });
    await page.evaluate(async () => {
        state.leagueSite = {
            league: { currentPhase: 'REGULAR_SEASON' }, teams: [
                { teamId: 'atl', teamName: 'Atlanta Hawks', conference: 'East' },
                { teamId: 'den', teamName: 'Denver Nuggets', conference: 'West' },
            ]
        };
        renderLeagueFilters();
        await loadLeagueStats();
    });
    const rows = () => page.locator('#league-stats-body > tr:not(.stats-expanded-row)');
    assert.equal(await rows().count(), 30);
    assert.equal(await rows().first().locator('[data-season-stats-player]').textContent(), 'Top Scorer');
    await page.locator('[data-season-stats-sort="RPG"]').click();
    assert.equal(await rows().first().locator('[data-season-stats-player]').textContent(), 'Top Rebounder');
    await page.locator('#league-stats-team').selectOption('atl');
    assert.equal(await rows().count(), 16);
    await page.locator('#league-stats-conference').selectOption('West');
    assert.equal(await rows().count(), 1);
    assert.match(await rows().textContent(), /No players match/);
    await page.locator('#league-stats-team').selectOption('');
    assert.equal(await rows().count(), 16);
    await page.locator('#league-stats-conference').selectOption('');
    await page.locator('[data-season-stats-sort="PPG"]').click();
    await page.locator('#league-stats-search').fill('Top Scorer');
    assert.equal(await rows().count(), 1);
    await page.locator('#league-stats-search').fill('');
    await page.locator('[data-season-stats-player="player-0"]').click();
    const gameLog = page.locator('.player-game-log');
    await gameLog.waitFor();
    assert.match(await gameLog.textContent(), /DNP/);
    assert.equal(await gameLog.locator('a[href="/games/game-1/submissions/submission-1/review"]').count(), 1);
    assert.equal(await page.locator('#league-stats-page-status').textContent(), '1–30 of 32 · Page 1 of 2');
    await page.locator('#league-stats-next').click();
    assert.equal(await rows().count(), 2);
    assert.equal(await page.locator('#league-stats-page-status').textContent(), '31–32 of 32 · Page 2 of 2');
    await page.locator('[data-season-stats-sort="FGPercent"]').click();
    assert.equal(await rows().count(), 1);
    assert.equal(await rows().first().locator('[data-season-stats-player]').textContent(), 'Top Rebounder');
    await page.locator('[data-season-stats-sort="threePPercent"]').click();
    assert.equal(await rows().first().locator('[data-season-stats-player]').textContent(), 'Top Scorer');
    await page.locator('[data-season-stats-sort="FTPercent"]').click();
    assert.match(await rows().textContent(), /No players match/);
    await page.locator('[data-season-stats-sort="PPG"]').click();
    assert.equal(await rows().count(), 30);
    assert.deepEqual(errors, []);
});
