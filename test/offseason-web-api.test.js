const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { fixture } = require('./helpers/free-agency');

test('offseason API uses commissioner authorization, prepare/confirm and protected original access', async t => {
  const f = fixture(t), saved = {};
  for (const key of ['FANTASYHQ_DATA_ROOT', 'GUILD_ID', 'WEBSITE_ADMIN_KEY', 'WEBSITE_ADMIN_KEYS']) saved[key] = process.env[key];
  process.env.FANTASYHQ_DATA_ROOT = f.root; process.env.GUILD_ID = 'guild'; process.env.WEBSITE_ADMIN_KEY = 'key'; delete process.env.WEBSITE_ADMIN_KEYS;
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  f.repository.saveLeague('league', { commissionerUserId: 'c', currentPhase: 'OFFSEASON' });
  const { requestHandler } = require('../src/web');
  function request(url, { method = 'GET', headers = {}, body } = {}) {
    return new Promise(resolve => {
      const req = new EventEmitter(); Object.assign(req, { url, method, headers });
      let status;
      requestHandler(req, { writeHead(code) { status = code; }, end(data) { resolve({ status, payload: JSON.parse(data) }); } });
      if (method === 'POST') { req.emit('data', Buffer.from(JSON.stringify(body || {}))); req.emit('end'); }
    });
  }
  const header = { 'x-leaguebuddy-admin-key': 'key' };
  assert.equal((await request('/api/league/admin/offseason')).status, 403);
  assert.equal((await request('/api/league/admin/retirements?imageId=anything')).status, 403);
  const blocked = await request('/api/league/admin/offseason', { headers: header });
  assert.equal(blocked.status, 200); assert.equal(blocked.payload.ready, false);
  process.env.WEBSITE_ADMIN_KEYS = JSON.stringify({ 'assistant': 'assistant-key' });
  assert.equal((await request('/api/league/admin/offseason', { headers: { 'x-leaguebuddy-admin-key': 'assistant-key' } })).status, 400);
  delete process.env.WEBSITE_ADMIN_KEYS;
  f.repository.commitLeagueFiles({ leagueId: 'league', files: [
    { name: 'championships.json', value: { version: 1, seasons: { '1': { teamId: 'a', finalizedAt: 'date', confirmedBy: 'c' } } } },
    { name: 'awards.json', value: { version: 1, seasons: { '1': { REGULAR_SEASON: { confirmedAt: 'date', confirmedBy: 'c' }, CONFERENCE_FINALS: { confirmedAt: 'date', confirmedBy: 'c' }, NBA_FINALS: { confirmedAt: 'date', confirmedBy: 'c' } } } } },
  ] });
  const preview = await request('/api/league/admin/offseason', { method: 'POST', headers: header, body: { action: 'prepare', operator: 'Commissioner' } });
  assert.equal(preview.status, 200); assert.ok(preview.payload.token);
  const completed = await request('/api/league/admin/offseason', { method: 'POST', headers: header, body: { action: 'confirm', token: preview.payload.token, operator: 'Commissioner' } });
  assert.equal(completed.status, 200); assert.equal(completed.payload.step, 'RETIREMENTS');
  const images = await request('/api/league/admin/retirements', { headers: header });
  assert.equal(images.status, 200); assert.deepEqual(images.payload.images, []);
});
