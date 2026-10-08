const {createHash,randomUUID} = require('crypto');
const {requireCoachIdentity} = require('./coach-identity');
const {requirePostseasonStaff} = require('./postseason-state');
const {cents,payout} = require('./sportsbook-money');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const closed = game => !!(game.sportsbookLockedAt || game.streamlink?.url || ['FINAL','CANCELED','CANCELLED'].includes(game.status));
function validateSportsbook(state) {
 if (state?.version !== 1 || !Array.isArray(state.bets) || !Array.isArray(state.markets)
  || !Array.isArray(state.ledger) || !Array.isArray(state.previews) || !state.wallets
  || typeof state.wallets !== 'object' || Array.isArray(state.wallets)) throw Error('Invalid Sportsbook storage.');
 for (const field of ['bets','markets','ledger','previews']) if (new Set(state[field].map(row=>row.id)).size !== state[field].length) throw Error('Duplicate Sportsbook record.');
 if (Object.values(state.wallets).some(wallet=>!wallet.userId || !Number.isSafeInteger(wallet.balanceCents) || wallet.balanceCents<0)
  || state.bets.some(bet=>!bet.id || !bet.userId || !Array.isArray(bet.legs) || !bet.legs.length || !Number.isSafeInteger(bet.stakeCents) || bet.stakeCents<100
    || !['OPEN','WON','LOST','PUSH','VOID'].includes(bet.status) || !Array.isArray(bet.settlements))) throw Error('Invalid Sportsbook currency or bet.');
 const balances = new Map();
 for(const entry of state.ledger) {
  if(!entry.userId||!state.wallets[entry.userId]||!Number.isSafeInteger(entry.amountCents))throw Error('Invalid Sportsbook ledger.');
  balances.set(entry.userId,(balances.get(entry.userId)||0n)+BigInt(entry.amountCents));
 }
 for(const account of Object.values(state.wallets)) {
  const initial=state.ledger.filter(entry=>entry.userId===account.userId&&entry.type==='INITIAL');
  if(initial.length!==1||initial[0].amountCents!==30000||balances.get(account.userId)!==BigInt(account.balanceCents))throw Error('Sportsbook wallet does not reconcile with its permanent ledger.');
 }
 return state;
}
function createSportsbookService({repository,submissions,now=Date.now}) {
 const stamp=()=>new Date(now()).toISOString();
 function save(leagueId,state,action,actor={id:'system'},metadata={}) {
  repository.commitLeagueFiles({leagueId,files:[{name:'sportsbook.json',value:state},{name:'audit-log.json',value:[...repository.loadAuditLog(leagueId),{action,userId:actor.id,timestamp:stamp(),metadata}]}]});
 }
 function identity(leagueId,actor) {
  const c=repository.loadLeague(leagueId);return requireCoachIdentity(repository,{...c,league:c.league},actor.member,actor.id);
 }
 function wallet(state,userId) {
  if (!state.wallets[userId]) {
   state.wallets[userId]={userId,balanceCents:30000,createdAt:stamp(),frozen:false};
   state.ledger.push({id:'initial:'+userId,userId,type:'INITIAL',amountCents:30000,at:stamp()});
  }
  return state.wallets[userId];
 }
 function currentGame(id) {const record=submissions.load?submissions.load(id):submissions.records().find(r=>r.game.gameId===id);if(!record)throw Error('Unknown game.');return record;}
 function refresh(leagueId) {
  const state=repository.loadSportsbook(leagueId),c=repository.loadLeague(leagueId),settings=repository.loadSettings(leagueId);
  const allRecords=submissions.records(),snapshotSubmissions={records:()=>allRecords};
  const streamService=require('./streams-service').createStreamsService({repository,submissions:snapshotSubmissions});let streamAnalysis;
  const simulationId=settings.simulationId||null,records=allRecords.filter(r=>r.game.leagueId===leagueId&&r.game.seasonId===c.seasonId
   && (simulationId?r.game.simulationId===simulationId:!r.game.simulationId));let changed=false;
  const players=new Map(repository.loadPlayers(leagueId).map(p=>[p.playerId,p]));
  const members=require('./service-helpers').activeMemberships(repository.loadRosterMemberships(leagueId),c.seasonId);
  const allMemberships=repository.loadRosterMemberships(leagueId),gameMap=new Map(allRecords.map(r=>[r.game.gameId,r.game]));
  const stats=['REGULAR_SEASON','PLAY_IN','PLAYOFFS'].flatMap(scope=>require('./player-stats-service').createPlayerStatsService({repository,submissions:snapshotSubmissions,scope}).getAllGamePerformances(leagueId,c.seasonId)).filter(log=>allMemberships.some(member=>require('./historical-membership').representedAt(member,{playerId:log.playerId,teamId:log.teamId,seasonId:c.seasonId,at:gameMap.get(log.gameId)?.finalizedAt})));
  for (const {game} of records) {
   const saved=state.markets.filter(m=>m.gameId===game.gameId&&m.simulationId===simulationId);
   if (closed(game)) {for(const m of saved)if(m.status==='OPEN'){m.status='LOCKED';m.lockedAt=game.sportsbookLockedAt||game.streamlink?.submittedAt||game.finalizedAt||stamp();changed=true;}continue;}
   streamAnalysis ||= streamService.analysis(leagueId,c.seasonId,allRecords);
   const facts=streamService.facts(game,streamAnalysis);
   const teamIds=[game.team1Id,game.team2Id],ranks=teamIds.map(id=>facts.teams.find(t=>t.teamId===id));
   if(ranks.some(r=>!r))continue;
   const margin=Math.max(-25,Math.min(25,(ranks[0].score-ranks[1].score)*.35));
   const probability=Math.max(.12,Math.min(.88,1/(1+Math.exp(-margin/9))));
   const american=p=>p>=.5?-Math.max(100,Math.round(p/(1-p)*100)):Math.max(100,Math.round((1-p)/p*100));
   const teamLogs=teamIds.map(id=>stats.filter(log=>log.teamId===id));
   // Totals require three distinct verified games for each team; no invented scoring baseline.
   const gameTotals=teamLogs.map(logs=>[...new Map(logs.map(log=>[log.gameId,log.score.split('-').map(Number).reduce((n,v)=>n+v,0)])).values()]);
   const average=values=>values.reduce((sum,v)=>sum+v,0)/values.length;
   const half=value=>Math.floor(value)+.5;
   const next=[];
   function add(kind,selection,line,odds,extra={}) {
    const group=[game.gameId,kind,extra.playerId||'game'].join(':');
    next.push({id:group+':'+selection,group,leagueId,seasonId:c.seasonId,week:game.weekNumber,gameId:game.gameId,teamIds,
     kind,selection,line,odds,simulationId,status:'OPEN',...extra});
   }
   add('MONEYLINE',game.team1Id,null,american(probability));add('MONEYLINE',game.team2Id,null,american(1-probability));
   const spread=half(Math.abs(margin))*(margin>=0?-1:1);
   add('SPREAD',game.team1Id,spread,-110);add('SPREAD',game.team2Id,-spread,-110);
   if(gameTotals.every(values=>values.length>=3)) {
    const total=half(average(gameTotals.flat()));add('TOTAL','OVER',total,-110);add('TOTAL','UNDER',total,-110);
   }
   for(const member of members.filter(m=>teamIds.includes(m.teamId))) {
    const player=players.get(member.playerId),logs=stats.filter(log=>log.playerId===member.playerId&&log.teamId===member.teamId&&log.MIN>=10).slice(-5);
    if(!player||player.retiredAt||logs.length<3)continue;
    for(const metric of ['PTS','REB','AST','3PM']) {
     const values=logs.map(log=>metric==='3PM'?Number(log['3PT'].split('-')[0]):log[metric]);
     const line=half(average(values));if(line<.5)continue;
     for(const selection of ['OVER','UNDER'])add('PROP_'+metric,selection,line,-110,{playerId:player.playerId,playerTeamId:member.teamId,playerName:player.name,sampleGames:logs.map(log=>log.gameId)});
    }
   }
   const sourceDigest=digest(next);
   for(const row of next) {
    const existing=state.markets.find(m=>m.id===row.id&&m.simulationId===simulationId);
    if(!existing){state.markets.push({...row,sourceDigest,updatedAt:stamp()});changed=true;}
    else if(existing.sourceDigest!==sourceDigest||existing.status!=='OPEN'){Object.assign(existing,row,{sourceDigest,updatedAt:stamp()});changed=true;}
   }
   for(const old of saved.filter(m=>m.status==='OPEN'&&!m.specialId&&!next.some(row=>row.id===m.id))){old.status='VOID';old.voidReason='Verified data or roster no longer supports this market.';changed=true;}
  }
  const existingSpecials=state.markets.filter(m=>m.specialId&&m.seasonId===c.seasonId&&m.week===c.league.currentWeek&&m.simulationId===simulationId);
  const bases=state.markets.filter(m=>!m.specialId&&m.seasonId===c.seasonId&&m.week===c.league.currentWeek&&m.simulationId===simulationId&&m.status==='OPEN');
  const candidates=[];
  for(const base of bases) {
   if(base.kind==='MONEYLINE'&&base.odds>=110) candidates.push({...base,odds:Math.round(base.odds*1.15),specialName:'🔥 Upset Alert',specialPriority:1,baseMarketId:base.id});
   if(base.kind.startsWith('PROP_')&&base.selection==='OVER') {
    const metric=base.kind.slice(5),logs=stats.filter(log=>base.sampleGames.includes(log.gameId)&&log.playerId===base.playerId);
    const values=logs.map(log=>metric==='3PM'?Number(log['3PT'].split('-')[0]):log[metric]);
    const step=metric==='PTS'?5:metric==='3PM'?1:2,threshold=Math.ceil((base.line+1)*1.15/step)*step;
    if(values.length<3||threshold>Math.max(...values))continue;
    const hitRate=(values.filter(value=>value>=threshold).length+1)/(values.length+2);
    if(hitRate>=.5)continue;
    candidates.push({...base,line:threshold-.5,odds:Math.max(110,Math.round((1-hitRate)/hitRate*115)),
     specialName:({'PTS':'⭐ Scoring Special','REB':'🔥 Rebounding Special','AST':'🎯 Playmaker Special','3PM':'🔥 Shooting Special'})[metric],
     specialPriority:2,baseMarketId:base.id,threshold,verifiedSample:values});
   }
  }
  // Retain each week's selected promotions; ordinary line refreshes do not flood new specials.
  const chosen=existingSpecials.length?candidates.filter(row=>existingSpecials.some(m=>m.baseMarketId===row.baseMarketId))
   :candidates.sort((a,b)=>a.specialPriority-b.specialPriority||b.odds-a.odds||a.id.localeCompare(b.id)).slice(0,5);
  for(const row of chosen) {
   const specialId=`${c.seasonId}:W${c.league.currentWeek}:${row.baseMarketId}`,id='special:'+specialId;
   const generated={...row,id,specialId,sourceDigest:digest(row)},old=state.markets.find(m=>m.id===id&&m.simulationId===simulationId);
   if(!old){state.markets.push({...generated,updatedAt:stamp()});changed=true;}
   else if(old.status==='OPEN'&&old.sourceDigest!==generated.sourceDigest){Object.assign(old,generated,{updatedAt:stamp()});changed=true;}
  }
  for(const special of existingSpecials.filter(m=>m.status==='OPEN')) {
   const base=state.markets.find(m=>m.id===special.baseMarketId&&m.simulationId===simulationId);
   if(!base||base.status!=='OPEN'||!chosen.some(row=>row.baseMarketId===special.baseMarketId)) {
    special.status=base?.status==='LOCKED'?'LOCKED':'VOID';special.voidReason='The underlying market is closed or no longer supported by verified data.';changed=true;
   }
  }
  if(changed)save(leagueId,state,'sportsbook.markets.refreshed');return state;
 }
 function selections(leagueId,actor,ids,state) {
  const coach=identity(leagueId,actor),simulationId=repository.loadSettings(leagueId).simulationId||null;
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)throw Error('Choose unique market selections.');
  const legs=ids.map(id=>state.markets.find(m=>m.id===id&&m.simulationId===simulationId));
  if(legs.some(m=>!m))throw Error('Unknown market.');
  if(new Set(legs.map(m=>m.group)).size!==legs.length)throw Error('A parlay cannot contain conflicting selections from the same market.');
  for(const leg of legs) {
   const game=currentGame(leg.gameId).game;
   if(game.leagueId!==leagueId||game.seasonId!==repository.loadLeague(leagueId).seasonId||closed(game)||leg.status!=='OPEN')throw Error('Betting is closed or this market is unavailable.');
   if(leg.teamIds.includes(coach.teamId))throw Error('You cannot bet on your own team, players or games.');
   if(leg.playerId&&repository.loadPlayers(leagueId).find(p=>p.playerId===leg.playerId)?.teamId===coach.teamId)throw Error('You cannot bet on your own players.');
  }
  return legs.map(leg=>structuredClone(leg));
 }
 function preview(leagueId,actor,{marketIds,wager}) {
  const state=refresh(leagueId),legs=selections(leagueId,actor,marketIds,state),stake=cents(wager),account=wallet(state,actor.id);
  if(account.frozen)throw Error('Your wallet needs Staff review before another wager.');
  if(stake<100||stake>(legs.length===1?5000:2500))throw Error(legs.length===1?'Straight wagers must be $1–$50.':'Parlay wagers must be $1–$25.');
  if(stake>account.balanceCents)throw Error('The wager exceeds your available career balance.');
  const potentialReturnCents=payout(stake,legs.map(leg=>leg.odds));
  const row={id:randomUUID(),userId:actor.id,seasonId:repository.loadLeague(leagueId).seasonId,legs,stakeCents:stake,potentialReturnCents,
   combinedAmericanOdds:require('./sportsbook-money').combinedAmericanOdds(legs.map(leg=>leg.odds)),profitCents:potentialReturnCents-stake,createdAt:stamp(),expiresAt:now()+300000,sourceDigest:digest(legs),simulationId:repository.loadSettings(leagueId).simulationId||null};
  state.previews=state.previews.filter(p=>p.userId!==actor.id&&p.expiresAt>now());state.previews.push(row);save(leagueId,state,'sportsbook.preview',actor,{id:row.id});return row;
 }
 function confirm(leagueId,actor,token) {
  identity(leagueId,actor);const state=refresh(leagueId),prior=state.bets.find(b=>b.id===token);
  if(prior){if(prior.userId!==actor.id)throw Error('This confirmation belongs to another coach.');return prior;}
  const row=state.previews.find(p=>p.id===token&&p.userId===actor.id);
  if(!row||row.expiresAt<=now())throw Error('Bet confirmation expired. Review the bet again.');
  const legs=selections(leagueId,actor,row.legs.map(leg=>leg.id),state);
  if(digest(legs)!==row.sourceDigest)throw Error('Lines changed. Review the new odds before confirming.');
  const account=wallet(state,actor.id);if(account.frozen||account.balanceCents<row.stakeCents)throw Error('Your available balance changed. Review the wallet.');
  account.balanceCents-=row.stakeCents;
  const bet={...row,leagueId,placedAt:stamp(),status:'OPEN',settlements:[]};delete bet.expiresAt;state.bets.push(bet);state.previews=state.previews.filter(p=>p.id!==token);
  state.ledger.push({id:'stake:'+bet.id,userId:actor.id,betId:bet.id,type:'WAGER',amountCents:-bet.stakeCents,at:stamp()});
  save(leagueId,state,'sportsbook.bet.placed',actor,{betId:bet.id});return bet;
 }
 function resultFor(leagueId,leg) {
  const record=currentGame(leg.gameId),game=record.game;
  if(['CANCELED','CANCELLED'].includes(game.status))return {status:'VOID',sourceDigest:digest(game)};
  if(game.status!=='FINAL')return {status:'OPEN',sourceDigest:null};
  const schedule=repository.loadSchedule(leagueId,game.seasonId),official=require('./official-game').officialRegularGame(record,{leagueId,seasonId:game.seasonId,schedule});
  if(!official && !['PLAY_IN','PLAYOFFS'].some(scope=>require('./stat-scope').officialScopeGames([record],{repository,leagueId,seasonId:game.seasonId,schedule,scope}).games.length))return {status:'OPEN',sourceDigest:null};
  const sourceDigest=digest({result:game.result,playerGameStats:record.playerGameStats});
  const compare=value=>({status:value===leg.line?'PUSH':(leg.selection==='OVER'?value>leg.line:value<leg.line)?'WON':'LOST',sourceDigest,value});
  const forfeit=game.result.type==='FORFEIT';
  if(leg.kind==='MONEYLINE')return {status:(forfeit?game.result.winnerTeamId:game.result.scores[game.team1Id]>game.result.scores[game.team2Id]?game.team1Id:game.team2Id)===leg.selection?'WON':'LOST',sourceDigest};
  if(forfeit)return {status:'VOID',sourceDigest,reason:'Administrative result has no invented scoring or player statistics.'};
  if(leg.kind==='SPREAD') {const other=leg.teamIds.find(id=>id!==leg.selection),margin=game.result.scores[leg.selection]-game.result.scores[other]+leg.line;return {status:margin===0?'PUSH':margin>0?'WON':'LOST',sourceDigest};}
  if(leg.kind==='TOTAL')return compare(leg.teamIds.reduce((sum,id)=>sum+game.result.scores[id],0));
  if(leg.kind.startsWith('PROP_')) {
   const raw=record.playerGameStats.filter(p=>p.playerId===leg.playerId&&p.teamId===leg.playerTeamId);
   // Reuse the validated statistics service; malformed rows and DNPs cannot settle props as losses.
   const valid=['REGULAR_SEASON','PLAY_IN','PLAYOFFS'].flatMap(scope=>require('./player-stats-service').createPlayerStatsService({repository,submissions,scope}).getAllGamePerformances(leagueId,game.seasonId)).find(log=>log.gameId===game.gameId&&log.playerId===leg.playerId&&log.teamId===leg.playerTeamId);
   if(raw.length!==1||!valid||!repository.loadRosterMemberships(leagueId).some(member=>require('./historical-membership').representedAt(member,{playerId:leg.playerId,teamId:leg.playerTeamId,seasonId:game.seasonId,at:game.finalizedAt})))return {status:'VOID',sourceDigest,reason:'No valid participating player box score.'};
   const metric=leg.kind.slice(5);return compare(metric==='3PM'?Number(valid['3PT'].split('-')[0]):valid[metric]);
  }
  return {status:'VOID',sourceDigest,reason:'Invalid market.'};
 }
 function settle(leagueId) {
  const state=repository.loadSportsbook(leagueId);let changed=false;
  for(const bet of state.bets) {
   if(bet.pendingCorrection)continue;
   const results=bet.legs.map(leg=>resultFor(leagueId,leg)),sourceDigest=digest(results);
   if(results.some(result=>result.status==='OPEN')||bet.settlements.at(-1)?.sourceDigest===sourceDigest)continue;
   const valid=bet.legs.filter((leg,index)=>results[index].status==='WON'),loss=results.some(r=>r.status==='LOST');
   const status=loss?'LOST':valid.length?'WON':results.every(r=>r.status==='VOID')?'VOID':'PUSH';
   const returnCents=loss?0:valid.length?payout(bet.stakeCents,valid.map(leg=>leg.odds)):bet.stakeCents;
   const previous=bet.settlements.at(-1),adjustmentCents=returnCents-(previous?.returnCents||0),account=wallet(state,bet.userId);
   if(account.balanceCents+adjustmentCents<0) {
    // Policy on already-spent corrected winnings needs commissioner resolution.
    // Preserve the old settlement, freeze new wagers, and expose the exact pending adjustment.
    account.frozen=true;bet.pendingCorrection={sourceDigest,status,returnCents,adjustmentCents,results,detectedAt:stamp()};changed=true;continue;
   }
   if(!Number.isSafeInteger(account.balanceCents+adjustmentCents))throw Error('Wallet credit exceeds the supported currency range.');
   account.balanceCents+=adjustmentCents;const settlement={id:randomUUID(),at:stamp(),sourceDigest,status,returnCents,adjustmentCents,results,corrects:previous?.id||null};
   bet.settlements.push(settlement);bet.status=status;delete bet.pendingCorrection;
   state.ledger.push({id:settlement.id,userId:bet.userId,betId:bet.id,type:previous?'CORRECTION':'SETTLEMENT',amountCents:adjustmentCents,at:stamp()});changed=true;
  }
  if(changed)save(leagueId,state,'sportsbook.settled');return state;
 }
 function profile(state,userId) {
  const account=state.wallets[userId];if(!account)return null;
  const settled=state.bets.filter(b=>b.userId===userId&&b.status!=='OPEN').sort((a,b)=>a.placedAt.localeCompare(b.placedAt)),all=state.bets.filter(b=>b.userId===userId);
  let streak=0,bestStreak=0;for(const bet of settled){streak=bet.status==='WON'?streak+1:0;bestStreak=Math.max(bestStreak,streak);}
  const wins=settled.filter(b=>b.status==='WON').length,losses=settled.filter(b=>b.status==='LOST').length;
  return {...account,totalWageredCents:all.reduce((sum,b)=>sum+b.stakeCents,0),totalWinningsCents:settled.reduce((sum,b)=>sum+b.settlements.at(-1).returnCents,0),
   careerProfitCents:settled.reduce((sum,b)=>sum+b.settlements.at(-1).returnCents-b.stakeCents,0),wins,losses,pushes:settled.filter(b=>['PUSH','VOID'].includes(b.status)).length,
   winPercentage:wins+losses?wins/(wins+losses)*100:null,biggestWinCents:Math.max(0,...settled.map(b=>b.settlements.at(-1).returnCents-b.stakeCents)),bestWinningStreak:bestStreak};
 }
 function mine(leagueId,actor) {identity(leagueId,actor);const state=repository.loadSportsbook(leagueId),exists=!!state.wallets[actor.id];wallet(state,actor.id);if(!exists)save(leagueId,state,'sportsbook.wallet.created',actor);return {profile:profile(state,actor.id),bets:state.bets.filter(b=>b.userId===actor.id)};}
 function leaderboard(leagueId) {const state=repository.loadSportsbook(leagueId);const owners=repository.loadOwners(leagueId);return Object.keys(state.wallets).map(id=>profile(state,id)).map(({userId,careerProfitCents,wins,losses,pushes,winPercentage,bestWinningStreak})=>({userId,displayName:owners.find(o=>o.userId===userId)?.displayName||'Coach '+userId,careerProfitCents,wins,losses,pushes,winPercentage,bestWinningStreak})).sort((a,b)=>b.careerProfitCents-a.careerProfitCents||a.userId.localeCompare(b.userId));}
 function staff(leagueId,actor) {requirePostseasonStaff(repository.loadLeague(leagueId),actor);return repository.loadSportsbook(leagueId);}
 function publication(leagueId,key,receipt) {const state=repository.loadSportsbook(leagueId);state.publications ||= {};state.publications[key]=receipt;save(leagueId,state,'sportsbook.announcement',undefined,{key});}
 return {refresh,preview,confirm,settle,mine,leaderboard,staff,publication};
}
module.exports={createSportsbookService,validateSportsbook,closed};
