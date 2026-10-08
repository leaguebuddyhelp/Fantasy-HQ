const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/free-agency');
const {createSportsbookService}=require('../src/fantasyhq/sportsbook-service');
const {createGameSubmissionService}=require('../src/fantasyhq/game-submissions');
async function setup(t) {
 const f=fixture(t);f.repository.saveLeague('league',{currentWeek:1,commissionerUserId:'commissioner'});
 f.repository.saveRoleOwnership('league',{roleIds:{a:'ra',b:'rb',c:'rc'}});
 f.repository.saveSchedule({leagueId:'league',seasonId:'1',weeks:Array.from({length:3},(_,i)=>({week:i+1,weekId:'w'+(i+1),status:'ACTIVE',games:[{team1Id:'a',team2Id:'b'}],byes:['c']}))});
 const submissions=createGameSubmissionService({repository:f.repository});
 const games=[1,2,3].map(weekNumber=>submissions.ensureGame({guildId:'guild',weekNumber,teamQuery:'a'}).game.gameId);
 let clock=Date.parse('2026-10-08T12:00:00Z');const service=createSportsbookService({repository:f.repository,submissions,now:()=>clock});
 const actor={id:'coach-c',member:{roles:{cache:new Map([['rc',{}]])}}};
 const ids=(kind='MONEYLINE',selection='a',gameId=games[0])=>service.refresh('league').markets.find(m=>m.gameId===gameId&&m.kind===kind&&m.selection===selection).id;
 async function final(gameId,{a=110,b=100,forfeit=false}={}) {
  await submissions.mutate(gameId,r=>{r.submissions=[{submissionId:'s',status:'FINAL',mode:'STAFF_ADMIN'}];r.extractions=[{extractionId:'e',submissionId:'s',status:'READY_FOR_REVIEW',issues:[]}];Object.assign(r.game,{status:'FINAL',finalizedAt:new Date(clock).toISOString(),result:{submissionId:'s',extractionId:'e',scores:forfeit?undefined:{a,b},...(forfeit?{type:'FORFEIT',winnerTeamId:'a',administrative:{approvedBy:'commissioner'}}:{})}});});
 }
 const bet=ids=>{const preview=service.preview('league',actor,{marketIds:ids,wager:'10'});return service.confirm('league',actor,preview.id);};
 return {...f,submissions,games,service,actor,ids,final,bet,advance:()=>clock+=300001};
}
test('money uses exact cents, correct American payouts and supports many legs with safe overflow rejection',()=>{
 const {cents,payout}=require('../src/fantasyhq/sportsbook-money');assert.equal(cents('10.25'),1025);assert.throws(()=>cents('1.001'),/two decimal/);assert.throws(()=>cents('1e3'),/dollar amount/);
 assert.equal(payout(1000,[-110]),1909);assert.equal(payout(1000,[125]),2250);assert.equal(payout(1000,[-200,-200]),2250);
 assert.ok(payout(100,Array(30).fill(-100000))>100);assert.throws(()=>payout(100,Array(60).fill(100)),/range/);
});
test('confirmed bets deduct once, exact odds persist, own-team/role/privacy restrictions are enforced server-side',async t=>{
 const f=await setup(t),id=f.ids(),preview=f.service.preview('league',f.actor,{marketIds:[id],wager:'10'});
 assert.equal(f.service.mine('league',f.actor).profile.balanceCents,30000);
 const placed=f.service.confirm('league',f.actor,preview.id);assert.equal(placed.stakeCents,1000);assert.equal(f.service.mine('league',f.actor).profile.balanceCents,29000);
 assert.equal(f.service.confirm('league',f.actor,preview.id).id,placed.id);assert.equal(f.repository.loadSportsbook('league').ledger.filter(l=>l.type==='WAGER').length,1);
 const other={id:'coach-a',member:{roles:{cache:new Map([['ra',{}]])}}};assert.throws(()=>f.service.preview('league',other,{marketIds:[id],wager:'1'}),/own team/);
 assert.throws(()=>f.service.confirm('league',other,preview.id),/another coach/);assert.equal(f.service.mine('league',other).bets.length,0);
 assert.throws(()=>f.service.mine('league',{id:'coach-c',member:{roles:{cache:new Map([['ra',{}]])}}}),/assignment must match/);
 assert.throws(()=>f.service.preview('league',f.actor,{marketIds:[id],wager:'51'}),/1–\$50/);
 assert.throws(()=>f.service.preview('league',f.actor,{marketIds:[id,id],wager:'10'}),/unique/);
 assert.throws(()=>f.service.preview('league',f.actor,{marketIds:[id,f.ids('MONEYLINE','b')],wager:'10'}),/conflicting/);
 assert.equal(f.service.leaderboard('league').some(row=>'bets' in row||'balanceCents' in row),false);
});
test('stream submission locks immediately, rejects outstanding confirmation, and preserved odds survive refresh',async t=>{
 const f=await setup(t),preview=f.service.preview('league',f.actor,{marketIds:[f.ids()],wager:'10'}),placed=f.service.confirm('league',f.actor,preview.id),next=f.service.preview('league',f.actor,{marketIds:[f.ids()],wager:'10'});
 await f.submissions.mutate(f.games[0],r=>{r.game.streamlink={url:'https://example.com/live',submittedAt:'2026-10-08T12:00:00Z'};r.game.sportsbookLockedAt='2026-10-08T12:00:00Z';});
 assert.throws(()=>f.service.confirm('league',f.actor,next.id),/closed/);assert.equal(f.repository.loadSportsbook('league').bets[0].legs[0].odds,placed.legs[0].odds);
 assert.equal(f.repository.loadSportsbook('league').markets.find(m=>m.id===placed.legs[0].id).status,'LOCKED');
});
test('verified settlement is idempotent; score corrections preserve original ledger and payout history',async t=>{
 const f=await setup(t),placed=f.bet([f.ids()]);await f.final(f.games[0]);f.service.settle('league');let mine=f.service.mine('league',f.actor);assert.equal(mine.bets[0].status,'WON');assert.equal(mine.profile.balanceCents,29000+placed.potentialReturnCents);
 f.service.settle('league');assert.equal(f.repository.loadSportsbook('league').bets[0].settlements.length,1);
 await f.final(f.games[0],{a:90,b:100});f.service.settle('league');mine=f.service.mine('league',f.actor);assert.equal(mine.bets[0].status,'LOST');assert.equal(mine.profile.balanceCents,29000);assert.equal(mine.bets[0].settlements.length,2);assert.ok(mine.bets[0].settlements[1].corrects);assert.equal(mine.profile.careerProfitCents,-1000);
 assert.equal(f.repository.loadSportsbook('league').ledger.filter(l=>l.type==='CORRECTION').length,1);
});
test('parlays wait for every verified game, remove voided scoring legs and refund fully voided games',async t=>{
 const f=await setup(t),parlay=f.bet([f.ids(),f.ids('SPREAD','a',f.games[1])]);
 await f.final(f.games[0]);f.service.settle('league');assert.equal(f.service.mine('league',f.actor).bets[0].status,'OPEN');
 await f.final(f.games[1],{forfeit:true});f.service.settle('league');const settled=f.service.mine('league',f.actor).bets[0];assert.equal(settled.status,'WON');assert.equal(settled.settlements[0].results[1].status,'VOID');assert.equal(settled.settlements[0].returnCents,require('../src/fantasyhq/sportsbook-money').payout(1000,[parlay.legs[0].odds]));
 const canceled=f.bet([f.ids('SPREAD','b',f.games[2])]);await f.submissions.mutate(f.games[2],r=>{r.game.status='CANCELED';});f.service.settle('league');assert.equal(f.service.mine('league',f.actor).bets.find(b=>b.id===canceled.id).status,'VOID');
});
test('stale odds and expired previews require new confirmation and career balances survive season rollover',async t=>{
 const f=await setup(t),preview=f.service.preview('league',f.actor,{marketIds:[f.ids()],wager:'10'});const players=f.repository.loadPlayers('league');for(const p of players.filter(p=>p.teamId==='b'))p.overall=99;f.repository.savePlayers('league',players);
 assert.throws(()=>f.service.confirm('league',f.actor,preview.id),/Lines changed/);const next=f.service.preview('league',f.actor,{marketIds:[f.ids()],wager:'10'});f.advance();assert.throws(()=>f.service.confirm('league',f.actor,next.id),/expired/);
 const placed=f.bet([f.ids()]);f.repository.saveLeague('league',{currentSeasonId:'2'});assert.equal(f.service.mine('league',f.actor).profile.balanceCents,29000);assert.equal(f.repository.loadSportsbook('league').bets[0].id,placed.id);
});
test('reliable props and higher-threshold specials reuse verified game logs; unsupported players receive no props',async t=>{
 const f=await setup(t),schedule=f.repository.loadSchedule('league','1');schedule.weeks.push({week:4,weekId:'w4',status:'ACTIVE',games:[{team1Id:'a',team2Id:'b'}],byes:['c']});f.repository.saveSchedule(schedule);f.repository.saveLeague('league',{currentWeek:4});
 const next=f.submissions.ensureGame({guildId:'guild',weekNumber:4,teamQuery:'a'}).game.gameId;
 assert.equal(f.service.refresh('league').markets.some(m=>m.gameId===next&&m.kind.startsWith('PROP_')),false);
 for(let i=0;i<3;i++){await f.final(f.games[i]);await f.submissions.mutate(f.games[i],r=>{r.playerGameStats=[{playerId:'a-0',gameId:r.game.gameId,teamId:'a',MIN:35,PTS:[20,30,40][i],REB:[8,12,16][i],AST:[6,10,14][i],STL:1,BLK:1,TO:2,FGM:[8,12,16][i],FGA:22,'3PM':[2,4,6][i],'3PA':9,FTM:2,FTA:2,OR:2,FLS:2}];});}
 const markets=f.service.refresh('league').markets.filter(m=>m.gameId===next),props=markets.filter(m=>m.kind.startsWith('PROP_')&&!m.specialId);assert.equal(props.length,8);assert.equal(props.some(m=>m.playerId==='a-1'),false);assert.equal(markets.filter(m=>m.kind==='TOTAL').length,0,'one team lacks reliable scoring data');
 const specials=markets.filter(m=>m.specialId);assert.ok(specials.length>=3&&specials.length<=5);const special=specials.find(m=>m.kind==='PROP_PTS');assert.ok(special.threshold>props.find(m=>m.kind==='PROP_PTS').line);assert.ok(special.odds>=110);
 const straight=f.bet([special.id]);await f.final(next);await f.submissions.mutate(next,r=>{r.playerGameStats=[{playerId:'a-0',gameId:r.game.gameId,teamId:'a',MIN:35,PTS:40,REB:16,AST:14,STL:1,BLK:1,TO:2,FGM:16,FGA:22,'3PM':6,'3PA':9,FTM:2,FTA:2,OR:2,FLS:2}];});f.service.settle('league');assert.equal(f.service.mine('league',f.actor).bets.find(b=>b.id===straight.id).status,'WON');
});
test('an already-spent corrected payout freezes new wagers and retains the original settlement for staff review',async t=>{
 const f=await setup(t),state=f.service.refresh('league'),market=state.markets.find(m=>m.id===f.ids());market.odds=1000;f.repository.commitLeagueFiles({leagueId:'league',files:[{name:'sportsbook.json',value:state}]});
 // Lines are deterministic and unchanged by refresh; use the persisted high-odds market as evidence.
 const placed=f.bet([market.id]);await f.final(f.games[0]);f.service.settle('league');for(let i=0;i<8;i++){const p=f.service.preview('league',f.actor,{marketIds:[f.ids('MONEYLINE','a',f.games[1])],wager:'50'});f.service.confirm('league',f.actor,p.id);}assert.equal(f.service.mine('league',f.actor).profile.balanceCents,0);
 await f.final(f.games[0],{a:90,b:100});f.service.settle('league');const pending=f.repository.loadSportsbook('league').bets.find(b=>b.id===placed.id);assert.ok(pending.pendingCorrection);assert.equal(pending.settlements.length,1);assert.equal(pending.status,'WON');assert.equal(f.service.mine('league',f.actor).profile.balanceCents,0);assert.equal(f.service.mine('league',f.actor).profile.frozen,true);assert.throws(()=>f.service.preview('league',f.actor,{marketIds:[f.ids('MONEYLINE','a',f.games[1])],wager:'1'}),/Staff review/);f.service.settle('league');assert.equal(f.repository.loadSportsbook('league').bets.find(b=>b.id===placed.id).settlements.length,1);
});

