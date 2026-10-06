const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sample } = require('./fixtures/cavaliers-bucks');
const { normalizeExtraction, playerCandidates } = require('../src/fantasyhq/box-score/normalize');
const { createOpenAIVisionProvider } = require('../src/fantasyhq/box-score/provider');
const { createBoxScoreExtractionService } = require('../src/fantasyhq/box-score/service');
const { createGameSubmissionService } = require('../src/fantasyhq/game-submissions');
const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { handleBoxScoreReview } = require('../src/fantasyhq/box-score/review-route');
const teams = [{teamId:'mil',teamName:'Milwaukee Bucks',abbreviation:'MIL',conference:'East'}, {teamId:'cle',teamName:'Cleveland Cavaliers',abbreviation:'CLE',conference:'East'}];
function context(data = sample()) {
  return {game:{team1Id:'mil',team2Id:'cle'},teams,media:[{mediaId:'mil-image'},{mediaId:'cle-image'}],
    rosters:Object.fromEntries(data.screenshots.map((s,i) => [i === 0 ? 'mil':'cle', s.players.map((p,j) => ({playerId:`${i}-${j}`,name:p.displayedName}))]))};
}
test('sample transcription: MIL 120/CLE 116, all stats, 20 played and 8 DNP, totals separate', () => {
  const result = normalizeExtraction(sample(),context());
  assert.deepEqual(result.issues, []);
  assert.equal(result.normalized.playedPlayerCount,20);
  const [mil,cle] = result.normalized.screenshots;
  assert.equal(mil.totals.PTS,120); assert.equal(cle.totals.PTS,116);
  assert.equal(mil.players.filter(p => p.dnp).length + cle.players.filter(p => p.dnp).length,8);
  assert.equal(cle.players[0].stats.FGM,8); assert.equal(cle.players[0].stats.FGA,16);
  assert.equal(cle.players[0].stats.raw.FG,'8-16');
  assert.equal(cle.players.at(-1).stats.PTS,null);
  assert.equal(mil.players[0].stats.REB,16);
});
test('ambiguous abbreviated players are never selected; search is team-scoped', () => {
  const roster = [{playerId:'1',name:'Jalen Williams'},{playerId:'2',name:'Jaylin Williams'}];
  assert.equal(playerCandidates('J. Williams',roster).length,2);
  const data = sample(), ctx = context();
  data.screenshots[0].players[0].displayedName='J. Williams'; ctx.rosters.mil=roster;
  const result = normalizeExtraction(data,ctx);
  assert.equal(result.normalized.screenshots[0].players[0].playerId,null);
  assert.equal(result.issues.find(i => i.code === 'PLAYER_MATCH_NEEDED').candidates.length,2);
  ctx.rosters.mil=[{playerId:'3',name:'Kel’el Ware'}];
  assert.equal(playerCandidates('K. Ware',ctx.rosters.mil)[0].playerId,'3');
});
test('mismatches, nulls, DNP uncertainty, low confidence, wrong teams and duplicate media require review', () => {
  const changes = [
    [d => { d.screenshots[1].scoreboard[0].finalScore='117'; },'FINAL_SCORES_MATCH'],
    [d => { d.screenshots[0].scoreboard[0].periods[0].score='29'; },'QUARTERS_MATCH'],
    [d => { d.screenshots[0].players[0].stats.PTS='29'; },'PLAYER_POINTS_MATCH'],
    [d => { d.screenshots[0].players[0].stats.REB=null; },'MISSING_FIELD'],
    [d => { d.screenshots[0].players[0].dnp=null; },'MISSING_FIELD'],
    [d => { d.screenshots[0].players[0].confidence='LOW'; },'CONFIDENCE'],
    [d => { d.screenshots[0].tableTeamName='Atlanta Hawks'; },'TEAMS_MATCH'],
    [d => { d.screenshots[1].mediaId='mil-image'; },'MEDIA_COVERAGE'],
    [d => { d.screenshots[0].players[0].stats.FG='8-?'; },'SHOOTING_SPLIT'],
    [d => { d.screenshots[0].uncertainFields=[{path:'totals.REB',reason:'blurry',confidence:'LOW'}]; },'UNCERTAIN_FIELD'],
  ];
  for (const [change, code] of changes) { const data=sample(); change(data); const original=structuredClone(data);
    assert.ok(normalizeExtraction(data,context()).issues.some(i => i.code===code),code); assert.deepEqual(data,original); }
});
test('overtime periods are retained and independently validated', () => {
  const data=sample();
  for (const screen of data.screenshots) for (const board of screen.scoreboard) {
    board.periods[3].score=String(Number(board.periods[3].score)-10);
    board.periods.push({label:'OT1',score:'6'},{label:'OT2',score:'4'});
  }
  assert.deepEqual(normalizeExtraction(data,context()).issues,[]);
});
async function fixture(t, provider) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'box-score-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const repository=createFantasyHQRepository({dataRoot:root});
  repository.saveLeague('test',{currentPhase:'REGULAR_SEASON',currentSeasonId:'1'});
  repository.saveTeams('test',teams); repository.saveOwners('test',[{teamId:'mil',userId:'owner'}]);
  repository.saveGuildLeagueBinding('guild',{leagueId:'test',seasonId:'1'});
  repository.saveSchedule({leagueId:'test',seasonId:'1',weeks:[{week:1,weekId:'test:1:week:1',games:[{team1Id:'mil',team2Id:'cle'}]}]});
  const ctx=context(); repository.savePlayers('test',Object.values(ctx.rosters).flat());
  repository.saveRosterMemberships('test',Object.entries(ctx.rosters).flatMap(([teamId,players]) => players.map(p => ({playerId:p.playerId,teamId,seasonId:'1',active:true}))));
  const bytes=Buffer.from([255,216,255,0]);
  const submissions=createGameSubmissionService({repository,download:async () => bytes});
  const actor={guildId:'guild',discordThreadId:'thread',privateThread:true,userId:'owner'};
  const {game}=submissions.bind({...actor,weekNumber:1,teamQuery:'MIL'});
  const {submission}=await submissions.begin(game.gameId,actor);
  await submissions.receive(game.gameId,actor,['1','2'].map(id => ({id,name:id+'.jpg',contentType:'image/jpeg',size:4,url:'https://cdn.discordapp.com/attachments/'+id})),'message');
  const extractor=createBoxScoreExtractionService({submissions,provider});
  return {submissions,extractor,game,submission,repository,bytes};
}
function fakeProvider() { return {name:'fixture',model:'manual-transcription',async extract(images) {
  const data=sample(); data.screenshots.forEach((s,i) => { s.mediaId=images[i].mediaId; });
  return {raw:JSON.stringify(data)};
},parse:r => JSON.parse(r.raw)}; }
test('pipeline persists raw, normalized and validation; retries reuse originals and preserve game/history', async t => {
  const f=await fixture(t,fakeProvider());
  const before=f.repository.loadSchedule('test','1');
  const first=await f.extractor.extract(f.game.gameId,f.submission.submissionId);
  assert.equal(first.status,'READY_FOR_REVIEW'); assert.ok(first.raw);
  assert.equal(first.normalized.official,false);
  const second=await f.extractor.extract(f.game.gameId,f.submission.submissionId);
  assert.notEqual(first.extractionId,second.extractionId);
  const record=f.submissions.load(f.game.gameId);
  assert.equal(record.extractions.length,2); assert.deepEqual(record.game,f.game);
  assert.deepEqual(record.extractions[0],first);
  assert.deepEqual(f.repository.loadSchedule('test','1'),before);
  for (const m of record.media) assert.deepEqual(f.submissions.readOriginal(f.game.gameId,m.mediaId),f.bytes);
});
test('provider error, malformed output and retry retain failed attempts and raw response', async t => {
  const provider=fakeProvider(); provider.parse=() => {throw new Error('malformed output');};
  const f=await fixture(t,provider);
  let result=await f.extractor.extract(f.game.gameId,f.submission.submissionId);
  assert.equal(result.status,'EXTRACTION_FAILED'); assert.ok(result.raw);
  provider.extract=async () => { throw new Error('network unavailable'); };
  result=await f.extractor.extract(f.game.gameId,f.submission.submissionId);
  assert.equal(result.status,'EXTRACTION_FAILED');
  Object.assign(provider,fakeProvider());
  result=await f.extractor.extract(f.game.gameId,f.submission.submissionId);
  assert.equal(result.status,'READY_FOR_REVIEW');
  assert.equal(f.submissions.load(f.game.gameId).extractions.length,3);
});
test('concurrent extraction coalesces; review API is protected and original media stays available', async t => {
  const f=await fixture(t,fakeProvider());
  const [a,b]=await Promise.all([f.extractor.extract(f.game.gameId,f.submission.submissionId),f.extractor.extract(f.game.gameId,f.submission.submissionId)]);
  assert.equal(a.extractionId,b.extractionId);
  const pathname=`/api/games/${f.game.gameId}/submissions/${f.submission.submissionId}/review`;
  function get(url,authorized) { const res={writeHead(status){this.status=status;},end(body){this.body=body;}};
    assert.equal(handleBoxScoreReview({method:'GET'},res,new URL(url,'http://localhost'),{authorized,submissions:f.submissions}),true);return res; }
  assert.equal(get(pathname,false).status,403);
  assert.equal(get(pathname,true).status,200);
  const media=f.submissions.load(f.game.gameId).media[0];
  assert.deepEqual(get(pathname.replace('/review','/media/'+media.mediaId),true).body,f.bytes);
});
test('OpenAI adapter sends both originals, preserves full response and rejects incomplete/refusal', async () => {
  let body;
  const response={status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(sample())}]}]};
  const provider=createOpenAIVisionProvider({apiKey:'test-only',fetch:async (_url,options) => {
    body=JSON.parse(options.body);return {ok:true,status:200,text:async () => JSON.stringify(response)};
  }});
  const result=await provider.extract([{mediaId:'a',contentType:'image/jpeg',bytes:Buffer.from('a')},{mediaId:'b',contentType:'image/jpeg',bytes:Buffer.from('b')}]);
  assert.equal(body.input[0].content.filter(c => c.type==='input_image').length,2);
  assert.equal(body.text.format.strict,true); assert.equal(body.store,false);
  assert.deepEqual(provider.parse(result),sample());
  assert.throws(() => provider.parse({ok:true,raw:JSON.stringify({status:'incomplete'})}),/incomplete/);
  assert.throws(() => provider.parse({ok:true,raw:JSON.stringify({status:'completed',output:[]})}),/refusal/);
});

