const { ChannelType } = require('discord.js');
const { nbaPlayerCard } = require('../shared/discord-player-card');
const { requireLeagueStaff } = require('./discord-permissions');

function createDiscordTradeBlock({ repository, playerService }) {
    function context(guildId) {
        const ctx = repository.loadLeagueContext({ guildId });
        return { ...ctx, leagueId: ctx.league.leagueId };
    }
    function load(leagueId) {
        const block = (repository.loadSettings(leagueId) || {}).tradeBlock || {};
        return { threads: { ...block.threads }, entries: [...(block.entries || [])] };
    }
    function save(leagueId, block) {
        repository.saveSettings(leagueId, { ...(repository.loadSettings(leagueId) || {}), tradeBlock: block });
    }
    function coachTeam(ctx, interaction) {
        return require('./coach-identity').requireCoachIdentity(repository, ctx, interaction.member, interaction.user.id).team;
    }
    async function parentChannel(guild, leagueId) {
        const id = repository.loadSettings(leagueId)?.discordChannels?.tradeBlock;
        const channel = id && await guild.channels.fetch(id).catch(() => null);
        if (!channel?.threads) throw Error('Trade block channel not found. Run channel setup first.');
        return channel;
    }
    async function ensureThread(guild, ctx, team, parent) {
        const block = load(ctx.leagueId), saved = block.threads[team.teamId];
        let thread = saved && await guild.channels.fetch(saved).catch(() => null);
        if (!thread) {
            thread = await parent.threads.create({ name: `${team.teamName} Trade Block`.slice(0, 100), type: ChannelType.PublicThread, autoArchiveDuration: 10080, reason: 'LEAGUEbuddy trade block' });
            const fresh = load(ctx.leagueId);
            save(ctx.leagueId, { ...fresh, threads: { ...fresh.threads, [team.teamId]: thread.id } });
        } else if (thread.archived) await thread.setArchived(false);
        return thread;
    }
    async function setup(interaction) {
        requireLeagueStaff(interaction);
        const ctx = context(interaction.guildId), parent = await parentChannel(interaction.guild, ctx.leagueId);
        let ready = 0; const failed = [];
        for (const team of ctx.teams) {
            try { await ensureThread(interaction.guild, ctx, team, parent); ready++; } catch (error) { failed.push(`${team.teamName}: ${error.message}`); }
        }
        await interaction.editReply(`Trade block threads ready for ${ready} of ${ctx.teams.length} teams in <#${parent.id}>.${failed.length ? '\n' + failed.join('\n') : ''}`);
    }
    function ownedPlayers(ctx, teamId) {
        return playerService.listPlayers(ctx.leagueId, ctx.seasonId).filter(player => player.teamId === teamId);
    }
    async function add(interaction) {
        const ctx = context(interaction.guildId), team = coachTeam(ctx, interaction);
        const player = ownedPlayers(ctx, team.teamId).find(entry => entry.playerId === interaction.options.getString('player', true));
        if (!player) throw Error('That player is not on your roster.');
        if (load(ctx.leagueId).entries.some(entry => entry.teamId === team.teamId && entry.playerId === player.playerId)) throw Error(`${player.name} is already on your trade block.`);
        const parent = await parentChannel(interaction.guild, ctx.leagueId), thread = await ensureThread(interaction.guild, ctx, team, parent);
        const roles = await interaction.guild.roles.fetch();
        const coachRole = [...roles.values()].find(role => !role.managed && role.name.trim().toLowerCase() === 'leaguebuddy coach');
        const card = nbaPlayerCard(player, `${team.teamName} Trade Block · added by ${interaction.member?.displayName || interaction.user.username}`);
        const message = await thread.send({ ...card, content: `${coachRole ? `<@&${coachRole.id}> ` : ''}**${team.teamName}** put **${player.name}** on the trade block.`, allowedMentions: { parse: [], roles: coachRole ? [coachRole.id] : [] } });
        const fresh = load(ctx.leagueId);
        fresh.entries.push({ teamId: team.teamId, playerId: player.playerId, messageId: message.id, threadId: thread.id, addedBy: interaction.user.id, addedAt: new Date().toISOString() });
        save(ctx.leagueId, fresh);
        await interaction.editReply({ content: `${player.name} added to the ${team.teamName} trade block: <#${thread.id}>`, allowedMentions: { parse: [] } });
    }
    async function dropEntry(guild, leagueId, entry) {
        try { const thread = await guild.channels.fetch(entry.threadId); await (await thread.messages.fetch(entry.messageId)).delete(); }
        catch (error) { if (![10003, 10008].includes(Number(error.code))) throw error; }
        const fresh = load(leagueId);
        save(leagueId, { ...fresh, entries: fresh.entries.filter(item => !(item.teamId === entry.teamId && item.playerId === entry.playerId)) });
    }
    async function remove(interaction) {
        const ctx = context(interaction.guildId), team = coachTeam(ctx, interaction), playerId = interaction.options.getString('player', true);
        const entry = load(ctx.leagueId).entries.find(item => item.teamId === team.teamId && item.playerId === playerId);
        if (!entry) throw Error('That player is not on your trade block.');
        await dropEntry(interaction.guild, ctx.leagueId, entry);
        const player = playerService.listPlayers(ctx.leagueId, ctx.seasonId).find(item => item.playerId === playerId);
        await interaction.editReply({ content: `${player?.name || 'Player'} removed from the ${team.teamName} trade block.`, allowedMentions: { parse: [] } });
    }
    async function handleTradeBlockCommand(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'setup') return setup(interaction);
        if (sub === 'add') return add(interaction);
        if (sub === 'remove') return remove(interaction);
        throw Error('Unknown trade block action.');
    }
    async function handleTradeBlockAutocomplete(interaction) {
        try {
            const ctx = context(interaction.guildId), team = coachTeam(ctx, interaction);
            const focused = String(interaction.options.getFocused() || '').toLowerCase(), sub = interaction.options.getSubcommand();
            const onBlock = new Set(load(ctx.leagueId).entries.filter(entry => entry.teamId === team.teamId).map(entry => entry.playerId));
            const choices = ownedPlayers(ctx, team.teamId).filter(player => (sub === 'remove') === onBlock.has(player.playerId) && (!focused || player.name.toLowerCase().includes(focused)))
                .sort((a, b) => b.tradeValue - a.tradeValue).slice(0, 25)
                .map(player => ({ name: `${player.name} · ${player.overall ?? '—'} OVR · TV ${Number(player.tradeValue || 1).toLocaleString('en-US')}`.slice(0, 100), value: player.playerId }));
            await interaction.respond(choices);
        } catch { await interaction.respond([]); }
    }
    // Players traded or released leave the block automatically.
    let running;
    async function sweep(client) {
        for (const guild of client.guilds.cache.values()) {
            let ctx; try { ctx = context(guild.id); } catch { continue; }
            const entries = load(ctx.leagueId).entries;
            if (!entries.length) continue;
            const current = new Map(playerService.listPlayers(ctx.leagueId, ctx.seasonId).map(player => [player.playerId, player.teamId]));
            for (const entry of entries.filter(item => current.get(item.playerId) !== item.teamId)) {
                try { await dropEntry(guild, ctx.leagueId, entry); } catch (error) { console.error('Trade block cleanup:', error.message); }
            }
        }
    }
    function tick(client) { if (!running) running = sweep(client).finally(() => { running = null; }); return running; }
    return { handleTradeBlockCommand, handleTradeBlockAutocomplete, tick };
}
module.exports = { createDiscordTradeBlock };
