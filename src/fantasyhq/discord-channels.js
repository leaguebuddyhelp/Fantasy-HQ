const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { ensureLeagueRoles } = require('./discord-roles');
const CHANNEL_LAYOUT_VERSION = 5;
const CHANNELS = [
    ['announcements', 'announcements', 'publicRead', 'League announcements, deadlines and important updates.'],
    ['news', 'news', 'publicRead', 'Staff-approved league journalism, verified reports and recorded corrections.'],
    ['availableTeams', 'available-teams', 'publicRead', 'Open teams and how to join the league.'],
    ['chat', 'chat', 'chat', 'League conversation and questions for coaches and GMs.'],
    ['games', 'game-threads', 'games', 'Current-week matchups. Submit game photos inside your private matchup thread.'],
    ['streamlink', 'streamlink', 'read', 'Coach-submitted game streams, verified matchup previews and game-page links.'],
    ['activity', 'activity-check', 'activity', 'Respond to league activity checks here.'],
    ['standings', 'standings', 'read', 'Official regular-season standings, published when the week advances.'],
    ['powerRankings', 'power-rankings', 'read', 'Top 10 power rankings, updated after finalized weeks and verified preseason progression.'],
    ['stats', 'stats', 'read', 'Official regular-season stat leaders and shooting percentages, published when the week advances.'],
    ['playoffStats', 'playoff-stats', 'read', 'Playoff bracket progress and postseason statistics.'],
    ['seasonAwards', 'season-awards', 'read', 'Official season awards and winner announcements.'],
    ['playerOfWeek', 'player-of-the-week', 'read', 'East and West Player of the Week winners, automatically posted after each completed week.'],
    ['freeAgency', 'free-agency', 'read', 'Browse free agents, submit signing proof, and track offers and waiver claims using the pinned panel.'],
    ['playerUpgrades', 'player-upgrades', 'upgrades', 'Check upgrade progress and eligibility, then submit a player upgrade from the pinned panel.'],
    ['scouting', 'scouting-hub', 'chat', 'Draft classes, prospect scouting, mock drafts and live mock draft controls.'],
    ['tradeBlock', 'trade-block', 'block', 'Team trade block threads: advertise players, picks and roster needs.'],
    ['submitTrade', 'submit-trade', 'trade', 'Build and submit trades using the pinned trade panel.'],
    ['tradeProof', 'trade-proof', 'chat', 'Required in-game trade proof and completion confirmations.'],
    ['tradeCounts', 'trade-counts', 'read', 'Completed trades and remaining trade limits for every team.'],
    ['approvedTrades', 'approved-trades', 'read', 'Approved and completed trade announcements.'],
    ['deniedTrades', 'denied-trades', 'read', 'Rejected trade decisions and their reasons.'],
    ['tradeCommittee', 'trade-committee', 'committee', 'Private trade review and voting for Staff and the Trade Committee.'],
    ['staff', 'league-staff', 'staff', 'Private Staff operations: weekly report, pending work, Test Mode and league controls.'],
    ['timeOff', 'time-off', 'chat', 'Post planned absences: your team, dates away, return date and any games that need rescheduling. Staff will coordinate coverage.'],
];
function prefixedChannelName(channel) {
    if (channel.name.startsWith('lb-')) return channel.name;
    const defaults = { 'Text Channels': 'community', 'Voice Channels': 'voice-channels' };
    const suffix = defaults[channel.name] || (channel.type === ChannelType.GuildVoice && channel.name === 'General' ? 'voice' : channel.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, ''));
    return 'lb-' + (suffix || 'channel');
}
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
        function overwrites(access, key) {
            const feed = ['read', 'publicRead', 'games', 'upgrades', 'activity', 'block'].includes(access);
            const noPosting = [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads];
            return [
                { id: guild.id, ...(access === 'publicRead' ? { allow: [P.ViewChannel, P.ReadMessageHistory, ...(key === 'news' ? [P.AddReactions] : [])], deny: noPosting } : { deny: [P.ViewChannel, ...(feed ? noPosting : [])] }) },
                { id: me.id, allow: [...write, P.ManageChannels, P.ManageThreads, P.CreatePrivateThreads, ...(['trade', 'read', 'chat', 'upgrades', 'activity', 'block'].includes(access) ? [P.ManageMessages] : []), ...(['games', 'upgrades', 'activity', 'block', 'publicRead'].includes(access) ? [P.MentionEveryone] : []), ...(access === 'block' ? [P.CreatePublicThreads] : []), ...((access === 'activity' || key === 'news') ? [P.AddReactions] : [])] },
                ...staff.map(id => ({ id, allow: write })),
                ...(!['staff', 'committee'].includes(access) ? [coach, gm].map(id => ({
                    id,
                    allow: ['chat', 'trade'].includes(access) ? write : access === 'games' ? [P.ViewChannel, P.ReadMessageHistory, P.SendMessagesInThreads, P.AttachFiles, P.EmbedLinks] : (access === 'activity' || key === 'news') ? [P.ViewChannel, P.ReadMessageHistory, P.AddReactions] : [P.ViewChannel, P.ReadMessageHistory],
                    ...(feed ? { deny: noPosting.filter(p => access !== 'games' || p !== P.SendMessagesInThreads) } : {}),
                })) : []),
                ...(access === 'committee' ? [{ id: committee, allow: write }] : []),
            ];
        }
        let settings = repository.loadSettings(leagueId) || {}, ids = { ...settings.discordChannels };
        const save = () => { settings = repository.loadSettings(leagueId) || {}; repository.saveSettings(leagueId, { ...settings, discordChannels: ids, ...(ids.games ? { gamesChannelId: ids.games } : {}) }); };
        function existing(id, name, type, aliases = []) { if (id && channels.has(id)) { const ch = channels.get(id); if (ch.type !== type) throw Error(`Saved ${name} is the wrong channel type.`); return ch; } const matches = [...channels.values()].filter(c => c && [name, ...aliases].includes(c.name)); if (matches.length > 1) throw Error(`Multiple ${name} channels found; resolve duplicates before retrying.`); if (matches.length && matches[0].type !== type) throw Error(`${name} exists with the wrong channel type.`); return matches[0]; }
        let category = existing(ids.category, 'lb-league', ChannelType.GuildCategory, ['LEAGUEbuddy 2K']);
        if (!category) { category = await guild.channels.create({ name: 'lb-league', type: ChannelType.GuildCategory, permissionOverwrites: overwrites('read'), reason: 'LEAGUEbuddy league setup' }); channels.set(category.id, category); }
        if (category.name !== 'lb-league') await category.setName('lb-league', 'Use the league channel prefix');
        ids.category = category.id; save();
        const result = { created: 0, reused: 0, failed: 0, errors: [] };
        for (const [key, suffix, access, topic] of CHANNELS) {
            try {
                const channelName = `lb-${suffix}`;
                let ch = existing(ids[key] || (key === 'stats' ? ids.schedule : key === 'games' ? settings.gamesChannelId : null), channelName, ChannelType.GuildText, key === 'activity' ? ['lb-activitycheck'] : ['playoffStats', 'seasonAwards'].includes(key) ? [suffix] : []);
                if (ch) { if (ch.name !== channelName) await ch.setName(channelName, 'Consistent league channel names'); if (ch.parentId !== category.id) await ch.setParent(category.id, { lockPermissions: false, reason: 'Group league workflows together' }); if (ch.topic !== topic) await ch.setTopic(topic, 'Explain this league channel'); await ch.permissionOverwrites.set(overwrites(access, key), 'LEAGUEbuddy channel access setup'); result.reused++; }
                else { ch = await guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: category.id, topic, permissionOverwrites: overwrites(access, key), reason: 'LEAGUEbuddy league setup' }); channels.set(ch.id, ch); result.created++; }
                if (key === 'stats' && ids.schedule) {
                    if (ch.id === ids.schedule && ch.name === 'lb-schedule') await ch.setName('lb-stats', 'Replace schedule feed with season stat leaders');
                    delete ids.schedule;
                }
                ids[key] = ch.id; save();
            } catch (error) { result.failed++; result.errors.push(`lb-${suffix}: ${error.message}`); }
        }
        try {
            for (const ch of channels.values()) {
                if (!ch || Object.values(ids).includes(ch.id)) continue;
                const name = prefixedChannelName(ch);
                if (ch.name !== name) await ch.setName(name, 'Use lb- for all server channels');
            }
            const positions = CHANNELS.filter(([key]) => ids[key] && channels.has(ids[key])).map(([key], position) => ({ channel: ids[key], position }));
            await guild.channels.setPositions(positions);
        } catch (error) {
            result.failed++;
            result.errors.push(`channel names/order: ${error.message}`);
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
        const freeAgencyChannel = channels.get(ids.freeAgency);
        if (freeAgencyChannel && typeof freeAgencyChannel.messages?.fetchPins === 'function') try {
            const message = await require('./discord-free-agency').createDiscordFreeAgency({ repository }).ensurePin(guild, leagueId);
            result.freeAgencyMessageId = message.id;
        } catch (error) { result.failed++; result.errors.push(`free agency pin: ${error.message}`); }
        const upgradesChannel = channels.get(ids.playerUpgrades);
        if (upgradesChannel && typeof upgradesChannel.messages?.fetchPins === 'function') try {
            const message = await require('./discord-player-upgrades').createDiscordPlayerUpgrades({ repository }).ensurePin(guild, leagueId);
            result.playerUpgradesMessageId = message.id; result.playerUpgradesChannelId = ids.playerUpgrades;
        } catch (error) { result.failed++; result.errors.push(`player upgrades pin: ${error.message}`); }
        try { await require('./discord-league-feeds').createDiscordLeagueFeeds({ repository }).ensurePins(guild, leagueId); }
        catch (error) { result.failed++; result.errors.push(`season feed pins: ${error.message}`); }
        if(channels.get(ids.playoffStats)?.messages?.fetchPins)try {await require('./discord-postseason-stats').createDiscordPostseasonStats({repository}).ensurePin(guild,leagueId);}catch(error){result.failed++;result.errors.push('playoff stats pin: '+error.message);}
        if(channels.get(ids.seasonAwards)?.messages?.fetchPins)try {await require('./discord-awards').createDiscordAwards({repository}).ensurePin(guild,leagueId);}catch(error){result.failed++;result.errors.push('awards pin: '+error.message);}
        if(channels.get(ids.staff)?.messages?.fetchPins)try {await require('./discord-simulation').createDiscordSimulation({repository}).ensurePin(guild,leagueId);}catch(error){result.failed++;result.errors.push('simulation pin: '+error.message);}
        if(channels.get(ids.staff)?.messages?.fetchPins)try {await require('./discord-league-resets').createDiscordLeagueResets({repository}).ensurePin(guild,leagueId);}catch(error){result.failed++;result.errors.push('league reset pin: '+error.message);}
        // Refresh is queued in the existing league storage; starts never generate simulations.
        try { require('./mock-storage').requestRefresh(repository, leagueId, 'league.channels.setup', `setup:${context.seasonId}`); }
        catch (error) { result.errors.push(`mock simulations: ${error.message}`); }
        if (!result.failed) { const fresh = repository.loadSettings(leagueId); repository.saveSettings(leagueId, { ...fresh, channelLayoutVersion: CHANNEL_LAYOUT_VERSION }); }
        repository.appendAuditLog(leagueId, { action: 'league.channels.setup', userId: actorId, leagueId, seasonId: context.seasonId, timestamp: new Date().toISOString(), ...result });
        return result;
    }
    function ensure(guild, actorId) { const key = `${repository.dataRoot}:${guild.id}`; if (pending.has(key)) return pending.get(key); const task = run(guild, actorId); pending.set(key, task); return task.finally(() => pending.delete(key)); }
    return { ensure };
}
module.exports = { CHANNELS, CHANNEL_LAYOUT_VERSION, prefixedChannelName, createChannelSetupService };
