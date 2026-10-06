// Runs inside the game record's serialized atomic update: result + stats commit together.
function finalizeValidatedSubmission(record, extractionId, { testMode = false, owners = [] } = {}) {
  const extraction=record.extractions.find(e=>e.extractionId===extractionId);
  const submission=record.submissions.find(s=>s.submissionId===extraction?.submissionId);
  if(record.game.finalizedAt) {
    if(record.game.result?.extractionId===extractionId)return;
    throw new Error('This game already has a final result.');
  }
  if(record.game.locked || !extraction || extraction.status!=='READY_FOR_REVIEW' || extraction.issues.length || !['TEAM_SIDES','STAFF_BOTH'].includes(submission?.mode)) throw new Error('Both coaches and a clean validated extraction are required.');
  if(record.submissions.at(-1).submissionId!==submission.submissionId) throw new Error('A newer submission exists; this result cannot finalize.');
  const media=record.media.filter(m=>m.submissionId===submission.submissionId);
  const sides=extraction.normalized.screenshots;
  const staff=submission.mode==='STAFF_BOTH' && submission.staffAuthorizedBy===submission.submittingUserId && !!submission.staffAuthorizedBy;
  if(submission.mode==='STAFF_BOTH'&&!staff)throw new Error('Missing staff authorization record.');
  if(staff && (media.length!==2||media.some(m=>m.uploadedBy!==submission.staffAuthorizedBy)))throw new Error('Both screenshots must come from the authorized staff submitter.');
  const solo = testMode === true && !!submission.soloTestAuthorizedBy && submission.mode === 'TEAM_SIDES'
    && media.every(m => m.uploadedBy === submission.soloTestAuthorizedBy && submission.participants?.[m.teamId] === m.uploadedBy
      && !owners.some(o => o.teamId === m.teamId && o.userId !== m.uploadedBy));
  if(submission.soloTestAuthorizedBy && !solo) throw Error('Solo test authorization is no longer valid.');
  if(!staff && (media.length!==2 || new Set(media.map(m=>m.teamId)).size!==2 || (new Set(media.map(m=>m.uploadedBy)).size!==2 && !solo))) throw new Error('Each coach must submit their own team’s box score.');
  const teamIds=[record.game.team1Id,record.game.team2Id];
  if(sides.length!==2 || teamIds.some(id=>!sides.some(s=>s.teamId===id)))throw new Error('Scheduled teams do not match.');
  const scores=Object.fromEntries(sides.map(s=>[s.teamId,s.totals.PTS]));
  if(!teamIds.every(id=>Number.isInteger(scores[id])) || scores[teamIds[0]]===scores[teamIds[1]]) throw new Error('Final scores must be valid and cannot be tied.');
  const playerGameStats=[],dnpPlayers=[];
  for(const side of sides) {
    if(!media.some(m=>m.mediaId===side.mediaId)||(!staff && media.find(m=>m.mediaId===side.mediaId)?.teamId!==side.teamId))throw new Error('Screenshot ownership does not match.');
    for(const row of side.players) {
      if(!row.playerId)throw new Error('Every player must have a resolved roster match.');
      const identity={gameId:record.game.gameId,teamId:side.teamId,playerId:row.playerId};
      if(row.dnp) dnpPlayers.push(identity);
      else playerGameStats.push({...identity,...row.stats});
    }
  }
  record.playerGameStats=playerGameStats;
  record.teamGameStats=sides.map(s=>({gameId:record.game.gameId,teamId:s.teamId,...s.totals,
    periods:s.scoreboard.find(b=>b.teamId===s.teamId).periods}));
  record.dnpPlayers=dnpPlayers;
  record.game.result={submissionId:submission.submissionId,extractionId,scores,
    winnerTeamId:scores[teamIds[0]]>scores[teamIds[1]]?teamIds[0]:teamIds[1]};
  if(solo) record.game.soloTest = { authorizedBy: submission.soloTestAuthorizedBy };
  record.game.status='FINAL';record.game.finalizedAt=new Date().toISOString();record.game.locked=true;
  submission.status='FINAL';
}
module.exports={finalizeValidatedSubmission};
