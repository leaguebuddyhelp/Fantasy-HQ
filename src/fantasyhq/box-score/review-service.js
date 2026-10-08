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
  function validate(record, source, input, reviewedPaths) {
    const original=editable(source);
    if (!input || input.screenshots?.length!==2) throw new Error('Two box scores are required.');
    input.screenshots.forEach((s,i)=>{
      const old=original.screenshots[i];
      if(s.mediaId!==old.mediaId || s.tableTeamName!==old.tableTeamName || s.players?.length!==old.players.length || s.scoreboard?.length!==old.scoreboard.length) throw new Error('Source images, teams and player rows cannot be replaced.');
      if(s.scoreboard.some((b,j)=>b.teamName!==old.scoreboard[j].teamName)) throw new Error('Scoreboard teams cannot be replaced.');
      s.confidence=old.confidence; s.uncertainFields=[];
      s.players.forEach((p,j)=>{p.confidence=old.players[j].confidence;});
    });
    const rosters=source.rosterSnapshot;
    if(!rosters) throw new Error('Roster snapshot unavailable. Run extraction again.');
    const teams=submissions.repository.loadLeague(record.game.leagueId,record.game.seasonId).teams;
    const all=new Set([...(source.reviewedPaths || []),...(reviewedPaths || [])]);
    const matches={};
    input.screenshots.forEach((s,i)=>{
      if(all.has(`screenshots.${i}`))s.confidence='HIGH';
      const teamId=source.normalized.screenshots[i].teamId;
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
    return {...output,reviewedPaths:[...all]};
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
      const output=validate(record,source,input,body.reviewedPaths);
      const revision={...output,extractionId:randomUUID(),gameId,submissionId,mediaIds:source.mediaIds,
        parentExtractionId:source.extractionId,rosterSnapshot:source.rosterSnapshot,correctedInput:input,
        ...(reason ? { revisionReason: reason, revisesExtractionId: record.game.result.extractionId } : {}),
        provider:'commissioner-correction',timestamp:new Date().toISOString(),actor:{principal:'website-commissioner-key',operator},
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
      const output=validate(record,source,structuredClone(source.correctedInput),[]);
      if(output.issues.length)throw new Error('Resolve all validation warnings before approval.');
      const operator=String(body.operator || '').trim(); if(!operator || operator.length>100)throw new Error('Enter your commissioner name.');
      if (reason) { archive(record, body, 'CORRECTED'); record.game.finalizedAt = null; record.game.locked = false; record.game.previousApprovalNotice = record.game.approvalNotice || record.game.previousApprovalNotice; delete record.game.approvalNotice; }
      finalizeValidatedSubmission(record,source.extractionId, { testMode: submissions.repository.loadSettings(record.game.leagueId)?.testMode === true, owners: submissions.repository.loadOwners(record.game.leagueId) });
      record.game.approval={extractionId:source.extractionId,at:new Date().toISOString(),principal:'website-commissioner-key',operator};
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
