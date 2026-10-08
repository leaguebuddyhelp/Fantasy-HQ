const { randomUUID, createHash } = require('crypto');
const { createStandingsService } = require('./standings-service');
const { officialRegularGames } = require('./official-game');
const { ACTIVE_TRADES, ACTIVE_WINDOWS, LIVE_OFFERS } = require('./transaction-locks');
const confirmations = new Map();
function createSeasonTransitionService({ submissions, now = Date.now } = {}) {
  const repository = submissions.repository;
  function authorize(actor, guildId) { require('./postseason-state').requireCommissioner(repository.loadLeagueContext({ guildId }), actor); }
  function inspect(guildId) {
    const context = repository.loadLeagueContext({ guildId }), leagueId = context.league.leagueId;
    const priorPlayoffs=context.league.currentPhase==='PLAYOFFS'?repository.loadPlayoffs(leagueId):null;
    if(priorPlayoffs?.version===2)return {alreadyStarted:true,playoffs:priorPlayoffs};
    const legacyMigration=context.league.currentPhase==='PLAYOFFS'&&!!priorPlayoffs;
    if ((!legacyMigration && context.league.currentPhase !== 'REGULAR_SEASON') || context.league.regularSeasonStatus !== 'COMPLETED') throw Error('Complete Week 15 before starting playoffs.');
    const schedule = repository.loadSchedule(leagueId, context.seasonId);
    if (schedule.weeks.length !== 15 || schedule.weeks.some(w => w.status !== 'COMPLETED')) throw Error('All 15 regular-season weeks must be completed.');
    const records = submissions.records(), official = officialRegularGames(records, { leagueId, seasonId: context.seasonId, schedule });
    const final = new Set(official.games.map(r => JSON.stringify([r.game.weekId, [r.game.team1Id,r.game.team2Id].sort()])));
    const unresolved = schedule.weeks.flatMap(w => w.games.filter(g => !final.has(JSON.stringify([w.weekId,[g.team1Id,g.team2Id].sort()]))).map(g => ({ week: w.week, ...g })));
    const standings = createStandingsService({ repository, submissions }).getStandings(leagueId, context.seasonId, records);
    const fa = repository.loadFreeAgencyState(leagueId), upgrades = repository.loadPlayerUpgradeState(leagueId);
    const pending = { trades: repository.loadTrades(leagueId).filter(t => t.seasonId === context.seasonId && ACTIVE_TRADES.has(t.status)).map(t => ({ id: t.tradeId, status: t.status })), offers: fa.offers.filter(o => o.seasonId === context.seasonId && LIVE_OFFERS.has(o.status)).map(o => ({ id: o.id, status: o.status })), waivers: fa.waivers.filter(w => w.seasonId === context.seasonId && w.status === 'PENDING').map(w => w.id), windows: fa.windows.filter(w => w.seasonId === context.seasonId && ACTIVE_WINDOWS.has(w.status)).map(w => ({ id: w.id, status: w.status, deadlineAt: w.deadlineAt })), upgrades: (upgrades?.requests || []).filter(r => r.seasonId === context.seasonId && r.status === 'PENDING_STAFF').map(r => r.requestId) };
    const eligible = Object.fromEntries(['East','West'].map(c => [c,standings.conferences[c].slice(0,10)]));
    if(legacyMigration)for(const c of ['East','West']){const prior=priorPlayoffs.seeds?.[c]||[];eligible[c]=[...prior,...standings.conferences[c].filter(t=>!prior.some(p=>p.teamId===t.teamId))].slice(0,10);}
    require('./postseason-state').validateSeeds(eligible,context.teams);
    if (Object.values(eligible).some(teams => teams.length !== 10)) throw Error('Playoffs require ten teams in each conference.');
    const view = { legacyMigration, priorPlayoffsDigest:priorPlayoffs?createHash('sha256').update(JSON.stringify(priorPlayoffs)).digest('hex'):null, leagueId, seasonId: context.seasonId, standings: standings.conferences, seeds: eligible, unresolved, pending, blocked: unresolved.length > 0 || official.duplicates.length > 0 };
    view.digest = createHash('sha256').update(JSON.stringify({ ...view, finalVersions: official.games.map(r => [r.game.gameId,r.game.result.extractionId]) })).digest('hex');
    return view;
  }
  function prepare(guildId, actor) {
    authorize(actor, guildId); const view = inspect(guildId); if (view.alreadyStarted || view.blocked) return view;
    const token = randomUUID(); confirmations.set(token, { guildId, actorId: actor.id, digest: view.digest, seeds: structuredClone(view.seeds), seedChanges: [], root: repository.dataRoot, expiresAt: now()+300000 });
    return { ...view, token };
  }
  function confirm(guildId, actor, token) {
    authorize(actor, guildId);
    const context = repository.loadLeagueContext({ guildId });
    const prior = repository.loadAuditLog(context.league.leagueId).find(e => e.action === 'season.playoffs.started' && e.requestId === token);
    if (prior) { if (prior.userId !== actor.id) throw Error('Confirmation belongs to another commissioner.'); return repository.loadPlayoffs(context.league.leagueId); }
    const confirmation = confirmations.get(token);
    if (!confirmation || confirmation.actorId !== actor.id || confirmation.guildId !== guildId || confirmation.root !== repository.dataRoot || confirmation.expiresAt < now()) throw Error('Playoff confirmation expired. Review again.');
    const view = inspect(guildId); if (view.blocked || view.digest !== confirmation.digest) throw Error('Season closeout changed. Review playoff seeding again.');
    const timestamp = new Date(now()).toISOString(), upgrades = repository.loadPlayerUpgradeState(view.leagueId);
    if (upgrades) {
      for (const r of upgrades.requests || []) if (r.seasonId === view.seasonId && r.status === 'PENDING_STAFF') { r.status = 'EXPIRED'; r.expirationReason = 'PLAYOFFS_STARTED'; r.updatedAt = timestamp; }
      for (const e of upgrades.newUserEntitlements || []) if (String(e.eligibleSeasonId) === view.seasonId && e.status === 'AVAILABLE') e.status = 'EXPIRED';
      for (const t of upgrades.tenures || []) if (t.seasonId === view.seasonId) t.spendingClosedAt = timestamp;
      for (const team of Object.values(upgrades.teamSeasons?.[view.seasonId] || {})) team.activeRequestId = null;
      upgrades.phases ||= {}; upgrades.phases[view.seasonId] = 'PLAYOFFS';
    }
    const schedule = repository.loadSchedule(view.leagueId, view.seasonId);
    const publicationGames = officialRegularGames(submissions.records(), { leagueId: view.leagueId, seasonId: view.seasonId, schedule }).games;
    schedule.statsPublication = { throughWeek: 15, publishedAt: timestamp, gameIds: publicationGames.map(r => r.game.gameId), snapshots: require('./official-game').publicationSnapshot(publicationGames) };
    const playoffs = require('./postseason-state').initializePostseason({ teams: context.teams, now: now(), leagueId: view.leagueId, seasonId: view.seasonId, seasonNumber:context.league.seasonNumber, startedAt: timestamp, standings: view.standings, seeds: confirmation.seeds, tiebreakers: ['PCT','W','HEAD_TO_HEAD','POINT_DIFFERENTIAL','POINTS_SCORED','STABLE_TEAM_ID'], ...(view.legacyMigration?{legacySeeding:structuredClone(priorLegacy(repository,view.leagueId))}:{}), pendingAtTransition: view.pending, pendingPolicy: 'Existing regular-season trade proofs, FA windows and waiver requests may finish under their saved rules. New workflows and upgrade spending are closed.', seedChanges: confirmation.seedChanges });
    require('./storage-safety').createStorageBackup(repository.dataRoot, { label: 'before-playoffs' });
    repository.commitSeasonTransition({ leagueId: view.leagueId, league: { ...context.league, currentPhase: 'PLAYOFFS' }, playoffs, schedule, upgradeState: upgrades, auditEntry: { action: 'season.playoffs.started', userId: actor.id, requestId: token, timestamp, leagueId: view.leagueId, seasonId: view.seasonId, metadata: { seeds: confirmation.seeds, seedChanges: confirmation.seedChanges, pending: view.pending } } });
    confirmations.delete(token); return playoffs;
  }
  function cancel(token, actor) { const pending=confirmations.get(token); if (!pending) throw Error('Confirmation expired.'); authorize(actor, pending.guildId); if (pending?.actorId !== actor.id || pending.root !== repository.dataRoot) throw Error('Confirmation belongs to another commissioner or has expired.'); confirmations.delete(token); }
  function adjustSeed(guildId, actor, token, conference, seedNumber, teamId) {
    authorize(actor, guildId);
    const c = confirmations.get(token), view = inspect(guildId);
    if (!c || c.actorId !== actor.id || c.guildId !== guildId || c.root !== repository.dataRoot || c.expiresAt < now() || c.digest !== view.digest) throw Error('Seeding preview expired or changed. Review again.');
    const context = repository.loadLeagueContext({guildId});
    if (!['East','West'].includes(conference) || !Number.isInteger(seedNumber) || seedNumber < 1 || seedNumber > 10) throw Error('Choose East or West and seed 1–10.');
    const selected = view.standings[conference].find(t => t.teamId === teamId);
    if (!selected) throw Error('Choose an eligible team from that conference.');
    const before = structuredClone(c.seeds), index = c.seeds[conference].findIndex(t => t.teamId === teamId), replaced = c.seeds[conference][seedNumber-1];
    c.seeds[conference][seedNumber-1] = selected;
    if (index >= 0 && index !== seedNumber-1) c.seeds[conference][index] = replaced;
    require('./postseason-state').validateSeeds(c.seeds, context.teams);
    c.seedChanges.push({conference,seed:seedNumber,teamId,replacedTeamId:replaced.teamId,at:new Date(now()).toISOString()});
    repository.appendAuditLog(context.league.leagueId,{action:'playoffs.seed.preview-adjusted',userId:actor.id,timestamp:new Date(now()).toISOString(),metadata:{before,after:c.seeds}});
    return {...view,seeds:structuredClone(c.seeds),token};
  }
  return { inspect, prepare, confirm, cancel, adjustSeed };
}
function priorLegacy(repository,leagueId){return repository.loadPlayoffs(leagueId);}
module.exports = { createSeasonTransitionService };
