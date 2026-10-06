const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { REVEAL_COST, WEEKLY_POINTS } = require('./scouting-service');

function scoutingCard(info) {
    const prospect = info.prospect;
    const positions = [prospect.position_1, prospect.position_2].filter(value => value && value !== 'N/A').join('/');
    const details = [prospect.team || prospect.nationality, positions, prospect.class, prospect.age ? `${prospect.age} yrs` : null]
        .filter(Boolean).join(' · ');
    const size = [prospect.height, prospect.weight ? `${prospect.weight} lbs` : null, prospect.wingspan ? `${prospect.wingspan} wingspan` : null]
        .filter(Boolean).join(' · ');
    const embed = new EmbedBuilder().setColor(0xffdc21)
        .setTitle(`#${prospect.board_number} ${prospect.name || 'Prospect'}`)
        .setDescription([details, prospect.build, prospect.about].filter(Boolean).join('\n\n').slice(0, 3000));
    if (size) embed.addFields({ name: 'Measurements', value: size, inline: true });
    const stats = [
        prospect.pts != null ? `${prospect.pts} PPG` : null,
        prospect.rbs != null ? `${prospect.rbs} RPG` : null,
        prospect.ast != null ? `${prospect.ast} APG` : null,
        prospect.stls != null ? `${prospect.stls} SPG` : null,
        prospect.blks != null ? `${prospect.blks} BPG` : null,
    ].filter(Boolean).join(' · ');
    if (stats) embed.addFields({ name: 'Production', value: stats });
    const strengths = [prospect.strength_1, prospect.strength_2, prospect.strength_3].filter(Boolean).join('\n');
    const weaknesses = [prospect.weakness_1, prospect.weakness_2, prospect.weakness_3].filter(Boolean).join('\n');
    if (strengths) embed.addFields({ name: 'Strengths', value: strengths, inline: true });
    if (weaknesses) embed.addFields({ name: 'Areas to improve', value: weaknesses, inline: true });
    if (prospect.pro_comp) embed.addFields({ name: 'Pro comparison', value: prospect.pro_comp, inline: true });

    const intel = info.reveals.map(reveal => `${reveal.unlocked ? 'Unlocked' : 'Locked'} · **${reveal.label}** · ${reveal.unlocked ? `**${prospect[reveal.field]}**` : `${REVEAL_COST} points`}`);
    embed.addFields({ name: 'Scouting intel', value: intel.join('\n') });
    embed.setFooter({
        text: info.scoutingAvailable === false
            ? `Season ${info.seasonNumber} · Scouting unlocks during the regular season · ${info.level}/3 ratings unlocked`
            : `Season ${info.seasonNumber} · Week ${info.weekNumber} · ${info.remaining}/${WEEKLY_POINTS} points remaining · ${info.level}/3 ratings unlocked`
    });

    const files = [];
    if (prospect.imagePath) {
        const name = `bigboard-${prospect.board_number}${require('path').extname(prospect.imagePath).toLowerCase() || '.png'}`;
        files.push(new AttachmentBuilder(prospect.imagePath, { name }));
        embed.setThumbnail(`attachment://${name}`);
    } else if (/^https?:\/\//i.test(String(prospect.image || ''))) {
        embed.setThumbnail(prospect.image);
    }
    return { embeds: [embed], files, allowedMentions: { parse: [] } };
}

