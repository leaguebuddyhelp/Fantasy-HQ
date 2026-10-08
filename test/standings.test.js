const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {createFantasyHQRepository}=require('../src/fantasyhq/repository');
const {createGameSubmissionService}=require('../src/fantasyhq/game-submissions');
const {createStandingsService}=require('../src/fantasyhq/standings-service');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lb-standings-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const repository=createFantasyHQRepository({dataRoot:root});
 const teams=['a','b','c','d','bye'].map((teamId,i)=>({teamId,teamName:teamId.toUpperCase(),abbreviation:teamId.toUpperCase(),conference:i<2||i===4?'East':'West'}));
 repository.saveLeague('l',{currentPhase:'REGULAR_SEASON',currentSeasonId:'1',currentWeek:2});repository.saveTeams('l',teams);repository.saveGuildLeagueBinding('guild',{leagueId:'l',seasonId:'1'});repository.saveSchedule({leagueId:'l',seasonId:'1',weeks:[1,2].map(week=>({week,weekId:'week'+week,games:[{team1Id:'a',team2Id:'b'},{team1Id:'c',team2Id:'d'}]}))});
 const submissions=createGameSubmissionService({repository}),service=createStandingsService({submissions});
 async function game(a='a',week=1,score=[120,116]){const record=submissions.ensureGame({guildId:'guild',weekNumber:week,teamQuery:a});await submissions.mutate(record.game.gameId,r=>{r.submissions=[{submissionId:'sub',status:'FINAL'}];r.extractions=[{extractionId:'ext',submissionId:'sub',status:'READY_FOR_REVIEW',issues:[]}];Object.assign(r.game,{status:'FINAL',finalizedAt:'2026-10-01T00:00:00Z',result:{submissionId:'sub',extractionId:'ext',scores:{[r.game.team1Id]:score[0],[r.game.team2Id]:score[1]}}});});return record.game.gameId;}
 const get=()=>service.getStandings('l','1'),row=id=>Object.values(get().conferences).flat().find(t=>t.teamId===id);return {repository,submissions,service,game,get,row};
}
test('zero games: all teams, East/West separated and deterministic ordering',t=>{const f=fixture(t),s=f.get();assert.equal(s.countedGames,0);assert.deepEqual(s.conferences.East.map(t=>t.teamId),['a','b','bye']);assert.deepEqual(s.conferences.West.map(t=>t.teamId),['c','d']);assert.equal(f.row('a').PCT,0);assert.equal(f.row('a').GP,0);assert.deepEqual(f.get(),s);});
test('one and multiple official games calculate GP/W/L/PCT/PF/PA/DIFF; bye unaffected',async t=>{const f=fixture(t);await f.game();assert.equal(f.row('a').W,1);assert.equal(f.row('b').L,1);assert.equal(f.row('a').DIFF,4);await f.game('a',2,[100,110]);await f.game('c',1,[90,80]);assert.deepEqual([f.row('a').GP,f.row('a').W,f.row('a').L,f.row('a').PCT,f.row('a').PF,f.row('a').PA,f.row('a').DIFF],[2,1,1,.5,220,226,-6]);assert.equal(f.row('bye').GP,0);assert.equal(f.row('c').W,1);assert.equal(f.get().conferences.West[0].teamId,'c');});
test('unofficial, incomplete, disputed, flagged and wrong-season games never count',async t=>{for(const mutate of [r=>r.game.status='SCHEDULED',r=>r.game.status='DISPUTED',r=>r.submissions[0].status='REVIEW_REQUIRED',r=>r.extractions[0].issues=[{code:'UNCERTAIN_FIELD'}],r=>r.game.finalizedAt=null,r=>r.game.seasonId='other',r=>r.game.weekId='playoff',r=>r.game.result.scores.a=NaN]){const f=fixture(t),id=await f.game();await f.submissions.mutate(id,mutate);assert.equal(f.get().countedGames,0);}});
test('corrected official score recalculates winner, totals and ranking with no standings writes',async t=>{const f=fixture(t),id=await f.game();assert.equal(f.row('a').W,1);await f.submissions.mutate(id,r=>r.game.result.scores.b=121);assert.equal(f.row('a').W,0);assert.equal(f.row('a').L,1);assert.equal(f.row('b').W,1);assert.equal(f.row('b').PF,121);assert.equal(f.row('a').PA,121);assert.equal(f.row('b').DIFF,1);assert.equal(f.get().conferences.East[0].teamId,'b');});
test('rank uses percentage and wins, then head-to-head and point differential',async t=>{const f=fixture(t);await f.game('a',1,[120,116]);await f.game('a',2,[110,100]);assert.equal(f.row('a').PCT,1);assert.equal(f.get().conferences.East[0].teamId,'a');await f.submissions.mutate(f.submissions.records().find(r=>r.game.weekNumber===2).game.gameId,r=>{r.game.result.scores={a:100,b:110};});assert.deepEqual(f.get().conferences.East.slice(0,2).map(t=>t.teamId),['b','a']);});
test('Discord standings supports both conferences or one without code-block tables',async t=>{const f=fixture(t);await f.game();const {handleStandings}=require('../src/fantasyhq/discord-standings');let payload;await handleStandings({guildId:'guild',options:{getString:()=>null},editReply:async p=>payload=p},f.service,f.repository);assert.equal(payload.embeds.length,2);assert.match(payload.embeds[0].toJSON().description,/1–0/);assert.ok(!payload.embeds[0].toJSON().description.includes('```'));await handleStandings({guildId:'guild',options:{getString:()=> 'West'},editReply:async p=>payload=p},f.service,f.repository);assert.equal(payload.embeds.length,1);assert.equal(payload.embeds[0].toJSON().title,'WESTERN CONFERENCE');});
test('existing Team service exposes current record immediately after official correction',async t=>{const f=fixture(t);await f.game();const {createTeamService}=require('../src/fantasyhq/team-service');const service=createTeamService({repository:f.repository});assert.equal(service.getTeam('l','1','a').record.W,1);});
test('website standings extends existing navigation, team branding and Team dialog',()=>{const html=fs.readFileSync('web/index.html','utf8'),js=fs.readFileSync('web/app.js','utf8');assert.match(html,/href="#standings"/);assert.match(html,/id="standings-tables"/);assert.match(js,/showTeamDetail\(button.dataset.standingsTeam\)/);assert.match(js,/teamLogoMarkup\(team.teamName\)/);assert.match(js,/team.record.W/);});
test('existing website standings and Team endpoints return derived official records',async t=>{
 const f=fixture(t);await f.game();const oldRoot=process.env.FANTASYHQ_DATA_ROOT,oldGuild=process.env.GUILD_ID;process.env.FANTASYHQ_DATA_ROOT=f.repository.dataRoot;process.env.GUILD_ID='guild';
 t.after(()=>{if(oldRoot===undefined)delete process.env.FANTASYHQ_DATA_ROOT;else process.env.FANTASYHQ_DATA_ROOT=oldRoot;if(oldGuild===undefined)delete process.env.GUILD_ID;else process.env.GUILD_ID=oldGuild;});
 const {requestHandler}=require('../src/web');function get(url){let status,body;requestHandler({url,method:'GET',headers:{}},{writeHead:c=>status=c,end:b=>body=JSON.parse(b)});assert.equal(status,200);return body;}
 assert.equal(get('/api/league/standings').conferences.East[0].W,0);assert.equal(get('/api/league/teams/a').team.record.W,0);
 const schedule=f.repository.loadSchedule('l','1');schedule.weeks[0].status='COMPLETED';schedule.statsPublication={throughWeek:1,gameIds:f.submissions.records().map(r=>r.game.gameId)};f.repository.saveSchedule(schedule);
 assert.equal(get('/api/league/standings').conferences.East[0].W,1);assert.equal(get('/api/league/teams/a').team.record.W,1);
});
test('equal percentages rank the team with more wins first',async t=>{
 const f=fixture(t);f.repository.saveSchedule({leagueId:'l',seasonId:'1',weeks:[{week:1,weekId:'week1',games:[{team1Id:'a',team2Id:'bye'}]},{week:2,weekId:'week2',games:[{team1Id:'b',team2Id:'c'}]},{week:3,weekId:'week3',games:[{team1Id:'b',team2Id:'c'}]}]});
 await f.game('a',1);await f.game('b',2);await f.game('b',3);assert.deepEqual(f.get().conferences.East.slice(0,2).map(t=>[t.teamId,t.W,t.PCT]),[['b',2,1],['a',1,1]]);
});