test('Discord processing posts concise summary and retry enforces thread ownership', async t => {
  const { createDiscordGameSubmissions } = require('../src/fantasyhq/discord-game-submissions');
  const { ChannelType } = require('discord.js');
  const f=await fixture(t,fakeProvider());
  await f.submissions.mutate(f.game.gameId,r=>r.game.inGameDate='10/24/2027');
  const adapter=createDiscordGameSubmissions(f.submissions,{extractor:f.extractor});
  const replies=[],posted=[];
  const interaction={guildId:'guild',channelId:'thread',user:{id:'owner'},
    channel:{type:ChannelType.PrivateThread,send:async payload => posted.push(payload)},
    customId:`gameextract:${f.game.gameId}:latest`,deferReply:async()=>{},editReply:async payload => replies.push(payload)};
  await adapter.button(interaction);
  assert.equal(posted[0].embeds[0].data.title,'GAME PROCESSED');
  assert.match(posted[0].embeds[0].data.description,/20 Players Recorded Stats/);
  assert.match(posted[0].components[0].components[0].data.url,new RegExp(f.submission.submissionId));
  await adapter.button({...interaction,user:{id:'intruder'}});
  assert.match(replies.at(-1).content,/Only an owner/);
  assert.equal(posted.length,1);
  await adapter.button({...interaction,channelId:'wrong'});
  assert.match(replies.at(-1).content,/private thread/);
  assert.equal(posted.length,1);
});
test('review-required status retains uncertain values and roster-match candidates', async t => {
  const provider=fakeProvider(), original=provider.parse;
  provider.parse=r => { const data=original(r);data.screenshots[0].players[0].stats.PTS=null;return data; };
  const f=await fixture(t,provider);
  const result=await f.extractor.extract(f.game.gameId,f.submission.submissionId);
  assert.equal(result.status,'REVIEW_REQUIRED');
  assert.equal(result.normalized.screenshots[0].players[0].stats.PTS,null);
  assert.ok(result.issues.some(i => i.code==='MISSING_FIELD'));
});

