const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { PermissionFlagsBits: P } = require('discord.js');
const { createChannelSetupService, CHANNELS } = require('../src/fantasyhq/discord-channels');
const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { createDiscordTradeWorkflow } = require('../src/fantasyhq/discord-trades');
const { setTeamEmojis } = require('../src/shared/team-emojis');
function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-channels-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const repo = createFantasyHQRepository({ dataRoot: root }); repo.saveLeague('l', { currentSeasonId: '1' }); repo.saveGuildLeagueBinding('g', { leagueId: 'l', seasonId: '1' }); const channels = new Map(), roles = new Map(); let count = 0, messageCount = 0; function makeChannel(opts) { const ch = { ...opts, id: 'c' + (++count), isTextBased: () => true }; ch.permissionOverwrites = { set: async value => { ch.overwrites = value; } }; ch.overwrites = opts.permissionOverwrites; const messages = new Map(); ch.messages = { fetchPins: async () => ({ items: [...messages.values()].filter(message => message.pinned).map(message => ({ message, pinnedTimestamp: 1 })), hasMore: false }), fetch: async id => typeof id === 'object' ? messages : messages.get(id) || null }; ch.send = async payload => { const message = { id: 'm' + (++messageCount), channelId: ch.id, pinned: false, author: { id: 'bot' }, ...payload, edit: async next => { Object.assign(message, next); message.embeds = (next.embeds || []).map(embed => ({ ...embed.data, data: embed.data })); return message; }, pin: async () => { message.pinned = true; return message; }, unpin: async () => { message.pinned = false; return message; } }; message.embeds = (payload.embeds || []).map(embed => ({ ...embed.data, data: embed.data })); messages.set(message.id, message); return message; }; ch._messages = messages; return ch; } const guild = { id: 'g', members: { me: { id: 'bot', permissions: { has: () => true } } }, roles: { fetch: async () => roles, create: async opts => { const role = { ...opts, id: 'r' + roles.size }; roles.set(role.id, role); return role; } }, channels: { fetch: async id => id ? channels.get(id) || null : channels, create: async opts => { const ch = makeChannel(opts); channels.set(ch.id, ch); return ch; } } }; return { repo, guild, channels, roles, service: createChannelSetupService(repo) }; }
test('setup creates 20 channels, roles, repairs persistent system pins and coalesces retries', async t => {
    const f = fixture(t);
    setTeamEmojis(new Map([['bos', { name: 'bos', id: '111' }], ['lal', { name: 'lal', id: '222' }]]));
    t.after(() => setTeamEmojis(new Map()));
    f.repo.saveTeams('l', [{ teamId: 'bos', teamName: 'Boston Celtics', abbreviation: 'BOS', conference: 'East' }, { teamId: 'lal', teamName: 'Los Angeles Lakers', abbreviation: 'LAL', conference: 'West' }]);
    f.repo.saveOwners('l', [{ teamId: 'bos', userId: 'coach-bos' }, { teamId: 'lal', userId: 'coach-lal' }]);
    const [r] = await Promise.all([f.service.ensure(f.guild, 'admin'), f.service.ensure(f.guild, 'admin')]);
    assert.equal(r.created, 20); assert.equal(r.failed, 0); assert.equal(f.channels.size, 21); assert.equal(f.roles.size, 35);
    assert.equal(f.repo.loadDraftPicks('l').length, 20);
    const settings = f.repo.loadSettings('l'); assert.equal(Object.keys(settings.discordChannels).length, 22); assert.equal(settings.gamesChannelId, settings.discordChannels.games);
    assert.ok(settings.discordPins.standingsMessageId); assert.ok(settings.discordPins.statsMessageId); assert.ok(settings.discordPins.liveMockMessageId); assert.ok(settings.discordPins.tradeBuilderMessageId); assert.ok(settings.discordPins.tradeCountsMessageId); assert.ok(settings.discordPins.playerUpgradesMessageId); assert.ok(settings.discordPins.freeAgencyMessageId); assert.equal(settings.discordChannels.freeAgencyProof, settings.discordChannels.staff);
    f.repo.saveTrades('l', [{ tradeId: 'completed', leagueId: 'l', seasonId: '1', status: 'COMPLETED', participatingTeams: ['bos'] }]);
    const workflow = createDiscordTradeWorkflow({ repository: f.repo }); await workflow.refreshTradeCounts(f.guild);
    const countPin = f.channels.get(settings.discordChannels.tradeCounts)._messages.get(settings.discordPins.tradeCountsMessageId);
    assert.ok(countPin.embeds[0].data.fields[0].value.includes('1/5'));
    assert.ok(countPin.embeds[0].data.fields[0].value.includes('<:bos:111> **Boston Celtics**'));
    const pins = () => [...f.channels.values()].flatMap(channel => [...channel._messages.values()].filter(message => message.pinned));
    assert.equal(pins().length, 11);
    const upgradesChannel = f.channels.get(settings.discordChannels.playerUpgrades), tradeProofChannel = f.channels.get(settings.discordChannels.tradeProof);
    tradeProofChannel.position = 12; upgradesChannel.position = 30; upgradesChannel.setPosition = async position => { upgradesChannel.position = position; };
    assert.equal((await f.service.ensure(f.guild, 'admin')).reused, 20);
    assert.equal(upgradesChannel.position, 13); assert.equal(pins().length, 11);
    const oldPin = settings.discordPins.tradeBuilderMessageId; f.channels.get(settings.discordChannels.submitTrade)._messages.delete(oldPin);
    await f.service.ensure(f.guild, 'admin'); assert.notEqual(f.repo.loadSettings('l').discordPins.tradeBuilderMessageId, oldPin); assert.equal(pins().length, 11);
    assert.equal(f.channels.size, 21); assert.equal(f.repo.loadAuditLog('l')[0].userId, 'admin');
});
test('private staff and committee access is isolated; coaches can chat but cannot post to feeds', async t => { const f = fixture(t); await f.service.ensure(f.guild, 'admin'); const ids = f.repo.loadSettings('l').discordChannels, role = name => [...f.roles.values()].find(r => r.name === name).id, coach = role('LEAGUEbuddy Coach'), committee = role('LEAGUEbuddy Trade Committee'); const perms = key => f.channels.get(ids[key]).overwrites; assert.ok(perms('staff').find(p => p.id === 'g').deny.includes(P.ViewChannel)); assert.ok(!perms('staff').some(p => [coach, committee].includes(p.id))); assert.ok(perms('tradeCommittee').find(p => p.id === committee).allow.includes(P.ViewChannel)); assert.ok(!perms('tradeCommittee').some(p => p.id === coach)); assert.ok(perms('chat').find(p => p.id === coach).allow.includes(P.SendMessages)); assert.ok(perms('standings').find(p => p.id === coach).deny.includes(P.SendMessages)); assert.ok(perms('games').find(p => p.id === 'bot').allow.includes(P.CreatePrivateThreads)); const { canManageLeague } = require('../src/fantasyhq/discord-permissions'); assert.equal(canManageLeague({ guildId: 'g', member: { roles: [committee] }, guild: { roles: { cache: f.roles } } }), false); });
test('reuses existing named channels and saved renamed channels; repairs deleted ones only', async t => { const f = fixture(t); const ch = await f.guild.channels.create({ name: 'lb-chat', type: 0 }); const r = await f.service.ensure(f.guild, 'admin'); assert.equal(r.created, 19); assert.equal(f.repo.loadSettings('l').discordChannels.chat, ch.id); ch.name = 'coach-lounge'; assert.equal((await f.service.ensure(f.guild, 'admin')).created, 0); f.channels.delete(f.repo.loadSettings('l').discordChannels.stats); assert.equal((await f.service.ensure(f.guild, 'admin')).created, 1); assert.equal(f.channels.size, 21); });
test('partial failures persist successes and retries create only missing channels', async t => { const f = fixture(t), create = f.guild.channels.create; f.guild.channels.create = async opts => { if (opts.name === 'lb-trade-proof') throw Error('Discord unavailable'); return create(opts); }; const r = await f.service.ensure(f.guild, 'admin'); assert.equal(r.failed, 1); assert.equal(r.created, 19); assert.ok(f.repo.loadSettings('l').gamesChannelId); f.guild.channels.create = create; const retry = await f.service.ensure(f.guild, 'admin'); assert.equal(retry.created, 1); assert.equal(retry.reused, 19); });
test('permissions and ambiguous existing channel names block unsafe setup', async t => { const f = fixture(t); f.guild.members.me.permissions.has = () => false; await assert.rejects(f.service.ensure(f.guild, 'admin'), /Manage Channels/); assert.equal(f.channels.size, 0); f.guild.members.me.permissions.has = () => true; await f.guild.channels.create({ name: 'lb-chat', type: 0 }); await f.guild.channels.create({ name: 'lb-chat', type: 0 }); const r = await f.service.ensure(f.guild, 'admin'); assert.equal(r.failed, 1); assert.match(r.errors[0], /Multiple lb-chat/); });
test('setup button rejects coaches before channel mutations', async () => { const { handleSetupFlowButton } = require('../src/fantasyhq/discord-setup'); await assert.rejects(handleSetupFlowButton({ customId: 'setupflow:channels:l', guildId: 'g', memberPermissions: { has: () => false }, member: { roles: [] } }), /Commish/); assert.equal(CHANNELS.length, 20); });
test('upgrade ledger is private to coaches and staff; public feeds stay public and read-only', async t => {
    const f = fixture(t); await f.service.ensure(f.guild, 'admin'); const ids = f.repo.loadSettings('l').discordChannels;
    const role = name => [...f.roles.values()].find(r => r.name === name).id, coach = role('LEAGUEbuddy Coach');
    // Resolve overwrites over permissive server-level permissions, including multiple roles.
    function has(key, memberRoles, permission) { const ow = f.channels.get(ids[key]).overwrites; let allowed = true; const everyone = ow.find(o => o.id === 'g'); if (everyone.deny?.includes(permission)) allowed = false; if (everyone.allow?.includes(permission)) allowed = true; const entries = ow.filter(o => memberRoles.includes(o.id)); if (entries.some(o => o.deny?.includes(permission))) allowed = false; if (entries.some(o => o.allow?.includes(permission))) allowed = true; return allowed; }
    for (const [key] of CHANNELS) { assert.equal(has(key, [], P.ViewChannel), ['announcements', 'availableTeams'].includes(key)); }
    for (const key of ['announcements', 'availableTeams', 'stats', 'standings', 'tradeCounts', 'approvedTrades', 'deniedTrades', 'playerUpgrades']) {
        for (const p of [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads]) assert.equal(has(key, [coach], p), false);
        for (const staff of ['LEAGUEbuddy Commish', 'LEAGUEbuddy Assistant Commish']) assert.equal(has(key, [coach, role(staff)], P.SendMessages), true);
    }
    assert.equal(has('playerUpgrades', [coach], P.ViewChannel), true);
    assert.equal(has('playerUpgrades', [], P.ViewChannel), false);
    assert.equal(has('games', [coach], P.SendMessages), false); assert.equal(has('games', [coach], P.SendMessagesInThreads), true); assert.equal(has('games', [coach], P.AttachFiles), true);
    const committee = role('LEAGUEbuddy Trade Committee'); assert.equal(has('tradeCommittee', [coach, committee], P.ViewChannel), true); assert.equal(has('staff', [coach, committee], P.ViewChannel), false); assert.equal(has('submitTrade', [committee], P.ViewChannel), false); assert.equal(has('submitTrade', [coach, committee], P.ViewChannel), true);
    assert.equal(has('tradeBlock', [coach], P.SendMessages), false); assert.equal(has('tradeBlock', [coach], P.SendMessagesInThreads), false); assert.equal(has('tradeBlock', [coach], P.ViewChannel), true); assert.equal(has('activity', [coach], P.SendMessages), false); assert.equal(has('activity', [coach], P.AddReactions), true); assert.equal(has('activity', [coach], P.ViewChannel), true);
    assert.equal(has('submitTrade', [role('LEAGUEbuddy GM')], P.SendMessages), true);
    assert.ok(f.channels.get(ids.submitTrade).overwrites.find(p => p.id === 'bot').allow.includes(P.ManageMessages));
    assert.ok(f.channels.get(ids.tradeCounts).overwrites.find(p => p.id === 'bot').allow.includes(P.ManageMessages));
    assert.ok(f.channels.get(ids.playerUpgrades).overwrites.find(p => p.id === 'bot').allow.includes(P.MentionEveryone));
    assert.equal(has('submitTrade', [coach], P.SendMessages), true);
});

