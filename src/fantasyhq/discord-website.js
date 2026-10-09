const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
function websitePayload({ websiteUrl = process.env.WEBSITE_URL, railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN, production = process.env.NODE_ENV === 'production' } = {}) {
  let url;
  for (const candidate of [websiteUrl, railwayDomain && `https://${railwayDomain}`]) {
    try {
      const parsed = new URL(candidate);
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) continue;
      if (production && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) continue;
      url = parsed.origin; break;
    } catch { /* Try Railway's public domain. */ }
  }
  if (!url) throw Error('Set WEBSITE_URL to the public league website in Railway.');
  return { embeds: [new EmbedBuilder().setColor(0xffdc21).setTitle('🌐 LEAGUEbuddy Website').setDescription(`[Open the league website](${url})\nYour matchup, schedule, standings, stats and draft room.`)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open Website').setURL(url))], allowedMentions: { parse: [] } };
}
async function handleWebsite(interaction) { await interaction.editReply(websitePayload()); }
module.exports = { websitePayload, handleWebsite };