test('validated two-coach submission atomically saves final score and player stats exactly once', async t => {
  const f=await fixture(t,fakeProvider());
  await f.submissions.mutate(f.game.gameId,r=>{
    r.submissions[0].mode='TEAM_SIDES';r.submissions[0].participants={mil:'owner',cle:'opponent'};
    r.media.forEach((m,i)=>{m.teamId=i?'cle':'mil';m.uploadedBy=i?'opponent':'owner';});
  });
  const extraction=await f.extractor.extract(f.game.gameId,f.submission.submissionId);
  assert.equal(extraction.status,'READY_FOR_REVIEW');
  const record=f.submissions.load(f.game.gameId);
  assert.equal(record.game.status,'FINAL');assert.equal(record.game.locked,true);
  assert.deepEqual(record.game.result.scores,{mil:120,cle:116});
  assert.equal(record.playerGameStats.length,20);assert.equal(record.dnpPlayers.length,8);
  assert.equal(record.teamGameStats.length,2);
  const {finalizeValidatedSubmission}=require('../src/fantasyhq/box-score/finalize');
  await f.submissions.mutate(f.game.gameId,r=>finalizeValidatedSubmission(r,extraction.extractionId));
  assert.deepEqual(f.submissions.load(f.game.gameId),record);
  await assert.rejects(f.extractor.extract(f.game.gameId,f.submission.submissionId),/locked/);
});
test('wrong coach screenshot or uncertain extraction cannot finalize the game', async t => {
  const f=await fixture(t,fakeProvider());
  await f.submissions.mutate(f.game.gameId,r=>{
    r.submissions[0].mode='TEAM_SIDES';
    r.media.forEach((m,i)=>{m.teamId=i?'mil':'cle';m.uploadedBy=i?'opponent':'owner';});
  });
  const extraction=await f.extractor.extract(f.game.gameId,f.submission.submissionId);
  assert.equal(extraction.status,'REVIEW_REQUIRED');
  assert.ok(extraction.issues.some(i=>i.code==='UPLOADED_TEAM_MISMATCH'));
  const record=f.submissions.load(f.game.gameId);
  assert.equal(record.game.status,'SCHEDULED');assert.equal(record.playerGameStats,undefined);
});