test('existing schedule channel becomes stats without deleting history; repair reuses both feed pins', async t => {
    const f = fixture(t);
    const old = await f.guild.channels.create({ name: 'lb-schedule', type: 0 });
    old.setName = async name => { old.name = name; };
    f.repo.saveSettings('l', { discordChannels: { schedule: old.id } });
    const result = await f.service.ensure(f.guild, 'admin');
    assert.equal(result.failed, 0);
    const settings = f.repo.loadSettings('l');
    assert.equal(settings.discordChannels.stats, old.id);
    assert.equal(settings.discordChannels.schedule, undefined);
    assert.equal(old.name, 'lb-stats');
    const original = settings.discordPins.statsMessageId;
    await f.service.ensure(f.guild, 'admin');
    assert.equal(f.repo.loadSettings('l').discordPins.statsMessageId, original);
    assert.equal([...old._messages.values()].filter(m => m.pinned).length, 1);
    old._messages.get(original).pinned = false;
    await f.service.ensure(f.guild, 'admin');
    assert.equal(old._messages.get(original).pinned, true);
    assert.equal(f.repo.loadSettings('l').discordPins.statsMessageId, original);
});
test('new official stats edit the existing pinned message rather than posting another recap', async t => {
    const f = fixture(t); await f.service.ensure(f.guild, 'admin');
    const { createDiscordLeagueFeeds } = require('../src/fantasyhq/discord-league-feeds');
    let players = [];
    const feeds = createDiscordLeagueFeeds({ repository: f.repo, statsService: { getSeasonPlayerStats: () => players } });
    await feeds.ensurePins(f.guild, 'l');
    const settings = f.repo.loadSettings('l'), channel = f.channels.get(settings.discordChannels.stats);
    const message = channel._messages.get(settings.discordPins.statsMessageId), count = channel._messages.size;
    players = [{ playerId: 'p', name: 'Official Player', teamName: 'Boston Celtics', GP: 1, PPG: 30, RPG: 10, APG: 5, SPG: 2, BPG: 1, FGA: 20, FGPercent: 50, '3PA': 5, threePPercent: 40, FTA: 4, FTPercent: 100 }];
    await feeds.ensurePins(f.guild, 'l');
    assert.ok(message.embeds[0].fields[0].value.includes('Official Player'));
    assert.ok(message.embeds[0].fields[0].value.includes('30.0'));
    assert.equal(channel._messages.size, count);
    assert.equal(message.pinned, true);
});
