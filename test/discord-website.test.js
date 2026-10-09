const test = require('node:test'), assert = require('node:assert/strict');
const { websitePayload } = require('../src/fantasyhq/discord-website');
test('website command provides configured public link in embed and button', () => {
  const payload = websitePayload({ websiteUrl: 'https://league.example/', railwayDomain: '', production: true });
  assert.match(payload.embeds[0].data.description, /https:\/\/league.example/);
  assert.equal(payload.components[0].toJSON().components[0].url, 'https://league.example');
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});
test('production website link falls back to Railway rather than advertising localhost or unsafe URLs', () => {
  for (const websiteUrl of ['http://localhost:3000', 'javascript:alert(1)', 'https://user:password@example.com']) {
    const payload = websitePayload({ websiteUrl, railwayDomain: 'leaguebuddy.up.railway.app', production: true });
    assert.equal(payload.components[0].toJSON().components[0].url, 'https://leaguebuddy.up.railway.app');
  }
  assert.throws(() => websitePayload({ websiteUrl: '', railwayDomain: '', production: true }), /Set WEBSITE_URL/);
});
