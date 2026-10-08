const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags, ChannelType } = require('discord.js');

function validateStreamUrl(value) {
  const input = String(value).trim();
  if (!input || input.length > 500 || /[\s<>]/.test(input)) throw Error('Enter a valid HTTP or HTTPS stream URL.');
  let url;
  try { url = new URL(input); } catch { throw Error('Enter a valid HTTP or HTTPS stream URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw Error('Enter a valid HTTP or HTTPS stream URL.');
  // Encode Markdown delimiters before displaying the coach-provided URL.
  return url.href.replaceAll('(', '%28').replaceAll(')', '%29');
}

function createGameStreamlinkHandler(service, { publish = null } = {}) {
  return async function handle(interaction) {
    try {
      const [, gameId] = interaction.customId.split(':');
      const actor = { guildId: interaction.guildId, discordThreadId: interaction.channelId,
        privateThread: interaction.channel?.type === ChannelType.PrivateThread, userId: interaction.user.id };
      // Either participating coach can act: coaches determine home in-game, not in stored league data.
      const authorize = () => service.authorizeExtraction(gameId, actor);
      authorize();
      if (interaction.isButton()) {
        const field = new TextInputBuilder().setCustomId('url').setLabel('Home coach: paste your stream URL').setPlaceholder('https://www.twitch.tv/yourchannel')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(500);
        const previous = service.load(gameId).game.streamlink?.url;
        if (previous) field.setValue(previous);
        await interaction.showModal(new ModalBuilder().setCustomId(`gamestreamsave:${gameId}`).setTitle('Home team Streamlink')
          .addComponents(new ActionRowBuilder().addComponents(field)));
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const url = validateStreamUrl(interaction.fields.getTextInputValue('url'));
      await service.mutate(gameId, record => {
        authorize();
        const at = new Date().toISOString();
        record.game.sportsbookLockedAt ||= at;
        record.game.streamlinkHistory ||= [];
        record.game.streamlinkHistory.push({ url, userId: actor.userId, at });
        record.game.streamlink = { url, submittedBy: actor.userId, submittedAt: record.game.streamlink?.submittedAt || at, updatedAt: at };
      });
      const record = service.load(gameId);
      let announcementError = null;
      if (publish) try { await publish(interaction.guild, gameId); } catch(error) { announcementError = error.message; }
      try {
        const message = await interaction.channel.messages.fetch(record.game.discordMessageId);
        await message.edit(require('./discord-game-submissions').gamePayload(record.game, require('./game-activity').activityView(record)));
      } catch {
        await interaction.editReply('Streamlink saved, but the matchup message could not refresh. Click Streamlink again to retry, or ask Staff to repair the game message.');
        return;
      }
      await interaction.editReply(announcementError ? 'Streamlink saved and game betting locked. The announcement needs a retry: ' + announcementError : '📺 Streamlink posted. Game betting is locked.');
    } catch (error) {
      if (interaction.deferred || interaction.replied) await interaction.editReply(error.message);
      else await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
    }
  };
}
module.exports = { validateStreamUrl, createGameStreamlinkHandler };
