const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createHash } = require('crypto');
const { createPlayerOfWeekService } = require('./player-of-week');
const publishing = new Map();
function awardPayload(record, players) {
  const marker = `PLAYER_OF_WEEK:${record.leagueId}:${record.seasonId}:W${record.week}`;
  const files = [], embeds = record.winners.map(winner => {
    const s = winner.stats, player = players.find(p => p.playerId === winner.playerId);
    const embed = new EmbedBuilder().setColor(winner.conference === 'East' ? 0x35a76f : 0x3478db)
      .setTitle(`🏆 ${record.testMode ? 'TEST MODE · ' : ''}${winner.conference.toUpperCase()} PLAYER OF THE WEEK · WEEK ${record.week}`)
      .setDescription(`**${winner.playerName}**\n${require('../shared/team-emojis').teamLabel(winner.teamName)}\n\n🏀 ${s.PTS} PTS · ${s.REB} REB · 🎯 ${s.AST} AST\n🛡️ ${s.STL} STL · ${s.BLK} BLK · ${s.TO} TO\n🔥 ${s['3PM']}/${s['3PA']} 3PT · ${s.FTM}/${s.FTA} FT\n📊 ${s.FGPercent == null ? '—' : Math.round(s.FGPercent) + '%'} FG (${s.FGM}/${s.FGA})\n\n**Why he won**\n${winner.explanation}`)
      .setFooter({ text: marker });
    if (player) {
      const card = require('../shared/discord-player-card').nbaPlayerCard({ ...player, teamName: winner.teamName }, marker);
      const portrait = card.files?.find(file => file.name.startsWith('player-portrait'));
      if (portrait) {
        const file = portrait, name = winner.conference + '-' + file.name;
        files.push(new AttachmentBuilder(file.attachment, { name })); embed.setThumbnail('attachment://' + name);
      } else if (/^https?:\/\//i.test(player.imageUrl || '')) embed.setThumbnail(player.imageUrl);
      else if (card.files?.length) {
        const file = card.files[0], name = winner.conference + '-' + file.name;
        files.push(new AttachmentBuilder(file.attachment, { name })); embed.setThumbnail('attachment://' + name);
      }
    }
    return embed;
  });
  if (!embeds.length) embeds.push(new EmbedBuilder().setColor(0xffdc21).setTitle(`🏆 PLAYER OF THE WEEK · WEEK ${record.week}`).setDescription('No eligible verified player performances this week.').setFooter({ text: marker }));
  if (record.unavailableConferences.length) embeds.at(-1).addFields({ name: 'Eligibility', value: record.unavailableConferences.join(' / ') + ': no eligible verified player performance.' });
  return { content: '🏆 LEAGUEbuddy Player of the Week', embeds, files, allowedMentions: { parse: [] },
    nonce: createHash('sha256').update(marker).digest('hex').slice(0, 24), enforceNonce: true };
}
function createDiscordPlayerOfWeek({ repository, submissions, now = Date.now }) {
  const service = createPlayerOfWeekService({ repository, submissions, now });
  async function recoverMessage(channel, record) {
    if (!channel.messages?.fetch) throw Error('Cannot reconcile the pending weekly award post. Preserve its receipt and retry.');
    const marker = `PLAYER_OF_WEEK:${record.leagueId}:${record.seasonId}:W${record.week}`;
    let before;
    while (true) {
      const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      if (!page || typeof page.values !== 'function') throw Error('Weekly award history could not be read.');
      const messages = [...page.values()];
      const found = messages.find(m => m.embeds?.some(e => (e.footer || e.data?.footer)?.text === marker));
      if (found) return found;
      if (messages.length < 100 || messages.at(-1).createdTimestamp < Date.parse(record.publication.at)) return null;
      const next = messages.at(-1).id;
      if (next === before) throw Error('Weekly award history pagination stalled.');
      before = next;
    }
  }
  function publish(guild, leagueId, seasonId, week) {
    const key = `${repository.dataRoot}:${leagueId}:${seasonId}:${week}`;
    if (publishing.has(key)) return publishing.get(key);
    const task = (async () => {
      let record = repository.loadAwards(leagueId).seasons[seasonId]?.PLAYER_OF_WEEK?.weeks[week];
      if (!record || record.publication?.messageId) return;
      const settings = repository.loadSettings(leagueId);
      if (!!record.testMode !== !!settings.simulationId) throw Error('Test Mode award cannot publish in the live league.');
      if (record.testMode) return; // Existing simulation output owns all external test messages.
      const channelId = settings.discordChannels?.playerOfWeek;
      if (!channelId) throw Error('Configure Player of the Week through league channel setup.');
      const channel = await guild.channels.fetch(channelId);
      if (!channel) throw Error('Player of the Week channel is unavailable.');
      let message;
      if (record.publication?.status === 'PENDING') message = await recoverMessage(channel, record);
      if (!message) {
        service.publication(leagueId, seasonId, week, { status: 'PENDING', at: new Date(now()).toISOString(), channelId });
        record = repository.loadAwards(leagueId).seasons[seasonId].PLAYER_OF_WEEK.weeks[week];
        message = await channel.send(awardPayload(record, repository.loadPlayers(leagueId)));
      }
      service.publication(leagueId, seasonId, week, { status: 'DELIVERED', channelId, messageId: message.id, at: new Date(now()).toISOString() });
    })().finally(() => publishing.delete(key));
    publishing.set(key, task); return task;
  }
  async function reconcile(guild, leagueId) {
    const context = repository.loadLeague(leagueId), seasonId = context.seasonId;
    if (repository.scheduleExists(leagueId, seasonId)) {
      for (const week of repository.loadSchedule(leagueId, seasonId).weeks.filter(w => w.status === 'COMPLETED' && w.completedAt)) service.processWeek(leagueId, seasonId, week.week);
    }
    const awards = repository.loadAwards(leagueId);
    for (const [id, season] of Object.entries(awards.seasons)) for (const record of Object.values(season.PLAYER_OF_WEEK?.weeks || {})) {
      if (!record.publication?.messageId) await publish(guild, leagueId, id, record.week);
    }
  }
  return { service, publish, reconcile };
}
module.exports = { createDiscordPlayerOfWeek, awardPayload };