function bigBoardPagePayload(page) {
    const rows = page.prospects.map(({ prospect }) => {
        const positions = [prospect.position_1, prospect.position_2].filter(value => value && value !== 'N/A').join('/');
        const source = prospect.team || prospect.nationality || 'Unknown';
        return `**#${prospect.board_number} ${prospect.name || 'Prospect'}** · ${positions || '—'} · ${source}`;
    });
    const embed = new EmbedBuilder().setColor(0xffdc21)
        .setTitle(`Season ${page.seasonNumber} Big Board`)
        .setDescription(rows.join('\n') || 'No prospects are available for this season.')
        .setFooter({ text: `Page ${page.page + 1}/${page.totalPages} · Prospects ${page.start + 1}-${Math.min(page.start + page.prospects.length, page.total)} of ${page.total}` });
    const current = page.page;
    const controls = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('bigboard:first').setLabel('First').setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
        new ButtonBuilder().setCustomId(`bigboard:prev:${current}`).setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(current === 0),
        new ButtonBuilder().setCustomId(`bigboard:next:${current}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(current >= page.totalPages - 1),
        new ButtonBuilder().setCustomId('bigboard:last').setLabel('Last').setStyle(ButtonStyle.Secondary).setDisabled(current >= page.totalPages - 1),
    );
    const selection = new StringSelectMenuBuilder()
        .setCustomId(`bigboard:select:${current}`)
        .setPlaceholder('Select a player for the full scouting card')
        .addOptions(page.prospects.map(({ prospect }) => {
            const position = [prospect.position_1, prospect.position_2].filter(value => value && value !== 'N/A').join('/');
            return {
                label: `#${prospect.board_number} ${prospect.name || 'Prospect'}`.slice(0, 100),
                description: [position, prospect.team || prospect.nationality].filter(Boolean).join(' · ').slice(0, 100) || 'Prospect',
                value: String(prospect.board_number),
            };
        }));
    return { embeds: [embed], components: [controls, new ActionRowBuilder().addComponents(selection)], allowedMentions: { parse: [] } };
}

async function handleBigBoardCommand(interaction, scoutingService) {
    const page = scoutingService.boardPage(interaction.guildId, interaction.user.id, 0);
    await interaction.editReply(bigBoardPagePayload(page));
}

async function handleBigBoardButton(interaction, scoutingService) {
    await interaction.deferUpdate();
    const [, action, pageValue] = interaction.customId.split(':');
    const current = Number(pageValue || 0);
    const requested = action === 'first' ? 0 : action === 'last' ? Number.MAX_SAFE_INTEGER
        : action === 'return' ? current
            : action === 'prev' ? current - 1 : current + 1;
    const page = scoutingService.boardPage(interaction.guildId, interaction.user.id, requested);
    await interaction.editReply(bigBoardPagePayload(page));
}

async function handleBigBoardSelect(interaction, scoutingService) {
    await interaction.deferUpdate();
    const [, , pageValue] = interaction.customId.split(':');
    const pageNumber = Number(pageValue || 0), boardPage = scoutingService.boardPage(interaction.guildId, interaction.user.id, pageNumber);
    const prospectNumber = String(interaction.values?.[0] || '');
    if (!boardPage.prospects.some(({ prospect }) => String(prospect.board_number) === prospectNumber)) {
        await interaction.editReply(bigBoardPagePayload(boardPage));
        return;
    }
    const info = scoutingService.inspect(interaction.guildId, interaction.user.id, prospectNumber);
    const back = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bigboard:return:${pageNumber}`).setLabel('Back to Big Board').setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({ ...scoutingCard(info), components: [back] });
}

async function handleScoutCommand(interaction, scoutingService) {
    const channelId = scoutingService.scoutingHubChannelId(interaction.guildId);
    if (!channelId) {
        await interaction.editReply('The Scouting Hub channel is not configured. Ask a commissioner to repair league channels.');
        return;
    }
    if (interaction.channelId !== channelId) {
        await interaction.editReply(`Scouting points can only be spent in <#${channelId}>.`);
        return;
    }
    const position = interaction.options.getString('position', true);
    const prospect = interaction.options.getString('prospect', true);
    await interaction.editReply(scoutingCard(scoutingService.scout(interaction.guildId, interaction.user.id, prospect, position)));
}

async function handleScoutingAutocomplete(interaction, scoutingService) {
    try {
        const focused = interaction.options.getFocused();
        const position = interaction.commandName === 'scout' ? interaction.options.getString('position') : null;
        await interaction.respond(scoutingService.prospects(interaction.guildId, focused, position));
    } catch {
        await interaction.respond([]);
    }
}

module.exports = { bigBoardPagePayload, handleBigBoardButton, handleBigBoardCommand, handleBigBoardSelect, handleScoutCommand, handleScoutingAutocomplete, scoutingCard };