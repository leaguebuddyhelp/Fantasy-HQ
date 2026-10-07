const test = require('node:test'), assert = require('node:assert/strict');
const { createDiscordActivityCheck, REACTION } = require('../src/fantasyhq/discord-activity-check');
function fixture(clock) {
    let settings = { discordChannels: { activity: 'ch' } }, sent = [], edits = [], reacted = [];
    const message = { id: 'm1', reactions: { cache: new Map([[REACTION, { users: { fetch: async () => new Map([['a', { bot: true }], ['b', { bot: false }], ['c', { bot: false }]]) } }]]) }, edit: async p => edits.push(p) };
    const channel = { id: 'ch', send: async p => { sent.push(p); return { id: 'm1', react: async e => reacted.push(e) }; }, messages: { fetch: async () => message } };
    const guild = { id: 'g', channels: { fetch: async () => channel }, roles: { fetch: async () => new Map([['r', { id: 'r', name: 'LEAGUEbuddy Coach', managed: false }]]) } };
    const repository = { loadLeagueContext: () => ({ league: { leagueId: 'l' } }), loadSettings: () => settings, saveSettings: (_, s) => { settings = s; } };
    const replies = [], interaction = { guild, guildId: 'g', user: { id: 'u' }, memberPermissions: { has: () => true }, editReply: async m => replies.push(m) };
    const service = createDiscordActivityCheck({ repository, now: () => clock.t });
    return { service, interaction, sent, edits, reacted, replies, guild, settings: () => settings };
}
test('posts a 24 hour check with a reaction, blocks duplicates, and closes after the deadline', async () => {
    const clock = { t: Date.parse('2026-10-07T12:00:00Z') }, f = fixture(clock);
    await f.service.start(f.interaction);
    assert.deepEqual(f.reacted, [REACTION]);
    assert.equal(f.settings().activityCheck.deadlineAt, '2026-10-08T12:00:00.000Z');
    assert.equal(f.sent[0].content, '<@&r>');
    await assert.rejects(() => f.service.start(f.interaction), /already open/);
    const client = { guilds: { cache: new Map([['g', f.guild]]) } };
    await f.service.tick(client); assert.equal(f.edits.length, 0);
    clock.t += 24 * 3600000 + 1000;
    await f.service.tick(client);
    assert.match(f.edits[0].embeds[0].data.description, /\*\*2\*\* coaches checked in/);
    assert.ok(f.settings().activityCheck.closedAt);
    await f.service.start(f.interaction);
    assert.equal(f.sent.length, 2);
});
test('requires league staff', async () => {
    const f = fixture({ t: 0 }); f.interaction.memberPermissions = { has: () => false }; f.interaction.member = { roles: { cache: { some: () => false } } };
    await assert.rejects(() => f.service.start(f.interaction), /need LEAGUEbuddy/);
});
