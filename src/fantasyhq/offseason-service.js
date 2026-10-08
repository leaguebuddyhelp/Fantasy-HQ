const { randomUUID, createHash } = require('node:crypto');
const { STEPS, PHASE_BY_STEP, validateOffseason } = require('./offseason-state');
const { requireCommissioner } = require('./postseason-state');
const { activeMemberships } = require('./service-helpers');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function createOffseasonService({ repository, submissions, now = Date.now, backup = () => require('./storage-safety').createStorageBackup(repository.dataRoot, { label: 'offseason-transition' }) }) {
  submissions ||= require('./game-submissions').createGameSubmissionService({ repository });
  // Confirmations are stored in offseason.json so a restart does not lose a reviewed action.
  function source(leagueId) {
    const c = repository.loadLeague(leagueId);
    return { league: c.league, teams: c.teams, owners: repository.loadOwners(leagueId),
      players: repository.loadPlayers(leagueId), memberships: repository.loadRosterMemberships(leagueId),
      picks: repository.loadDraftPicks(leagueId), trades: repository.loadTrades(leagueId),
      freeAgency: repository.loadFreeAgencyState(leagueId), upgrades: repository.loadPlayerUpgradeState(leagueId),
      schedule: repository.scheduleExists(leagueId, c.seasonId) ? repository.loadSchedule(leagueId, c.seasonId) : null,
      playoffs: repository.loadPlayoffs(leagueId, c.seasonId), awards: repository.loadAwards(leagueId),
      championships: repository.loadChampionships(leagueId), powerRankings: repository.loadPowerRankings(leagueId), news: repository.loadNews(leagueId),
      games: submissions.records().filter(record => record.game.leagueId === leagueId && String(record.game.seasonId) === c.seasonId) };
  }
  function context(leagueId, actor) {
    const c = repository.loadLeague(leagueId); requireCommissioner(c, actor); return c;
  }
  function inspect(leagueId) {
    const c = repository.loadLeague(leagueId), state = repository.loadOffseason(leagueId);
    const season = state?.seasons[c.seasonId] || null, step = season?.step || 'WRAP_UP';
    const blockers = [];
    if (!['OFFSEASON', 'DRAFT', 'FREE_AGENCY'].includes(c.league.currentPhase)) blockers.push('Finish the championship before starting the offseason.');
    if (season && c.league.currentPhase !== PHASE_BY_STEP[step]) blockers.push('The league phase does not match the current offseason step.');
    if (step === 'WRAP_UP') {
      const championship = repository.loadChampionships(leagueId).seasons?.[c.seasonId];
      if (!championship?.finalizedAt || !championship.confirmedBy || !c.teams.some(t => t.teamId === championship.teamId)) blockers.push('Confirm the official championship.');
      const awards = repository.loadAwards(leagueId).seasons?.[c.seasonId];
      for (const group of ['REGULAR_SEASON', 'CONFERENCE_FINALS', 'NBA_FINALS']) if (!awards?.[group]?.confirmedAt || !awards[group].confirmedBy) blockers.push(`Confirm ${group.replaceAll('_', ' ')} awards.`);
    } else {
      // Completion receipts are written by verified import services, never by an unchecked UI checkbox.
      const receipt = season.receipts?.[step];
      if (!receipt?.confirmedAt || !receipt?.requestId) blockers.push(`Complete and confirm ${step.replaceAll('_', ' ').toLowerCase()} review.`);
      if (step === 'CUTDOWN' || step === 'PROGRESSION' || step === 'PREPARATION') {
        const memberships = activeMemberships(repository.loadRosterMemberships(leagueId), c.seasonId);
        const players = new Set(repository.loadPlayers(leagueId).filter(p => !p.retiredAt).map(p => p.playerId));
        if (c.teams.length !== 30) blockers.push('Exactly 30 teams are required.');
        const seen = new Set();
        for (const m of memberships) {
          if (seen.has(m.playerId) || !players.has(m.playerId) || !c.teams.some(t => t.teamId === m.teamId)) blockers.push(`Resolve invalid active membership ${m.playerId}.`);
          seen.add(m.playerId);
        }
        for (const team of c.teams) {
          const count = memberships.filter(m => m.teamId === team.teamId).length;
          if (count !== 15) blockers.push(`${team.teamName}: ${count}/15 players.`);
        }
      }
    }
    return { leagueId, seasonId: c.seasonId, step, nextStep: STEPS[STEPS.indexOf(step) + 1] || null,
      revision: season?.revision || 0, completedSteps: season?.completedSteps || [], blockers,
      ready: blockers.length === 0, pending: season?.pending ? { token: season.pending.token, expiresAt: season.pending.expiresAt, nextStep: season.pending.nextStep } : null };
  }
  function save(leagueId, state, auditEntry, extraFiles = []) {
    validateOffseason(state);
    repository.commitLeagueFiles({ leagueId, files: [
      ...extraFiles, { name: 'offseason.json', value: state },
      { name: 'audit-log.json', value: [...repository.loadAuditLog(leagueId), auditEntry] },
    ] });
  }
  function prepare(leagueId, actor) {
    const c = context(leagueId, actor), view = inspect(leagueId);
    if (!view.ready) return view;
    if (!view.nextStep) throw Error('Season rollover requires its own reviewed confirmation.');
    const state = repository.loadOffseason(leagueId) || { version: 1, seasons: {} };
    const timestamp = new Date(now()).toISOString();
    const season = state.seasons[c.seasonId] ||= { seasonId: c.seasonId, step: 'WRAP_UP', revision: 1, completedSteps: [], receipts: {}, history: [], createdAt: timestamp };
    const pending = { token: randomUUID(), actorId: actor.id, sourceDigest: hash(source(leagueId)), step: season.step,
      nextStep: view.nextStep, revision: season.revision, expiresAt: now() + 300000 };
    season.pending = pending;
    save(leagueId, state, { action: 'offseason.transition.prepared', userId: actor.id, seasonId: c.seasonId, timestamp, requestId: pending.token, metadata: { step: season.step, nextStep: pending.nextStep } });
    return { ...inspect(leagueId), token: pending.token };
  }
  function confirm(leagueId, actor, token) {
    const c = context(leagueId, actor), state = repository.loadOffseason(leagueId), season = state?.seasons[c.seasonId];
    const prior = season?.history.find(entry => entry.requestId === token);
    if (prior) { if (prior.userId !== actor.id) throw Error('Confirmation belongs to another commissioner.'); return inspect(leagueId); }
    const pending = season?.pending;
    if (!pending || pending.token !== token || pending.actorId !== actor.id || pending.expiresAt <= now()
      || pending.step !== season.step || pending.revision !== season.revision) throw Error('Offseason confirmation expired or changed. Review again.');
    const view = inspect(leagueId);
    if (!view.ready || hash(source(leagueId)) !== pending.sourceDigest) throw Error('Offseason source data changed. Review again.');
    const timestamp = new Date(now()).toISOString(), snapshot = source(leagueId);
    const storedArchive = repository.loadSeasonArchive(leagueId, c.seasonId);
    const safetyBackup = backup();
    const entry = { action: 'offseason.step.advanced', userId: actor.id, seasonId: c.seasonId, timestamp, requestId: token,
      metadata: { from: season.step, to: pending.nextStep, backupId: safetyBackup?.id || null } };
    season.completedSteps.push(season.step); season.step = pending.nextStep; season.revision++;
    season.history.push(entry); delete season.pending;
    save(leagueId, state, entry, [
      { name: 'league.json', value: { ...c.league, currentPhase: PHASE_BY_STEP[season.step], updatedAt: timestamp } },
      ...(!storedArchive ? [{ name: `season-archives/${c.seasonId}.json`, value: { version: 1, leagueId, seasonId: c.seasonId, archivedAt: timestamp, ...snapshot } }] : []),
    ]);
    return inspect(leagueId);
  }
  function cancel(leagueId, actor, token) {
    const c = context(leagueId, actor), state = repository.loadOffseason(leagueId), season = state?.seasons[c.seasonId];
    const pending = season?.pending?.token === token ? season.pending : season?.rolloverPending?.token === token ? season.rolloverPending : null;
    if (!pending || pending.actorId !== actor.id) throw Error('Offseason confirmation expired or changed. Review again.');
    if (season.pending?.token === token) delete season.pending;
    if (season.rolloverPending?.token === token) delete season.rolloverPending;
    save(leagueId, state, { action: 'offseason.transition.cancelled', userId: actor.id, seasonId: c.seasonId, timestamp: new Date(now()).toISOString(), requestId: token });
    return inspect(leagueId);
  }
  function inspectRollover(leagueId) {
    const c = repository.loadLeague(leagueId), state = repository.loadOffseason(leagueId), season = state?.seasons[c.seasonId];
    const blockers = [];
    if (season?.step !== 'PREPARATION' || season.completedSteps.length !== 9 || !season.receipts?.PREPARATION?.confirmedAt) blockers.push('Complete all offseason steps and confirm regular-season preparation first.');
    if (!['OFFSEASON', 'DRAFT', 'FREE_AGENCY'].includes(c.league.currentPhase)) blockers.push('Season rollover is available only after the offseason.');
    if (season?.schedulePolicy !== 'CONFERENCE_ROUND_ROBIN_15') blockers.push('Confirm the schedule policy before generating the next season.');
    if (!repository.loadSeasonArchive(leagueId, c.seasonId)) blockers.push('The completed season archive is missing.');
    const players = repository.loadPlayers(leagueId), ids = new Set(players.filter(p => !p.retiredAt).map(p => p.playerId));
    const memberships = activeMemberships(repository.loadRosterMemberships(leagueId), c.seasonId), seen = new Set();
    if (c.teams.length !== 30) blockers.push('Exactly 30 teams are required.');
    for (const m of memberships) {
      if (!ids.has(m.playerId) || seen.has(m.playerId) || !c.teams.some(t => t.teamId === m.teamId)) blockers.push(`Resolve invalid membership ${m.playerId}.`);
      seen.add(m.playerId);
    }
    for (const team of c.teams) if (memberships.filter(m => m.teamId === team.teamId).length !== 15) blockers.push(`${team.teamName} must have exactly 15 players.`);
    const fa = repository.loadFreeAgencyState(leagueId), locks = require('./transaction-locks');
    if (repository.loadTrades(leagueId).some(t => String(t.seasonId) === c.seasonId && locks.ACTIVE_TRADES.has(t.status))
      || fa.windows.some(w => String(w.seasonId) === c.seasonId && locks.ACTIVE_WINDOWS.has(w.status))
      || fa.offers.some(o => String(o.seasonId) === c.seasonId && locks.LIVE_OFFERS.has(o.status))
      || fa.waivers.some(w => String(w.seasonId) === c.seasonId && w.status === 'PENDING')
      || (repository.loadPlayerUpgradeState(leagueId)?.requests || []).some(r => String(r.seasonId) === c.seasonId && r.status === 'PENDING_STAFF')) blockers.push('Resolve pending transactions and upgrades before rollover.');
    const nextSeasonNumber = Number(c.league.seasonNumber) + 1, nextSeasonId = String(nextSeasonNumber);
    const contractYear = require('./asset-valuation').leagueSeasonStartYear(nextSeasonNumber);
    const contractSeason = `${contractYear}-${String(contractYear + 1).slice(-2)}`;
    for (const player of players.filter(p => seen.has(p.playerId))) {
      const salary = player.contract?.seasons?.find(row => row.season === contractSeason);
      if (!salary || !Number.isSafeInteger(salary.salary) || salary.salary <= 0) blockers.push(`${player.name}: verify the next season's contract.`);
      else if (salary.option && salary.optionDecision !== 'ACCEPTED') blockers.push(`${player.name}: confirm the upcoming contract option decision.`);
    }
    if (!Number.isSafeInteger(nextSeasonNumber) || repository.scheduleExists(leagueId, nextSeasonId) || state?.seasons[nextSeasonId]) blockers.push('The next season ID is invalid or already exists.');
    return { leagueId, seasonId: c.seasonId, nextSeasonId, nextSeasonNumber, blockers, ready: blockers.length === 0 };
  }
  function prepareRollover(leagueId, actor) {
    const c = context(leagueId, actor), view = inspectRollover(leagueId);
    if (!view.ready) return view;
    const state = repository.loadOffseason(leagueId), season = state.seasons[c.seasonId];
    const pending = { token: randomUUID(), actorId: actor.id, sourceDigest: hash(source(leagueId)), revision: season.revision, expiresAt: now() + 300000, nextSeasonId: view.nextSeasonId };
    season.rolloverPending = pending;
    save(leagueId, state, { action: 'season.rollover.prepared', userId: actor.id, seasonId: c.seasonId, timestamp: new Date(now()).toISOString(), requestId: pending.token });
    return { ...view, token: pending.token };
  }
  function confirmRollover(leagueId, actor, token) {
    const c = context(leagueId, actor), state = repository.loadOffseason(leagueId);
    const prior = Object.values(state?.seasons || {}).find(s => s.rolledOver?.requestId === token)?.rolledOver;
    if (prior) { if (prior.confirmedBy !== actor.id) throw Error('Confirmation belongs to another commissioner.'); return prior; }
    const season = state?.seasons[c.seasonId], pending = season?.rolloverPending, view = inspectRollover(leagueId);
    if (!view.ready || !pending || pending.token !== token || pending.actorId !== actor.id || pending.expiresAt <= now()
      || pending.revision !== season.revision || pending.nextSeasonId !== view.nextSeasonId || pending.sourceDigest !== hash(source(leagueId))) throw Error('Rollover confirmation expired or changed. Review again.');
    const timestamp = new Date(now()).toISOString(), players = repository.loadPlayers(leagueId);
    const { leagueAge, leagueSeasonStartYear } = require('./asset-valuation'), year = leagueSeasonStartYear(view.nextSeasonNumber);
    for (const player of players) {
      const before = { age: player.age ?? null, yearsInNBA: player.yearsInNBA ?? null };
      const age = leagueAge(player.birthdate, view.nextSeasonNumber);
      if (age != null) player.age = age;
      else if (Number.isFinite(player.age) && player.age >= 0) player.age++;
      // Incoming rookies enter their first season at zero experience.
      if (!player.retiredAt && Number.isInteger(player.yearsInNBA) && player.yearsInNBA >= 0
        && player.nbaDebutSeasonId !== view.nextSeasonId && Number(player.draftYear) !== year) player.yearsInNBA++;
      player.seasonHistory ||= [];
      player.seasonHistory.push({ action: 'ROLLOVER', fromSeasonId: c.seasonId, seasonId: view.nextSeasonId, at: timestamp, before, after: { age: player.age ?? null, yearsInNBA: player.yearsInNBA ?? null } });
      // Salary schedules are preserved. Contract display/valuation advances by the new league season.
    }
    const memberships = repository.loadRosterMemberships(leagueId), carried = [];
    for (const m of activeMemberships(memberships, c.seasonId)) {
      carried.push({ ...m, membershipId: randomUUID(), seasonId: view.nextSeasonId, active: true, endedAt: null, endedReason: null, startedAt: timestamp, source: 'season-rollover', previousMembershipId: m.membershipId || null });
      m.active = false; m.endedAt = timestamp; m.endedReason = 'SEASON_ROLLOVER';
    }
    const schedule = require('./schedule-generator').generateSchedule({ leagueId, seasonId: view.nextSeasonId, teams: c.teams });
    for (const week of schedule.weeks) { week.weekId = randomUUID(); for (const game of week.games) game.gameId = randomUUID(); }
    const validation = require('./schedule-validator').validateSchedule(schedule, c.teams);
    if (!validation.valid) throw Error('Generated rollover schedule failed validation.');
    const safetyBackup = backup(), receipt = { requestId: token, fromSeasonId: c.seasonId, nextSeasonId: view.nextSeasonId, confirmedAt: timestamp, confirmedBy: actor.id, backupId: safetyBackup?.id || null };
    season.rolledOver = receipt; season.revision++; delete season.rolloverPending;
    const league = { ...c.league, seasonNumber: view.nextSeasonNumber, currentSeasonId: view.nextSeasonId, currentPhase: 'PRESEASON', currentWeek: null, regularSeasonStatus: null, regularSeasonCompletedAt: null, updatedAt: timestamp };
    const upgrades = repository.loadPlayerUpgradeState(leagueId);
    if (upgrades) { upgrades.phases ||= {}; upgrades.phases[view.nextSeasonId] = 'PRESEASON'; }
    repository.commitReset({ leagueId, seasonId: view.nextSeasonId, files: [
      { name: 'league.json', value: league }, { name: 'players.json', value: players }, { name: 'roster-memberships.json', value: [...memberships, ...carried] },
      { name: 'offseason.json', value: state }, { name: 'current-schedule.json', value: schedule }, { name: `schedules/${view.nextSeasonId}.json`, value: schedule },
      ...(upgrades ? [{ name: 'player-upgrades.json', value: upgrades }] : []),
      { name: 'audit-log.json', value: [...repository.loadAuditLog(leagueId), { action: 'season.rolled.over', userId: actor.id, seasonId: c.seasonId, timestamp, requestId: token, metadata: receipt }] },
    ] });
    return receipt;
  }
  function prepareNext(leagueId, actor) {
    if (inspect(leagueId).step !== 'PREPARATION') return prepare(leagueId, actor);
    return { ...prepareRollover(leagueId, actor), step: 'PREPARATION', nextStep: 'PRESEASON', rollover: true };
  }
  function confirmNext(leagueId, actor, token) {
    const state = repository.loadOffseason(leagueId);
    const rollover = Object.values(state?.seasons || {}).some(s => s.rolloverPending?.token === token || s.rolledOver?.requestId === token);
    if (!rollover) return confirm(leagueId, actor, token);
    const receipt = confirmRollover(leagueId, actor, token);
    return { leagueId, seasonId: receipt.nextSeasonId, step: 'PRESEASON', nextStep: null, blockers: [], ready: false, receipt };
  }
  return { inspect, prepare, confirm, cancel, inspectRollover, prepareRollover, confirmRollover, prepareNext, confirmNext };
}
module.exports = { createOffseasonService };
