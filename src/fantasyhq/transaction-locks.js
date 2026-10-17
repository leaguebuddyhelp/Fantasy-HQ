const ACTIVE_TRADES = new Set(['PENDING_GM_APPROVAL', 'PENDING_COMMITTEE', 'AWAITING_PROOF', 'PENDING_PROOF_REVIEW']);
function playerTransactionLock(repository, leagueId, seasonId, playerId, { includeTrades = true } = {}) {
  if (includeTrades) {
    const trade = repository.loadTrades(leagueId).find(t => String(t.seasonId) === String(seasonId) && ACTIVE_TRADES.has(t.status) && (t.currentVersion?.transfers || []).some(a => a.assetType === 'PLAYER' && a.assetId === playerId));
    if (trade) return 'Player is locked by an active trade.';
  }
  return null;
}
module.exports = { playerTransactionLock, ACTIVE_TRADES };
