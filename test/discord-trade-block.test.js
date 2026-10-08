const { Collection } = require('discord.js');
const test = require('node:test'), assert = require('node:assert/strict');
const { createDiscordTradeBlock } = require('../src/fantasyhq/discord-trade-block');
function fixture() {
    let settings = { discordChannels: { tradeBlock: 'parent' } }, players = [
        { playerId: 'p1', name: 'Star One', teamId: 'bos', teamName: 'Boston Celtics', overall: 90, tradeValue: 500, age: 25 },
        { playerId: 'p2', name: 'Bench Two', teamId: 'bos', teamName: 'Boston Celtics', overall: 70, tradeValue: 50, age: 30 },
        { playerId: 'p3', name: 'Other', teamId: 'nyk', teamName: 'New York Knicks', overall: 80, tradeValue: 200, age: 27 }];
    const sent = [], deleted = [], created = [], messages = new Map(), threads = new Map();
    const parent = { id: 'parent', threads: { create: async o => { const t = { id: `t${created.length}`, archived: false, send: async p => { sent.push(p); const id = `m${sent.length}`, m = { id, delete: async () => deleted.push(id) }; messages.set(m.id, m); return m; }, messages: { fetch: async id => messages.get(id) } }; created.push(o); threads.set(t.id, t); return t; } } };
    const guild = { id: 'g', channels: { fetch: async id => id === 'parent' ? parent : threads.get(id) }, roles: { fetch: async () => new Map([['r', { id: 'r', name: 'LEAGUEbuddy Coach', managed: false }]]) } };
    const repository = {
        loadLeagueContext: () => ({ league: { leagueId: 'l' }, seasonId: '1', teams: [{ teamId: 'bos', teamName: 'Boston Celtics' }, { teamId: 'nyk', teamName: 'New York Knicks' }] }),
        loadRoleOwnership: () => ({ roleIds: { bos: "bos-role", nyk: "nyk-role" } }), loadSettings: () => settings, saveSettings: (_, s) => { settings = s; }, loadOwners: () => [{ teamId: 'bos', userId: 'u1' }],
    };
    const service = createDiscordTradeBlock({ repository, playerService: { listPlayers: () => players } });
    const replies = [], act = (sub, player, user = 'u1', perms = false) => ({ guild, guildId: 'g', user: { id: user }, member: { displayName: 'Coach', roles: { cache: new Collection(user === "u1" ? [["bos-role", { id: "bos-role", name: "Boston Celtics" }]] : []) } }, memberPermissions: { has: () => perms },
        options: { getSubcommand: () => sub, getString: () => player, getFocused: () => '' }, editReply: async m => replies.push(m), respond: async c => replies.push(c) });
    return { service, act, sent, deleted, created, replies, guild, setPlayers: v => { players = v; }, settings: () => settings };
}
test('add posts a card with the coach role ping, remove deletes it, and duplicates are rejected', async () => {
    const f = fixture();
    await f.service.handleTradeBlockCommand(f.act('add', 'p1'));
    assert.equal(f.created.length, 1); assert.match(f.sent[0].content, /<@&r>.*Star One/);
    assert.match(f.sent[0].embeds[0].data.title, /Star One/); assert.match(JSON.stringify(f.sent[0].embeds[0].data.fields), /Trade Value 500/);
    await assert.rejects(() => f.service.handleTradeBlockCommand(f.act('add', 'p1')), /already on your trade block/);
    await assert.rejects(() => f.service.handleTradeBlockCommand(f.act('add', 'p3')), /not on your roster/);
    await f.service.handleTradeBlockCommand(f.act('add', 'p2'));
    assert.equal(f.created.length, 1);
    await f.service.handleTradeBlockCommand(f.act('remove', 'p1'));
    assert.deepEqual(f.deleted, ['m1']); assert.deepEqual(f.settings().tradeBlock.entries.map(e => e.playerId), ['p2']);
    await assert.rejects(() => f.service.handleTradeBlockCommand(f.act('remove', 'p1')), /not on your trade block/);
});
test('autocomplete offers roster players to add and block players to remove; unassigned users rejected', async () => {
    const f = fixture(); await f.service.handleTradeBlockCommand(f.act('add', 'p1'));
    const add = f.act('add'); await f.service.handleTradeBlockAutocomplete(add);
    const remove = f.act('remove'); await f.service.handleTradeBlockAutocomplete(remove);
    const [, , , , a, r] = [0, 0, 0, 0, ...f.replies.slice(-2)];
    assert.deepEqual(a.map(c => c.value), ['p2']); assert.deepEqual(r.map(c => c.value), ['p1']);
    await assert.rejects(() => f.service.handleTradeBlockCommand(f.act('add', 'p1', 'nobody')), /team Coach role/);
});
test('setup creates one thread per team (staff only) and the sweep removes traded players', async () => {
    const f = fixture();
    await assert.rejects(() => f.service.handleTradeBlockCommand(f.act('setup')), /need LEAGUEbuddy/);
    await f.service.handleTradeBlockCommand(f.act('setup', null, 'staff', true));
    assert.equal(f.created.length, 2);
    await f.service.handleTradeBlockCommand(f.act('add', 'p1'));
    f.setPlayers([{ playerId: 'p1', teamId: 'nyk' }]);
    await f.service.tick({ guilds: { cache: new Map([['g', f.guild]]) } });
    assert.deepEqual(f.deleted.length, 1); assert.deepEqual(f.settings().tradeBlock.entries, []);
});
