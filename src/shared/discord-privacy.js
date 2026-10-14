const { MessageFlags } = require('discord.js');

// Slash-command responses belong to the requester. Shared feeds and announcements
// are published separately through channel messages.
function commandReplyFlags() {
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
