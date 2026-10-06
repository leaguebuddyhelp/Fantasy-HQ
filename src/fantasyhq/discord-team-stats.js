const { EmbedBuilder } = require('discord.js');
const { teamLabel } = require('../shared/team-emojis');
const { brandTeamReply } = require('../shared/team-branding');

function average(value) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '—';
}

function percentage(value) {
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(1)}%`;
}

function createDiscordTeamStatsHandlers({ repository, teamStatsService }) {
    async function handleTeamStatsCommand(interaction) {
        const context = repository.loadLeagueContext({ guildId: interaction.guildId });
        const teamId = interaction.options.getString('team', true);
        const team = context.teams.find(candidate => candidate.teamId === teamId);
        if (!team) throw new Error('Choose a team from this league.');
        const stats = teamStatsService.getTeamSeasonStats(context.league.leagueId, context.seasonId, teamId);
        if (!stats || stats.GP === 0) {
            await interaction.editReply(`No official regular-season team statistics yet for ${team.teamName}.`);
            return;
        }
        const record = `${stats.W}-${stats.L}`;
        const pct = Number(stats.PCT).toFixed(3).replace(/^0\./, '.');
        const diff = `${stats.AVG_DIFF > 0 ? '+' : ''}${Number(stats.AVG_DIFF).toFixed(1)}`;
        const embed = new EmbedBuilder().setColor(0xffdc21)
            .setTitle(teamLabel(team.teamName))
            .setDescription(`${context.league.leagueName} · Season ${context.league.seasonNumber}\nREGULAR SEASON`)
            .addFields(
                { name: 'Record', value: `${record} · ${pct}`, inline: true },
                { name: 'PPG', value: average(stats.PPG), inline: true },
                { name: 'Opp PPG', value: average(stats.OPP_PPG), inline: true },
                { name: 'Diff', value: diff, inline: true },
                { name: 'RPG', value: average(stats.RPG), inline: true },
                { name: 'APG', value: average(stats.APG), inline: true },
                { name: 'SPG', value: average(stats.SPG), inline: true },
                { name: 'BPG', value: average(stats.BPG), inline: true },
                { name: 'TOV', value: average(stats.TOV), inline: true },
                { name: 'FG', value: percentage(stats.FGPercent), inline: true },
                { name: '3PT', value: percentage(stats.threePPercent), inline: true },
                { name: 'FT', value: percentage(stats.FTPercent), inline: true },
            );
        embed.setFooter({ text: `${stats.GP} official games` });
        await interaction.editReply(brandTeamReply({ embeds: [embed], allowedMentions: { parse: [] } }, team.teamName));
    }

    async function handleTeamStatsAutocomplete(interaction) {
        try {
            const context = repository.loadLeagueContext({ guildId: interaction.guildId });
            const focused = String(interaction.options.getFocused() || '').toLowerCase();
            const choices = context.teams
                .filter(team => !focused || `${team.teamName} ${team.abbreviation} ${team.teamId}`.toLowerCase().includes(focused))
                .sort((left, right) => left.teamName.localeCompare(right.teamName))
                .slice(0, 25)
                .map(team => ({ name: `${team.abbreviation} · ${team.teamName}`.slice(0, 100), value: team.teamId }));
            await interaction.respond(choices);
        } catch {
            await interaction.respond([]);
        }
    }

    return { handleTeamStatsCommand, handleTeamStatsAutocomplete };
}

module.exports = { createDiscordTeamStatsHandlers };