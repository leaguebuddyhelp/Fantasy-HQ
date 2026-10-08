const {randomUUID}=require('crypto');
const path=require('path');
const {simulateBoxScore,validateSimulationRoster}=require('./simulation-box-score');
const {createGameSubmissionService}=require('./game-submissions');
const {activeMemberships}=require('./service-helpers');
const running=new Map();
function createSimulationEngine({storage,rng=Math.random,onOutput=async()=>{}}){
  function roster(sim,teamId){const players=new Map(sim.repository.loadPlayers(sim.leagueId).map(p=>[p.playerId,p]));return activeMemberships(sim.repository.loadRosterMemberships(sim.leagueId),sim.seasonId).filter(m=>m.teamId===teamId).map(m=>({...players.get(m.playerId),position1:m.position1||players.get(m.playerId)?.position1}));}
  async function approve(sim,submissions,record){
    require('./simulation-guard').requireSimulationRepository(sim.repository,sim.leagueId,sim.id);
    const g=record.game,boxes=simulateBoxScore(roster(sim,g.team1Id),roster(sim,g.team2Id),rng),owners=sim.repository.loadOwners(sim.leagueId),timestamp=new Date().toISOString(),sid=randomUUID(),eid=randomUUID();
    await submissions.mutate(g.gameId,r=>{
      if(r.game.status==='FINAL')return;
      r.game.simulationId=sim.id;r.game.approval={operator:'TEST MODE',at:timestamp};
      r.submissions.push({submissionId:sid,status:'FINAL',mode:'SIMULATION',createdAt:timestamp,participants:Object.fromEntries([g.team1Id,g.team2Id].map(id=>[id,owners.find(o=>o.teamId===id)?.userId])),latestExtractionId:eid});
      r.extractions||=[];r.extractions.push({submissionId:sid,extractionId:eid,status:'READY_FOR_REVIEW',issues:[],provider:'TEST MODE simulation'});
      r.playerGameStats=boxes.flatMap((b,i)=>b.players.map(p=>({...p,gameId:g.gameId,teamId:[g.team1Id,g.team2Id][i]})));
      r.teamGameStats=boxes.map((b,i)=>({...b.totals,gameId:g.gameId,teamId:[g.team1Id,g.team2Id][i]}));
      r.dnpPlayers=boxes.flatMap((b,i)=>b.dnp.map(playerId=>({playerId,gameId:g.gameId,teamId:[g.team1Id,g.team2Id][i]})));
      r.game.result={submissionId:sid,extractionId:eid,scores:{[g.team1Id]:boxes[0].totals.PTS,[g.team2Id]:boxes[1].totals.PTS},winnerTeamId:boxes[0].totals.PTS>boxes[1].totals.PTS?g.team1Id:g.team2Id};r.game.status='FINAL';r.game.finalizedAt=timestamp;r.game.locked=true;
    });
    return submissions.load(g.gameId);
  }
  function pauseRequested(sim,actor,runtime){runtime.pauseRequested=storage.runtime(sim.id,actor).pauseRequested===true;return runtime.pauseRequested;}
  async function output(sim,actor,runtime,event){pauseRequested(sim,actor,runtime);runtime.history.push({...event,at:new Date().toISOString()});storage.saveRuntime(sim.id,actor,runtime);if(runtime.outputMode==='FULL'){const receipt=await onOutput(sim,{...event,testMode:true});if(receipt)runtime.discordContent.push(receipt);pauseRequested(sim,actor,runtime);storage.saveRuntime(sim.id,actor,runtime);}}
  function transactions(sim,runtime){
    const repository=sim.repository,c=repository.loadLeague(sim.leagueId),week=c.league.currentWeek;
    if(week>9||week%2||c.league.currentPhase!=='REGULAR_SEASON')return;
    const standings=require('./standings-service').createStandingsService({repository}).getStandings(sim.leagueId,sim.seasonId),rank=Object.values(standings.conferences).flat().sort((a,b)=>b.PCT-a.PCT);
    const rosters=new Map(c.teams.map(t=>[t.teamId,roster(sim,t.teamId)])),valuation=require('./asset-valuation'),draftYear=valuation.leagueSeasonStartYear(sim.seasonId)+1;
    const needs=new Map(c.teams.map(t=>[t.teamId,require('./mock-engine').teamPositionNeeds({draftYear,rosters:Object.fromEntries(rosters),prospects:[]},t.teamId)]));
    const contenders=rank.slice(0,10),middle=rank.slice(10,20),rebuilders=rank.slice(-10);
    const classifications=Object.fromEntries(rank.map((t,i)=>[t.teamId,i<10?'CONTENDER':i<20?'MIDDLE':'REBUILDING']));
    const service=require('./trade-service').createTradeService({repository}),outlooks=valuation.teamOutlooks(c.teams,rosters,new Map(rank.map(t=>[t.teamId,t])),week,sim.seasonId),picks=repository.loadDraftPicks(sim.leagueId);
    const primary=p=>String(p.position1||'').split('/')[0];
    const fit=(team,p)=>needs.get(team).positions.find(n=>n.position===primary(p))?.score||0;
    function attempt(transfers,teams){try{const result=service.completeSimulatedTrade({leagueId:sim.leagueId,participatingTeams:teams,actorUserId:'TEST MODE',transfers});runtime.transactions.push({type:'TRADE',week,classifications:Object.fromEntries(teams.map(id=>[id,classifications[id]])),...result});return true;}catch(error){return false;}}
    for(const a of contenders)for(const b of rebuilders){
      const incoming=rosters.get(b.teamId).filter(p=>Number.isFinite(p.age)&&p.age>=27).sort((x,y)=>(y.overall+fit(a.teamId,y)*8)-(x.overall+fit(a.teamId,x)*8)).slice(0,5);
      const outgoing=rosters.get(a.teamId).filter(p=>Number.isFinite(p.age)&&p.age<=26).sort((x,y)=>y.overall-x.overall);
      for(const veteran of incoming)for(const youth of outgoing){
        if(veteran.overall<youth.overall||veteran.overall-youth.overall>5)continue;
        const transfers=[{assetType:'PLAYER',assetId:youth.playerId,fromTeamId:a.teamId,toTeamId:b.teamId},{assetType:'PLAYER',assetId:veteran.playerId,fromTeamId:b.teamId,toTeamId:a.teamId}];
        const gap=valuation.playerTradeValue(veteran,sim.seasonId)-valuation.playerTradeValue(youth,sim.seasonId);
        if(gap>50){const pick=picks.filter(p=>p.currentOwnerTeamId===a.teamId&&p.draftYear>=draftYear&&p.draftYear<=draftYear+4).map(p=>({pick:p,value:valuation.pickTradeValue({...p,currentYear:draftYear-1,outlooks}).value})).sort((x,y)=>Math.abs(x.value-gap)-Math.abs(y.value-gap))[0];if(pick&&Math.abs(pick.value-gap)<=50&&attempt([...transfers,{assetType:'PICK',assetId:pick.pick.pickId,fromTeamId:a.teamId,toTeamId:b.teamId,protection:pick.pick.protection}], [a.teamId,b.teamId]))return;}
        // Middle teams can facilitate a balanced three-player cycle that improves a weak position.
        if(week%4===0)for(const m of middle.slice(0,5)){const facilitator=rosters.get(m.teamId).filter(p=>Math.abs(valuation.playerTradeValue(p,sim.seasonId)-valuation.playerTradeValue(youth,sim.seasonId))<=50&&fit(m.teamId,youth)>fit(m.teamId,p)).sort((x,y)=>y.overall-x.overall)[0];if(facilitator&&attempt([{...transfers[0],toTeamId:m.teamId},transfers[1],{assetType:'PLAYER',assetId:facilitator.playerId,fromTeamId:m.teamId,toTeamId:b.teamId}],[a.teamId,b.teamId,m.teamId]))return;}
        if(attempt(transfers,[a.teamId,b.teamId]))return;
      }
    }
    const memberships=activeMemberships(repository.loadRosterMemberships(sim.leagueId),sim.seasonId),free=repository.loadPlayers(sim.leagueId).filter(p=>!memberships.some(m=>m.playerId===p.playerId));
    for(const team of [...rebuilders,...middle]){const worst=rosters.get(team.teamId).slice().sort((a,b)=>a.overall-b.overall)[0],candidate=free.filter(p=>p.overall>worst.overall+2).sort((a,b)=>(b.overall+fit(team.teamId,b)*8)-(a.overall+fit(team.teamId,a)*8))[0];if(!candidate)continue;try{const move=require('./free-agency-service').createFreeAgencyService({repository}).simulateReplacement(sim.leagueId,{teamId:team.teamId,playerId:candidate.playerId,releasePlayerId:worst.playerId,actorUserId:'TEST MODE'});runtime.transactions.push({type:'FA_WAIVER',week,...move});return;}catch(error){/* Existing rules reject invalid proposals without changing rosters. */}}
  }
  function develop(sim,submissions,runtime){
    const service=require('./player-upgrades-service').createPlayerUpgradeService({repository:sim.repository,submissions}),owners=sim.repository.loadOwners(sim.leagueId),stats=require('./player-stats-service').createPlayerStatsService({repository:sim.repository,submissions}).getSeasonPlayerStats(sim.leagueId,sim.seasonId);
    service.syncOwnerSnapshot({leagueId:sim.leagueId,seasonId:sim.seasonId,owners,phase:'REGULAR_SEASON'});service.reconcileFinalizedGames({leagueId:sim.leagueId,seasonId:sim.seasonId});
    const builds=[...new Set(sim.repository.loadPlayers(sim.leagueId).map(p=>p.archetype).filter(Boolean))];
    for(const owner of owners){const base={leagueId:sim.leagueId,seasonId:sim.seasonId,teamId:owner.teamId,coachUserId:owner.userId,phase:'REGULAR_SEASON'},status=service.getStatus(base);if(!status.gameEarnedAvailable&&status.newUserStatus!=='AVAILABLE')continue;
      const eligibility=service.playerEligibility(base),players=roster(sim,owner.teamId).filter(p=>Number.isFinite(p.age)&&p.age<=29&&p.overall<95&&(runtime.development[p.playerId]?.gain||0)<2&&!eligibility.find(e=>e.playerId===p.playerId)?.maxed).sort((a,b)=>a.age-b.age);
      for(const p of players){const production=stats.find(s=>s.playerId===p.playerId),expected=Math.max(5,(p.overall-60)*.55),chance=.08+(29-p.age)*.01+Math.max(0,(production?.PPG||0)-expected)*.008;if(rng()>chance)continue;
        const e=eligibility.find(e=>e.playerId===p.playerId),categories=require('./player-upgrades-service').NORMAL_CATEGORIES,category=Object.keys(categories).find(key=>!e.usedCategories.includes(key));if(!category)continue;
        const request=service.createRequest({...base,source:status.newUserStatus==='AVAILABLE'?'NEW_USER':'GAME_EARNED',type:'NORMAL',playerId:p.playerId,category,allocations:[{attribute:categories[category][0],points:1}]});
        const changeBuild=builds.length>1&&rng()<.05,newBuild=changeBuild?builds.find(b=>b!==p.archetype):undefined;
        service.completeRequest({leagueId:sim.leagueId,requestId:request.requestId,staffUserId:'TEST MODE',staffAuthorized:true,phase:'REGULAR_SEASON',changeMode:changeBuild?'BOTH_CHANGED':'OVR_CHANGED',newOverall:p.overall+1,newBuild});
        runtime.development[p.playerId]={gain:(runtime.development[p.playerId]?.gain||0)+1,startingOverall:runtime.development[p.playerId]?.startingOverall??p.overall};runtime.history.push({type:'DEVELOPMENT',playerId:p.playerId,overall:p.overall+1,build:newBuild||p.archetype});break;
      }
    }
  }
  function simulatedAwards(sim,submissions,runtime,group){
    const repository=sim.repository,leagueId=sim.leagueId,scope=group==='REGULAR_SEASON'?'REGULAR_SEASON':'PLAYOFFS',state=repository.loadPlayoffs(leagueId),players=repository.loadPlayers(leagueId),stats=require('./player-stats-service').createPlayerStatsService({repository,submissions,scope}).getSeasonPlayerStats(leagueId,sim.seasonId).filter(p=>p.GP>0).sort((a,b)=>(b.PPG+b.RPG+b.APG+b.SPG+b.BPG)-(a.PPG+a.RPG+a.APG+a.SPG+a.BPG));
    const existing=repository.loadAwards(leagueId).seasons[sim.seasonId]?.[group];if(existing)return;
    const winners={};
    if(group==='REGULAR_SEASON'){
      const rookie=stats.find(s=>players.find(p=>p.playerId===s.playerId)?.yearsInNBA===0),sixth=stats.find(s=>roster(sim,s.teamId).sort((a,b)=>b.overall-a.overall).slice(5).some(p=>p.playerId===s.playerId)),defender=stats.slice().sort((a,b)=>(b.SPG+b.BPG)-(a.SPG+a.BPG))[0],improved=stats.slice().sort((a,b)=>(runtime.development[b.playerId]?.gain||0)-(runtime.development[a.playerId]?.gain||0))[0];
      if(!rookie||!sixth){runtime.errors.push({error:'TEST MODE regular-season award batch unavailable: no stored eligible rookie or bench player.'});return;}
      Object.assign(winners,{MVP:stats[0].playerId,ROY:rookie.playerId,DPOY:defender.playerId,'6MOY':sixth.playerId,MIP:improved.playerId});
    }else for(const conference of ['East','West']){const champion=state.series.find(s=>s.stage==='CONFERENCE_FINALS'&&s.conference===conference)?.winnerTeamId;const player=stats.find(s=>s.teamId===champion);if(!player)throw Error('No eligible simulated Conference Finals MVP.');winners[conference==='East'?'EAST_MVP':'WEST_MVP']=player.playerId;}
    const actor={id:repository.loadLeague(leagueId).league.commissionerUserId,authorized:true,staffAuthorized:true},service=require('./awards-service').createAwardsService({repository,submissions}),preview=service.prepare(leagueId,actor,group,winners);service.confirm(leagueId,actor,preview.token);runtime.history.push({type:'TEST_MODE_AWARDS',group,winners});
  }
  async function runWeeks(sim,actor,runtime,count){
    const repository=sim.repository,leagueId=sim.leagueId;
    let c=repository.loadLeague(leagueId);if(['SETUP','PRESEASON'].includes(c.league.currentPhase)){repository.saveLeague(leagueId,{currentPhase:'PRESEASON'});require('./league-service').createLeagueService({repository}).startRegularSeason({leagueId,seasonId:sim.seasonId,validator:()=>({ready:true})});c=repository.loadLeague(leagueId);}
    if(c.league.currentPhase!=='REGULAR_SEASON'||c.league.regularSeasonStatus==='COMPLETED')throw Error('Regular-season simulation requires an unfinished regular season.');
    const owners=repository.loadOwners(leagueId);for(const t of c.teams)if(!owners.some(o=>o.teamId===t.teamId))owners.push({teamId:t.teamId,userId:`simulation:${sim.id}:${t.teamId}`,assignedAt:new Date(0).toISOString()});repository.saveOwners(leagueId,owners);
    const submissions=createGameSubmissionService({repository}),upgrades=require('./player-upgrades-service').createPlayerUpgradeService({repository,submissions});upgrades.syncOwnerSnapshot({leagueId,seasonId:sim.seasonId,owners,phase:'REGULAR_SEASON'});upgrades.handlePhase({leagueId,seasonId:sim.seasonId,owners,phase:'REGULAR_SEASON'});
    let completed=0;
    while(completed<count){c=repository.loadLeague(leagueId);if(c.league.regularSeasonStatus==='COMPLETED')break;const week=c.league.currentWeek,schedule=repository.loadSchedule(leagueId,sim.seasonId),active=schedule.weeks.find(w=>w.week===week);
      const coverage=await require('./simulation-coverage').beforeWeek({sim,submissions,week});
      for(const match of active.games){const record=submissions.ensureGame({guildId:c.league.guildId||'simulation',weekNumber:week,teamQuery:match.team1Id});if(record.game.status!=='FINAL'){await require('./simulation-coverage').startGame({sim,submissions,gameId:record.game.gameId,coverage});const result=await approve(sim,submissions,record);await output(sim,actor,runtime,{type:'GAME',week,gameId:result.game.gameId,team1:result.game.team1Name,team2:result.game.team2Name,scores:result.game.result.scores});}}
      const previousTransactions=runtime.transactions.length;if(runtime.automaticTransactions)transactions(sim,runtime);for(const move of runtime.transactions.slice(previousTransactions))await output(sim,actor,runtime,{type:'TRANSACTION',week,summary:JSON.stringify(move)});develop(sim,submissions,runtime);
      const service=require('./week-advancement').createWeekAdvancementService({submissions,threads:{create:async()=>({created:0})}}),preview=service.prepare(c.league.guildId||'simulation',actor);await service.advance({id:c.league.guildId||'simulation'},actor,preview.token);
      const weeklyAwards = require('./player-of-week').createPlayerOfWeekService({ repository, submissions }).list(leagueId, { seasonId: c.seasonId, week });
      runtime.history.push({ type: 'TEST_MODE_PLAYER_OF_WEEK', week, winners: weeklyAwards.map(w => ({ awardId: w.awardId, playerId: w.playerId, teamId: w.teamId, conference: w.conference })) });
      await output(sim, actor, runtime, { type: 'PLAYER_OF_WEEK', week, summary: weeklyAwards.map(w => `${w.conference}: ${w.playerName} · ${w.stats.PTS} PTS / ${w.stats.REB} REB / ${w.stats.AST} AST`).join('\n') || 'No eligible weekly player performances.' });
      const ranking = require('./power-rankings').createPowerRankingsService({repository,submissions}).process(leagueId);
      if(ranking){runtime.history.push({type:'TEST_MODE_POWER_RANKINGS',week,key:ranking.key,teams:ranking.teams});await output(sim,actor,runtime,{type:'POWER_RANKINGS',week,summary:ranking.teams.slice(0,10).map(t=>`${t.rank}. ${t.teamName} · ${t.score.toFixed(1)}`).join('\n')});}
      const featureReport=require('./simulation-coverage').afterWeek({sim,submissions,week,coverage,actor});
      runtime.history.push({type:'TEST_MODE_FEATURE_COVERAGE',week,...featureReport});
      if(featureReport.news.length)await output(sim,actor,runtime,{type:'NEWS',week,summary:featureReport.news.map(a=>a.headline).join('\n')});
      if(featureReport.sportsbook)await output(sim,actor,runtime,{type:'SPORTSBOOK',week,summary:`TEST MODE · Career balance $${(featureReport.sportsbook.profile.balanceCents/100).toFixed(2)} · Bet ${featureReport.sportsbook.settlement||'not placed'} · Stream lock ${featureReport.sportsbook.streamLockVerified?'verified':'no pending bet'} · Own-team restriction ${featureReport.sportsbook.ownTeamBlocked?'verified':'no eligible own-team market'}`});
      if(week===15){simulatedAwards(sim,submissions,runtime,'REGULAR_SEASON');await output(sim,actor,runtime,{type:'AWARDS',week,summary:'TEST MODE regular-season awards saved in the simulation archive.'});}
      completed++;await output(sim,actor,runtime,{type:'WEEK_COMPLETE',week});if([5,10,15].includes(week))storage.checkpoint(sim.id,actor,'Week '+week,true);
      if(completed<count&&pauseRequested(sim,actor,runtime)&&repository.loadLeague(leagueId).league.regularSeasonStatus!=='COMPLETED')return {paused:true,weeksCompleted:completed,phase:'REGULAR_SEASON'};
    }
    return {weeksCompleted:completed,games:submissions.records().filter(r=>r.game.simulationId===sim.id).length,phase:repository.loadLeague(leagueId).league.currentPhase};
  }
  async function runPlayoffs(sim,actor,runtime){
    const repository=sim.repository,leagueId=sim.leagueId,submissions=createGameSubmissionService({repository});let c=repository.loadLeague(leagueId);
    if(c.league.currentPhase==='REGULAR_SEASON'){const transition=require('./season-transition').createSeasonTransitionService({submissions}),p=transition.prepare(c.league.guildId||'simulation',actor);transition.confirm(c.league.guildId||'simulation',actor,p.token);}
    const service=require('./postseason-service').createPostseasonService({repository,submissions});
    while(true){let state=service.inspect(leagueId);
      for(const series of state.series.filter(s=>s.stage===state.stage&&!s.winnerTeamId)){while(!service.inspect(leagueId).series.find(s=>s.id===series.id).winnerTeamId){const record=submissions.ensurePostseasonGame({leagueId,seriesId:series.id,guildId:c.league.guildId||'simulation'});const result=await approve(sim,submissions,record);service.synchronize(leagueId);await output(sim,actor,runtime,{type:'GAME',stage:series.stage,gameId:result.game.gameId,team1:result.game.team1Name,team2:result.game.team2Name,scores:result.game.result.scores});if(pauseRequested(sim,actor,runtime))return {paused:true,phase:'PLAYOFFS',stage:series.stage};}}
      state=service.inspect(leagueId);if(state.stage==='PLAY_IN'&&!state.roundComplete){for(const conference of ['East','West'])service.createFinalPlayIn(leagueId,conference,actor);continue;}
      if(!state.roundComplete)throw Error('Simulation encountered an unresolved postseason conflict.');
      if(state.stage==='CONFERENCE_FINALS'){simulatedAwards(sim,submissions,runtime,'CONFERENCE_FINALS');await output(sim,actor,runtime,{type:'AWARDS',summary:'TEST MODE Conference Finals MVPs saved in the simulation archive.'});}
      if(state.stage!=='NBA_FINALS')storage.checkpoint(sim.id,actor,state.stage.replaceAll('_',' ')+' Complete',true);
      if(state.stage==='NBA_FINALS'){
        const final=state.series.find(s=>s.stage==='NBA_FINALS'),players=require('./player-stats-service').createPlayerStatsService({repository,submissions,scope:'PLAYOFFS'}).getSeasonPlayerStats(leagueId,sim.seasonId).filter(p=>p.teamId===final.winnerTeamId&&p.GP>0).sort((a,b)=>(b.PPG+b.RPG+b.APG)-(a.PPG+a.RPG+a.APG));
        const awards=require('./awards-service').createAwardsService({repository,submissions}),p=awards.prepare(leagueId,{...actor,staffAuthorized:true},'NBA_FINALS',{FINALS_MVP:players[0].playerId});awards.confirm(leagueId,{...actor,staffAuthorized:true},p.token);
        const preview=service.prepareChampionship(leagueId,actor),result=service.finalizeChampionship(leagueId,actor,preview.token);await output(sim,actor,runtime,{type:'CHAMPION',...result.champion});storage.checkpoint(sim.id,actor,'NBA FINALS Complete',true);return {champion:result.champion,phase:'OFFSEASON'};
      }
      const preview=service.prepareAdvance(leagueId,actor);service.advance(leagueId,actor,preview.token);
    }
  }
  function pause(id,actor){
    const runtime=storage.runtime(id,actor);if(runtime.status!=='RUNNING')throw Error('Only a running simulation can be paused.');
    runtime.pauseRequested=true;storage.saveRuntime(id,actor,runtime);return {status:'PAUSE_REQUESTED'};
  }
  function resume(id,actor){const runtime=storage.runtime(id,actor);if(runtime.status!=='PAUSED'||!runtime.plan)throw Error('No paused simulation to resume.');return run(id,actor,{...runtime.plan,resume:true});}
  function run(id,actor,{weeks=1,playoffs=false,offseason=false,fullCycle=false,automaticTransactions=false,outputMode='QUIET',resume=false}={}){
    if(![1,3,5,15].includes(weeks)||!['QUIET','FULL'].includes(outputMode))throw Error('Choose 1, 3, 5 or 15 weeks and QUIET or FULL output.');
    const sim=storage.load(id,actor),key=path.dirname(sim.dir)+':'+sim.leagueId;if(running.has(key))throw Error('A simulation for this league is already running.');
    const runtime=storage.runtime(id,actor);if(runtime.status==='PAUSED'&&!resume)throw Error('Resume or reset the paused simulation first.');
    const context=sim.repository.loadLeague(sim.leagueId);sim.seasonId=context.seasonId;for(const team of context.teams){try{validateSimulationRoster(roster(sim,team.teamId));}catch(error){throw Error(`${team.teamName||team.teamId}: ${error.message}`);}}
    const targetWeek=resume?runtime.plan?.targetWeek:(fullCycle?15:Math.min(15,(context.league.currentWeek||1)+weeks-1));
    if(resume&&(!runtime.plan||runtime.status!=='PAUSED'))throw Error('No paused simulation to resume.');
    const count=resume?targetWeek-(context.league.currentWeek||1)+1:weeks;
    const before={games:runtime.history.filter(e=>e.type==='GAME').length,transactions:runtime.transactions.length,checkpoints:storage.checkpoints(id,actor).length,errors:runtime.errors.length};
    const standingsService=require('./standings-service').createStandingsService({repository:sim.repository});
    const recordsBefore=Object.values(standingsService.getStandings(sim.leagueId,sim.seasonId).conferences).flat();
    runtime.plan={weeks,playoffs,offseason,fullCycle,automaticTransactions,outputMode,targetWeek};runtime.pauseRequested=false;runtime.status='RUNNING';runtime.processId=process.pid;runtime.automaticTransactions=automaticTransactions===true;runtime.outputMode=outputMode;storage.saveRuntime(id,actor,runtime);
    const job=(async()=>{try{
      let result;
      if(fullCycle){const c=sim.repository.loadLeague(sim.leagueId);if(['SETUP','PRESEASON','REGULAR_SEASON'].includes(c.league.currentPhase)&&c.league.regularSeasonStatus!=='COMPLETED')result=await runWeeks(sim,actor,runtime,15);if(!result?.paused&&['REGULAR_SEASON','PLAYOFFS'].includes(sim.repository.loadLeague(sim.leagueId).league.currentPhase))result=await runPlayoffs(sim,actor,runtime);}
      if((offseason||fullCycle)&&!result?.paused)result=await require('./simulation-offseason').runSimulationOffseason({sim,actor,runtime,onStage:async event=>{await output(sim,actor,runtime,{type:'OFFSEASON',summary:`TEST MODE · ${event.step} completed${event.nextSeasonId?' · Season '+event.nextSeasonId:''}`, ...event});storage.checkpoint(sim.id,actor,'Season '+event.seasonId+' '+event.step,true);return pauseRequested(sim,actor,runtime);}});
      else if(!fullCycle&&!offseason)result=playoffs?await runPlayoffs(sim,actor,runtime):await runWeeks(sim,actor,runtime,count);
      runtime.status=result.paused?'PAUSED':'IDLE';
      const rows=Object.values(standingsService.getStandings(sim.leagueId,sim.seasonId).conferences).flat();
      const stats=require('./player-stats-service').createPlayerStatsService({repository:sim.repository,scope:playoffs?'PLAYOFFS':'REGULAR_SEASON'}).getSeasonPlayerStats(sim.leagueId,sim.seasonId).filter(p=>p.GP).sort((a,b)=>b.PPG-a.PPG).slice(0,3);
      return {...result,gamesSimulated:runtime.history.filter(e=>e.type==='GAME').length-before.games,transactionsCompleted:runtime.transactions.length-before.transactions,checkpointsCreated:storage.checkpoints(id,actor).length-before.checkpoints,errors:runtime.errors.slice(before.errors),standingsChanges:(context.seasonId===sim.seasonId?rows:[]).map(row=>{const previous=recordsBefore.find(r=>r.teamId===row.teamId);return {teamName:row.teamName,wins:row.W-(previous?.W||0),losses:row.L-(previous?.L||0)};}).filter(r=>r.wins||r.losses).sort((a,b)=>b.wins-a.wins).slice(0,5),performances:stats.map(p=>({name:p.name,PPG:p.PPG,RPG:p.RPG,APG:p.APG}))};
    }catch(error){runtime.status='IDLE';runtime.errors.push({at:new Date().toISOString(),error:error.message});throw error;}finally{storage.saveRuntime(id,actor,runtime);}})().finally(()=>running.delete(key));running.set(key,job);return job;
  }
  return {run,pause,resume};
}
module.exports={createSimulationEngine};