const {editable,createReviewService}=require('../src/fantasyhq/box-score/review-service');
async function reviewFixture(t) {
  const provider=fakeProvider();
  provider.parse=r=>{const d=JSON.parse(r.raw);d.screenshots[0].scoreboard[0].finalScore='999';d.screenshots[0].players[0].stats.PTS='99';d.screenshots[0].players[10].dnp=false;d.screenshots[0].players[1].displayedName='Unmatched';d.screenshots[0].uncertainFields=[{path:'players.0.stats.PTS',reason:'blurred',confidence:'LOW'}];return d;};
  const f=await fixture(t,provider);
  await f.submissions.mutate(f.game.gameId,r=>{r.submissions[0].mode='TEAM_SIDES';r.media.forEach((m,i)=>{m.teamId=i?'cle':'mil';m.uploadedBy=i?'opponent':'owner';});});
  f.original=await f.extractor.extract(f.game.gameId,f.submission.submissionId);
  f.review=createReviewService(f.submissions);
  f.body={extractionId:f.original.extractionId,operator:'Commissioner Test',input:editable(f.original),reviewedPaths:[]};
  return f;
}
function fixReview(f){const s=f.body.input.screenshots[0];s.scoreboard[0].finalScore='116';s.players[0].stats.PTS='28';s.players[10].dnp=true;s.players[1].playerId='0-1';f.body.reviewedPaths=['screenshots.0.players.0.stats.PTS'];}
test('review corrects score, player stats, DNP and unmatched player; validates and approves through existing finalizer',async t=>{
  const f=await reviewFixture(t);fixReview(f);
  const corrected=await f.review.correct(f.game.gameId,f.submission.submissionId,f.body);
  assert.deepEqual(corrected.issues,[]);assert.equal(corrected.normalized.screenshots[0].players[1].playerId,'0-1');
  assert.equal(corrected.normalized.screenshots[0].players[10].dnp,true);
  assert.equal(corrected.normalized.screenshots[0].players[0].stats.PTS,28);
  assert.equal(f.submissions.load(f.game.gameId).game.status,'SCHEDULED');
  await f.review.approve(f.game.gameId,f.submission.submissionId,{extractionId:corrected.extractionId,operator:'Approver'});
  const record=f.submissions.load(f.game.gameId);
  assert.deepEqual(record.game.result.scores,{mil:120,cle:116});assert.equal(record.playerGameStats.length,20);assert.equal(record.dnpPlayers.length,8);
  assert.equal(record.game.approval.operator,'Approver');assert.equal(corrected.actor.operator,'Commissioner Test');assert.ok(corrected.timestamp);
  assert.deepEqual(record.extractions[0],f.original);
  for(const m of record.media)assert.deepEqual(f.submissions.readOriginal(f.game.gameId,m.mediaId),f.bytes);
  await assert.rejects(f.review.correct(f.game.gameId,f.submission.submissionId,{...f.body,extractionId:corrected.extractionId}),/locked/);
});
test('correction cannot dismiss mathematical failures or silently dismiss OCR uncertainty',async t=>{
  const f=await reviewFixture(t);
  f.body.reviewedPaths=f.original.issues.map(i=>i.path);
  const revision=await f.review.correct(f.game.gameId,f.submission.submissionId,f.body);
  assert.ok(revision.issues.some(i=>i.code==='PLAYER_POINTS_MATCH'));
  await assert.rejects(f.review.approve(f.game.gameId,f.submission.submissionId,{extractionId:revision.extractionId,operator:'Test'}),/warnings/);
  const second=await reviewFixture(t);fixReview(second);second.body.reviewedPaths=[];
  const uncertain=await second.review.correct(second.game.gameId,second.submission.submissionId,second.body);
  assert.ok(uncertain.issues.some(i=>i.code==='UNCERTAIN_FIELD'));
});
test('review prevents stale overwrites, wrong-team player selection and changed source images',async t=>{
  const f=await reviewFixture(t);fixReview(f);
  const bad=structuredClone(f.body);bad.input.screenshots[0].players[1].playerId='1-1';
  await assert.rejects(f.review.correct(f.game.gameId,f.submission.submissionId,bad),/appropriate roster/);
  bad.input.screenshots[0].mediaId='replacement';
  await assert.rejects(f.review.correct(f.game.gameId,f.submission.submissionId,bad),/cannot be replaced/);
  await f.review.correct(f.game.gameId,f.submission.submissionId,f.body);
  await assert.rejects(f.review.correct(f.game.gameId,f.submission.submissionId,f.body),/stale/);
});
function reviewRequest(f,action,authorized,body) {
  const {Readable}=require('stream');const request=Readable.from(body?[JSON.stringify(body)]:[]);request.method=body?'POST':'GET';
  return new Promise(resolve=>{let code;const response={writeHead(c){code=c;},end(b){resolve({code,body:b});}};
    handleBoxScoreReview(request,response,new URL(`http://localhost/api/games/${f.game.gameId}/submissions/${f.submission.submissionId}/${action}`),{authorized,submissions:f.submissions});});
}
test('review HTTP routes require existing commissioner authorization for reads, corrections, approval and originals',async t=>{
  const f=await reviewFixture(t);fixReview(f);
  for(const action of ['review','correct','approve',`media/${f.original.mediaIds[0]}`])assert.equal((await reviewRequest(f,action,false,['correct','approve'].includes(action)?f.body:null)).code,403);
  const loaded=await reviewRequest(f,'review',true);assert.equal(loaded.code,200);assert.equal(JSON.parse(loaded.body).editable.screenshots.length,2);
  const saved=await reviewRequest(f,'correct',true,f.body);assert.equal(saved.code,200);
  const approved=await reviewRequest(f,'approve',true,{extractionId:JSON.parse(saved.body).extractionId,operator:'Test'});assert.equal(approved.code,200);
  assert.deepEqual((await reviewRequest(f,`media/${f.original.mediaIds[0]}`,true)).body,f.bytes);
});
test('revisions and originals survive loss of Discord thread reference',async t=>{
  const f=await reviewFixture(t);fixReview(f);await f.review.correct(f.game.gameId,f.submission.submissionId,f.body);
  await f.submissions.mutate(f.game.gameId,r=>{r.game.discordThreadId=null;});
  assert.equal((await reviewRequest(f,'review',true)).code,200);
  assert.deepEqual((await reviewRequest(f,`media/${f.original.mediaIds[0]}`,true)).body,f.bytes);
  assert.deepEqual(f.submissions.load(f.game.gameId).extractions[0],f.original);
});

