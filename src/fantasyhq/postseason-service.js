const { randomUUID } = require('crypto');
const { STAGES, STAGE_ORDER, matchup, validatePostseason, requireCommissioner, requirePostseasonStaff } = require('./postseason-state');
const confirmations = new Map();
function approvedPostseasonGame(record, state, series) {
  const g = record?.game;
  if (!g || g.leagueId !== state.leagueId || g.seasonId !== state.seasonId || g.seriesId !== series.id || g.stage !== series.stage || g.status !== 'FINAL' || !g.finalizedAt || !g.result || g.team1Id !== series.team1Id || g.team2Id !== series.team2Id) return false;
  const submission = record.submissions?.find(s => s.submissionId === g.result.submissionId);
  const extraction = record.extractions?.find(e => e.extractionId === g.result.extractionId && e.submissionId === submission?.submissionId);
  if (submission?.status !== 'FINAL' || extraction?.status !== 'READY_FOR_REVIEW' || !Array.isArray(extraction.issues) || extraction.issues.length) return false;
  if (g.result.type === 'FORFEIT') return submission.mode === 'STAFF_ADMIN' && !!g.result.administrative?.approvedBy && [g.team1Id,g.team2Id].includes(g.result.winnerTeamId) && !record.playerGameStats?.length && !record.teamGameStats?.length;
  const a = g.result.scores?.[g.team1Id], b = g.result.scores?.[g.team2Id];
  return !!g.approval && [a,b].every(n => Number.isInteger(n) && n >= 0) && a !== b && g.result.winnerTeamId === (a > b ? g.team1Id : g.team2Id);
}
function recalculate(state, records) {
  const byId = new Map(records.map(r => [r.game.gameId, r]));
  state.conflicts = [];
  for (const s of state.series) {
    s.wins = { [s.team1Id]: 0, [s.team2Id]: 0 };
    s.winnerTeamId = null;
    let incomplete = false;
    for (let i = 0; i < s.gameIds.length; i++) {
      const r = byId.get(s.gameIds[i]);
      if (!approvedPostseasonGame(r, state, s) || r.game.seriesGameNumber !== i+1) { incomplete = true; continue; }
      if (incomplete || s.winnerTeamId) { state.conflicts.push({ seriesId: s.id, gameId: r.game.gameId, reason: 'Approved game exists after an unresolved or decided game.' }); continue; }
      s.wins[r.game.result.winnerTeamId]++;
      if (s.wins[r.game.result.winnerTeamId] === s.requiredWins) s.winnerTeamId = r.game.result.winnerTeamId;
    }
    if (s.forfeit) s.winnerTeamId = s.forfeit.winnerTeamId;
    s.status = s.winnerTeamId ? 'COMPLETE' : 'ACTIVE';
    if (s.advancedWinnerTeamId && s.advancedWinnerTeamId !== s.winnerTeamId) state.conflicts.push({ seriesId: s.id, reason: 'Winner changed after downstream round started. Commissioner review required.' });
  }
  for (const c of ['East','West']) {
    const first = state.series.find(s => s.id === `${c}:7-8`), second = state.series.find(s => s.id === `${c}:9-10`), final = state.series.find(s => s.id === `${c}:final`);
    if(final&&(!first?.winnerTeamId||!second?.winnerTeamId))state.conflicts.push({seriesId:final.id,reason:'Initial Play-In result reopened after final matchup started. Commissioner review required.'});
    if (final && first?.winnerTeamId && second?.winnerTeamId) {
      const loser = first.winnerTeamId === first.team1Id ? first.team2Id : first.team1Id;
      if (final.team1Id !== loser || final.team2Id !== second.winnerTeamId) state.conflicts.push({ seriesId: final.id, reason: 'Initial Play-In correction invalidated final matchup. Commissioner review required.' });
    }
    if (first?.winnerTeamId && final?.winnerTeamId) state.qualifiedSeeds[c] = [...state.seeds[c].slice(0,6).map(t => typeof t === 'string' ? t : t.teamId), first.winnerTeamId, final.winnerTeamId];
    else delete state.qualifiedSeeds[c];
  }
  if(state.champion&&state.series.find(s=>s.stage==='NBA_FINALS')?.winnerTeamId!==state.champion.teamId)state.conflicts.push({seriesId:'NBA_FINALS',reason:'Finals correction conflicts with the finalized championship. Commissioner review required; championship history preserved.'});
  return state;
}
function nextMatchups(state) {
  if (state.stage === 'PLAY_IN') {
    if (!state.qualifiedSeeds.East || !state.qualifiedSeeds.West) throw Error('Both conferences must finish the Play-In.');
    return ['East','West'].flatMap(c => [[0,7],[3,4],[2,5],[1,6]].map(([a,b],i) => matchup(`${c}:FIRST_ROUND:${i}`, 'FIRST_ROUND', c, state.qualifiedSeeds[c][a], state.qualifiedSeeds[c][b])));
  }
  const index = STAGE_ORDER.indexOf(state.stage), next = STAGE_ORDER[index+1];
  if (!next) return [];
  if (next === 'NBA_FINALS') {
    const champions = ['East','West'].map(c => state.series.find(s => s.stage === 'CONFERENCE_FINALS' && s.conference === c)?.winnerTeamId);
    return [matchup('NBA_FINALS', next, 'NBA', ...champions)];
  }
  return ['East','West'].flatMap(c => {
    const previous = state.series.filter(s => s.stage === state.stage && s.conference === c);
    return Array.from({length:previous.length/2}, (_,i) => matchup(`${c}:${next}:${i}`, next, c, previous[i*2].winnerTeamId, previous[i*2+1].winnerTeamId));
  });
}
function createPostseasonService({ repository, submissions, now = Date.now }) {
  function load(leagueId,allowCompleted=false) {
    const context = repository.loadLeague(leagueId), state = repository.loadPlayoffs(leagueId);
    if (context.league.currentPhase !== 'PLAYOFFS' && !(allowCompleted&&context.league.currentPhase==='OFFSEASON'&&state?.champion)) throw Error('League must be in PLAYOFFS.');
    validatePostseason(state);
    if (state.seasonId !== context.seasonId) throw Error('Postseason belongs to another season.');
    return { context, state: recalculate(state, submissions.records()) };
  }
  function save(state, action, actor, metadata = {}, requestId = null) {
    state.revision++;
    const event = { action, userId: actor.id, timestamp: new Date(now()).toISOString(), leagueId: state.leagueId, seasonId: state.seasonId, metadata, ...(requestId ? { requestId } : {}) };
    state.events.push(event);
    return repository.commitPostseason({ leagueId: state.leagueId, playoffs: state, auditEntry: event });
  }
  function inspect(leagueId) {
    const { state } = load(leagueId,true), active = state.series.filter(s => s.stage === state.stage);
    return { ...state, roundComplete: !state.conflicts.length && active.length > 0 && active.every(s => s.winnerTeamId) && (state.stage !== 'PLAY_IN' || !!state.qualifiedSeeds.East && !!state.qualifiedSeeds.West), nextMatchups: !state.conflicts.length && active.every(s => s.winnerTeamId) && (state.stage !== 'PLAY_IN' || !!state.qualifiedSeeds.East && !!state.qualifiedSeeds.West) ? nextMatchups(state) : [] };
  }
  function createFinalPlayIn(leagueId, conference, actor) {
    const { context, state } = load(leagueId); requirePostseasonStaff(context, actor);
    if (!['East','West'].includes(conference) || state.stage !== 'PLAY_IN' || state.conflicts.length) throw Error('Valid active Play-In conference required.');
    if (state.series.some(s => s.id === `${conference}:final`)) return state;
    const first = state.series.find(s => s.id === `${conference}:7-8`), second = state.series.find(s => s.id === `${conference}:9-10`);
    if (!first?.winnerTeamId || !second?.winnerTeamId) throw Error('Approve both initial Play-In results first.');
    state.series.push(matchup(`${conference}:final`, 'PLAY_IN', conference, first.winnerTeamId === first.team1Id ? first.team2Id : first.team1Id, second.winnerTeamId));
    return save(state,'playoffs.play-in.final-created',actor,{ conference });
  }
  function prepareAdvance(leagueId, actor) {
    const { context } = load(leagueId); requireCommissioner(context,actor);
    const view = inspect(leagueId);
    if (!view.roundComplete) throw Error('Every matchup must have an official winner and all conflicts must be resolved.');
    if (view.stage === 'NBA_FINALS') throw Error('Use championship finalization after entering Finals MVP.');
    const token = randomUUID(); confirmations.set(token,{leagueId,actorId:actor.id,revision:view.revision,root:repository.dataRoot,expiresAt:now()+300000});
    return { ...view, token };
  }
  function advance(leagueId, actor, token) {
    const { context, state } = load(leagueId); requireCommissioner(context,actor);
    const applied = state.events.find(e => e.action === 'playoffs.round.advanced' && e.requestId === token);
    if (applied) { if (applied.userId !== actor.id) throw Error('Confirmation belongs to another commissioner.'); return state; }
    const c = confirmations.get(token);
    if (!c || c.root !== repository.dataRoot || c.leagueId !== leagueId || c.actorId !== actor.id || c.revision !== state.revision || c.expiresAt < now()) throw Error('Round confirmation expired or changed. Review again.');
    if (!inspect(leagueId).roundComplete) throw Error('Round no longer complete.');
    const matches = nextMatchups(state), stage = matches[0].stage, timestamp = new Date(now()).toISOString();
    state.rounds.at(-1).completedAt = timestamp;
    for (const s of state.series.filter(s => s.stage === state.stage)) s.advancedWinnerTeamId = s.winnerTeamId;
    state.stage = stage; state.series.push(...matches);
    state.rounds.push({stage, startedAt:timestamp, deadlineAt:new Date(now()+STAGES[stage].hours*3600000).toISOString(), completedAt:null});
    const output = save(state,'playoffs.round.advanced',actor,{stage},token); confirmations.delete(token); return output;
  }
  function extendDeadline(leagueId, actor, hours, reason) {
    const { context, state } = load(leagueId); requirePostseasonStaff(context,actor);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 720 || String(reason || '').trim().length < 5) throw Error('A positive extension (up to 720 hours) and reason are required.');
    const round = state.rounds.at(-1), previous = round.deadlineAt;
    round.deadlineAt = new Date(Math.max(now(),Date.parse(previous))+hours*3600000).toISOString();
    return save(state,'playoffs.deadline.extended',actor,{previous,deadlineAt:round.deadlineAt,reason});
  }
  function prepareSeriesForfeit(leagueId, actor, seriesId, winnerTeamId, reason) {
    const { context,state } = load(leagueId); requirePostseasonStaff(context,actor);
    const s = state.series.find(s => s.id === seriesId && s.stage === state.stage);
    if (!s || s.winnerTeamId || state.conflicts.length || ![s.team1Id,s.team2Id].includes(winnerTeamId) || String(reason || '').trim().length < 5) throw Error('Active undecided series, participating winner and reason required.');
    const token = randomUUID(); confirmations.set(token,{root:repository.dataRoot,leagueId,actorId:actor.id,revision:state.revision,seriesId,winnerTeamId,reason,expiresAt:now()+300000}); return {token,series:s,winnerTeamId,reason};
  }
  function confirmSeriesForfeit(leagueId, actor, token) {
    const {context,state} = load(leagueId); requirePostseasonStaff(context,actor);
    if (state.events.some(e => e.action === 'playoffs.series.forfeit' && e.requestId === token && e.userId === actor.id)) return state;
    const c = confirmations.get(token), s = state.series.find(s => s.id === c?.seriesId);
    if (!c || c.root !== repository.dataRoot || c.leagueId !== leagueId || c.actorId !== actor.id || c.revision !== state.revision || c.expiresAt < now() || !s || s.winnerTeamId || state.conflicts.length) throw Error('Forfeit confirmation expired or changed.');
    s.forfeit = {winnerTeamId:c.winnerTeamId,reason:c.reason,approvedBy:actor.id,at:new Date(now()).toISOString()};
    s.winnerTeamId = c.winnerTeamId; s.status = 'COMPLETE';
    const output = save(state,'playoffs.series.forfeit',actor,{seriesId:s.id,...s.forfeit},token); confirmations.delete(token); return output;
  }
  function synchronize(leagueId, actor = {id:'system'}) {
    const { state } = load(leagueId,true);
    return save(state,'playoffs.results.reconciled',actor,{conflicts:state.conflicts});
  }
  function registerGame(leagueId, seriesId, gameId, actor) {
    const {context,state} = load(leagueId); requirePostseasonStaff(context,actor);
    const s = state.series.find(s => s.id === seriesId && s.stage === state.stage);
    if (!s || state.conflicts.length) throw Error('Active series with no conflicts required.');
    if (s.gameIds.includes(gameId)) return state;
    if (s.winnerTeamId) throw Error('Series is complete; no further games are allowed.');
    if (s.gameIds.length && !approvedPostseasonGame(submissions.load(s.gameIds.at(-1)),state,s)) throw Error('Approve the preceding game first.');
    const record = submissions.load(gameId), g = record.game;
    if (g.leagueId !== leagueId || g.seasonId !== state.seasonId || g.seriesId !== seriesId || g.stage !== state.stage || g.seriesGameNumber !== s.gameIds.length+1 || g.team1Id !== s.team1Id || g.team2Id !== s.team2Id) throw Error('Game does not match the next series game.');
    s.gameIds.push(gameId); return save(state,'playoffs.game.opened',actor,{seriesId,gameId});
  }
  function prepareChampionship(leagueId,actor) {
    const {context,state}=load(leagueId);requireCommissioner(context,actor);
    const view=inspect(leagueId),final=state.series.find(s=>s.stage==='NBA_FINALS');
    const mvp=repository.loadAwards(leagueId).seasons[state.seasonId]?.NBA_FINALS;
    if(state.stage!=='NBA_FINALS'||!view.roundComplete||!final?.winnerTeamId||!mvp?.winners?.length)throw Error('Finish all Finals games and confirm Finals MVP first.');
    const token=randomUUID();confirmations.set(token,{root:repository.dataRoot,leagueId,actorId:actor.id,revision:state.revision,mvpToken:mvp.token,expiresAt:now()+300000});return {...view,token,finalsMvp:mvp.winners[0]};
  }
  function finalizeChampionship(leagueId,actor,token) {
    const context=repository.loadLeague(leagueId);requireCommissioner(context,actor);
    let state=repository.loadPlayoffs(leagueId);
    if(state?.champion?.requestId===token)return state;
    state=load(leagueId).state;
    const c=confirmations.get(token),mvp=repository.loadAwards(leagueId).seasons[state.seasonId]?.NBA_FINALS;
    if(!c||c.root!==repository.dataRoot||c.leagueId!==leagueId||c.actorId!==actor.id||c.expiresAt<now()||c.revision!==state.revision||c.mvpToken!==mvp?.token||!inspect(leagueId).roundComplete)throw Error('Championship confirmation expired or changed.');
    const final=state.series.find(s=>s.stage==='NBA_FINALS'),teamId=final.winnerTeamId,runnerUpTeamId=teamId===final.team1Id?final.team2Id:final.team1Id;
    state.champion={requestId:token,teamId,runnerUpTeamId,coachUserId:repository.loadOwners(leagueId).find(o=>o.teamId===teamId)?.userId||null,seasonId:state.seasonId,seasonNumber:context.league.seasonNumber,seriesScore:structuredClone(final.wins),finalsMvpPlayerId:mvp.winners[0].playerId,finalizedAt:new Date(now()).toISOString(),confirmedBy:actor.id};state.rounds.at(-1).completedAt=state.champion.finalizedAt;
    const championships=repository.loadChampionships(leagueId);if(championships.seasons[state.seasonId])throw Error('This season already has a finalized championship.');championships.seasons[state.seasonId]=structuredClone(state.champion);
    require('./storage-safety').createStorageBackup(repository.dataRoot,{label:'before-championship'});
    repository.commitPostseason({leagueId,playoffs:state,league:{...context.league,currentPhase:'OFFSEASON'},championships,auditEntry:{action:'championship.finalized',userId:actor.id,seasonId:state.seasonId,timestamp:state.champion.finalizedAt,requestId:token,metadata:state.champion}});confirmations.delete(token);return state;
  }
  function updateThread(leagueId, seriesId, actor, changes) {
    const {context,state} = load(leagueId);requirePostseasonStaff(context,actor);
    const s = state.series.find(s=>s.id===seriesId);
    if (!s) throw Error('Unknown series.');
    for (const key of ['discordThreadId','threadCreationPending','threadCleanedAt']) if (key in changes) s[key]=changes[key];
    return save(state,'playoffs.thread.updated',actor,{seriesId,changes});
  }
  function prepareGameForfeit(leagueId, actor, gameId, winnerTeamId, reason) {
    const {context,state}=load(leagueId);requirePostseasonStaff(context,actor);
    const r=submissions.load(gameId),s=state.series.find(s=>s.id===r.game.seriesId&&s.stage===state.stage);
    if (!s || s.winnerTeamId || s.gameIds.at(-1)!==gameId || r.game.status==='FINAL' || state.conflicts.length || ![s.team1Id,s.team2Id].includes(winnerTeamId) || String(reason || '').trim().length<5) throw Error('Open game, participating winner and reason required.');
    const token=randomUUID();confirmations.set(token,{root:repository.dataRoot,leagueId,actorId:actor.id,revision:state.revision,gameId,winnerTeamId,reason,expiresAt:now()+300000});return {token,game:r.game,winnerTeamId,reason};
  }
  async function confirmGameForfeit(leagueId,actor,token) {
    const {context,state}=load(leagueId);requirePostseasonStaff(context,actor);
    if (state.events.some(e=>e.action==='playoffs.game.forfeit'&&e.requestId===token&&e.userId===actor.id))return state;
    const c=confirmations.get(token);
    if (!c || c.root!==repository.dataRoot || c.leagueId!==leagueId || c.actorId!==actor.id || c.revision!==state.revision || c.expiresAt<now())throw Error('Forfeit confirmation expired or changed.');
    await submissions.mutate(c.gameId,r=>require('./administrative-results').recordForfeit(r,{winnerTeamId:c.winnerTeamId,actorUserId:actor.id,staffAuthorized:true,reason:c.reason}));
    return save(load(leagueId).state,'playoffs.game.forfeit',actor,{gameId:c.gameId,winnerTeamId:c.winnerTeamId,reason:c.reason},token);
  }
  return {prepareChampionship,finalizeChampionship,updateThread,prepareGameForfeit,confirmGameForfeit,inspect,createFinalPlayIn,prepareAdvance,advance,extendDeadline,prepareSeriesForfeit,confirmSeriesForfeit,synchronize,registerGame};
}
module.exports = {createPostseasonService,approvedPostseasonGame,recalculate,nextMatchups};
