const { randomUUID } = require('crypto');
const { createFantasyHQRepository } = require('./repository');
const { activeMemberships } = require('./service-helpers');
const { leagueSeasonStartYear } = require('./asset-valuation');
const { normalizeOffer, offerScore, rankOffers } = require('./offer-score');
const { playerTransactionLock, ACTIVE_WINDOWS, LIVE_OFFERS } = require('./transaction-locks');
const HOUR_MS = 3600000;
const ROSTER_SIZE = 15; // Same roster rule enforced by trade-service.
function offerWindowDuration(settings = {}) {
  const seconds = Number(settings.freeAgencyTestWindowSeconds);
  return settings.testMode === true && Number.isFinite(seconds) && seconds >= 10 && seconds < 3600 ? Math.round(seconds * 1000) : HOUR_MS;
}
function createFreeAgencyService({ repository = createFantasyHQRepository(), now = Date.now, onPlayersMoved = null } = {}) {
  const stamp = () => new Date(now()).toISOString();
  function load(leagueId) {
    const context = repository.loadLeague(leagueId);
    const state = repository.loadFreeAgencyState(leagueId);
    state.teams ||= {}; state.deliveries ||= []; state.drafts ||= [];
    return { leagueId, context, state, players: repository.loadPlayers(leagueId), memberships: repository.loadRosterMemberships(leagueId), extraAudit: [] };
  }
  function save(s, action, actorUserId = 'system', metadata = {}) {
    repository.commitTradeTransaction({ leagueId: s.leagueId, players: s.players, rosterMemberships: s.memberships, draftPicks: repository.loadDraftPicks(s.leagueId), trades: repository.loadTrades(s.leagueId), freeAgencyState: s.state,
      auditEntry: { action, userId: actorUserId, leagueId: s.leagueId, seasonId: s.context.seasonId, timestamp: stamp(), metadata }, auditEntries: s.extraAudit });
    if (onPlayersMoved && s.extraAudit.length) Promise.resolve().then(() => onPlayersMoved({ leagueId: s.leagueId, seasonId: s.context.seasonId, playerIds: [...new Set(s.extraAudit.map(a => a.metadata.playerId))], reason: 'FA_OR_WAIVER' })).catch(e => console.error('FA roster refresh:', e.message));
  }
  function duration(s) {
    return offerWindowDuration(repository.loadSettings(s.leagueId) || {});
  }
  function roster(s, teamId) { return activeMemberships(s.memberships, s.context.seasonId).filter(m => m.teamId === teamId); }
  function available(s, playerId) { const matches = s.players.filter(p => p.playerId === playerId); return matches.length === 1 && !activeMemberships(s.memberships, s.context.seasonId).some(m => m.playerId === playerId); }
  function windowFor(s, playerId) { return s.state.windows.find(w => w.playerId === playerId && w.seasonId === s.context.seasonId && ACTIVE_WINDOWS.has(w.status)); }
  function offersFor(s, windowId, teamId = null) { return s.state.offers.filter(o => o.windowId === windowId && (!teamId || o.teamId === teamId)); }
  function live(s, windowId, teamId = null) { return offersFor(s, windowId, teamId).filter(o => LIVE_OFFERS.has(o.status)); }
  function authorize(s, teamId, actorUserId, staffAuthorized = false) {
    if (!s.context.teams.some(t => t.teamId === teamId)) throw Error('Unknown team.');
    const owner = repository.loadOwners(s.leagueId).find(o => o.teamId === teamId);
    if (owner?.userId !== actorUserId && !(repository.loadSettings(s.leagueId)?.testMode === true && !owner && staffAuthorized)) throw Error('Only the current assigned Coach can act for this team. Staff may simulate vacant teams only in Test Mode.');
  }
  function consent(s, row) {
    const owner = repository.loadOwners(s.leagueId).find(o => o.teamId === row.teamId);
    return owner ? owner.userId === row.coachUserId && (!owner.assignedAt || Date.parse(owner.assignedAt) <= Date.parse(row.submittedAt)) : repository.loadSettings(s.leagueId)?.testMode === true && row.staffTestAuthorized === true;
  }
  function requireStaff(staffAuthorized) { if (!staffAuthorized) throw Error('Only configured Staff can review proof.'); }
  function teamStatus(s, teamId) {
    const key = `${s.context.seasonId}:${teamId}`;
    const completedSignings = s.state.teams[key]?.completedSignings || 0;
    const targets = s.state.windows.filter(w => w.seasonId === s.context.seasonId && ACTIVE_WINDOWS.has(w.status) && live(s, w.id, teamId).length);
    return { completedSignings, activeTargets: targets.length, allowedActiveTargets: Math.min(2, Math.max(0, 5 - completedSignings)), targets };
  }
  function requireRelease(s, teamId, playerId, windowId = null, waiverId = null) {
    const memberships = activeMemberships(s.memberships, s.context.seasonId).filter(m => m.playerId === playerId);
    if (memberships.length !== 1 || memberships[0].teamId !== teamId || s.players.filter(p => p.playerId === playerId).length !== 1) throw Error('Select a current roster player with one valid owner.');
    const reason = playerTransactionLock(repository, s.leagueId, s.context.seasonId, playerId, { windowId, waiverId });
    if (reason) throw Error(reason);
  }
  function offer(leagueId, args) {
    const s = load(leagueId), { teamId, actorUserId, playerId, screenshot, details, conditionalReleasePlayerId = null, staffAuthorized = false, requestId = randomUUID() } = args;
    const duplicate = s.state.offers.find(o => o.requestId === requestId);
    if (duplicate) { if (duplicate.coachUserId !== actorUserId || duplicate.teamId !== teamId) throw Error('Submission belongs to another coach.'); return duplicate; }
    authorize(s, teamId, actorUserId, staffAuthorized);
    if (!available(s, playerId)) throw Error('This player is no longer in the official Free Agent pool.');
    let w = windowFor(s, playerId);
    if ((s.context.league.regularSeasonStatus === 'COMPLETED' && !w) || (s.context.league.currentPhase !== 'REGULAR_SEASON' && !(s.context.league.currentPhase === 'PLAYOFFS' && w?.startedPhase === 'REGULAR_SEASON'))) throw Error('New Free Agent windows require REGULAR_SEASON.');
    if (w && (w.status !== 'OPEN' || now() >= Date.parse(w.deadlineAt))) throw Error('This offer window is closed.');
    const existing = w ? live(s, w.id, teamId) : [];
    if (existing.some(o => o.status === 'PENDING_REVIEW')) throw Error('Your current screenshot is still awaiting Staff review.');
    if (existing.length && (s.context.league.currentPhase !== 'REGULAR_SEASON' || s.context.league.regularSeasonStatus === 'COMPLETED')) throw Error('Offer improvements are closed outside REGULAR_SEASON.');
    const status = teamStatus(s, teamId);
    if (status.completedSignings >= 5 || (!existing.length && status.activeTargets >= status.allowedActiveTargets)) throw Error(`FA target limit reached (${status.activeTargets}/${status.allowedActiveTargets}); signings ${status.completedSignings}/5.`);
    if (!screenshot?.path || !screenshot?.url) throw Error('An official NBA 2K offer screenshot is required.');
    const normalized = normalizeOffer(details, { year: leagueSeasonStartYear(s.context.seasonId), screenshotUrl: screenshot.url, timestamp: stamp() });
    const previous = existing.find(o => o.status === 'APPROVED');
    if (previous && offerScore(normalized.contract, normalized.details.structure) <= offerScore(previous.contract, previous.details.structure)) throw Error('An improvement must be strictly better than your approved offer.');
    if (roster(s, teamId).length >= ROSTER_SIZE && !conditionalReleasePlayerId) throw Error('Your roster is full. Select a conditional release.');
    if (conditionalReleasePlayerId) requireRelease(s, teamId, conditionalReleasePlayerId, w?.id);
    if (!w) {
      w = { id: randomUUID(), leagueId, seasonId: s.context.seasonId, playerId, status: 'OPEN', startedAt: stamp(), startedPhase: 'REGULAR_SEASON', deadlineAt: new Date(now() + duration(s)).toISOString(), durationMs: duration(s), createdByOfferId: null, announcementMessageId: null, announcementChannelId: null, ranking: [], rankingIndex: 0 };
      s.state.windows.push(w);
    }
    const row = { id: randomUUID(), requestId, windowId: w.id, leagueId, seasonId: s.context.seasonId, playerId, teamId, coachUserId: actorUserId, staffTestAuthorized: staffAuthorized && repository.loadSettings(leagueId)?.testMode === true, submittedAt: stamp(), screenshot, ocrOriginal: Object.fromEntries(["salary", "years", "structure", "option"].map(key => [key, (args.ocrOriginal || details)[key]])), ...normalized, conditionalReleasePlayerId, status: 'PENDING_REVIEW', version: offersFor(s, w.id, teamId).length + 1, submissionSequence: s.state.offers.length, replacesOfferId: previous?.id || null, corrections: [], startedPhase: s.context.league.currentPhase };
    s.state.offers.push(row); w.createdByOfferId ||= row.id;
    save(s, 'fa.offer.submitted', actorUserId, { windowId: w.id, offerId: row.id });
    return row;
  }
  function cancel(s, w, status, reason) {
    w.status = status; w.reason = reason; w.resolvedAt = stamp();
    for (const o of live(s, w.id)) o.status = 'INVALIDATED';
  }
  function reviewOffer(leagueId, { offerId, decision, actorUserId, staffAuthorized, correction = null }) {
    requireStaff(staffAuthorized);
    const s = load(leagueId), o = s.state.offers.find(o => o.id === offerId);
    if (!o) throw Error('Offer not found.');
    if (o.status !== 'PENDING_REVIEW') return o;
    if (!consent(s, o)) { o.status = 'INVALIDATED'; o.reason = 'Coach ownership changed.'; save(s, 'fa.offer.invalidated', actorUserId, { offerId }); return o; }
    const w = s.state.windows.find(w => w.id === o.windowId);
    if (!ACTIVE_WINDOWS.has(w.status)) throw Error('This process is no longer active.');
    if (correction) {
      const normalized = normalizeOffer(correction, { year: leagueSeasonStartYear(o.seasonId), screenshotUrl: o.screenshot.url, timestamp: stamp() });
      o.corrections.push({ before: o.details, after: normalized.details, actorUserId, timestamp: stamp() });
      Object.assign(o, normalized);
    }
    if (decision === 'CORRECT') { save(s, 'fa.offer.corrected', actorUserId, { offerId }); return o; }
    if (!['APPROVE', 'REJECT'].includes(decision)) throw Error('Choose approve or reject.');
    const old = live(s, w.id, o.teamId).find(a => a.id !== o.id && a.status === 'APPROVED');
    if (decision === 'APPROVE' && old && offerScore(o.contract, o.details.structure) <= offerScore(old.contract, old.details.structure)) {
      o.status = 'REJECTED'; o.reason = 'Corrected improvement is not strictly better than the approved offer.';
    } else {
      o.status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      if (o.status === 'APPROVED' && old) old.status = 'SUPERSEDED';
    }
    o.reviewedBy = actorUserId; o.reviewedAt = stamp();
    if (!live(s, w.id).length) cancel(s, w, 'NO_VALID_OFFERS', 'No active offers remain.');
    save(s, 'fa.offer.reviewed', actorUserId, { offerId, decision: o.status });
    tick(leagueId); return repository.loadFreeAgencyState(leagueId).offers.find(a => a.id === offerId);
  }
  function withdraw(leagueId, { windowId, teamId, actorUserId, staffAuthorized = false }) {
    const s = load(leagueId); authorize(s, teamId, actorUserId, staffAuthorized);
    const w = s.state.windows.find(w => w.id === windowId);
    if (!w || w.status !== 'OPEN' || now() >= Date.parse(w.deadlineAt)) throw Error('Withdrawals are closed at the original deadline.');
    for (const o of live(s, w.id, teamId)) { o.status = 'WITHDRAWN'; o.withdrawnAt = stamp(); }
    if (!live(s, w.id).length) cancel(s, w, 'CANCELLED', 'All offers withdrawn.');
    save(s, 'fa.offer.withdrawn', actorUserId, { windowId, teamId });
  }
  function release(s, teamId, playerId, transactionId, reason) {
    const m = roster(s, teamId).find(m => m.playerId === playerId), p = s.players.find(p => p.playerId === playerId);
    if (!m || !p) throw Error('Release player changed ownership.');
    const oldContract = p.contract || null;
    m.active = false; m.endedAt = stamp(); m.transactionId = transactionId;
    p.teamId = null; delete p.contract; p.updatedAt = stamp();
    s.extraAudit.push({ action: 'player.waived', userId: 'system', leagueId: s.leagueId, seasonId: s.context.seasonId, timestamp: stamp(), metadata: { transactionId, teamId, playerId, oldContract, reason } });
  }
  function finish(s, w) {
    if (!available(s, w.playerId)) { cancel(s, w, 'CANCELLED', 'Player removed from the official FA pool.'); return; }
    while (w.rankingIndex < w.ranking.length) {
      const o = s.state.offers.find(o => o.id === w.ranking[w.rankingIndex]);
      if (!o || !consent(s, o) || o.status !== 'APPROVED' || teamStatus(s, o.teamId).completedSignings >= 5) { if (o) o.status = 'FORFEITED'; w.rankingIndex++; continue; }
      const count = roster(s, o.teamId).length;
      const cutId = w.cutPlayerId || o.conditionalReleasePlayerId;
      let validCut = false;
      if (cutId) { try { requireRelease(s, o.teamId, cutId, w.id); validCut = true; } catch { /* Coach may choose an eligible replacement. */ } }
      if (count >= ROSTER_SIZE && (!validCut || count > ROSTER_SIZE)) {
        if (w.status === 'AWAITING_WINNER_ROSTER_CUT' && now() >= Date.parse(w.cutDeadlineAt)) { o.status = 'FORFEITED'; w.rankingIndex++; w.cutPlayerId = null; w.status = 'RESOLVING'; w.cutDeadlineAt = null; continue; }
        if (w.status !== 'AWAITING_WINNER_ROSTER_CUT') { w.status = 'AWAITING_WINNER_ROSTER_CUT'; w.winnerOfferId = o.id; w.cutDeadlineAt = new Date(now() + (w.durationMs || HOUR_MS)).toISOString(); }
        return;
      }
      if (count >= ROSTER_SIZE) release(s, o.teamId, cutId, `${w.id}:release`, 'Conditional FA release');
      const p = s.players.find(p => p.playerId === w.playerId);
      p.teamId = o.teamId; p.contract = o.contract; p.updatedAt = stamp();
      s.memberships.push({ membershipId: randomUUID(), leagueId: s.leagueId, seasonId: w.seasonId, playerId: p.playerId, teamId: o.teamId, position1: p.position1, position2: p.position2, active: true, importedAt: stamp(), source: 'free-agency', transactionId: w.id });
      const key = `${w.seasonId}:${o.teamId}`;
      s.state.teams[key] ||= { completedSignings: 0 };
      s.state.teams[key].completedSignings++;
      o.status = 'WON'; w.status = 'COMPLETED'; w.winnerOfferId = o.id; w.resolvedAt = stamp();
      for (const other of live(s, w.id)) other.status = 'LOST';
      s.extraAudit.push({ action: 'fa.signing.completed', userId: o.coachUserId, leagueId: s.leagueId, seasonId: w.seasonId, timestamp: stamp(), metadata: { transactionId: w.id, windowId: w.id, playerId: p.playerId, teamId: o.teamId, contract: p.contract } });
      return;
    }
    cancel(s, w, 'NO_VALID_OFFERS', 'No eligible bidder completed the signing.');
  }
  function tick(leagueId) {
    const s = load(leagueId); const before = JSON.stringify(s.state);
    for (const o of s.state.offers.filter(o => LIVE_OFFERS.has(o.status))) if (!consent(s, o)) { o.status = 'INVALIDATED'; o.reason = 'Coach ownership changed.'; }
    for (const w of s.state.waivers.filter(w => w.status === 'PENDING')) if (!consent(s, w)) { w.status = 'INVALIDATED'; w.reason = 'Coach ownership changed.'; }
    for (const w of s.state.windows.filter(w => ACTIVE_WINDOWS.has(w.status))) {
      if (w.seasonId !== s.context.seasonId || !available(s, w.playerId)) { cancel(s, w, 'CANCELLED', 'Season changed or player removed from the official FA pool.'); continue; }
      if (now() < Date.parse(w.deadlineAt)) continue;
      if (live(s, w.id).some(o => o.status === 'PENDING_REVIEW')) { w.status = 'CLOSED_AWAITING_REVIEW'; continue; }
      if (!w.ranking.length && w.status !== 'AWAITING_WINNER_ROSTER_CUT') {
        w.ranking = rankOffers(live(s, w.id).filter(o => o.status === 'APPROVED')).map(o => o.id); w.rankingIndex = 0; w.status = 'RESOLVING';
      }
      finish(s, w);
    }
    if (JSON.stringify(s.state) !== before) {
      save(s, 'fa.windows.processed', 'system');
    }
    return s.state;
  }
  function chooseCut(leagueId, { windowId, teamId, actorUserId, playerId, staffAuthorized = false }) {
    const s = load(leagueId); authorize(s, teamId, actorUserId, staffAuthorized);
    const w = s.state.windows.find(w => w.id === windowId), winner = s.state.offers.find(o => o.id === w?.winnerOfferId);
    if (w?.status !== 'AWAITING_WINNER_ROSTER_CUT' || winner?.teamId !== teamId || now() >= Date.parse(w.cutDeadlineAt)) throw Error('This roster-cut window is closed or belongs to another team.');
    requireRelease(s, teamId, playerId, w.id);
    if (roster(s, teamId).length > ROSTER_SIZE) throw Error('Your roster exceeds 15. Complete Staff-approved waivers to bring it to 15 before choosing the final signing cut.');
    w.cutPlayerId = playerId; finish(s, w); save(s, 'fa.winner.cut', actorUserId, { windowId, playerId });
    return w;
  }
  function requestWaiver(leagueId, { teamId, playerId, actorUserId, staffAuthorized = false, requestId = randomUUID() }) {
    const s = load(leagueId); const duplicate = s.state.waivers.find(w => w.requestId === requestId);
    if (duplicate) { if (duplicate.coachUserId !== actorUserId) throw Error('This request belongs to another coach.'); return duplicate; }
    authorize(s, teamId, actorUserId, staffAuthorized);
    if (s.context.league.currentPhase !== 'REGULAR_SEASON' || s.context.league.regularSeasonStatus === 'COMPLETED') throw Error('New waiver requests require REGULAR_SEASON.');
    requireRelease(s, teamId, playerId);
    const w = { id: randomUUID(), requestId, leagueId, seasonId: s.context.seasonId, teamId, playerId, coachUserId: actorUserId, staffTestAuthorized: staffAuthorized && repository.loadSettings(leagueId)?.testMode === true, submittedAt: stamp(), startedPhase: 'REGULAR_SEASON', status: 'PENDING' };
    s.state.waivers.push(w); save(s, 'waiver.requested', actorUserId, { waiverId: w.id }); return w;
  }
  function reviewWaiver(leagueId, { waiverId, decision, actorUserId, staffAuthorized }) {
    requireStaff(staffAuthorized); const s = load(leagueId), w = s.state.waivers.find(w => w.id === waiverId);
    if (!w) throw Error('Waiver not found.');
    if (w.status !== 'PENDING') return w;
    if (!consent(s, w)) { w.status = 'INVALIDATED'; w.reason = 'Coach ownership changed.'; save(s, 'waiver.invalidated', actorUserId, { waiverId }); return w; }
    if (!['APPROVE', 'REJECT'].includes(decision)) throw Error('Choose approve or reject.');
    if (decision === 'REJECT') w.status = 'REJECTED';
    else {
      try { requireRelease(s, w.teamId, w.playerId, null, w.id); if (w.seasonId !== s.context.seasonId) throw Error('Season changed.'); }
      catch (e) { w.status = 'INVALIDATED'; w.reason = e.message; }
      if (w.status === 'PENDING') { release(s, w.teamId, w.playerId, w.id, 'Staff-approved waiver'); w.status = 'APPROVED'; }
    }
    w.reviewedBy = actorUserId; w.reviewedAt = stamp(); save(s, 'waiver.reviewed', actorUserId, { waiverId, decision: w.status });
    return w;
  }
  function browse(leagueId, position) {
    const s = load(leagueId);
    return s.players.filter(p => available(s, p.playerId) && p.position1 === position).sort((a, b) => Number(b.overall || 0) - Number(a.overall || 0) || a.name.localeCompare(b.name)).map(p => ({ playerId: p.playerId, name: p.name, position1: p.position1, overall: p.overall, status: windowFor(s, p.playerId)?.status || 'AVAILABLE', deadlineAt: windowFor(s, p.playerId)?.deadlineAt || null }));
  }
  function update(leagueId, fn) { const s = load(leagueId); fn(s.state); repository.saveFreeAgencyState(leagueId, s.state); }
  function simulateReplacement(leagueId,{teamId,playerId,releasePlayerId,actorUserId}) {
    const simulationId=require('./simulation-guard').requireSimulationRepository(repository,leagueId),s=load(leagueId);
    if(s.context.league.currentPhase!=='REGULAR_SEASON'||s.context.league.regularSeasonStatus==='COMPLETED')throw Error('Simulation roster transactions are frozen outside the regular season.');
    if(!available(s,playerId)||roster(s,teamId).length!==15||teamStatus(s,teamId).completedSignings>=5)throw Error('Available free agent, fifteen-player roster and signing eligibility required.');
    requireRelease(s,teamId,releasePlayerId);const id=randomUUID();release(s,teamId,releasePlayerId,id,'TEST MODE replacement');
    const player=s.players.find(p=>p.playerId===playerId);player.teamId=teamId;
    s.memberships.push({membershipId:randomUUID(),leagueId,seasonId:s.context.seasonId,playerId,teamId,position1:player.position1,position2:player.position2,active:true,source:'simulation',transactionId:id});
    const key=`${s.context.seasonId}:${teamId}`;s.state.teams[key]||={completedSignings:0};s.state.teams[key].completedSignings++;
    save(s,'simulation.fa.completed',actorUserId,{id,simulationId,teamId,playerId,releasePlayerId,contract:player.contract||null});return {id,teamId,playerId,releasePlayerId};
  }
  return { simulateReplacement, repository, offer, reviewOffer, withdraw, chooseCut, requestWaiver, reviewWaiver, browse, tick, update,
    getStatus(leagueId, teamId) { const s = load(leagueId); return teamStatus(s, teamId); },
    authorize(leagueId, args) { authorize(load(leagueId), args.teamId, args.actorUserId, args.staffAuthorized); },
    eligibleReleases(leagueId, teamId, windowId = null) { const s = load(leagueId); return roster(s, teamId).filter(m => !playerTransactionLock(repository, leagueId, s.context.seasonId, m.playerId, { windowId })).map(m => ({ ...s.players.find(p => p.playerId === m.playerId), position1: m.position1 || s.players.find(p => p.playerId === m.playerId)?.position1 })); }
  };
}
module.exports = { createFreeAgencyService, offerWindowDuration, HOUR_MS, ROSTER_SIZE };