test('review page retains existing website styles, navigation and protected image integration',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../web/box-score-review.html'),'utf8');
  assert.match(html,/href="\/styles.css"/);assert.match(html,/site-header/);assert.match(html,/#league-admin/);
  const js=fs.readFileSync(path.join(__dirname,'../web/box-score-review.js'),'utf8');
  assert.match(js,/leaguebuddyAdminKey/);assert.match(js,/createObjectURL/);assert.match(js,/APPROVE GAME/);
});
test('authorized staff pair retains both teams stats and finalizes via normal validation',async t=>{
 const f=await fixture(t,fakeProvider());
 await f.submissions.mutate(f.game.gameId,r=>{r.submissions[0].mode='STAFF_BOTH';r.submissions[0].staffAuthorizedBy=r.submissions[0].submittingUserId;});
 const extraction=await f.extractor.extract(f.game.gameId,f.submission.submissionId);
 const record=f.submissions.load(f.game.gameId);assert.equal(extraction.status,'READY_FOR_REVIEW');assert.equal(record.game.status,'FINAL');assert.equal(record.teamGameStats.length,2);assert.ok(record.playerGameStats.length>0);assert.ok(record.media.every(m=>m.uploadedBy===record.submissions[0].staffAuthorizedBy));
});
test('staff screenshot pair supports commissioner corrections and approval',async t=>{const f=await reviewFixture(t);await f.submissions.mutate(f.game.gameId,r=>{r.submissions[0].mode='STAFF_BOTH';r.submissions[0].staffAuthorizedBy=r.submissions[0].submittingUserId;r.media.forEach(m=>{m.uploadedBy=r.submissions[0].submittingUserId;delete m.teamId;});});fixReview(f);const correction=await f.review.correct(f.game.gameId,f.submission.submissionId,f.body);assert.equal(correction.issues.length,0);await f.review.approve(f.game.gameId,f.submission.submissionId,{extractionId:correction.extractionId,operator:'Staff'});assert.equal(f.submissions.load(f.game.gameId).game.status,'FINAL');});


