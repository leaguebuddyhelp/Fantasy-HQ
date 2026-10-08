const ACTIVE_TRADES = new Set(['PENDING_GM_APPROVAL', 'PENDING_COMMITTEE', 'AWAITING_PROOF', 'PENDING_PROOF_REVIEW']);
const ACTIVE_WINDOWS = new Set(['OPEN', 'CLOSED_AWAITING_REVIEW', 'RESOLVING', 'AWAITING_WINNER_ROSTER_CUT']);
const LIVE_OFFERS = new Set(['PENDING_REVIEW', 'APPROVED']);
function playerTransactionLock(repository, leagueId, seasonId, playerId, { windowId = null, waiverId = null, includeTrades = true } = {}) {
  if (includeTrades) {
    const trade = repository.loadTrades(leagueId).find(t => String(t.seasonId) === String(seasonId) && ACTIVE_TRADES.has(t.status) && (t.currentVersion?.transfers || []).some(a => a.assetType === 'PLAYER' && a.assetId === playerId));
    if (trade) return 'Player is locked by an active trade.';
  }
  const state = repository.loadFreeAgencyState(leagueId);
  const windows = new Set(state.windows.filter(w => w.seasonId === String(seasonId) && ACTIVE_WINDOWS.has(w.status) && w.id !== windowId).map(w => w.id));
  if (state.offers.some(o => windows.has(o.windowId) && LIVE_OFFERS.has(o.status) && o.conditionalReleasePlayerId === playerId)) return 'Player is reserved as an FA conditional release.';
  if (state.windows.some(w => windows.has(w.id) && w.cutPlayerId === playerId)) return 'Player is reserved for an FA roster cut.';
  if (state.waivers.some(w => w.id !== waiverId && w.seasonId === String(seasonId) && w.playerId === playerId && w.status === 'PENDING')) return 'Player has a pending waiver request.';
  return null;
}
module.exports = { playerTransactionLock, ACTIVE_TRADES, ACTIVE_WINDOWS, LIVE_OFFERS };
