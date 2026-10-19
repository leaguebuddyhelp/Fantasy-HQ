const { randomUUID } = require('crypto');
const { normalizeExtraction } = require('./normalize');
const { finalizeValidatedSubmission } = require('./finalize');
function editable(extraction) {
  if (extraction.correctedInput) return structuredClone(extraction.correctedInput);
  return structuredClone({ screenshots: extraction.normalized.screenshots.map(s => ({ mediaId:s.mediaId, tableTeamName:s.displayedTeamName,
    confidence:s.confidence, uncertainFields:[], scoreboard:s.scoreboard.map(b=>({teamName:b.displayedTeamName,finalScore:b.finalScore,periods:b.periods})),
    players:s.players.map(p=>({displayedName:p.displayedName,playerId:p.playerId,dnp:p.dnp,confidence:p.confidence,stats:p.stats.raw || {}})), totals:s.totals.raw || {} })) });
}
function createReviewService(submissions) {
  function validate(record, source, input, reviewedPaths, rosterAdditions = []) {
    const original=editable(source);
    if (!input || input.screenshots?.length!==2) throw new Error('Two box scores are required.');
    input.screenshots.forEach((s,i)=>{
      const old=original.screenshots[i];
      if(s.mediaId!==old.mediaId || (old.tableTeamName && s.tableTeamName!==old.tableTeamName) || s.players?.length!==old.players.length || s.scoreboard?.length!==old.scoreboard.length) throw new Error('Source images, teams and player rows cannot be replaced.');
      if(s.scoreboard.some((b,j)=>old.scoreboard[j].teamName && b.teamName!==old.scoreboard[j].teamName)) throw new Error('Scoreboard teams cannot be replaced.');
      s.confidence=old.confidence; s.uncertainFields=[];
      s.players.forEach((p,j)=>{p.confidence=old.players[j].confidence;});
    });
    const rosters=source.rosterSnapshot && structuredClone(source.rosterSnapshot);
    if(!rosters) throw new Error('Roster snapshot unavailable. Run extraction again.');
    const teams=submissions.repository.loadLeague(record.game.leagueId,record.game.seasonId).teams;
    // Players an admin moved or signed onto a game team after extraction are part of that roster even if the page lost its in-memory additions.
    {
      const known=new Map(submissions.repository.loadPlayers(record.game.leagueId).map(pl=>[pl.playerId,pl]));
      const extractedAt=Date.parse(source.timestamp||'');
      const all=submissions.repository.loadRosterMemberships(record.game.leagueId);
      for(const teamId of [record.game.team1Id,record.game.team2Id]){
        rosters[teamId] ||= [];
        for(const m of all.filter(e=>e.teamId===teamId&&String(e.seasonId)===String(record.game.seasonId)&&e.active!==false&&!e.endedAt&&Date.parse(e.startedAt||'')>=extractedAt)){
          const pl=known.get(m.playerId);
          if(pl&&!pl.retiredAt&&!rosters[teamId].some(r=>r.playerId===m.playerId))rosters[teamId].push({playerId:m.playerId,name:pl.name});
        }
      }
    }
    const resolved=normalizeExtraction(input,{game:record.game,media:record.media.filter(m=>m.submissionId===source.submissionId),teams,rosters});
    const all=new Set([...(source.reviewedPaths || []),...(reviewedPaths || [])]);
    const matches={};
    const additions = new Map();
    const players = new Map(submissions.repository.loadPlayers(record.game.leagueId).map(player => [player.playerId, player]));
    const memberships = submissions.repository.loadRosterMemberships(record.game.leagueId);
    const approvedAdditions = [...(source.rosterAdditions || []), ...(rosterAdditions || [])];
    for (const addition of approvedAdditions) {
      const { screenshotIndex, playerId, teamId } = addition || {};
      if (!Number.isInteger(screenshotIndex) || screenshotIndex < 0 || screenshotIndex >= input.screenshots.length
        || typeof playerId !== 'string' || typeof teamId !== 'string') throw new Error('Invalid roster addition for this review.');
      const screen = input.screenshots[screenshotIndex];
      const resolvedTeamId = source.normalized.screenshots[screenshotIndex].teamId || resolved.normalized.screenshots[screenshotIndex].teamId;
      if (resolvedTeamId !== teamId || !screen.players.some(player => player.playerId === playerId)) throw new Error('Added player must be matched to a row on the same team.');
      const membership = memberships.find(entry => entry.playerId === playerId && entry.teamId === teamId
        && String(entry.seasonId) === String(record.game.seasonId) && entry.active !== false && !entry.endedAt);
      const player = players.get(playerId);
      const signedAt = Date.parse(membership?.startedAt || '');
      const moved = membership && memberships.some(entry => entry.playerId === playerId && entry.teamId !== teamId && String(entry.seasonId) === String(record.game.seasonId)
        && entry.endedReason === 'ADMIN_CORRECTION' && entry.endedAt === membership.startedAt);
      if (!membership || (membership.source !== 'admin-free-agent' && !moved) || !Number.isFinite(signedAt)
        || !player || player.retiredAt) throw new Error('The added player is no longer an active free-agent signing on this team. Reload the review.');
      const key = `${screenshotIndex}:${playerId}`;
      const existing = additions.get(key);
      if (existing && existing.teamId !== teamId) throw new Error('A player cannot be added to two teams in one review.');
      additions.set(key, { screenshotIndex, playerId, teamId, name: player.name });
      rosters[teamId] ||= [];
      if (!rosters[teamId].some(entry => entry.playerId === playerId)) rosters[teamId].push({ playerId, name: player.name });
    }
    input.screenshots.forEach((s,i)=>{
      if(all.has(`screenshots.${i}`))s.confidence='HIGH';
      const teamId=source.normalized.screenshots[i].teamId || resolved.normalized.screenshots[i].teamId;
      s.players.forEach((p,j)=>{
        const key=`screenshots.${i}.players.${j}`;
        if(all.has(key))p.confidence='HIGH';
        if(p.playerId){
          if(!(rosters[teamId] || []).some(r=>r.playerId===p.playerId))throw new Error('Player must belong to the appropriate roster.');
          matches[key]=p.playerId;
        }
      });
    });
    const output=normalizeExtraction(input,{game:record.game,media:record.media.filter(m=>m.submissionId===source.submissionId),teams,rosters,playerMatches:matches,learnedAliases:require('./learning').loadLearning(submissions.repository,record.game.leagueId).aliases});
    for(const issue of source.issues || []) if(issue.code==='UNCERTAIN_FIELD' && !all.has(issue.path))output.issues.push(issue);
    if(record.submissions.find(s=>s.submissionId===source.submissionId)?.mode==='TEAM_SIDES') for(const screen of output.normalized.screenshots) if(record.media.find(m=>m.mediaId===screen.mediaId)?.teamId!==screen.teamId)output.issues.push({code:'UPLOADED_TEAM_MISMATCH',path:screen.mediaId,message:'Screenshot does not match the uploading team.'});
    return {...output,reviewedPaths:[...all],rosterAdditions:[...additions.values()]};
  }
  function revisionReason(record, body) {
    if(submissions.repository.loadLeague(record.game.leagueId).seasonId!==String(record.game.seasonId))throw Error('This result belongs to an archived season; current-season review controls cannot change it.');
    const final = record.game.status === 'FINAL';
    if (!final) return null;
    if (!record.game.seriesId && (submissions.repository.loadLeague(record.game.leagueId).league.currentPhase === 'PLAYOFFS' || submissions.repository.loadPlayoffs(record.game.leagueId,record.game.seasonId)?.version === 2)) throw Error('Playoff seeds are frozen. Regular-season results cannot be changed after playoff confirmation.');
    const reason = String(body.revisionReason || '').trim();
    if (reason.length < 5 || reason.length > 1000) throw Error('Game is locked. Enter a correction reason (5–1000 characters) to review a final result.');
    return reason;
  }
  function archive(record, body, action) {
    record.resultRevisions ||= [];
    record.resultRevisions.push({ action, at: new Date().toISOString(), operator: body.operator, reason: body.revisionReason,
      game: structuredClone(record.game), playerGameStats: structuredClone(record.playerGameStats || []),
      teamGameStats: structuredClone(record.teamGameStats || []), dnpPlayers: structuredClone(record.dnpPlayers || []) });
  }
  function current(record, submissionId, extractionId, allowFinal = false) {
    if(submissions.repository.loadLeague(record.game.leagueId).seasonId!==String(record.game.seasonId))throw Error('This review belongs to an archived season.');
    if(!allowFinal && (record.game.locked || record.game.finalizedAt || ['FINAL','FINALIZED','LOCKED'].includes(record.game.status)))throw new Error('Game is already locked or finalized.');
    const submission=record.submissions.at(-1);
    if(submission?.submissionId!==submissionId || submission.latestExtractionId!==extractionId || submission.status==='PROCESSING')throw new Error('This review is stale. Reload the latest submission.');
    const source=record.extractions.find(e=>e.extractionId===extractionId);
    if(!source?.normalized)throw new Error('No extracted box score is available.');
    return {source,submission};
  }
  async function correct(gameId,submissionId,body) {
    return submissions.mutate(gameId,record=>{
      const reason = revisionReason(record, body);
      const {source,submission}=current(record,submissionId,body.extractionId, !!reason);
      const operator=String(body.operator || '').trim(); if(!operator || operator.length>100)throw new Error('Enter your commissioner name (up to 100 characters).');
      const input=structuredClone(body.input);
      const output=validate(record,source,input,body.reviewedPaths,body.rosterAdditions);
      const revision={...output,extractionId:randomUUID(),gameId,submissionId,mediaIds:source.mediaIds,
        parentExtractionId:source.extractionId,rosterSnapshot:source.rosterSnapshot,correctedInput:input,
        ...(reason ? { revisionReason: reason, revisesExtractionId: record.game.result.extractionId } : {}),
        provider:'commissioner-correction',timestamp:new Date().toISOString(),actor:{principal:body.authenticatedPrincipal || 'website-commissioner-key',operator},
        status:output.issues.length?'REVIEW_REQUIRED':'READY_FOR_REVIEW'};
      record.extractions.push(revision); submission.latestExtractionId=revision.extractionId; if (!reason) submission.status=revision.status;
      return revision;
    });
  }
  async function approve(gameId,submissionId,body) {
    const result = await submissions.mutate(gameId,record=>{
      if(record.game.seriesId){const state=require('../postseason-service').createPostseasonService({repository:submissions.repository,submissions}).inspect(record.game.leagueId),series=state.series.find(s=>s.id===record.game.seriesId);if(series?.forfeit)throw Error('The series was forfeited. Commissioner review is required before changing its games.');if(record.game.status!=='FINAL'&&(state.conflicts.length||state.stage!==record.game.stage||series?.winnerTeamId||series?.gameIds.at(-1)!==record.game.gameId))throw Error('This postseason game is no longer open for approval.');}
      const reason = revisionReason(record, body);
      const {source}=current(record,submissionId,body.extractionId, !!reason);
      if (reason && source.revisesExtractionId !== record.game.result.extractionId) throw Error('Save a correction of the current official result first.');
      if(!source.correctedInput || !source.actor)throw new Error('Save and revalidate your review first.');
      const output=validate(record,source,structuredClone(source.correctedInput),[],source.rosterAdditions);
      if(output.issues.length)throw new Error('Resolve all validation warnings before approval.');
      const operator=String(body.operator || '').trim(); if(!operator || operator.length>100)throw new Error('Enter your commissioner name.');
      if (reason) { archive(record, body, 'CORRECTED'); record.game.finalizedAt = null; record.game.locked = false; record.game.previousApprovalNotice = record.game.approvalNotice || record.game.previousApprovalNotice; delete record.game.approvalNotice; }
      finalizeValidatedSubmission(record,source.extractionId, { testMode: require('../simulation-guard').isSimulationRepository(submissions.repository,record.game.leagueId), owners: submissions.repository.loadOwners(record.game.leagueId) });
      record.game.approval={extractionId:source.extractionId,at:new Date().toISOString(),principal:body.authenticatedPrincipal || 'website-commissioner-key',operator};
      return record.game;
    });
    const saved = submissions.load(gameId);
    try { require('./learning').learnApprovedReview(submissions.repository, saved, saved.extractions.find(e => e.extractionId === body.extractionId)); }
    catch (error) { console.error('OCR alias learning:', error.message); }
    return result;
  }
  async function reject(gameId, submissionId, body) {
    return submissions.mutate(gameId, record => {
      current(record, submissionId, body.extractionId);
      const operator = String(body.operator || '').trim(), reason = String(body.revisionReason || '').trim();
      if (!operator || operator.length > 100 || reason.length < 5 || reason.length > 1000) throw Error('Commissioner name and rejection reason (5–1000 characters) are required.');
      record.reviewDecisions ||= [];
      record.reviewDecisions.push({ action: 'REJECTED', operator, reason, extractionId: body.extractionId, at: new Date().toISOString() });
      record.submissions.at(-1).status = 'STAFF_REJECTED'; record.game.status = 'REVIEW_REQUIRED';
      return record.game;
    });
  }
  async function reverse(gameId, submissionId, body) {
    return submissions.mutate(gameId, record => {
      if (record.game.status !== 'FINAL') throw Error('Only a final result can be reversed.');
      revisionReason(record, body);
      if (!String(body.operator || '').trim() || String(body.operator).length > 100) throw Error('Enter your commissioner name.');
      if (record.game.result.submissionId !== submissionId || record.submissions.at(-1)?.latestExtractionId !== body.extractionId) throw Error('This review is stale. Reload the latest submission.');
      archive(record, body, 'REVERSED');
      record.game.result = null; record.game.finalizedAt = null; record.game.locked = false; record.game.status = 'REVIEW_REQUIRED';
      delete record.game.approval; record.game.previousApprovalNotice = record.game.approvalNotice || record.game.previousApprovalNotice; delete record.game.approvalNotice;
      record.playerGameStats = []; record.teamGameStats = []; record.dnpPlayers = [];
      record.submissions.at(-1).status = 'REVIEW_REQUIRED';
      return record.game;
    });
  }
  return {correct,approve,reject,reverse};
}
module.exports={editable,createReviewService};
