const {teamLabel}=require("../../shared/team-emojis");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
function extractionPayload(game, extraction) {
  const embed = new EmbedBuilder().setColor(game.status === 'FINAL' ? 0x35a76f : 0xffdc21).setTitle(game.status === 'FINAL' ? '✅ GAME APPROVED' : extraction.status === 'EXTRACTION_FAILED' ? 'EXTRACTION FAILED' : 'GAME PROCESSED');
  if (extraction.status === 'EXTRACTION_FAILED') embed.setDescription(`${extraction.error}\n\nOriginal screenshots are safe. Retry without uploading again.`.slice(0,4000));
  else {
    const screens = extraction.normalized.screenshots;
    const scores = [game.team1Id,game.team2Id].map((id,i) => {
      const readings = screens.map(s => s.scoreboard.find(b => b.teamId === id)?.finalScore).filter(n => n != null);
      const unique = [...new Set(readings)];
      return `${teamLabel(i === 0 ? game.team1Name : game.team2Name)} **${unique.length === 1 ? unique[0] : unique.length ? unique.join(' / ') + ' (conflict)' : 'Unreadable'}**`;
    }).join('\n');
    const details = extraction.issues.length ? `⚠ ${extraction.issues.length} Items Need Review` :
      (game.status === 'FINAL' ? 'Final score and player stats stored.\n\n' : '') + 'Validation:\n✓ Teams Match\n✓ Final Scores Match\n✓ Quarter Scores Match\n✓ Player Points Match Team Totals\n\nReady for Review';
    embed.setDescription(`${scores}\n\n${screens.length} Team Box Scores Detected\n${extraction.normalized.playedPlayerCount} Players Recorded Stats\n\n${details}`);
    if (game.status === 'FINAL') embed.setDescription(embed.data.description.replace('Ready for Review','Final result stored'));
    embed.setFooter({ text:game.status === 'FINAL' ? 'Official final result. Scores and statistics passed validation.' : 'Unclear or conflicting values require review before a final result can be saved.' });
  }
  const link = new URL(`/games/${game.gameId}/submissions/${extraction.submissionId}/review`, process.env.WEBSITE_URL || 'http://localhost:3000');
  if (game.status === 'FINAL') return {embeds:[embed],allowedMentions:{parse:[]},components:[]};
  return { embeds:[embed], allowedMentions:{ parse:[] }, components:[new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Review Game').setStyle(ButtonStyle.Link).setURL(link.toString()),
    new ButtonBuilder().setLabel('Retry extraction').setStyle(ButtonStyle.Secondary).setCustomId(`gameextract:${game.gameId}:${extraction.submissionId}`),
  )] };
}
module.exports = { extractionPayload };
