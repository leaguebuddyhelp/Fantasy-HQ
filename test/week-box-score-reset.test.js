const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createFantasyHQRepository}=require('../src/fantasyhq/repository');
const {createGameSubmissionService}=require('../src/fantasyhq/game-submissions');
const {createWeekBoxScoreReset}=require('../src/fantasyhq/week-box-score-reset');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'week-box-reset-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repository=createFantasyHQRepository({dataRoot:root});
 repository.saveLeague('league',{currentPhase:'REGULAR_SEASON',currentSeasonId:'1',currentWeek:1});
 repository.saveTeams('league',[{teamId:'a',teamName:'A',abbreviation:'A',conference:'East'},{teamId:'b',teamName:'B',abbreviation:'B',conference:'East'}]);
 repository.saveGuildLeagueBinding('guild',{leagueId:'league',seasonId:'1'});
 repository.saveSchedule({leagueId:'league',seasonId:'1',weeks:[{week:1,weekId:'one',status:'ACTIVE',games:[{team1Id:'a',team2Id:'b'}]}]});
 const submissions=createGameSubmissionService({repository}),actor={authorized:true,id:'commissioner'};
 function record(id,week=1,season='1'){
  const r={game:{gameId:id,leagueId:'league',seasonId:season,weekNumber:week,weekId:week===1?'one':'two',status:'SCHEDULED',discordThreadId:'thread',inGameDate:'Jan 12',activity:{count:3}},submissions:[{submissionId:'old',status:'EXTRACTION_FAILED'}],media:[{mediaId:'photo',submissionId:'old',storedFile:'photo.jpg'}],extractions:[{status:'EXTRACTION_FAILED'}],playerGameStats:[],teamGameStats:[],dnpPlayers:[]};
  const dir=path.join(root,'game-history',id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'record.json'),JSON.stringify(r));fs.writeFileSync(path.join(dir,'photo.jpg'),'saved original');return r;
 }
 const id='11111111-1111-1111-1111-111111111111';record(id);
 let backups=0;const service=createWeekBoxScoreReset({submissions,backup:()=>{backups++;return {id:'backup'};}});
 return {root,repository,submissions,actor,service,id,record,backups:()=>backups};
}
test('active-week reset archives originals and clears all attempts while preserving threads, dates and other games',async t=>{
 const f=fixture(t),other='22222222-2222-2222-2222-222222222222';const untouched=f.record(other,2);f.record('33333333-3333-3333-3333-333333333333',1,'older');
 const p=f.service.prepare('guild',f.actor,1);assert.equal(p.images,1);const r=await f.service.clear('guild',f.actor,p.token);
 assert.equal(f.backups(),1);assert.equal(r.cleared.length,1);
 const current=f.submissions.load(f.id);for(const key of ['submissions','media','extractions','playerGameStats','teamGameStats','dnpPlayers'])assert.deepEqual(current[key],[]);
 assert.equal(current.game.discordThreadId,'thread');assert.equal(current.game.inGameDate,'Jan 12');assert.equal(current.game.activity.count,3);
 assert.deepEqual(f.submissions.load(other),untouched);assert.equal(fs.existsSync(path.join(f.root,'game-history',f.id,'photo.jpg')),false);
 assert.equal(fs.readFileSync(path.join(f.root,'box-score-reset-archives',p.token,f.id,'photo.jpg'),'utf8'),'saved original');
 assert.equal(f.repository.loadAuditLog('league').at(-1).action,'week.box-scores.cleared');
 await assert.rejects(f.service.clear('guild',f.actor,p.token),/expired/);
});
test('reset rejects unauthorized actors, other weeks and finalized results before creating a backup',async t=>{
 const f=fixture(t);assert.throws(()=>f.service.prepare('guild',{},1),/authorization/);assert.throws(()=>f.service.prepare('guild',f.actor,2),/active/);
 await f.submissions.mutate(f.id,r=>{r.game.status='FINAL';r.game.result={scores:{a:10,b:9}};});assert.throws(()=>f.service.prepare('guild',f.actor,1),/official result/);assert.equal(f.backups(),0);
});
test('changed submissions and mismatched confirmation actor cannot be cleared',async t=>{
 const f=fixture(t),p=f.service.prepare('guild',f.actor,1);
 await assert.rejects(f.service.clear('guild',{authorized:true,id:'other'},p.token),/another commissioner/);
 await f.submissions.mutate(f.id,r=>r.submissions.push({submissionId:'new',status:'COLLECTING'}));
 await assert.rejects(f.service.clear('guild',f.actor,p.token),/changed/);assert.equal(f.backups(),0);assert.equal(f.submissions.load(f.id).media.length,1);
});
test('published weeks are protected',t=>{
 const f=fixture(t),s=f.repository.loadSchedule('league','1');s.statsPublication={throughWeek:1};f.repository.saveSchedule(s);
 assert.throws(()=>f.service.prepare('guild',f.actor,1),/Published/);assert.equal(f.backups(),0);
});

test('failed backup leaves active uploads unchanged',async t=>{
 const f=fixture(t),service=createWeekBoxScoreReset({submissions:f.submissions,backup:()=>{throw Error('Backup unavailable');}}),p=service.prepare('guild',f.actor,1);
 await assert.rejects(service.clear('guild',f.actor,p.token),/Backup unavailable/);assert.equal(f.submissions.load(f.id).media.length,1);
});
test('live OCR blocks reset until the in-process extraction completes',async t=>{
 const f=fixture(t);await f.submissions.mutate(f.id,r=>r.media.push({...r.media[0],mediaId:'second'}));
 let start,finish;const started=new Promise(r=>start=r),wait=new Promise(r=>finish=r);
 const provider={name:'test',extract:async()=>{start();await wait;return {raw:'{}'};},parse:()=>({screenshots:[]})};
 const job=require('../src/fantasyhq/box-score/service').createBoxScoreExtractionService({submissions:f.submissions,provider}).extract(f.id,'old');
 await started;assert.throws(()=>f.service.prepare('guild',f.actor,1),/processing/);assert.equal(f.backups(),0);
 finish();await job;
});
