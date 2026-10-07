const EXPIRED_INTERACTION_CODES = new Set([10062, 40060]);

async function replyInteractionError(interaction, error, logger = console) {
    logger.error(error);
    const content = `Error: ${error.message}`;
    try {
        if (interaction.deferred || interaction.replied) await interaction.editReply(content);
        else await interaction.reply({ content, flags: require("discord.js").MessageFlags.Ephemeral });
    } catch (responseError) {
        if (!EXPIRED_INTERACTION_CODES.has(Number(responseError.code))) logger.error("Could not send interaction error response:", responseError);
    }
}

module.exports = { replyInteractionError };