test('head-to-head takes precedence over a better point differential among equal records',async t=>{
 const f=fixture(t);const context=f.repository.loadLeague('l');f.repository.saveTeams('l',context.teams.map(team=>({...team,conference:'East'})));
 f.repository.saveSchedule({leagueId:'l',seasonId:'1',weeks:[{week:1,weekId:'week1',games:[{team1Id:'a',team2Id:'b'},{team1Id:'c',team2Id:'d'}]},{week:2,weekId:'week2',games:[{team1Id:'a',team2Id:'c'},{team1Id:'b',team2Id:'d'}]}]});
 await f.game('a',1,[100,90]);await f.game('c',1,[110,90]);await f.game('a',2,[80,120]);await f.game('b',2,[200,20]);
 assert.equal(f.row('a').PCT,f.row('b').PCT);assert.ok(f.row('b').DIFF>f.row('a').DIFF);
 assert.deepEqual(f.get().conferences.East.filter(r=>['a','b'].includes(r.teamId)).map(r=>r.teamId),['a','b']);
});
test('points scored break equal record, head-to-head and differential ties',async t=>{
 const f=fixture(t);f.repository.saveSchedule({leagueId:'l',seasonId:'1',weeks:[{week:1,weekId:'week1',games:[{team1Id:'a',team2Id:'b'}]},{week:2,weekId:'week2',games:[{team1Id:'a',team2Id:'b'}]},{week:3,weekId:'week3',games:[{team1Id:'a',team2Id:'c'},{team1Id:'b',team2Id:'d'}]}]});
 await f.game('a',1,[100,90]);await f.game('a',2,[110,120]);await f.game('a',3,[100,120]);await f.game('b',3,[110,130]);
 assert.equal(f.row('a').DIFF,f.row('b').DIFF);assert.ok(f.row('b').PF>f.row('a').PF);
 assert.deepEqual(f.get().conferences.East.filter(r=>['a','b'].includes(r.teamId)).map(r=>r.teamId),['b','a']);
});
