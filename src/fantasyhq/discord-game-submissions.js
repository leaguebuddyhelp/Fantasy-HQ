const { teamLabel } = require("../shared/team-emojis");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags } = require("discord.js");
const { requireLeagueStaff, canManageLeague } = require("./discord-permissions");
const { createGameSubmissionService } = require("./game-submissions");

function actor(source, userId) {
  return {
    guildId: source.guildId, discordThreadId: source.channelId,
    privateThread: source.channel?.type === ChannelType.PrivateThread, userId
  };
}
function submissionPayload({ game, submission, media, teamId }) {
  if (submission.mode === "TEAM_SIDES") {
    const own = media.some(m => m.teamId === teamId);
    const name = teamId === game.team1Id ? game.team1Name : game.team2Name;
    return {
      embeds: [new EmbedBuilder().setColor(0xffdc21).setTitle(media.length === 2 ? "BOX SCORES RECEIVED" : "SUBMIT SCORE")
        .setDescription(media.length === 2 ? "**2 / 2 team box scores received.** Checking scores and stats…" :
          `${own ? "Your box score is stored. Waiting for the other coach." : `Upload **${teamLabel(name)}’s** Association Box Score here. Include the full scoreboard and every player row.`}\n\n**${media.length} / 2 team box scores received.** ${submission.soloTestAuthorizedBy ? '🧪 Solo test: use Test as the other vacant team to submit its side next.' : 'Each coach submits their own team.'}`)],
      allowedMentions: { parse: [] }, components: []
    };
  }
  const count = media.length;
  const embed = new EmbedBuilder().setColor(0xffdc21);
  if (count === 2) {
    embed.setTitle("GAME SUBMISSION RECEIVED")
      .setDescription("**2 / 2 Box Scores Uploaded**\n\nReady to process.\nProcessing will begin next.");
  } else if (count === 1) {
    embed.setTitle("GAME SUBMISSION").setDescription("**1 / 2 screenshots received.**\n\nUpload the other team's box score.");
  } else {
    embed.setTitle("SUBMIT GAME").setDescription(
      `Upload both team box-score screenshots in this thread.\n\nRequired:\n• Box score for ${teamLabel(game.team1Name)}\n• Box score for ${teamLabel(game.team2Name)}\n\nMake sure the entire player table and scoreboard are visible.\n\n**0 / 2 screenshots received.**`);
  }
  return {
    embeds: [embed], allowedMentions: { parse: [] }, components: count < 2 ? [
      new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId(`gamecancel:${game.gameId}:${submission.submissionId}`)
        .setLabel("Cancel submission").setStyle(ButtonStyle.Secondary)),
    ] : []
  };
}
function gamePayload(game, activity) {
  const label = game.seriesId ? `${game.stage.replaceAll('_',' ')} · GAME ${game.seriesGameNumber}` : `WEEK ${game.weekNumber}`;
  const approved = game.status === "FINAL" && !!game.finalizedAt && !!game.result?.scores;
  const dateRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gamedate:${game.gameId}`).setLabel(game.inGameDate ? "Edit game date" : "Set game date").setStyle(ButtonStyle.Primary).setDisabled(game.status === 'FINAL'));
  const streamRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gamestream:${game.gameId}`).setLabel(game.streamlink?.url ? "Update Streamlink" : "Streamlink").setEmoji('📺').setStyle(ButtonStyle.Primary));
  dateRow.addComponents(...streamRow.components);
  const forfeit = (teamId, name) => {
    const b = new ButtonBuilder().setCustomId(`gamedecision:forfeit:${game.gameId}:${teamId}`).setLabel(`Forfeit → ${name}`.slice(0, 80)).setStyle(ButtonStyle.Secondary).setDisabled(game.status === 'FINAL');
    const emoji = require('../shared/team-emojis').teamEmoji(name).match(/^<(a?):([^:]+):(\d+)>$/);
    if (emoji) b.setEmoji({ id: emoji[3], name: emoji[2], animated: !!emoji[1] }); return b;
  };
  const payload = {
    content: [...new Set([...(game.teamRoleIds || []), ...(game.staffRoleIds || [])])].map(id => `<@&${id}>`).join(" "), embeds: [new EmbedBuilder().setColor(approved ? 0x35a76f : 0xffdc21)
      .setTitle(approved ? `✅ GAME APPROVED · ${label}` : `${label} MATCHUP`)
      .addFields({ name: "NBA 2K GAME DATE", value: game.inGameDate ? `**${require("./game-date").formatGameDate(game.inGameDate)}**` : "**Not set — click Set game date to unlock the game buttons.**" })
      .addFields({ name: "📺 STREAMING", value: `**The home team is required to stream.** Use the Streamlink button to post your link.${game.streamlink?.url ? `\n[Watch stream](<${game.streamlink.url}>)` : ''}` })
      .setDescription(`**${teamLabel(game.team1Name)}**\nvs\n**${teamLabel(game.team2Name)}**\n\n${(game.coachUserIds || []).map(id => `<@${id}>`).join(' · ')}${game.deadlineAt ? `\n\n${label} Deadline: <t:${Math.floor(Date.parse(game.deadlineAt) / 1000)}:F>\nTime Remaining: <t:${Math.floor(Date.parse(game.deadlineAt) / 1000)}:R>` : ''}\n\nUse this thread to schedule your game. Coaches submit their own box score; Staff tools contains submission and recovery controls. Fair Sim requires both coaches or staff approval. Forfeit buttons name the team receiving the win. Staff-approved forfeits record wins and losses without player statistics.\n\n${game.matchupType ? 'Matchup: ' + game.matchupType.replaceAll('_', ' ') + '\n' : ''}${game.matchupDecision ? 'Decision: ' + game.matchupDecision.type.replaceAll('_', ' ') + (game.matchupDecision.confirmed ? ' confirmed' : ' pending') + '\n' : ''}Status: **${approved ? "✅ APPROVED — OFFICIAL FINAL" : activity?.status || (game.status === 'FINAL' ? 'FINAL' : 'NOT PLAYED')}**${activity ? '\n\n' + require('./game-activity').activityLines(activity) : ''}`)],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gamesubmit:${game.gameId}`)
      .setLabel("Submit Score").setStyle(ButtonStyle.Primary).setDisabled(game.status === "FINAL"),
      new ButtonBuilder().setCustomId(`gametools:${game.gameId}`).setLabel("Staff tools").setStyle(ButtonStyle.Secondary)),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`gamedecision:fair:${game.gameId}`).setLabel('Fair Sim').setEmoji('⚖️').setStyle(ButtonStyle.Secondary).setDisabled(game.status === 'FINAL'),
      forfeit(game.team1Id, game.team1Name), forfeit(game.team2Id, game.team2Name),
      new ButtonBuilder().setCustomId(`gamedecision:cpu:${game.gameId}`).setLabel('CPU').setEmoji('🤖').setStyle(ButtonStyle.Secondary)
    )], allowedMentions: { parse: [] }
  };
  if (approved && game.result.type === 'FORFEIT') { payload.components = []; payload.embeds[0].addFields({ name: 'OFFICIAL FORFEIT', value: `${game.result.winnerTeamId === game.team1Id ? game.team1Name : game.team2Name} wins · no player statistics or scoring averages` }); return payload; }
  if (approved) payload.embeds[0].addFields({ name: "✅ APPROVED FINAL SCORE", value: `${teamLabel(game.team1Name)} **${game.result.scores[game.team1Id]}**\n${teamLabel(game.team2Name)} **${game.result.scores[game.team2Id]}**\n${game.seriesId ? '📊 Official postseason statistics updated' : '📊 Result recorded · Stats and standings publish when the week advances'} · 🔒 Submissions closed` });
  payload.components = game.status === 'FINAL' ? [] : game.inGameDate ? [dateRow, ...payload.components] : [dateRow];
  return payload;
}
function createDiscordGameSubmissions(service = createGameSubmissionService(), options = {}) {
  if (options.onFinalized && service.setFinalizationHandler) service.setFinalizationHandler(options.onFinalized);
  const extractor = options.extractor === null ? null : options.extractor || require("./box-score/service").createBoxScoreExtractionService({ submissions: service });
  const { extractionPayload } = require("./box-score/discord-summary");
  const approvals = require("./discord-game-approvals").createDiscordGameApprovals({ submissions: service });
  async function refreshFinalMessage(channel, game) {
    if (game.status !== "FINAL" || !game.discordMessageId || !channel.messages) return;
    try { const message = await channel.messages.fetch(game.discordMessageId); await message.edit(gamePayload(game, require("./game-activity").activityView(service.load(game.gameId)))); }
    catch (error) { console.error("Final game message refresh:", error.message); }
    try { await approvals.publish(channel, game.gameId); } catch (error) { console.error("Game approval notice:", error.message); }
  }
  async function setup(interaction) {
    requireLeagueStaff(interaction);
    const { game } = service.bind({
      ...actor(interaction, interaction.user.id),
      weekNumber: interaction.options.getInteger("week", true), teamQuery: interaction.options.getString("team", true)
    });
    if (!game.threadCreatedAt && interaction.channel.createdTimestamp) await service.mutate(game.gameId, r => { r.game.threadCreatedAt = new Date(interaction.channel.createdTimestamp).toISOString(); });
    if (game.discordMessageId) {
      const message = await interaction.channel.messages.fetch(game.discordMessageId).catch(error => {
        if (error.code === 10008) return null;
        throw error;
      });
      if (message) { await message.edit(gamePayload(game, require("./game-activity").activityView(service.load(game.gameId)))); await interaction.editReply("Game message updated."); return; }
    }
    const message = await interaction.channel.send(gamePayload(game, require("./game-activity").activityView(service.load(game.gameId))));
    await service.setMessage(game.gameId, message.id);
    await interaction.editReply("Game linked. Set the NBA 2K game date above to unlock the game buttons.");
  }
  async function button(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const [action, gameId, submissionId] = interaction.customId.split(":");
      if (action !== "gamecancel" && !service.load(gameId).game.inGameDate) throw Error("Set the NBA 2K game date in the matchup message first.");
      if (action === "gametools") {
        requireLeagueStaff(interaction);
        service.authorizeExtraction(gameId, actor(interaction, interaction.user.id), true);
        const game = service.load(gameId).game;
        const components = [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`gamestaff:${gameId}`).setLabel("Submit both box scores").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`gameextract:${gameId}:latest`).setLabel("Process stored box scores").setStyle(ButtonStyle.Secondary))];
        if (game.testMode === true) components.push(new ActionRowBuilder().addComponents(
          ...[[game.team1Id, game.team1Name], [game.team2Id, game.team2Name]].map(([id, name]) =>
            new ButtonBuilder().setCustomId(`gametest:${gameId}:${id}`).setLabel(`🧪 Test as ${name}`.slice(0, 80)).setStyle(ButtonStyle.Secondary))));
        await interaction.editReply({ content: "Staff tools · this game only. Test controls still recheck Test Mode and coach ownership when used.", components });
      } else if (action === "gameextract") {
        service.authorizeExtraction(gameId, actor(interaction, interaction.user.id), canManageLeague(interaction));
        await interaction.editReply("Processing the stored screenshots…");
        const targetId = submissionId === "latest" ? service.load(gameId).submissions
          .filter(s => !["COLLECTING", "CANCELLED"].includes(s.status)).at(-1)?.submissionId : submissionId;
        if (!targetId) throw new Error("No complete stored submission exists yet. Upload both screenshots first.");
        const result = await extractor.extract(gameId, targetId);
        await interaction.channel.send(extractionPayload(service.load(gameId).game, result));
        await refreshFinalMessage(interaction.channel, service.load(gameId).game);
        await interaction.editReply("Processing finished. See the thread for the result.");
      } else if (action === "gamestaff") {
        requireLeagueStaff(interaction);
        const result = await service.beginStaff(gameId, { ...actor(interaction, interaction.user.id), staff: true });
        await interaction.editReply(submissionPayload(result));
      } else if (action === "gamecancel") {
        await service.cancel(gameId, submissionId, { ...actor(interaction, interaction.user.id), staff: canManageLeague(interaction) });
        await interaction.editReply("Submission cancelled. Its screenshots are preserved. Click Submit Game to start again.");
      } else if (action === "gametest") {
        requireLeagueStaff(interaction);
        const result = await service.beginSide(gameId, { ...actor(interaction, interaction.user.id), staff: true, testTeamId: submissionId });
        await interaction.editReply(submissionPayload(result));
      } else if (action === "gamesubmit") {
        const result = await service.beginSide(gameId, actor(interaction, interaction.user.id));
        await interaction.editReply(submissionPayload(result));
      } else { throw Error("Unknown game action."); }
    } catch (error) { await interaction.editReply({ content: error.message, embeds: [], components: [] }); }
  }
  async function message(message) {
    if (message.author.bot || !message.guildId || !message.attachments.size) return;
    const record = service.findThread(message.guildId, message.channelId);
    if (!record) return;
    try {
      if (!record.game.inGameDate) throw Error("Set the NBA 2K game date in the matchup message before uploading screenshots.");
      const staffUpload = record.submissions.some(s => s.status === 'COLLECTING' && s.mode === 'STAFF_BOTH' && s.submittingUserId === message.author.id);
      const source = { ...actor(message, message.author.id), staff: canManageLeague({ guildId: message.guildId, guild: message.guild, member: message.member, memberPermissions: message.member?.permissions }) };
      const result = await (staffUpload ? service.receiveStaff : service.receiveSide)(record.game.gameId, source, [...message.attachments.values()], message.id);
      await message.reply(submissionPayload(result));
      if (result.media.length === 2 && extractor) {
        const progress = await message.reply({
          content: "Processing the stored box scores…", allowedMentions: { parse: [], repliedUser: false },
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Retry extraction")
            .setStyle(ButtonStyle.Secondary).setCustomId(`gameextract:${result.game.gameId}:${result.submission.submissionId}`))]
        });
        const extraction = await extractor.extract(result.game.gameId, result.submission.submissionId);
        await progress.edit({ content: null, ...extractionPayload(service.load(result.game.gameId).game, extraction) });
        await refreshFinalMessage(message.channel, service.load(result.game.gameId).game);
      }
    } catch (error) {
      await message.reply({ content: error.message, allowedMentions: { parse: [], repliedUser: false } });
    }
  }
  return { setup, button, message };
}
module.exports = { createDiscordGameSubmissions, submissionPayload, gamePayload };
