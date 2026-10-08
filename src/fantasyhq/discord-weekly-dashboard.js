const { createHash } = require('crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits: P } = require('discord.js');
const { requireLeagueStaff, STAFF_ROLES } = require('./discord-permissions');
const { createWeeklyDashboardService } = require('./weekly-dashboard-service');
const jobs = new Map();
function websiteBase() {
  const value = process.env.WEBSITE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.origin : null; } catch { return null; }
}
function transactionCounts(view) {
  const { trades, offers, waivers } = view.transactions;
  return { trades: trades.length, coachTrades: trades.filter(t => t.status === 'PENDING_GM_APPROVAL').length, committeeTrades: trades.filter(t => t.status === 'PENDING_COMMITTEE').length, tradeProof: trades.filter(t => t.status === 'PENDING_PROOF_REVIEW').length, awaitingTradeProof: trades.filter(t => t.status === 'AWAITING_PROOF').length, offers: offers.length, offerReviews: offers.filter(o => o.status === 'PENDING_REVIEW').length, waivers: waivers.length, activeWindows: view.transactions.activeWindows, waitingCuts: view.transactions.waitingCuts };
}
function staffPayload(view, counts = transactionCounts(view)) {
  const b = view.blockers;
  const deadline = view.deadlineAt ? `<t:${Math.floor(Date.parse(view.deadlineAt) / 1000)}:F> · <t:${Math.floor(Date.parse(view.deadlineAt) / 1000)}:R>` : 'Starts when game threads are created';
  const embed = new EmbedBuilder().setColor(view.closed ? 0x808080 : view.readyToAdvance ? 0x35a76f : 0xffdc21)
    .setTitle(`${view.closed ? '🔒' : '📋'} WEEK ${view.week} · STAFF REPORT${view.closed ? ' · CLOSED' : ''}`)
    .setDescription(`**${view.leagueName}** · ${view.final}/${view.total} games approved\n${view.closed ? 'Week closed. This is the saved closeout report.' : `Deadline: ${deadline}`}\n${view.testMode ? '🧪 Test Mode · Matchup groups reflect assigned coaches; game processing keeps its existing test rules.\n' : ''}📊 Stats and standings publish when the week advances.`)
    .addFields(
      { name: '🏀 Matchup completion', value: view.groups.map(g => `**${g.label}** · ${g.final}/${g.total} approved · ${g.total - g.final} remaining`).join('\n') },
      { name: '🚦 Game closeout', value: `${b.unresolved} unfinished games${b.duplicateRecords ? ` · ⚠ ${b.duplicateRecords} duplicate game records` : ''}\n${b.missingThreads} missing threads · ${b.missingDates} dates not set\n${b.missingBoxScores} incomplete box-score pairs · ${b.pendingReviews} awaiting review\n${b.extractionFailures} OCR failures · ${b.processing} processing\n${b.noActivity} user matchups with no coach activity` },
      { name: '🔁 Pending trades', value: `${counts.trades} active · ${counts.coachTrades} awaiting coaches · ${counts.committeeTrades} awaiting committee\n${counts.awaitingTradeProof} awaiting proof · ${counts.tradeProof} proof reviews`, inline: true },
      { name: '📝 Free agency / waivers', value: `${counts.offers} active offers · ${counts.offerReviews} proof reviews\n${counts.activeWindows} active windows · ${counts.waitingCuts} winner cuts needed\n${counts.waivers} waiver requests awaiting Staff`, inline: true },
      { name: '📅 Byes', value: view.byes.map(t => t.teamName).join(' · ') || 'None' },
      { name: 'Next step', value: view.closed ? 'Use the current week’s report for active work. Pending transaction totals above are from this report’s last active refresh.' : view.readyToAdvance ? 'All scheduled games are approved. Review week advancement below to confirm the next week.' : 'Resolve unfinished games in the website checklist. Transactions are reminders, not additional week-advance blockers.' })
    .setFooter({ text: `Weekly Staff report · ${view.guildId} · ${view.leagueId} · ${view.seasonId} · ${view.weekId}`.slice(0, 2048) });
  if (view.storageIssues?.length || view.notificationFailures || view.upgradeDebtCount) embed.addFields({ name: '⚠ Recovery needed', value: `${view.storageIssues?.length || 0} unreadable game records · ${view.notificationFailures || 0} failed notification attempts · ${view.upgradeDebtCount || 0} upgrade balances need review. Staff can inspect the website checklist and storage backups.` });
  const controls = [];
  if (!view.closed) controls.push(new ButtonBuilder().setCustomId(`weeklystaff:review:${view.week}`).setLabel('Review week advancement').setStyle(ButtonStyle.Primary));
  controls.push(new ButtonBuilder().setCustomId('offseason:review').setLabel('Offseason checklist').setStyle(ButtonStyle.Secondary));
  const base = websiteBase();
  if (base) controls.push(new ButtonBuilder().setURL(`${base}/#staff-weekly`).setLabel('Website checklist').setStyle(ButtonStyle.Link));
  return { embeds: [embed], components: controls.length ? [new ActionRowBuilder().addComponents(...controls)] : [], allowedMentions: { parse: [] } };
}
function coachPayload(view) {
  const embed = new EmbedBuilder().setColor(0xffdc21).setTitle(`📅 ${view.teamName} · MY WEEK`);
  if (!view.available) return { embeds: [embed.setDescription('Your weekly dashboard opens during the regular season.')], components: [], allowedMentions: { parse: [] } };
  embed.setDescription(`**Week ${view.week}** · ${view.leagueName}\n${view.bye ? 'Bye week' : `vs **${view.game.opponent}** · ${view.game.final ? '✅ Approved' : view.game.screenshots + '/2 box scores'}`}\n${view.deadlineAt ? `Deadline: <t:${Math.floor(Date.parse(view.deadlineAt) / 1000)}:F>\n` : ''}\n**Next step:** ${view.nextAction}`);
  const t = view.transactions;
  if (t) embed.addFields({ name: 'Your pending work', value: `${t.trades.length} active trades${t.trades.some(x => x.status === 'PENDING_GM_APPROVAL' && x.waitingTeamIds.includes(view.teamId)) ? ' · ⚠ trade response needed' : ''}\n${t.offers.length} active FA offers${t.offers.length ? ': ' + t.offers.map(o => `${o.player} (${o.cutRequired ? 'choose roster cut' : o.status === 'PENDING_REVIEW' ? 'Staff review' : 'approved'})`).join(', ') : ''}\n${t.waivers.length} waiver requests awaiting Staff`.slice(0, 1024) });
  embed.setFooter({ text: 'Private coach dashboard · Transactions stay in Discord · Refresh to see changes' });
  const rows = [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('myweek:refresh').setLabel('Refresh my week').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('fa:active').setLabel('My FA offers').setStyle(ButtonStyle.Secondary))];
  const links = [];
  for (const [label, url] of [['Game thread', view.game?.threadUrl], ['Trade channel', view.channels.submitTrade], ['Free agency', view.channels.freeAgency]]) if (url) links.push(new ButtonBuilder().setURL(url).setLabel(label).setStyle(ButtonStyle.Link));
  const base = websiteBase(); if (base) links.push(new ButtonBuilder().setURL(`${base}/?team=${encodeURIComponent(view.teamId)}#my-week`).setLabel('Website dashboard').setStyle(ButtonStyle.Link));
  if (links.length) rows.push(new ActionRowBuilder().addComponents(...links));
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}
function createDiscordWeeklyDashboard({ repository = require('./repository').createFantasyHQRepository(), service, weekService, now = Date.now, logger = console } = {}) {
  service ||= createWeeklyDashboardService({ repository, now });
  async function staffChannel(guild, leagueId) {
    const id = repository.loadSettings(leagueId)?.discordChannels?.staff;
    if (!id) return null;
    const channel = await guild.channels.fetch(id);
    if (!channel?.isTextBased?.() || !channel.messages?.fetch) throw Error('Staff report channel is unavailable.');
    const roles = await guild.roles.fetch(), me = guild.members.me || await guild.members.fetchMe();
    const nonStaff = [...roles.values()].filter(r => r.id !== me.roles?.botRole?.id && !STAFF_ROLES.has(r.name) && !r.permissions?.has(P.Administrator));
    if (channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel) || nonStaff.some(r => channel.permissionsFor(r)?.has(P.ViewChannel))) throw Error('Weekly reports need a Staff-only channel. Repair channel access from /league setup.');
    for (const overwrite of channel.permissionOverwrites?.cache?.values() || []) {
      if (overwrite.type !== 1 || overwrite.id === me.id || !overwrite.allow.has(P.ViewChannel)) continue;
      const member = await guild.members.fetch(overwrite.id);
      if (!member.permissions.has(P.Administrator) && !member.roles.cache.some(r => STAFF_ROLES.has(r.name))) throw Error('Staff report channel grants a non-Staff member access.');
    }
    return channel;
  }
  async function publish(guild, channel, view, key, counts) {
    const settings = repository.loadSettings(view.leagueId) || {}, saved = settings.weeklyStaffReports?.[key];
    const payload = staffPayload(view, counts), signature = JSON.stringify({ embeds: payload.embeds.map(e => e.toJSON()), components: payload.components.map(r => r.toJSON()) });
    let message = saved?.channelId === channel.id && saved.messageId ? await channel.messages.fetch(saved.messageId).catch(error => { if (Number(error.code) === 10008) return null; throw error; }) : null;
    if (!message) {
      const footer = payload.embeds[0].data.footer.text;
      let before;
      while (true) {
        const history = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        message = [...history.values()].find(m => m.author.id === guild.members.me.id && m.embeds.some(e => e.footer?.text === footer));
        if (message || history.size < 100) break;
        const oldest = [...history.values()].at(-1);
        if (!oldest || oldest.id === before) throw Error('Could not finish Staff report recovery. Retry after message history is available.');
        if (oldest.createdTimestamp < Date.parse(view.startedAt)) break;
        before = oldest.id;
      }
    }
    if (message && message.author.id !== guild.members.me.id) throw Error('Saved Staff report belongs to another author.');
    if (!message) message = await channel.send({ ...payload, nonce: createHash('sha256').update(`weekly:${guild.id}:${view.leagueId}:${key}`).digest('hex').slice(0, 24), enforceNonce: true });
    else if (saved?.signature !== signature) await message.edit(payload);
    const fresh = repository.loadSettings(view.leagueId) || {};
    if (!saved || saved.signature !== signature || saved.messageId !== message.id || saved.channelId !== channel.id) repository.saveSettings(view.leagueId, { ...fresh, weeklyStaffReports: { ...fresh.weeklyStaffReports, [key]: { guildId: guild.id, seasonId: view.seasonId, week: view.week, weekId: view.weekId, messageId: message.id, channelId: channel.id, signature, transactionCounts: counts || transactionCounts(view), updatedAt: new Date(now()).toISOString(), closed: view.closed } } });
    return message;
  }
  async function run(guild) {
    const view = service.report(guild.id); if (!view.available) return;
    const channel = await staffChannel(guild, view.leagueId); if (!channel) return;
    const saved = repository.loadSettings(view.leagueId)?.weeklyStaffReports || {};
    for (const [key, row] of Object.entries(saved)) if (row.guildId === guild.id && String(row.seasonId) === String(view.seasonId) && row.week !== view.week && !row.closed) {
      const closed = service.report(guild.id, row.week);
      if (closed.closed) await publish(guild, channel, closed, key, row.transactionCounts);
    }
    const key = `${guild.id}:${view.seasonId}:${view.weekId}`;
    if (view.closed && saved[key]?.closed) return;
    return publish(guild, channel, view, key, view.closed ? saved[key]?.transactionCounts : undefined);
  }
  function ensureReport(guild) {
    const key = `${repository.dataRoot}:${guild.id}`;
    if (!jobs.has(key)) jobs.set(key, run(guild).finally(() => jobs.delete(key)));
    return jobs.get(key);
  }
  async function button(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (interaction.customId.startsWith('myweek:')) {
        const context = repository.loadLeagueContext({ guildId: interaction.guildId });
        const identity = require('./coach-identity').requireCoachIdentity(repository, context, interaction.member, interaction.user.id);
        await interaction.editReply(coachPayload(service.teamDashboard(interaction.guildId, identity.teamId, true)));
      } else {
        requireLeagueStaff(interaction);
        const view = service.report(interaction.guildId), row = repository.loadSettings(view.leagueId)?.weeklyStaffReports?.[`${interaction.guildId}:${view.seasonId}:${view.weekId}`];
        if (!view.available || view.closed || Number(interaction.customId.split(':')[2]) !== view.week || row?.messageId !== interaction.message?.id || row?.channelId !== interaction.channelId) throw Error('This weekly report is closed or stale. Use the current report.');
        await require('./discord-week').handleWeekPreview(interaction, weekService);
      }
    } catch (error) { await interaction.editReply({ content: error.message, embeds: [], components: [] }); }
  }
  let running;
  function tick(client) { if (!running) running = (async () => { for (const guild of client.guilds.cache.values()) { try { if(typeof repository.loadGuildLeagueBinding==='function'&&!repository.loadGuildLeagueBinding(guild.id)&&!process.env.FANTASYHQ_LEAGUE_ID)continue;await ensureReport(guild); } catch (error) { logger.error('Weekly Staff report:', error.message); } } })().finally(() => { running = null; }); return running; }
  return { ensureReport, tick, button };
}
module.exports = { createDiscordWeeklyDashboard, staffPayload, coachPayload, transactionCounts };
