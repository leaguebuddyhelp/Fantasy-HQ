const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

test('website offseason review shows blockers and requires explicit, cancellable confirmation', async t => {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  const actions = []; let blocked = true;
  await page.route('http://offseason.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: fs.readFileSync('web/index.html', 'utf8').replace('<script src="/app.js" defer></script>', '') });
    if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: '' });
    if (url.pathname === '/api/league/admin/offseason') {
      const body = route.request().postDataJSON(); actions.push(body.action);
      return route.fulfill({ json: { step: body.action === 'confirm' ? 'RETIREMENTS' : 'WRAP_UP', nextStep: 'RETIREMENTS', blockers: blocked ? ['Confirm the official championship.'] : [], token: body.action === 'prepare' && !blocked ? 'token' : null } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('http://offseason.test/#admin');
  await page.addScriptTag({ content: fs.readFileSync('web/app.js', 'utf8').replace(/^initialize\(\);$/m, '').replace(/^refreshStandings\(\);$/m, '').replace(/^setInterval\(.*$/gm, '') });
  await page.evaluate(() => { state.adminKey = 'test'; state.adminUnlocked = true; document.querySelector('#admin-operator').value = 'Commissioner'; });
  await page.locator('#offseason-review').click();
  await page.waitForFunction(() => document.querySelector('#offseason-output').textContent.includes('official championship'));
  assert.equal(await page.getByRole('button', { name: 'Confirm next step', exact: true }).count(), 0);
  blocked = false;
  await page.locator('#offseason-review').click();
  await page.getByRole('button', { name: 'Confirm next step', exact: true }).waitFor();
  assert.equal(actions.includes('confirm'), false);
  await page.locator('#offseason-output').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#offseason-output').textContent.includes('cancelled'));
  assert.equal(actions.at(-1), 'cancel');
  await page.locator('#offseason-review').click();
  await page.getByRole('button', { name: 'Confirm next step', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#offseason-output').textContent.includes('RETIREMENTS'));
  assert.equal(actions.at(-1), 'confirm');
});
test('retirement website presents evidence candidates and requires review before a separate commit', async t => {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  const actions = []; let confirmed = false;
  const player = { playerId: 'permanent-id', name: 'Example Player', teamName: 'Boston Celtics' };
  await page.route('http://retirements.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: fs.readFileSync('web/index.html', 'utf8').replace('<script src="/app.js" defer></script>', '') });
    if (url.pathname === '/api/league/players') return route.fulfill({ json: { players: [player] } });
    if (url.pathname === '/api/league/admin/retirements') {
      if (route.request().method() === 'GET') return route.fulfill({ json: { confirmed, images: [{ imageId: 'image', filename: 'Photo.jpg', status: 'READY_FOR_REVIEW', text: 'E. Player', candidates: [{ candidates: [player] }] }] } });
      const body = route.request().postDataJSON(); actions.push(body);
      if (body.action === 'prepare') {
        if (!body.reviewedAllImages) return route.fulfill({ status: 400, json: { error: 'Review every uploaded retirement image before confirming.' } });
        return route.fulfill({ json: { token: 'token', selected: [player] } });
      }
      if (body.action === 'confirm') { confirmed = true; return route.fulfill({ json: { confirmedAt: 'time' } }); }
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('http://retirements.test/#admin');
  await page.addScriptTag({ content: fs.readFileSync('web/app.js', 'utf8').replace(/^initialize\(\);$/m, '').replace(/^refreshStandings\(\);$/m, '').replace(/^setInterval\(.*$/gm, '') });
  await page.evaluate(() => { state.adminKey = 'test'; document.querySelector('#admin-operator').value = 'Commissioner'; });
  await page.locator('#retirement-reload').click();
  await page.getByLabel('Example Player · Boston Celtics').check();
  await page.getByRole('button', { name: 'Review retirement changes' }).click();
  await page.getByText('Review every uploaded retirement image before confirming.').waitFor();
  assert.equal(confirmed, false);
  await page.getByLabel('I reviewed every original photo and selected every retired player.').check();
  await page.getByRole('button', { name: 'Review retirement changes' }).click();
  await page.getByRole('button', { name: 'Confirm retirements' }).waitFor();
  assert.deepEqual(actions.at(-1).playerIds, ['permanent-id']);
  assert.equal(confirmed, false);
  await page.getByRole('button', { name: 'Confirm retirements' }).click();
  await page.getByText('Retirements confirmed. Return to the offseason checklist to advance.').waitFor();
  assert.equal(confirmed, true);
});
