const { createHash } = require('crypto');
const { ChannelType, EmbedBuilder } = require('discord.js');
const { teamLabel } = require('../shared/team-emojis');
const pending = new Map();

function approvalPayload(game) {
    const scores = game.result.scores;
    const reviewed = game.approval?.operator;
    return {
        embeds: [new EmbedBuilder().setColor(0x35a76f).setTitle('✅ GAME APPROVED')
            .setDescription(`**Week ${game.weekNumber} · ${require('./game-date').formatGameDate(game.inGameDate) || 'Game date not set'}**\n\n${teamLabel(game.team1Name)} **${scores[game.team1Id]}**\n${teamLabel(game.team2Name)} **${scores[game.team2Id]}**\n\n✅ Final result is official.\n📊 Player stats and standings have been recorded.\n🔒 Score submissions are closed.`)
            .setFooter({ text: reviewed ? `Approved after commissioner review by ${reviewed}` : 'Automatically approved after box-score validation' })],
        allowedMentions: { parse: [] },
        nonce: createHash('sha256').update(`game-approved:${game.gameId}`).digest('hex').slice(0, 24),
        enforceNonce: true,
    };
}
function createDiscordGameApprovals({ submissions }) {
    function publish(channel, gameId) {
        const key = `${submissions.repository.dataRoot}:${gameId}`;
        if (pending.has(key)) return pending.get(key);
        const work = (async () => {
            const record = submissions.load(gameId), game = record.game;
            if (game.status !== 'FINAL' || !game.finalizedAt || !game.result?.scores || game.approvalNotice?.messageId) return;
            if (channel?.id !== game.discordThreadId || channel.type !== ChannelType.PrivateThread || (channel.guildId && channel.guildId !== game.guildId)) throw Error('Use the approved game’s private thread.');
            if (channel.archived) await channel.setArchived(false);
            if (game.discordMessageId && channel.messages) {
                try {
                    const card = await channel.messages.fetch(game.discordMessageId);
                    await card.edit(require('./discord-game-submissions').gamePayload(game, require('./game-activity').activityView(record)));
                } catch (error) { if (error.code !== 10008) throw error; }
            }
            const message = await channel.send(approvalPayload(game));
            await submissions.mutate(gameId, r => { r.game.approvalNotice = { messageId: message.id, sentAt: new Date().toISOString() }; });
        })().finally(() => pending.delete(key));
        pending.set(key, work);
        return work;
    }
    return { publish };
}
module.exports = { approvalPayload, createDiscordGameApprovals };
