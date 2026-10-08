const { randomUUID } = require('crypto');
function recordForfeit(record, { winnerTeamId, actorUserId, staffAuthorized, reason = 'Staff-approved forfeit' }) {
  if (!staffAuthorized || !actorUserId) throw Error('Staff approval is required to record an official forfeit.');
  if (![record.game.team1Id, record.game.team2Id].includes(winnerTeamId)) throw Error('Choose a matchup team.');
  if (record.game.status === 'FINAL') {
    if (record.game.result?.type === 'FORFEIT' && record.game.result.winnerTeamId === winnerTeamId) return record.game;
    throw Error('A final result already exists. Use the correction workflow.');
  }
  const timestamp = new Date().toISOString(), submissionId = randomUUID(), extractionId = randomUUID();
  for (const s of record.submissions) if (['COLLECTING', 'PROCESSING'].includes(s.status)) throw Error('Finish or cancel screenshot processing before recording a forfeit.');
  record.submissions.push({ submissionId, mode: 'STAFF_ADMIN', status: 'FINAL', createdAt: timestamp, staffAuthorizedBy: actorUserId, latestExtractionId: extractionId });
  record.extractions ||= []; record.extractions.push({ extractionId, submissionId, provider: 'administrative-forfeit', status: 'READY_FOR_REVIEW', issues: [], timestamp });
  record.playerGameStats = []; record.teamGameStats = []; record.dnpPlayers = [];
  record.game.result = { type: 'FORFEIT', submissionId, extractionId, winnerTeamId, scores: {}, administrative: { approvedBy: actorUserId, reason: String(reason).slice(0, 500), timestamp } };
  record.game.status = 'FINAL'; record.game.finalizedAt = timestamp; record.game.locked = true;
  record.game.approval = { operator: actorUserId, principal: 'discord-staff', at: timestamp };
  return record.game;
}
module.exports = { recordForfeit };
