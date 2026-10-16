const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { requireLeagueStaff } = require('./discord-permissions');
function actor(interaction) { requireLeagueStaff(interaction); return { authorized: true, id: interaction.user.id, operator: interaction.user.username || interaction.user.id }; }
function recreatePreviewPayload(preview) {
    return { embeds: [new EmbedBuilder().setColor(0xffdc21).setTitle(`REPLACE WEEK ${preview.week} GAME THREADS`).setDescription(`**${preview.status} · ${preview.total} scheduled games**\n\n${preview.found} existing threads will be deleted and recreated. ${preview.already} are already missing or cleaned. ${preview.failed} could not be checked.\n\nThis replaces every active-week Discord thread, regardless of game or submission status. Saved game results, screenshots, stats and submission history remain attached to their games. Messages or uploads not yet saved into LEAGUEbuddy will be lost.`)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gamerecreate:cancel:${preview.week}:${preview.token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`gamerecreate:confirm:${preview.week}:${preview.token}`).setLabel(`Replace ${preview.total} Threads`).setStyle(ButtonStyle.Danger))], allowedMentions: { parse: [] } };
}
function creationPayload(result) {
    return { embeds: [new EmbedBuilder().setColor(result.failed ? 0xe67e22 : 0xffdc21).setTitle(`WEEK ${result.week} GAME THREADS`).setDescription(`${result.created} created · ${result.existing} reused · ${result.failed} failed${result.cleaned ? ` · ${result.cleaned} intentionally cleaned` : ''}\n${result.deadlineAt ? `Deadline: <t:${Math.floor(Date.parse(result.deadlineAt) / 1000)}:F>` : 'Countdown starts after the first thread is created.'}\n\nRun /games create again to repair missing threads without replacing conversations or resetting the clock.${result.failed ? '\n'+result.errors.slice(0,5).map(e=>e.message).join('\n') : ''}${result.announcementError ? '\nWeekly announcement needs retry: '+result.announcementError : ''}`)], components: [], allowedMentions: { parse: [] } };
}
async function handleGameThreads(interaction, service, cleanupService, postseason) {
    const a = actor(interaction);
    const phase = service.repository.loadLeagueContext({ guildId: interaction.guildId }).league.currentPhase;
    if (phase === 'PLAYOFFS') {
        if (!postseason) throw Error('Postseason creation is unavailable. Restart the connected bot.');
        if (interaction.options?.getBoolean?.('replace') === true) throw Error('Postseason threads are reused by series. Use /games create without replace.');
        await postseason.createThreads(interaction.guild);
        await interaction.editReply({ content: 'Postseason game threads created or repaired. Run /games create again when the next games or round are ready.', components: [] });
        return;
    }
    if (interaction.options?.getBoolean?.('replace') !== true) {
        const result = await service.create(interaction.guild);
        await interaction.editReply(creationPayload(result));
        return;
    }
    const current = service.status(interaction.guildId);
    const preview = await cleanupService.prepare(interaction.guild, a, current.week);
    preview.total = current.games.length;
    await interaction.editReply(recreatePreviewPayload(preview));
}
async function handleGameThreadsButton(interaction, service, cleanupService) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const [, action, weekText, token] = interaction.customId.split(':'), a = actor(interaction), week = Number(weekText);
        if (action === 'cancel') { cleanupService.cancel(token, a); await interaction.editReply('Thread replacement cancelled.'); return; }
        if (service.status(interaction.guildId).week !== week) throw Error('Active week changed. Refresh and try again.');
        const removed = await cleanupService.cleanup(interaction.guild, a, token);
        const reopened = await service.reopenCleanedWeek(interaction.guildId, week);
        const created = await service.create(interaction.guild);
        const errors = [...removed.errors.map(e => e.error), ...created.errors.map(e => e.message)];
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(created.failed || removed.failed ? 0xe67e22 : 0xffdc21).setTitle(`WEEK ${week} THREAD REPLACEMENT`).setDescription(`${removed.deleted} Old threads deleted\n${created.created} New threads created\n${created.existing} Threads reused after a deletion failure\n${created.failed} Creations failed\n${reopened} cleaned game links reopened\n\nSaved results, screenshots, stats and submission history remain preserved.${errors.length ? '\n\n' + errors.slice(0, 6).join('\n') : ''}`)], components: [], allowedMentions: { parse: [] } });
    } catch (error) { await interaction.editReply(error.message); }
}
module.exports = { creationPayload, handleGameThreads, handleGameThreadsButton, recreatePreviewPayload };
