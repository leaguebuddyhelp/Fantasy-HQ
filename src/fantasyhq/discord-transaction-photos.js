const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { requireLeagueStaff } = require('./discord-permissions');
const { downloadDiscordImage } = require('./game-submissions');

const FILE_OPTIONS = Array.from({ length: 10 }, (_, index) => `file${index + 1}`);
const MAX_LINES = 20;

function createDiscordTransactionPhotos({ repository = require('./repository').createFantasyHQRepository(), service, download = downloadDiscordImage, onRosterMovement = null } = {}) {
    const sync = service || require('./roster-photo-sync').createRosterPhotoSync({ repository, onRosterMovement });

    function leagueFor(interaction) {
        const context = repository.loadLeagueContext({ guildId: interaction.guildId });
        const leagueId = context.league.leagueId, full = repository.loadLeague(leagueId);
        // The sync service records a single commissioner identity; Discord staff act through it.
        return { leagueId, teams: full.teams, actor: { id: full.league.commissionerUserId, authorized: true } };
    }
    const teamName = (teams, teamId) => teamId ? teams.find(team => team.teamId === teamId)?.teamName || teamId : 'Free agency';
    const clip = (text, size = 1000) => text.length > size ? `${text.slice(0, size - 1)}…` : text;

    function attachmentsOf(interaction) {
        const seen = new Set(), files = [];
        for (const name of FILE_OPTIONS) {
            const file = interaction.options.getAttachment(name);
            if (file && !seen.has(file.id)) { seen.add(file.id); files.push(file); }
        }
        return files;
    }

    function readableRows(batch) {
        const rows = [], skipped = [], ignoredImages = [];
        for (const image of batch.images) {
            if (image.status !== 'READ' || !image.rows?.length) { ignoredImages.push(image.imageId); continue; }
            image.rows.forEach((row, index) => {
                const complete = row.playerId && row.teamId && row.type && row.date;
                rows.push({ key: `${image.imageId}:${index}`, ...row, ignore: !complete });
                if (!complete) skipped.push(`${image.filename}: ${clip(String(row.sourceText || row.name || 'unreadable row'), 90)}`);
            });
        }
        return { rows, skipped, ignoredImages };
    }

    function reviewPayload(batchId, teams, preview, notes) {
        const lines = preview.changes.map(change => {
            const contract = change.reportedYears || change.reportedTotal ? ` · ${change.reportedYears || '?'}yr / ${change.reportedTotal ? `$${Number(change.reportedTotal).toLocaleString('en-US')}` : '?'}` : '';
            return `**${change.name}**: ${teamName(teams, change.fromTeamId)} → ${teamName(teams, change.toTeamId)} (${change.date})${contract}${change.warnings?.length ? ` ⚠️ ${change.warnings[0]}` : ''}`;
        });
        const shown = lines.slice(0, MAX_LINES).join('\n') + (lines.length > MAX_LINES ? `\n…and ${lines.length - MAX_LINES} more.` : '');
        const embed = new EmbedBuilder().setColor(0xffdc21).setTitle('📋 Transaction Report review')
            .setDescription(clip(shown || 'No roster changes. These transactions are already recorded.', 4000))
            .addFields({ name: 'Roster changes', value: String(preview.changes.length), inline: true }, { name: 'Already recorded', value: String(preview.duplicates || 0), inline: true });
        if (preview.newPlayers?.length) embed.addFields({ name: 'New players', value: clip(preview.newPlayers.map(p => p.name).join(', ')) });
        if (preview.older?.length) embed.addFields({ name: 'Skipped, older than a verified update', value: clip(preview.older.join(', ')) });
        for (const note of notes) embed.addFields(note);
        embed.setFooter({ text: 'Nothing changes until you press Confirm. This review expires in 5 minutes.' });
        const confirmable = preview.changes.length > 0 || preview.newPlayers?.length > 0;
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`txn:confirm:${batchId}`).setLabel('Confirm and update rosters').setStyle(ButtonStyle.Success).setDisabled(!confirmable),
            new ButtonBuilder().setCustomId(`txn:cancel:${batchId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );
        return { content: '', embeds: [embed], components: [row] };
    }

    async function handle(interaction) {
        requireLeagueStaff(interaction);
        const files = attachmentsOf(interaction);
        if (!files.length) throw Error('Attach at least one Transaction Report picture.');
        const { leagueId, teams, actor } = leagueFor(interaction);
        const batch = sync.start(leagueId, actor);
        const problems = [];
        for (const file of files.slice(0, 10)) {
            try {
                if (file.contentType && !/^(image\/|application\/octet-stream)/.test(file.contentType)) throw Error('Only pictures (JPG, PNG, WebP or HEIC) can be read.');
                await sync.upload(leagueId, actor, batch.id, { bytes: await download(file), filename: file.name });
            } catch (error) { problems.push(`${file.name}: ${error.message}`); }
        }
        const current = sync.inspect(leagueId, actor, batch.id);
        for (const image of current.images) if (image.status === 'FAILED') problems.push(`${image.filename}: ${image.error}`);
        const { rows, skipped, ignoredImages } = readableRows(current);
        const notes = [];
        if (problems.length) notes.push({ name: 'Files that could not be read', value: clip(problems.join('\n')) });
        if (skipped.length) notes.push({ name: `Rows skipped (${skipped.length}) — player, team or date unclear`, value: clip(skipped.slice(0, 8).join('\n')) });
        if (!rows.some(row => !row.ignore)) {
            await interaction.editReply({ content: `No complete transaction rows could be read.\n${problems.concat(skipped).slice(0, 8).join('\n')}\nTry a clearer or tighter crop that shows the DATE, TYPE and NEWS columns, or use the website roster upload.`, embeds: [], components: [] });
            return;
        }
        let preview;
        try { preview = sync.prepare(leagueId, actor, batch.id, { rows, reviewedAllImages: true, ignoredImages }); }
        catch (error) { await interaction.editReply({ content: `Could not prepare these transactions: ${error.message}\nFix the picture or use the website roster upload for manual matching.`, embeds: [], components: [] }); return; }
        await interaction.editReply(reviewPayload(batch.id, teams, preview, notes));
    }

    async function button(interaction) {
        const [, action, batchId] = interaction.customId.split(':');
        await interaction.deferUpdate();
        try {
            requireLeagueStaff(interaction);
            if (action === 'cancel') { await interaction.editReply({ content: 'Cancelled. No rosters were changed.', embeds: [], components: [] }); return; }
            const { leagueId, actor } = leagueFor(interaction);
            const batch = sync.inspect(leagueId, actor, batchId);
            if (batch.receipt) { await interaction.editReply({ content: 'These transactions were already saved.', embeds: [], components: [] }); return; }
            if (!batch.preview?.token) throw Error('This review is no longer available. Run /transactions again.');
            const receipt = sync.confirm(leagueId, actor, batchId, batch.preview.token);
            const moved = receipt.changes.filter(change => change.fromTeamId !== change.toTeamId).length;
            await interaction.editReply({ content: `✅ Rosters updated by <@${interaction.user.id}>: ${moved} player move${moved === 1 ? '' : 's'} saved, ${receipt.duplicates || 0} already recorded. A backup was taken first.`, embeds: [], components: [] });
        } catch (error) {
            await interaction.editReply({ content: error.message, embeds: [], components: [] }).catch(() => { });
        }
    }
    return { handle, button };
}

module.exports = { createDiscordTransactionPhotos, FILE_OPTIONS };