test('pushes refund stakes once, remain removable from parlays, and combined odds use exact rational factors',async t=>{
 const f=await setup(t),state=f.service.refresh('league'),market=state.markets.find(m=>m.id===f.ids('SPREAD','a'));market.line=-10;f.repository.commitLeagueFiles({leagueId:'league',files:[{name:'sportsbook.json',value:state}]});
 const straight=f.bet([market.id]),parlay=f.bet([market.id,f.ids('MONEYLINE','a',f.games[1])]);await f.final(f.games[0]);f.service.settle('league');
 const pushed=f.service.mine('league',f.actor).bets.find(b=>b.id===straight.id);assert.equal(pushed.status,'PUSH');assert.equal(pushed.settlements[0].returnCents,1000);f.service.settle('league');assert.equal(f.service.mine('league',f.actor).bets.find(b=>b.id===straight.id).settlements.length,1);
 await f.final(f.games[1]);f.service.settle('league');const settled=f.service.mine('league',f.actor).bets.find(b=>b.id===parlay.id);assert.equal(settled.status,'WON');assert.equal(settled.settlements[0].results[0].status,'PUSH');assert.equal(settled.settlements[0].returnCents,require('../src/fantasyhq/sportsbook-money').payout(1000,[parlay.legs[1].odds]));
 const {combinedAmericanOdds}=require('../src/fantasyhq/sportsbook-money');assert.equal(combinedAmericanOdds([100,100]),300);assert.equal(combinedAmericanOdds([-110]),-110);assert.equal(combinedAmericanOdds([150]),150);
});
