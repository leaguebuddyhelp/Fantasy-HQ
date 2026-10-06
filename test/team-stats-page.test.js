const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

test('Team Stats page filters/sorts all teams, opens existing Team detail and expands game logs', async t => {
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const teams = Array.from({ length: 30 }, (_, index) => ({
        teamId: `team-${String(index).padStart(2, '0')}`,
        teamName: index === 29 ? 'Zulu Team' : index === 0 ? 'Atlanta Hawks' : `Team ${String(index).padStart(2, '0')}`,
        abbreviation: `T${index}`,
        conference: index < 15 ? 'East' : 'West',
        GP: 8,
        W: index % 2 ? 4 : 6,
        L: index % 2 ? 4 : 2,
        PCT: index % 2 ? 0.5 : 0.75,
        PPG: index,
        OPP_PPG: 100,
        DIFF: index - 100,
        AVG_DIFF: index - 100,
        RPG: 40 + index,
        APG: 20,
        SPG: 7,
        BPG: 4,
        TOV: 12,
        FGPercent: 48,
        threePPercent: 37,
        FTPercent: 80,
        totals: {},
    }));
    await page.route('http://teamstats.test/**', async route => {
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
        if (url.pathname === '/api/league/team-stats') {
            await route.fulfill({ json: { leagueId: 'league', seasonId: '1', teams, warnings: [] } });
            return;
        }
        if (url.pathname === '/api/league/team-stats/team-00/games') {
            await route.fulfill({ json: { team: teams[0], games: [{ gameId: 'game-1', submissionId: 'sub-1', week: 1, date: '10/01/2026', teamId: 'team-00', teamName: 'Atlanta Hawks', opponentId: 'team-01', opponent: 'Team 01', result: 'W', score: '110-100', PTS: 110, PTS_ALLOWED: 100, MIN: 240, REB: 44, AST: 25, STL: 7, BLK: 4, TO: 12, FG: '40-80', '3PT': '10-30', FT: '20-25', OREB: 10, FLS: 15 }], warnings: [] } });
            return;
        }
        if (url.pathname === '/api/league/teams/team-00') {
            await route.fulfill({ json: { team: { ...teams[0], roster: [], schedule: [] } } });
            return;
        }
        await route.fulfill({ status: 404, json: { error: `Unexpected ${url.pathname}` } });
    });
    await page.goto('http://teamstats.test/');
    const app = fs.readFileSync('web/app.js', 'utf8')
        .replace(/^initialize\(\);$/m, '')
        .replace(/^refreshStandings\(\);$/m, '')
        .replace(/^setInterval\(.*$/gm, '');
    await page.addScriptTag({ content: app });
    await page.evaluate(async () => {
        state.leagueSite = {
            league: { currentPhase: 'REGULAR_SEASON' }, teams: [
                { teamId: 'team-00', teamName: 'Atlanta Hawks', conference: 'East' },
                { teamId: 'team-01', teamName: 'Team 01', conference: 'East' },
            ]
        };
        await loadTeamStats();
    });
    const rows = () => page.locator('#team-stats-body > tr:not(.stats-expanded-row)');
    assert.equal(await rows().count(), 30);
    assert.equal(await rows().first().locator('[data-team-stats-profile]').textContent(), 'Atlanta Hawks');
    await page.locator('[data-team-stats-sort="PPG"]').click();
    assert.equal(await rows().first().locator('[data-team-stats-profile]').textContent(), 'Zulu Team');
    await page.locator('#team-stats-conference').selectOption('East');
    assert.equal(await rows().count(), 15);
    await page.locator('#team-stats-conference').selectOption('');
    await page.locator('[data-team-stats-sort="teamName"]').click();
    assert.equal(await rows().first().locator('[data-team-stats-profile]').textContent(), 'Atlanta Hawks');
    await rows().first().locator('[data-team-stats-log]').click();
    const log = page.locator('.team-game-log');
    await log.waitFor();
    assert.match(await log.textContent(), /W 110-100/);
    assert.equal(await log.locator('a[href="/games/game-1/submissions/sub-1/review"]').count(), 1);
    await rows().first().locator('[data-team-stats-profile]').click();
    await page.locator('#league-dialog-content').getByRole('heading', { name: 'Atlanta Hawks' }).waitFor();
    assert.deepEqual(errors, []);
});
