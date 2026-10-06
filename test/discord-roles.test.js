const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureLeagueRoles, ROLE_NAMES } = require('../src/fantasyhq/discord-roles');
function guildFixture(id) {
  const roles = new Map();
  const guild = {
    id, members: { me: { permissions: { has: () => true } } }, roles: {
      fetch: async () => roles,
      create: async (options) => { assert.deepEqual(options.permissions, []); const role = { id: String(roles.size), ...options }; roles.set(role.id, role); return role; },
    }
  };
  return { guild, roles };
}
test('creates 35 roles and reuses them on retries and concurrent requests', async () => {
  const { guild, roles } = guildFixture('roles-test');
  roles.set('old', { id: 'old', name: 'boston celtics' });
  const [result] = await Promise.all([ensureLeagueRoles(guild), ensureLeagueRoles(guild)]);
  assert.equal(result.created, 34);
  assert.equal(roles.size, 35);
  assert.equal((await ensureLeagueRoles(guild)).created, 0);
  assert.equal(new Set(ROLE_NAMES).size, 35);
  assert.ok(ROLE_NAMES.includes('LEAGUEbuddy GM'));
  assert.ok(ROLE_NAMES.includes('Philadelphia 76ers'));
});
test('permission failure and partial creation can be retried without duplicates', async () => {
  const { guild, roles } = guildFixture('retry-test');
  guild.members.me.permissions.has = () => false;
  await assert.rejects(ensureLeagueRoles(guild), /Manage Roles/);
  assert.equal(roles.size, 0);
  guild.members.me.permissions.has = () => true;
  const create = guild.roles.create;
  guild.roles.create = async (options) => { if (roles.size === 5) throw Error('failure'); return create(options); };
  await assert.rejects(ensureLeagueRoles(guild), /Created 5 roles/);
  guild.roles.create = create;
  assert.equal((await ensureLeagueRoles(guild)).created, 30);
  assert.equal(roles.size, 35);
});
test('team icons are attached only when supported and existing icons can be repaired', async () => {
  const { guild, roles } = guildFixture('icon-test');
  guild.features = ['ROLE_ICONS'];
  let icons = 0;
  const create = guild.roles.create;
  guild.roles.create = async (options) => {
    if (options.icon) icons++;
    const role = await create(options);
    role.editable = true;
    role.setIcon = async () => { };
    return role;
  };
  await ensureLeagueRoles(guild);
  assert.equal(icons, 30);
  assert.equal((await ensureLeagueRoles(guild)).iconsUpdated, 30);
  const team = [...roles.values()].find(role => role.name === 'Boston Celtics');
  team.editable = false;
  assert.equal((await ensureLeagueRoles(guild)).warnings.length, 1);
});
