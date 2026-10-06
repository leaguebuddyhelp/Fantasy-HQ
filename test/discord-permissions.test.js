const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { canManageLeague, requireLeagueStaff } = require('../src/fantasyhq/discord-permissions');
const { teamBrand, logoPath, brandTeamReply } = require('../src/shared/team-branding');
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
test('staff role access without Discord administrator permissions', () => {
  for (const name of ['LEAGUEbuddy Commish', 'LEAGUEbuddy Assistant Commish']) {
    assert.equal(canManageLeague({ guildId: 'g', member: { roles: { cache: new Collection([['r', { name }]]) } } }), true);
  }
  for (const name of ['LEAGUEbuddy Coach', 'Boston Celtics']) {
    assert.throws(() => requireLeagueStaff({ guildId: 'g', member: { roles: { cache: new Collection([['r', { name }]]) } } }), /Commish/);
  }
  assert.equal(canManageLeague({ guildId: 'g', memberPermissions: { has: () => true } }), true);
  assert.equal(canManageLeague({}), false);
  assert.equal(canManageLeague({ guildId: 'g', member: { roles: ['r'] }, guild: { roles: { cache: new Collection([['r', { name: 'LEAGUEbuddy Commish' }]]) } } }), true);
});
test('all 30 team logos resolve by name, abbreviation, and slug', () => {
  const teams = require('../web/assets/nba/teams.json');
  assert.equal(teams.length, 30);
  for (const team of teams) {
    for (const key of [team.name, team.abbreviation, team.slug]) assert.equal(teamBrand(key), team);
    assert.ok(fs.existsSync(logoPath(team)));
    const payload = brandTeamReply({ embeds: [new EmbedBuilder().setTitle('Team')] }, team.name);
    assert.equal(payload.files.length, 1);
    assert.match(payload.embeds[0].toJSON().thumbnail.url, /^attachment:/);
  }
});
