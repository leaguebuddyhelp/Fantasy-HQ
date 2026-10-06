const { EmbedBuilder } = require('discord.js');

function rate(value) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '—';
}

function pct(value) {
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(1)}%`;
}

function createDiscordPlayerStatsHandlers({ repository, playerService, statsService }) {
    async function handleStatsCommand(interaction) {
        const context = repository.loadLeagueContext({ guildId: interaction.guildId });
        const playerId = interaction.options.getString('player', true);
        const player = playerService.getPlayer(context.league.leagueId, context.seasonId, playerId);
        const result = statsService.getPlayerStatsAndGameLog(context.league.leagueId, context.seasonId, player.playerId);
        const stats = result.stats;
        if (!stats || stats.GP === 0) {
            await interaction.editReply(`No official regular-season statistics yet for ${player.name}. Age ${player.age ?? "—"} · Trade Value ${Number(player.tradeValue || 1).toLocaleString("en-US")}.`);
            return;
        }
        const embed = new EmbedBuilder().setColor(0xffdc21).setTitle(player.name)
            .setDescription(`${player.teamName || 'Free Agent'} · Age ${player.age ?? '—'} · Trade Value ${Number(player.tradeValue || 1).toLocaleString('en-US')}\n\nREGULAR SEASON`)
            .addFields(
                { name: 'Games', value: String(stats.GP), inline: true },
                { name: 'MPG', value: rate(stats.MPG), inline: true },
                { name: 'PPG', value: rate(stats.PPG), inline: true },
                { name: 'RPG', value: rate(stats.RPG), inline: true },
                { name: 'APG', value: rate(stats.APG), inline: true },
                { name: 'SPG', value: rate(stats.SPG), inline: true },
                { name: 'BPG', value: rate(stats.BPG), inline: true },
                { name: 'TOV', value: rate(stats.TOV), inline: true },
                { name: 'FG%', value: pct(stats.FGPercent), inline: true },
                { name: '3P%', value: pct(stats.threePPercent), inline: true },
                { name: 'FT%', value: pct(stats.FTPercent), inline: true },
            );
        const lastGame = result.games.at(-1);
        if (lastGame) {
            const summary = lastGame.DNP
                ? `DNP · ${lastGame.result} vs ${lastGame.opponent} (${lastGame.score})`
                : `${lastGame.PTS} PTS · ${lastGame.REB} REB · ${lastGame.AST} AST · ${lastGame.result} vs ${lastGame.opponent} (${lastGame.score})`;
            embed.addFields({ name: 'Last Game', value: `Week ${lastGame.week} · ${summary}` });
        }
        embed.setFooter({ text: `Season ${context.league.seasonNumber} · Official games only` });
        await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    }

    async function handleStatsAutocomplete(interaction) {
        try {
            const context = repository.loadLeagueContext({ guildId: interaction.guildId });
            const focused = String(interaction.options.getFocused() || '').toLowerCase();
            const choices = playerService.listPlayers(context.league.leagueId, context.seasonId)
                .filter(player => !focused || `${player.name} ${player.teamName || 'Free Agent'}`.toLowerCase().includes(focused))
                .sort((left, right) => left.name.localeCompare(right.name))
                .slice(0, 25)
                .map(player => ({ name: `${player.name} · ${player.teamName || 'Free Agent'} · Age ${player.age ?? '—'} · TV ${Number(player.tradeValue || 1).toLocaleString('en-US')}`.slice(0, 100), value: player.playerId }));
            await interaction.respond(choices);
        } catch {
            await interaction.respond([]);
        }
    }

    return { handleStatsCommand, handleStatsAutocomplete };
}

module.exports = { createDiscordPlayerStatsHandlers };