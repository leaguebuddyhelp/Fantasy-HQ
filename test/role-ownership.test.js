const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Collection } = require('discord.js');
const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { createRoleOwnershipService } = require('../src/fantasyhq/role-ownership');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'role-owners-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = createFantasyHQRepository({ dataRoot: root });
  repo.saveLeague('l', { currentSeasonId: '1', currentPhase: 'PRESEASON' });
  repo.saveTeams('l', [{ teamId: 'bos', teamName: 'Boston Celtics', abbreviation: 'BOS', conference: 'East' }, { teamId: 'lal', teamName: 'Los Angeles Lakers', abbreviation: 'LAL', conference: 'West' }]);
  repo.saveGuildLeagueBinding('g', { leagueId: 'l', seasonId: '1' });
  const roles = new Collection([['r1', { id: 'r1', name: 'Boston Celtics', editable: true }], ['r2', { id: 'r2', name: 'Los Angeles Lakers', editable: true }], ['coach', { id: 'coach', name: 'LEAGUEbuddy Coach', editable: true }]]);
  function member(id, ids) { const cache = new Collection(ids.map(id => [id, roles.get(id)])); return { id, user: { bot: false }, roles: { cache, add: async id => cache.set(id, roles.get(id)), remove: async id => cache.delete(id) } }; }
  const members = new Collection([['a', member('a', ['r1'])], ['b', member('b', [])]]);
  const guild = { id: 'g', roles: { fetch: async () => roles }, members: { fetch: async () => members } };
  return { repo, roles, members, guild, service: createRoleOwnershipService(repo) };
}
test('team roles drive owners, coach role, team records, removals and renames', async t => {
  const { repo, roles, members, guild, service } = fixture(t);
  await service.sync(guild);
  assert.equal(repo.loadOwners('l')[0].userId, 'a');
  assert.equal(repo.loadLeague('l').teams[0].assignedUserId, 'a');
  assert.ok(members.get('a').roles.cache.has('coach'));
  roles.get('r1').name = 'Celtics Owner';
  await service.sync(guild);
  assert.equal(repo.loadOwners('l').length, 1);
  await service.setOwner(guild, 'bos', 'b');
  assert.equal(repo.loadOwners('l')[0].userId, 'b');
  assert.ok(!members.get('a').roles.cache.has('coach'));
  assert.ok(members.get('b').roles.cache.has('coach'));
  service.updateMember(guild.id, members.get('b'), true); members.delete('b'); await service.sync(guild);
  assert.equal(repo.loadOwners('l').length, 0);
});

test('ownership sync reports the resolved team-role assignments to upgrade tenure tracking', async t => {
  const { repo, members, guild, service } = fixture(t), changes = [];
  service.setOwnerChangeHandler(change => changes.push(change));
  await service.sync(guild);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].owners[0].userId, 'a');
  members.get('a').roles.cache.delete('r1');
  members.get('b').roles.cache.set('r1', { id: 'r1', name: 'Boston Celtics' });
  await service.sync(guild);
  assert.equal(changes.length, 2);
  assert.equal(changes[1].previousOwners[0].userId, 'a');
  assert.equal(changes[1].owners[0].userId, 'b');
  assert.equal(repo.loadOwners('l')[0].userId, 'b');
});
test('conflicts never select an arbitrary owner; failed member fetch preserves ownership', async t => {
  const { repo, members, roles, guild, service } = fixture(t);
  await service.sync(guild);
  service.invalidateMembers(guild.id);
  guild.members.fetch = async () => { throw Error('members intent unavailable') };
  await assert.rejects(service.sync(guild), /intent/);
  assert.equal(repo.loadOwners('l').length, 1);
  guild.members.fetch = async () => members;
  members.get('b').roles.cache.set('r1', roles.get('r1'));
  assert.ok((await service.sync(guild)).conflicts.length);
  assert.equal(repo.loadOwners('l').length, 0);
  members.get('b').roles.cache.delete('r1');
  members.get('a').roles.cache.set('r2', roles.get('r2'));
  assert.equal((await service.sync(guild)).owners, 0);
  assert.equal(repo.loadRoleOwnership('l').conflicts.length, 2);
});
test('sync followed by assignment and more syncs uses one complete member request', async t => {
  const { guild, service, repo } = fixture(t); let calls = 0; const fetch = guild.members.fetch;
  guild.members.fetch = async () => { calls++; return fetch() };
  await service.sync(guild);
  await service.setOwner(guild, 'bos', 'b');
  await Promise.all([service.sync(guild), service.sync(guild)]);
  assert.equal(calls, 1);
  assert.equal(repo.loadOwners('l')[0].userId, 'b');
});
test('owner display names follow nicknames and username fallback without changing ownership', async t => {
  const { repo, members, guild, service } = fixture(t);
  const member = members.get('a'); member.displayName = 'Coach Brandon'; member.user.username = 'brandon';
  await service.sync(guild);
  const { createTeamService } = require('../src/fantasyhq/team-service');
  const teams = createTeamService({ repository: repo });
  assert.equal(teams.getTeam('l', '1', 'bos').ownerDisplayName, 'Coach Brandon');
  member.displayName = 'New Nickname'; service.updateMember(guild.id, member); await service.sync(guild);
  assert.equal(teams.getTeam('l', '1', 'bos').ownerDisplayName, 'New Nickname');
  member.displayName = null; service.updateMember(guild.id, member); await service.sync(guild);
  assert.equal(teams.getTeam('l', '1', 'bos').ownerDisplayName, 'brandon');
  assert.equal(repo.loadOwners('l')[0].userId, 'a');
});

test('staff thread membership uses both existing staff roles and the shared member snapshot', async t => {
  const { roles, members, guild, service } = fixture(t);
  roles.set('staff1', { id: 'staff1', name: 'LEAGUEbuddy Commish' }); roles.set('staff2', { id: 'staff2', name: 'LEAGUEbuddy Assistant Commish' });
  members.get('a').roles.cache.set('staff1', roles.get('staff1')); members.get('a').roles.cache.set('staff2', roles.get('staff2')); members.get('b').roles.cache.set('staff2', roles.get('staff2'));
  let fetches = 0; const fetch = guild.members.fetch; guild.members.fetch = async () => { fetches++; return fetch(); };
  assert.deepEqual((await service.sync(guild)).staffUserIds, ['a', 'b']);
  assert.deepEqual((await service.sync(guild)).staffUserIds, ['a', 'b']); assert.equal(fetches, 1);
});
