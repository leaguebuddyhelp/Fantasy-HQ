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
    const output=normalizeExtraction(input,{game:record.game,media:record.media.filter(m=>m.submissionId===source.submissionId),teams,rosters,playerMatches:matches});
    for(const issue of source.issues || []) if(issue.code==='UNCERTAIN_FIELD' && !all.has(issue.path))output.issues.push(issue);
    if(record.submissions.find(s=>s.submissionId===source.submissionId)?.mode==='TEAM_SIDES') for(const screen of output.normalized.screenshots) if(record.media.find(m=>m.mediaId===screen.mediaId)?.teamId!==screen.teamId)output.issues.push({code:'UPLOADED_TEAM_MISMATCH',path:screen.mediaId,message:'Screenshot does not match the uploading team.'});
    return {...output,reviewedPaths:[...all]};
  }
  function current(record, submissionId, extractionId) {
    if(record.game.locked || record.game.finalizedAt || ['FINAL','FINALIZED','LOCKED'].includes(record.game.status))throw new Error('Game is already locked or finalized.');
    const submission=record.submissions.at(-1);
    if(submission?.submissionId!==submissionId || submission.latestExtractionId!==extractionId || submission.status==='PROCESSING')throw new Error('This review is stale. Reload the latest submission.');
    const source=record.extractions.find(e=>e.extractionId===extractionId);
    if(!source?.normalized)throw new Error('No extracted box score is available.');
    return {source,submission};
  }
  async function correct(gameId,submissionId,body) {
    return submissions.mutate(gameId,record=>{
      const {source,submission}=current(record,submissionId,body.extractionId);
      const operator=String(body.operator || '').trim(); if(!operator || operator.length>100)throw new Error('Enter your commissioner name (up to 100 characters).');
      const input=structuredClone(body.input);
      const output=validate(record,source,input,body.reviewedPaths);
      const revision={...output,extractionId:randomUUID(),gameId,submissionId,mediaIds:source.mediaIds,
        parentExtractionId:source.extractionId,rosterSnapshot:source.rosterSnapshot,correctedInput:input,
        provider:'commissioner-correction',timestamp:new Date().toISOString(),actor:{principal:'website-commissioner-key',operator},
        status:output.issues.length?'REVIEW_REQUIRED':'READY_FOR_REVIEW'};
      record.extractions.push(revision); submission.latestExtractionId=revision.extractionId; submission.status=revision.status;
      return revision;
    });
  }
  async function approve(gameId,submissionId,body) {
    return submissions.mutate(gameId,record=>{
      const {source}=current(record,submissionId,body.extractionId);
      if(!source.correctedInput || !source.actor)throw new Error('Save and revalidate your review first.');
      const output=validate(record,source,structuredClone(source.correctedInput),[]);
      if(output.issues.length)throw new Error('Resolve all validation warnings before approval.');
      const operator=String(body.operator || '').trim(); if(!operator || operator.length>100)throw new Error('Enter your commissioner name.');
      finalizeValidatedSubmission(record,source.extractionId);
      record.game.approval={extractionId:source.extractionId,at:new Date().toISOString(),principal:'website-commissioner-key',operator};
      return record.game;
    });
  }
  return {correct,approve};
}
module.exports={editable,createReviewService};
