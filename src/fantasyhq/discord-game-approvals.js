const { createHash } = require('crypto');
const { ChannelType, EmbedBuilder } = require('discord.js');
const { teamLabel } = require('../shared/team-emojis');
const pending = new Map();

function approvalPayload(game) {
    const scores = game.result.scores;
    if (game.result.type === 'FORFEIT') return { embeds: [new EmbedBuilder().setColor(0x35a76f).setTitle('✅ OFFICIAL FORFEIT').setDescription(`${teamLabel(game.result.winnerTeamId === game.team1Id ? game.team1Name : game.team2Name)} wins by Staff-approved forfeit.\nWin/loss only. No player stats or scoring averages.`)], allowedMentions: { parse: [] }, nonce: createHash('sha256').update(`game-approved:${game.gameId}:${game.result.extractionId}`).digest('hex').slice(0,24), enforceNonce: true };
    const reviewed = game.approval?.operator;
    return {
        embeds: [new EmbedBuilder().setColor(0x35a76f).setTitle('✅ GAME APPROVED')
            .setDescription(`**${game.seriesId ? game.stage.replaceAll('_',' ') + ' · Game ' + game.seriesGameNumber : 'Week ' + game.weekNumber} · ${require('./game-date').formatGameDate(game.inGameDate) || 'Game date not set'}**\n\n${teamLabel(game.team1Name)} **${scores[game.team1Id]}**\n${teamLabel(game.team2Name)} **${scores[game.team2Id]}**\n\n✅ Final result is official.\n${game.seriesId ? '📊 Official postseason statistics updated.' : '📊 Stats and standings publish when the week advances.'}\n🔒 Score submissions are closed.`)
            .setFooter({ text: reviewed ? `Approved after commissioner review by ${reviewed}` : 'Automatically approved after box-score validation' })],
        allowedMentions: { parse: [] },
        nonce: createHash('sha256').update(`game-approved:${game.gameId}:${game.result.extractionId}`).digest('hex').slice(0, 24),
        enforceNonce: true,
    };
}
function createDiscordGameApprovals({ submissions }) {
    function publish(channel, gameId) {
        const key = `${submissions.repository.dataRoot}:${gameId}`;
        if (pending.has(key)) return pending.get(key);
        const work = (async () => {
            const record = submissions.load(gameId), game = record.game;
            const reversed = game.status !== 'FINAL' && record.resultRevisions?.at(-1)?.action === 'REVERSED';
            if (!reversed && (game.status !== 'FINAL' || !game.finalizedAt || !game.result?.scores || game.approvalNotice?.messageId && (!game.approvalNotice.extractionId || game.approvalNotice.extractionId === game.result.extractionId))) return;
            if (reversed && !game.previousApprovalNotice) return;
            if (channel?.id !== game.discordThreadId || channel.type !== ChannelType.PrivateThread || (channel.guildId && channel.guildId !== game.guildId)) throw Error('Use the approved game’s private thread.');
            if (channel.archived) await channel.setArchived(false);
            if (game.discordMessageId && channel.messages) {
                try {
                    const card = await channel.messages.fetch(game.discordMessageId);
                    await card.edit(require('./discord-game-submissions').gamePayload(game, require('./game-activity').activityView(record)));
                } catch (error) { if (error.code !== 10008) throw error; }
            }
            let message;
            const previous = game.previousApprovalNotice;
            const payload = reversed ? { embeds: [new EmbedBuilder().setColor(0xc0392b).setTitle('APPROVAL REVERSED').setDescription('Staff reversed this result. The original scores and statistics remain in the audit history. New box scores or a corrected review are required.')], components: [], allowedMentions: { parse: [] } } : approvalPayload(game);
            if (previous?.messageId && channel.messages) {
                try { message = await channel.messages.fetch(previous.messageId); await message.edit(payload); }
                catch (error) { if (Number(error.code) !== 10008) throw error; }
            }
            if (!message) message = await channel.send(payload);
            await submissions.mutate(gameId, r => {
                if (r.game.result?.extractionId !== game.result?.extractionId) return;
                delete r.game.previousApprovalNotice;
                if (!reversed) r.game.approvalNotice = { messageId: message.id, extractionId: game.result.extractionId, sentAt: new Date().toISOString() };
            });
        })().finally(() => pending.delete(key));
        pending.set(key, work);
        return work;
    }
    return { publish };
}
module.exports = { approvalPayload, createDiscordGameApprovals };
