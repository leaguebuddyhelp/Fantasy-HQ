const { EmbedBuilder } = require('discord.js');
const { isDeepStrictEqual } = require('node:util');
const { teamLabel } = require('../shared/team-emojis');
const { fetchPinnedMessages } = require('../shared/discord-pins');
const { standingsPayload } = require('./discord-standings');
const CATEGORIES = [
    ['🏀 Points', 'PPG'], ['💪 Rebounds', 'RPG'], ['🎯 Assists', 'APG'],
    ['🖐️ Steals', 'SPG'], ['🛡️ Blocks', 'BPG'],
    ['🥅 FG%', 'FGPercent', 'FGA'], ['🔥 3PT%', 'threePPercent', '3PA'], ['🎟️ FT%', 'FTPercent', 'FTA'],
];
const pending = new Map();
function statsPayload(players, context, scope = 'REGULAR_SEASON') {
    const embed = new EmbedBuilder().setColor(0xffdc21).setTitle('📊 SEASON STAT LEADERS')
        .setDescription(`Top 5 players in each category · Published after week advancement\nShooting percentages use total makes / attempts. ${scope === 'REGULAR_SEASON' ? `Minimum ${Number(context.league.currentWeek || 0) * 10} attempts per category` : 'Minimum 8 attempts per player game in this scope'}.`)
        .setFooter({ text: `Season ${context.league.seasonNumber || context.seasonId} · Week ${context.league.currentWeek || 0} · Updates when the week advances` });
    for (const [label, key, attempts] of CATEGORIES) {
        const leaders = players.filter(p => p.GP > 0 && p[key] != null && Number.isFinite(Number(p[key])) && (!attempts || (p.percentageQualification?.[key]?.eligible ?? require('./stat-qualification').qualifiesForPercentage(p, key, { scope, currentWeek: context.league.currentWeek }))))
            .sort((a, b) => b[key] - a[key] || (attempts ? b[attempts] - a[attempts] : b.GP - a.GP) || a.name.localeCompare(b.name) || String(a.playerId).localeCompare(String(b.playerId))).slice(0, 5);
        embed.addFields({ name: label, inline: true, value: leaders.map((p, i) => `**${i + 1}. ${String(p.name).slice(0, 45)}** · ${Number(p[key]).toFixed(1)}${attempts ? '%' : ''}\n${p.teamName ? teamLabel(p.teamName) : 'Free Agent'}`).join('\n') || 'No official stats yet.' });
    }
    return { embeds: [embed], allowedMentions: { parse: [] } };
}
function createDiscordLeagueFeeds({ repository = require('./repository').createFantasyHQRepository(), standingsService, statsService, logger = console } = {}) {
    standingsService ||= require('./standings-service').createStandingsService({ repository, publishedOnly: true });
    statsService ||= require('./player-stats-service').createPlayerStatsService({ repository, publishedOnly: true });
    async function upsert(guild, leagueId, key, payload) {
        const settings = repository.loadSettings(leagueId) || {}, id = settings.discordChannels?.[key];
        if (!id) return;
        const channel = await guild.channels.fetch(id);
        if (!channel?.messages?.fetchPins) return;
        const pinKey = `${key}MessageId`, signatureKey = `${key}Signature`, signature = JSON.stringify(payload.embeds.map(e => e.toJSON()));
        const pins = await fetchPinnedMessages(channel), botId = guild.members.me?.id;
        const matching = pins.filter(m => m.author.id === botId && (m.id === settings.discordPins?.[pinKey] || m.embeds[0]?.title === payload.embeds[0].data.title));
        let message = matching.find(m => m.id === settings.discordPins?.[pinKey]) || matching[0];
        if (!message && settings.discordPins?.[pinKey]) {
            try { const saved = await channel.messages.fetch(settings.discordPins[pinKey]); if (saved?.author.id === botId) message = saved; }
            catch (error) { if (Number(error.code) !== 10008) throw error; }
        }
        if (!message) message = await channel.send(payload);
        else if (settings.discordPins?.[signatureKey] !== signature || !isDeepStrictEqual(message.embeds.map(e => { const { type, ...data } = e.toJSON ? e.toJSON() : e.data || e; return data; }), JSON.parse(signature))) await message.edit(payload);
        if (!message.pinned) await message.pin('LEAGUEbuddy automatic season feed');
        for (const duplicate of matching.filter(m => m.id !== message.id)) await duplicate.unpin('Remove duplicate league feed pin');
        const fresh = repository.loadSettings(leagueId) || {};
        if (fresh.discordPins?.[pinKey] !== message.id || fresh.discordPins?.[signatureKey] !== signature) repository.saveSettings(leagueId, { ...fresh, discordPins: { ...fresh.discordPins, [pinKey]: message.id, [signatureKey]: signature } });
        return message;
    }
    function ensureAvailableTeams(guild, leagueId) {
        const key = `available:${repository.dataRoot}:${guild.id}`;
        if (pending.has(key)) return pending.get(key);
        const task = (async () => {
            let message, signature;
            do {
                const context = repository.loadLeague(leagueId), owners = repository.loadOwners(leagueId);
                signature = JSON.stringify(owners);
                message = await upsert(guild, leagueId, 'availableTeams', require('./discord-available-teams').availableTeamsPayload(context, owners));
            } while (signature !== JSON.stringify(repository.loadOwners(leagueId)));
            return message;
        })().finally(() => pending.delete(key));
        pending.set(key, task);
        return task;
    }
    async function run(guild, leagueId) {
        const context = repository.loadLeague(leagueId);
        const results = await Promise.allSettled([
            ensureAvailableTeams(guild, leagueId),
            upsert(guild, leagueId, 'standings', standingsPayload(standingsService.getStandings(leagueId, context.seasonId))),
            upsert(guild, leagueId, 'stats', statsPayload(statsService.getSeasonPlayerStats(leagueId, context.seasonId), context)),
        ]);
        const errors = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
        if (errors.length) throw Error(errors.join('; '));
        return results.map(r => r.value);
    }
    function ensurePins(guild, leagueId) {
        const key = `${repository.dataRoot}:${guild.id}`;
        if (pending.has(key)) return pending.get(key);
        const task = run(guild, leagueId).finally(() => pending.delete(key)); pending.set(key, task); return task;
    }
    let running;
    async function refresh(client) {
        for (const guild of client.guilds.cache.values()) {
            let context;
            try { context = repository.loadLeagueContext({ guildId: guild.id }); } catch { continue; }
            const leagueId = context.league.leagueId, channels = repository.loadSettings(leagueId)?.discordChannels;
            if (!channels?.category) continue;
            try {
                if (!channels.stats || channels.schedule) await require('./discord-channels').createChannelSetupService(repository).ensure(guild, client.user.id);
                await ensurePins(guild, leagueId);
            } catch (error) { logger.error('League feeds:', error.message); }
        }
    }
    function tick(client) { if (!running) running = refresh(client).finally(() => { running = null; }); return running; }
    return { ensurePins, ensureAvailableTeams, tick };
}
module.exports = { CATEGORIES, statsPayload, createDiscordLeagueFeeds };
