const { chromium } = require(process.cwd() + '/node_modules/playwright');
const fs = require('fs');
const { sample } = require(process.cwd() + '/test/fixtures/cavaliers-bucks');
const { normalizeExtraction } = require(process.cwd() + '/src/fantasyhq/box-score/normalize');
const { editable } = require(process.cwd() + '/src/fantasyhq/box-score/review-service');
(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); const errors = []; page.on('pageerror', e => errors.push(e.message));
        const raw = sample(), game = { weekNumber: 1, team1Id: 'mil', team2Id: 'cle', team1Name: 'Milwaukee Bucks', team2Name: 'Cleveland Cavaliers', status: 'SCHEDULED' };
        const rosters = Object.fromEntries(raw.screenshots.map((s, i) => [i ? 'cle' : 'mil', s.players.map((p, j) => ({ playerId: `${i}-${j}`, name: p.displayedName }))]));
        const result = normalizeExtraction(raw, { game, media: raw.screenshots, teams: [{ teamId: 'mil', teamName: 'Milwaukee Bucks', abbreviation: 'MIL' }, { teamId: 'cle', teamName: 'Cleveland Cavaliers', abbreviation: 'CLE' }], rosters });
        const suggestedPlayer = result.normalized.screenshots[0].players[1], suggestedName = suggestedPlayer.displayedName;
        suggestedPlayer.playerId = null; suggestedPlayer.candidates = [{ playerId: '0-1', name: suggestedName }];
        const latest = { ...result, extractionId: 'test', rosterSnapshot: rosters, provider: 'tesseract', timestamp: 'today' };
        const data = { game, media: raw.screenshots, submission: { status: 'REVIEW_REQUIRED' }, extractions: [latest], editable: editable(latest) };
        let posted, failSave = false, failApprove = true;
        latest.issues = [{ code: 'UNCERTAIN_FIELD', path: 'screenshots.0.players.0.stats.AST', message: 'OCR readings disagree.' }, { code: 'PLAYER_MATCH_NEEDED', path: 'screenshots.0.players.1', message: 'Player match needed.' }];
        await page.route('http://review.test/**', async route => {
            const u = new URL(route.request().url());
            if (u.pathname.endsWith('/approve')) { if (failApprove) { await route.fulfill({ status: 400, json: { error: 'Approval rejected for test' } }); return; } game.status = 'FINAL'; game.locked = true; await route.fulfill({ json: game }); return; }
            if (u.pathname.endsWith('/correct')) { posted = route.request().postDataJSON(); if (failSave) { await route.fulfill({ status: 400, json: { error: 'Test save rejected' } }); return; } latest.correctedInput = posted.input; latest.issues = []; data.editable = posted.input; await route.fulfill({ json: {} }); return; }
            if (u.pathname.startsWith('/api/') && u.pathname.endsWith('/review')) { await route.fulfill({ json: data }); return; }
            if (u.pathname.includes('/media/')) { await route.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync('test/fixtures/association-bucks.jpg') }); return; }
            let file = u.pathname.endsWith('/review') ? 'web/box-score-review.html' : 'web' + u.pathname;
            if (fs.existsSync(file)) await route.fulfill({ contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'image/png', body: fs.readFileSync(file) }); else await route.fulfill({ status: 404, body: '' });
        });
        await page.goto('http://review.test/games/g/submissions/s/review'); await page.locator('#key').fill('test'); await page.getByRole('button', { name: 'Load submission' }).click();
        await page.locator('#approve').waitFor();
        if (await page.locator('.review-original img').count() !== 2) throw Error('Missing originals');
        if (!await page.locator('.review-original img').evaluateAll(imgs => imgs.every(i => i.complete && i.naturalWidth > 0))) throw Error('Original image did not display');
        await page.locator('.review-original img').first().click();
        await page.getByRole('dialog', { name: 'Screenshot zoom' }).waitFor();
        await page.getByRole('slider', { name: 'Image zoom' }).fill('200');
        if (await page.locator('.review-image-stage img').evaluate(image => image.style.width) !== '200%') throw Error('Screenshot zoom control did not resize the image');
        await page.getByRole('button', { name: 'Close image' }).click();
        if (await page.locator('#issue-progress').textContent() !== 'Item 1 of 2 · 2 unresolved') throw Error('Incorrect review issue count');
        await page.getByRole('button', { name: 'Next issue' }).click();
        if (await page.evaluate(() => document.activeElement.dataset.path) !== 'screenshots.0.players.1.playerId') throw Error('Next issue did not jump to the next field');
        if (!await page.locator('.review-issue').nth(1).evaluate(card => card.classList.contains('review-issue-active'))) throw Error('Next issue was not highlighted');
        await page.getByRole('button', { name: 'Previous issue' }).click();
        if (await page.evaluate(() => document.activeElement.dataset.path) !== 'screenshots.0.players.0.stats.AST') throw Error('Previous issue did not return to the prior field');
        await page.getByRole('button', { name: 'Save corrections & revalidate' }).click();
        if (posted) throw Error('Blank commissioner name should not be submitted');
        if (!await page.locator('#action-status').textContent().then(t => t.includes('commissioner name'))) throw Error('Missing visible name guidance');
        await page.screenshot({ path: '/tmp/lb-review-issues.png', fullPage: false });
        const warning = page.locator('.review-issue').first(); if (!(await warning.textContent()).includes(raw.screenshots[0].players[0].displayedName)) throw Error('Missing player name');
        await warning.getByRole('button', { name: 'Show in table' }).click();
        if (await page.evaluate(() => document.activeElement.dataset.path) !== 'screenshots.0.players.0.stats.AST') throw Error('Issue did not target stat');
        if (!await page.locator('[data-path="screenshots.0.players.0.stats.AST"]').locator('xpath=ancestor::tr').evaluate(row => row.classList.contains('review-row-highlight'))) throw Error('Target row was not highlighted');
        await page.getByRole('button', { name: `Assign ${suggestedName} to this row` }).click();
        if (await page.locator('[data-path="screenshots.0.players.1.playerId"]').inputValue() !== '0-1') throw Error('Suggested player match did not update the row');
        await warning.getByRole('checkbox').check();
        if (await page.locator('#issue-progress').textContent() !== 'Item 1 of 2 · 1 unresolved') throw Error('Verified screenshot check did not update the unresolved count');
        await page.locator('#operator').fill('Test Commissioner');
        await page.locator('[data-path="screenshots.0.players.0.stats.PTS"]').fill('28');
        failSave = true;
        await page.getByRole('button', { name: 'Save corrections & revalidate' }).click();
        await page.getByText('Test save rejected', { exact: true }).waitFor();
        if (await page.locator('[data-path="screenshots.0.players.0.stats.PTS"]').inputValue() !== '28') throw Error('Failed save lost edit');
        failSave = false;
        await page.getByRole('button', { name: 'Save corrections & revalidate' }).click();
        await page.getByText('Saved successfully. All checks passed — you can now approve the game.', { exact: true }).waitFor();
        if (await page.locator('#approve').isDisabled()) throw Error('Clean saved review should enable approval');
        if (!posted.reviewedPaths.includes('screenshots.0.players.0.stats.AST')) throw Error('Verification not submitted');
        await page.screenshot({ path: '/tmp/lb-review-desktop.png', fullPage: true });
        if (posted?.input.screenshots[0].players[0].stats.PTS !== '28') throw Error('Correction not posted');
        if (posted?.input.screenshots[0].players[1].playerId !== '0-1') throw Error('Suggested player match was not saved');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: '/tmp/lb-review-mobile.png', fullPage: true });
        await page.locator('#approve').click(); await page.getByText('Approval rejected for test', { exact: true }).waitFor();
        if (await page.locator('#approval-confirmation').count()) throw Error('Failed approval showed success');
        failApprove = false; await page.locator('#approve').click();
        await page.getByRole('dialog').waitFor();
        if (!(await page.getByRole('dialog').textContent()).includes('No further approval is needed')) throw Error('Missing approval confirmation');
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        await page.getByRole('button', { name: 'APPROVED ✓', exact: true }).waitFor();
        if (!await page.locator('#approve').isDisabled()) throw Error('Approved game permits second approval');
        data.editable = null; data.extractions = [{ status: 'EXTRACTION_FAILED', error: 'Layout recognition failed' }];
        await page.getByRole('button', { name: 'Load submission' }).click();
        await page.getByRole('heading', { name: 'Original screenshot 2', exact: true }).waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll('.review-original img')].length === 2 && [...document.querySelectorAll('.review-original img')].every(i => i.complete && i.naturalWidth > 0));
        if (errors.length) throw Error(errors.join('\n'));
        console.log('Browser PASS: issue navigation/count, highlighted rows, in-page image zoom, roster suggestions, saved corrections, mobile layout, no JS errors.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