test('solo finalization uses real validation and is rejected after disabling test mode or assigning an online owner', async t => {
  for (const scenario of ['valid', 'disabled', 'online-owner']) {
    const f = await fixture(t, fakeProvider());
    f.repository.saveSettings('test', { testMode: scenario !== 'disabled' });
    if (scenario === 'online-owner') f.repository.saveOwners('test', [{ teamId: 'mil', userId: 'owner' }, { teamId: 'cle', userId: 'online' }]);
    await f.submissions.mutate(f.game.gameId, r => {
      Object.assign(r.submissions[0], { mode: 'TEAM_SIDES', soloTestAuthorizedBy: 'owner', participants: { mil: 'owner', cle: 'owner' } });
      r.media.forEach((m, i) => { m.teamId = i ? 'cle' : 'mil'; m.uploadedBy = 'owner'; });
    });
    await f.extractor.extract(f.game.gameId, f.submission.submissionId);
    const record = f.submissions.load(f.game.gameId);
    if (scenario === 'valid') {
      assert.equal(record.game.status, 'FINAL');
      assert.deepEqual(record.game.result.scores, { mil: 120, cle: 116 });
      assert.equal(record.playerGameStats.length, 20);
      assert.equal(record.dnpPlayers.length, 8);
      assert.deepEqual(record.game.soloTest, { authorizedBy: 'owner' });
    } else {
      assert.notEqual(record.game.status, 'FINAL');
      assert.equal(record.playerGameStats, undefined);
    }
  }
});
