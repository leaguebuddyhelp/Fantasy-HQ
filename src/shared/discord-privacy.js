const { MessageFlags } = require('discord.js');

// Personal work and administration are private unless explicitly classified as shared information.
const PUBLIC_COMMANDS = new Set(['website', 'promo', 'availableteams', 'standings', 'player', 'ratings', 'stats', 'teamstats', 'toptenpreview', 'freeagents']);
function commandReplyFlags(interaction) {
    const name = interaction.commandName;
    if (PUBLIC_COMMANDS.has(name)) return 0;
    const subcommand = interaction.options?.getSubcommand?.(false);
    if (name === 'schedule' && ['week', 'team', 'full'].includes(subcommand)) return 0;
    if (name === 'team' && ['list', 'roster'].includes(subcommand)) return 0;
    return MessageFlags.Ephemeral;
}
function isEphemeralMessage(message) {
    return message?.flags?.has?.(MessageFlags.Ephemeral) === true;
}
async function acknowledgePrivateComponent(interaction) {
    if (isEphemeralMessage(interaction.message)) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}
async function respondPrivately(interaction, payload) {
    if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
    if (isEphemeralMessage(interaction.message)) return interaction.update(payload);
    return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}
module.exports = { commandReplyFlags, isEphemeralMessage, acknowledgePrivateComponent, respondPrivately };
