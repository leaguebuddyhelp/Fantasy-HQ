const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { ensureLeagueRoles } = require('./discord-roles');
const CHANNELS = [
    ['staff', 'league-staff', 'staff'], ['announcements', 'announcements', 'publicRead'], ['chat', 'chat', 'chat'],
    ['availableTeams', 'available-teams', 'publicRead'], ['stats', 'stats', 'read'], ['standings', 'standings', 'read'],
    ['games', 'game-threads', 'games'], ['scouting', 'scouting-hub', 'chat'], ['activity', 'activitycheck', 'chat'],
    ['submitTrade', 'submit-trade', 'trade'], ['tradeBlock', 'trade-block', 'chat'], ['tradeCounts', 'trade-counts', 'read'],
    ['tradeCommittee', 'trade-committee', 'committee'], ['tradeProof', 'trade-proof', 'chat'], ['playerUpgrades', 'player-upgrades', 'upgrades'],
    ['approvedTrades', 'approved-trades', 'read'], ['deniedTrades', 'denied-trades', 'read'],
];
const pending = new Map();
function createChannelSetupService(repository = require('./repository').createFantasyHQRepository()) {
    async function run(guild, actorId) {
        const context = repository.loadLeagueContext({ guildId: guild.id }), leagueId = context.league.leagueId;
        const me = guild.members.me || await guild.members.fetchMe();
        if (!me.permissions.has([P.ManageChannels, P.ManageRoles])) throw Error('Bot needs Manage Channels and Manage Roles for channel setup.');
        await ensureLeagueRoles(guild);
        const roles = await guild.roles.fetch(), channels = await guild.channels.fetch();
        const role = name => { const matches = [...roles.values()].filter(r => !r.managed && r.name.trim().toLowerCase() === name.toLowerCase()); if (matches.length !== 1) throw Error(`Expected one ${name} role. Resolve duplicate roles before channel setup.`); return matches[0].id; };
        const coach = role('LEAGUEbuddy Coach'), gm = role('LEAGUEbuddy GM'), staff = [role('LEAGUEbuddy Commish'), role('LEAGUEbuddy Assistant Commish')], committee = role('LEAGUEbuddy Trade Committee');
        const write = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks, P.SendMessagesInThreads];
        function overwrites(access) {
            const feed = ['read', 'publicRead', 'games', 'upgrades'].includes(access);
            const noPosting = [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads];
            return [
                { id: guild.id, ...(access === 'publicRead' ? { allow: [P.ViewChannel, P.ReadMessageHistory], deny: noPosting } : { deny: [P.ViewChannel, ...(feed ? noPosting : [])] }) },
                { id: me.id, allow: [...write, P.ManageChannels, P.ManageThreads, P.CreatePrivateThreads, ...(['trade', 'read', 'chat', 'upgrades'].includes(access) ? [P.ManageMessages] : []), ...(['games', 'upgrades'].includes(access) ? [P.MentionEveryone] : [])] },
                ...staff.map(id => ({ id, allow: write })),
                ...(!['staff', 'committee'].includes(access) ? [{
                    id: coach,
                    allow: ['chat', 'trade'].includes(access) ? write : access === 'games' ? [P.ViewChannel, P.ReadMessageHistory, P.SendMessagesInThreads, P.AttachFiles, P.EmbedLinks] : [P.ViewChannel, P.ReadMessageHistory],
                    ...(feed ? { deny: noPosting.filter(p => access !== 'games' || p !== P.SendMessagesInThreads) } : {}),
                }] : []),
                ...(access === 'trade' ? [{ id: gm, allow: write }] : []),
                ...(access === 'committee' ? [{ id: committee, allow: write }] : []),
            ];
        }
        let settings = repository.loadSettings(leagueId) || {}, ids = { ...settings.discordChannels };
        const save = () => { settings = repository.loadSettings(leagueId) || {}; repository.saveSettings(leagueId, { ...settings, discordChannels: ids, ...(ids.games ? { gamesChannelId: ids.games } : {}) }); };
        function existing(id, name, type) { if (id && channels.has(id)) { const ch = channels.get(id); if (ch.type !== type) throw Error(`Saved ${name} is the wrong channel type.`); return ch; } const matches = [...channels.values()].filter(c => c && c.name === name); if (matches.length > 1) throw Error(`Multiple ${name} channels found; resolve duplicates before retrying.`); if (matches.length && matches[0].type !== type) throw Error(`${name} exists with the wrong channel type.`); return matches[0]; }
        let category = existing(ids.category, 'LEAGUEbuddy 2K', ChannelType.GuildCategory);
        if (!category) { category = await guild.channels.create({ name: 'LEAGUEbuddy 2K', type: ChannelType.GuildCategory, permissionOverwrites: overwrites('read'), reason: 'LEAGUEbuddy league setup' }); channels.set(category.id, category); }
        ids.category = category.id; save();
        const result = { created: 0, reused: 0, failed: 0, errors: [] };
        for (const [key, suffix, access] of CHANNELS) {
            try {
                let ch = existing(ids[key] || (key === 'stats' ? ids.schedule : key === 'games' ? settings.gamesChannelId : null), `lb-${suffix}`, ChannelType.GuildText);
                if (ch) { await ch.permissionOverwrites.set(overwrites(access), 'LEAGUEbuddy channel access setup'); result.reused++; }
                else { ch = await guild.channels.create({ name: `lb-${suffix}`, type: ChannelType.GuildText, parent: category.id, permissionOverwrites: overwrites(access), reason: 'LEAGUEbuddy league setup' }); channels.set(ch.id, ch); result.created++; }
                if (key === 'stats' && ids.schedule) {
                    if (ch.id === ids.schedule && ch.name === 'lb-schedule') await ch.setName('lb-stats', 'Replace schedule feed with season stat leaders');
                    delete ids.schedule;
                }
                ids[key] = ch.id; save();
            } catch (error) { result.failed++; result.errors.push(`lb-${suffix}: ${error.message}`); }
        }
        try {
            const upgrades = channels.get(ids.playerUpgrades), tradeProof = channels.get(ids.tradeProof);
            if (upgrades && upgrades.parentId !== category.id && typeof upgrades.setParent === 'function') {
                await upgrades.setParent(category.id, { lockPermissions: false, reason: 'Keep Player Upgrades with LEAGUEbuddy channels' });
            }
            if (upgrades && tradeProof && typeof upgrades.setPosition === 'function' && Number.isInteger(tradeProof.position)) {
                await upgrades.setPosition(tradeProof.position + 1, { reason: 'Place Player Upgrades beside the game/trade workflow' });
            }
        } catch (error) {
            result.failed++;
            result.errors.push(`lb-player-upgrades order: ${error.message}`);
        }
        try { result.draftPicksInitialized = require('./trade-service').createTradeService({ repository }).initializeDraftPicks({ leagueId, seasonId: context.seasonId, actingUserId: actorId }).created; }
        catch (error) { result.failed++; result.errors.push(`draft picks: ${error.message}`); }
        const tradeChannels = [ids.submitTrade, ids.tradeCounts].map(id => channels.get(id)).filter(Boolean);
        if (tradeChannels.length === 2 && tradeChannels.every(channel => typeof channel.messages?.fetchPins === 'function')) try { await require('./discord-trades').createDiscordTradeWorkflow({ repository }).ensurePins(guild, leagueId); } catch (error) { result.failed++; result.errors.push(`trade pins: ${error.message}`); }
        const scoutingChannel = channels.get(ids.scouting);
        if (scoutingChannel && typeof scoutingChannel.messages?.fetchPins === 'function') try {
            const message = await require('./discord-mock-draft').createDiscordMockDraft({ repository }).ensurePin(guild, leagueId);
            result.liveMockMessageId = message.id; result.liveMockChannelId = ids.scouting;
        } catch (error) { result.failed++; result.errors.push(`live mock pin: ${error.message}`); }
        const upgradesChannel = channels.get(ids.playerUpgrades);
        if (upgradesChannel && typeof upgradesChannel.messages?.fetchPins === 'function') try {
            const message = await require('./discord-player-upgrades').createDiscordPlayerUpgrades({ repository }).ensurePin(guild, leagueId);
            result.playerUpgradesMessageId = message.id; result.playerUpgradesChannelId = ids.playerUpgrades;
        } catch (error) { result.failed++; result.errors.push(`player upgrades pin: ${error.message}`); }
        try { await require('./discord-league-feeds').createDiscordLeagueFeeds({ repository }).ensurePins(guild, leagueId); }
        catch (error) { result.failed++; result.errors.push(`season feed pins: ${error.message}`); }
        // Refresh is queued in the existing league storage; starts never generate simulations.
        try { require('./mock-storage').requestRefresh(repository, leagueId, 'league.channels.setup', `setup:${context.seasonId}`); }
        catch (error) { result.errors.push(`mock simulations: ${error.message}`); }
        repository.appendAuditLog(leagueId, { action: 'league.channels.setup', userId: actorId, leagueId, seasonId: context.seasonId, timestamp: new Date().toISOString(), ...result });
        return result;
    }
    function ensure(guild, actorId) { const key = `${repository.dataRoot}:${guild.id}`; if (pending.has(key)) return pending.get(key); const task = run(guild, actorId); pending.set(key, task); return task.finally(() => pending.delete(key)); }
    return { ensure };
}
module.exports = { CHANNELS, createChannelSetupService };
