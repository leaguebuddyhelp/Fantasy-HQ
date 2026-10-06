const fs = require('fs');
const path = require('path');
const {editable,createReviewService}=require('./review-service');
const { createGameSubmissionService } = require('../game-submissions');
function handleBoxScoreReview(request,response,url,{ authorized, submissions = createGameSubmissionService() } = {}) {
  const match = url.pathname.match(/^\/(api\/)?games\/([a-f0-9-]{36})\/submissions\/([a-f0-9-]{36})\/(review|correct|approve|media\/([a-f0-9-]{36}))$/);
  if (!match) return false;
  if (!['GET','POST'].includes(request.method)) { response.writeHead(405); response.end(); return true; }
  const [,api,gameId,submissionId,action,mediaId] = match;
  if (!api && action === 'review' && request.method === 'GET') {
    response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    response.end(fs.readFileSync(path.join(__dirname,'../../../web/box-score-review.html'))); return true;
  }
  if (!api || !authorized) { response.writeHead(403,{'Content-Type':'application/json','Cache-Control':'no-store'}); response.end(JSON.stringify({error:'Commissioner website key required.'})); return true; }
  if (request.method === 'POST') {
    if (!['correct','approve'].includes(action)) {response.writeHead(405);response.end();return true;}
    (async()=>{
      try {
        let body=''; for await (const chunk of request) {body+=chunk;if(Buffer.byteLength(body)>512000)throw new Error('Review is too large.');}
        const result=await createReviewService(submissions)[action](gameId,submissionId,JSON.parse(body));
        response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(result));
      } catch(error) {response.writeHead(400,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify({error:error.message}));}
    })();return true;
  }
  if (action !== 'review' && !mediaId) {response.writeHead(405);response.end();return true;}
  try {
    const record = submissions.load(gameId);
    const submission = record.submissions.find(s => s.submissionId === submissionId);
    if (!submission) throw new Error('Not found');
    const media = record.media.filter(m => m.submissionId === submissionId);
    const attempts = (record.extractions || []).filter(e => e.submissionId === submissionId);
    if (!mediaId && url.searchParams.has('history')) {
      const attempt = attempts.find(e => e.extractionId === url.searchParams.get('history'));
      if (!attempt) throw new Error('Revision not found');
      response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      response.end(JSON.stringify(attempt)); return true;
    }

    let teamRecords=[];
    if(!mediaId)try {teamRecords=Object.values(require('../standings-service').createStandingsService({submissions}).getStandings(record.game.leagueId,record.game.seasonId).conferences).flat().filter(t=>[record.game.team1Id,record.game.team2Id].includes(t.teamId));}catch { /* Historic games remain readable after league deletion. */ }
    if (mediaId) {
      const image = media.find(m => m.mediaId === mediaId);
      if (!image) throw new Error('Not found');
      response.writeHead(200,{'Content-Type':image.contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      response.end(submissions.readOriginal(gameId,mediaId));
    } else {
      response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      response.end(JSON.stringify({game:record.game,submission,media,teamRecords,
        editable:(record.extractions || []).filter(e=>e.submissionId===submissionId).at(-1)?.normalized ? editable((record.extractions || []).filter(e=>e.submissionId===submissionId).at(-1)) : null,
        playerGameStats:record.playerGameStats || [],teamGameStats:record.teamGameStats || [],dnpPlayers:record.dnpPlayers || [],
        extractions:attempts.map((e,i) => {
          if(i === attempts.length-1) { const { raw, ...current } = e; return current; }
          const { extractionId, timestamp, actor, provider, status, error } = e;
          return { extractionId, timestamp, actor, provider, status, error };
        })}));
    }
  } catch { response.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'}); response.end(JSON.stringify({error:'Submission or media not found.'})); }
  return true;
}
module.exports = { handleBoxScoreReview };
