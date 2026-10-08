const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { requireLeagueStaff } = require('./discord-permissions');
function payload(view, confirming = false) {
  const embed = new EmbedBuilder().setTitle('📋 OFFSEASON CHECKLIST').setColor(view.ready ? 0x35a76f : 0xffdc21)
    .setDescription(`**${view.step.replaceAll('_', ' ')}**\n${view.step === 'PRESEASON' ? 'Rollover confirmed. The new preseason is ready; review readiness before starting the regular season.' : view.blockers.length ? view.blockers.map(b => `• ${b}`).join('\n').slice(0, 3800) : `Ready to advance to ${view.nextStep?.replaceAll('_', ' ') || 'season rollover'}.`}`)
    .setFooter({ text: `Season ${view.seasonId} · Commissioner confirmation required` });
  const controls = confirming && view.token
    ? [new ButtonBuilder().setCustomId(`offseason:confirm:${view.token}`).setLabel('Confirm next step').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`offseason:cancel:${view.token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)]
    : [new ButtonBuilder().setCustomId('offseason:review').setLabel('Review current step').setStyle(ButtonStyle.Secondary)];
  const base = process.env.WEBSITE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  if (view.step === 'RETIREMENTS') try {
    const url = new URL('/#admin', base);
    if (['http:', 'https:'].includes(url.protocol)) controls.push(new ButtonBuilder().setURL(url.href).setLabel('Open import review').setStyle(ButtonStyle.Link));
  } catch { /* The checklist remains usable when no website URL is configured. */ }
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(...controls)], allowedMentions: { parse: [] } };
}
function createDiscordOffseason({ repository }) {
  const service = require('./offseason-service').createOffseasonService({ repository });
  async function handle(i) {
    await i.deferReply({ flags: 64 });
    try {
      requireLeagueStaff(i);
      const context = repository.loadLeagueContext({ guildId: i.guildId }), leagueId = context.league.leagueId;
      const actor = { authorized: true, id: i.user.id }, [, action, token] = i.customId.split(':');
      if (action === 'cancel') { service.cancel(leagueId, actor, token); await i.editReply({ content: 'Transition cancelled. No phase changed.', components: [] }); return; }
      // Assistant commissioners can inspect blockers; only the commissioner prepares/confirms.
      if (action === 'review') {
        const view = context.league.commissionerUserId === actor.id ? service.prepareNext(leagueId, actor) : service.inspect(leagueId);
        await i.editReply(payload(view, true));
      } else if (action === 'confirm') await i.editReply(payload(service.confirmNext(leagueId, actor, token)));
      else throw Error('Unknown offseason control.');
    } catch (error) { await i.editReply({ content: error.message, components: [] }); }
  }
  return { handle, service };
}
module.exports = { createDiscordOffseason, payload };
