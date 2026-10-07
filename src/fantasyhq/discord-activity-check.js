const { EmbedBuilder } = require('discord.js');
const { requireLeagueStaff } = require('./discord-permissions');
const REACTION = '✅', WINDOW_MS = 24 * 3600000;
function payload(check, closed) {
    const ts = Math.floor(Date.parse(check.deadlineAt) / 1000);
    const embed = new EmbedBuilder().setColor(closed ? 0x808080 : 0xffdc21).setTitle(closed ? '🛑 ACTIVITY CHECK CLOSED' : '✅ ACTIVITY CHECK')
        .setDescription(closed
            ? `This check closed <t:${ts}:F>.${check.responded != null ? `\n**${check.responded}** coaches checked in.` : ''}`
            : `React with ${REACTION} below to confirm you are active.\n\nDeadline: <t:${ts}:F>\nTime Remaining: <t:${ts}:R>`);
    return { embeds: [embed], allowedMentions: { parse: [], roles: closed || !check.roleId ? [] : [check.roleId] }, ...(closed || !check.roleId ? {} : { content: `<@&${check.roleId}>` }) };
}
function createDiscordActivityCheck({ repository = require('./repository').createFantasyHQRepository(), now = () => Date.now() } = {}) {
    async function channelFor(guild, leagueId) {
        const id = repository.loadSettings(leagueId)?.discordChannels?.activity;
        const channel = id && await guild.channels.fetch(id).catch(() => null);
        if (!channel?.send) throw Error('Activity check channel not found. Run channel setup first.');
        return channel;
    }
    async function start(interaction) {
        requireLeagueStaff(interaction);
        const guild = interaction.guild, leagueId = repository.loadLeagueContext({ guildId: guild.id }).league.leagueId;
        const channel = await channelFor(guild, leagueId);
        const settings = repository.loadSettings(leagueId) || {}, open = settings.activityCheck;
        if (open && !open.closedAt && Date.parse(open.deadlineAt) > now()) throw Error(`An activity check is already open until <t:${Math.floor(Date.parse(open.deadlineAt) / 1000)}:F>.`);
        const roles = await guild.roles.fetch();
        const coach = [...roles.values()].find(r => !r.managed && r.name.trim().toLowerCase() === 'leaguebuddy coach');
        const check = { channelId: channel.id, deadlineAt: new Date(now() + WINDOW_MS).toISOString(), roleId: coach?.id || null, startedBy: interaction.user.id };
        const message = await channel.send(payload(check, false));
        check.messageId = message.id;
        await message.react(REACTION);
        const fresh = repository.loadSettings(leagueId) || {};
        repository.saveSettings(leagueId, { ...fresh, activityCheck: check });
        await interaction.editReply(`Activity check posted in <#${channel.id}>. It closes <t:${Math.floor(Date.parse(check.deadlineAt) / 1000)}:R>.`);
    }
    async function close(guild, leagueId, check) {
        const channel = await channelFor(guild, leagueId), message = await channel.messages.fetch(check.messageId).catch(() => null);
        if (message) {
            const reaction = message.reactions.cache.get(REACTION);
            const users = reaction ? await reaction.users.fetch() : new Map();
            check.responded = [...users.values()].filter(u => !u.bot).length;
            await message.edit(payload(check, true));
        }
        check.closedAt = new Date(now()).toISOString();
        const fresh = repository.loadSettings(leagueId) || {};
        repository.saveSettings(leagueId, { ...fresh, activityCheck: check });
    }
    let running;
    async function sweep(client) {
        for (const guild of client.guilds.cache.values()) {
            let leagueId;
            try { leagueId = repository.loadLeagueContext({ guildId: guild.id }).league.leagueId; } catch { continue; }
            const check = repository.loadSettings(leagueId)?.activityCheck;
            if (!check || check.closedAt || Date.parse(check.deadlineAt) > now()) continue;
            try { await close(guild, leagueId, { ...check }); } catch (error) { console.error('Activity check close:', error.message); }
        }
    }
    function tick(client) { if (!running) running = sweep(client).finally(() => { running = null; }); return running; }
    return { start, tick };
}
module.exports = { createDiscordActivityCheck, payload, REACTION, WINDOW_MS };
