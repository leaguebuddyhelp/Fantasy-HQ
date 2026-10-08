// Feature coverage inside the existing isolated simulation engine. Every write
// uses the same production services and the simulation workspace repository.
const {requireSimulationRepository}=require('./simulation-guard');
async function beforeWeek({sim,submissions,week}) {
 const repository=sim.repository,leagueId=sim.leagueId;requireSimulationRepository(repository,leagueId,sim.id);
 const c=repository.loadLeague(leagueId),schedule=repository.loadSchedule(leagueId,sim.seasonId),active=schedule.weeks.find(w=>w.week===week);
 const records=[];
 for(const match of active.games) {
  const record=submissions.ensureGame({guildId:c.league.guildId||'simulation',weekNumber:week,teamQuery:match.team1Id});
  if(record.game.status!=='FINAL'){await submissions.mutate(record.game.gameId,r=>{r.game.simulationId=sim.id;});records.push(submissions.load(record.game.gameId));}
 }
 const settings=repository.loadSettings(leagueId);if(settings.simulationCoverage===false||!records.length)return null;
 const excluded=new Set(records.slice(0,2).flatMap(r=>[r.game.team1Id,r.game.team2Id])),team=c.teams.find(t=>!excluded.has(t.teamId));
 if(!team)return null;
 const userId='simulation-sportsbook:'+sim.id,owners=repository.loadOwners(leagueId);
 for(const owner of owners.filter(o=>o.userId===userId&&o.teamId!==team.teamId))owner.userId='simulation:'+sim.id+':'+owner.teamId;
 const owner=owners.find(o=>o.teamId===team.teamId);if(owner)owner.userId=userId;else owners.push({teamId:team.teamId,userId});repository.saveOwners(leagueId,owners);
 const ownership=repository.loadRoleOwnership(leagueId),roleId='simulation-role:'+team.teamId;
 repository.saveRoleOwnership(leagueId,{...ownership,roleIds:{...ownership.roleIds,[team.teamId]:roleId}});
 const actor={id:userId,member:{roles:{cache:new Map([[roleId,{}]])}}},service=require('./sportsbook-service').createSportsbookService({repository,submissions}),state=service.refresh(leagueId);
 const streamService=require('./streams-service').createStreamsService({repository,submissions});
 const streamAnalysis=streamService.analysis(leagueId,c.seasonId);
 const marketFor=id=>state.markets.find(m=>m.gameId===id&&m.kind==='MONEYLINE'&&!m.specialId&&m.selection===submissions.load(id).game.team1Id);
 const markets=records.slice(0,2).map(r=>marketFor(r.game.gameId)).filter(Boolean);
 const ownMarket=state.markets.find(m=>m.status==='OPEN'&&m.teamIds.includes(team.teamId));let ownTeamBlocked=false;
 if(ownMarket)try{service.preview(leagueId,actor,{marketIds:[ownMarket.id],wager:'1'});}catch(error){ownTeamBlocked=/own team/.test(error.message);}
 const account=service.mine(leagueId,actor).profile;
 let betId=null,lockedPreview=null;
 if(account.balanceCents>=100&&markets.length) {
  const preview=service.preview(leagueId,actor,{marketIds:markets.map(m=>m.id),wager:'1'});
  betId=service.confirm(leagueId,actor,preview.id).id;
  lockedPreview=service.preview(leagueId,actor,{marketIds:[markets[0].id],wager:'1'}).id;
 }
 return {actor,service,streamService,streamAnalysis,betId,lockedPreview,lockedGameId:markets[0]?.gameId,ownTeamBlocked,startingBalanceCents:account.balanceCents,week};
}
async function startGame({sim,submissions,gameId,coverage}) {
 requireSimulationRepository(sim.repository,sim.leagueId,sim.id);
 await submissions.mutate(gameId,r=>{const at=new Date().toISOString();r.game.sportsbookLockedAt ||= at;r.game.streamlink ||= {url:'https://example.invalid/test-mode/'+gameId,submittedAt:at,submittedBy:'TEST MODE'};});
 if(coverage?.lockedGameId===gameId&&coverage.lockedPreview) {
  try{coverage.service.confirm(sim.leagueId,coverage.actor,coverage.lockedPreview);throw Error('Test Mode detected a bet accepted after stream start.');}
  catch(error){if(!/closed/.test(error.message))throw error;coverage.streamLockVerified=true;}
 }
 const game=submissions.load(gameId).game;
 const facts=coverage?coverage.streamService.facts(game,coverage.streamAnalysis):require('./streams-service').createStreamsService({repository:sim.repository,submissions}).facts(game);
 await submissions.mutate(gameId,r=>{r.game.streamAnnouncement={facts,testMode:true};});
}
function afterWeek({sim,submissions,week,coverage,actor}) {
 requireSimulationRepository(sim.repository,sim.leagueId,sim.id);
 const now=()=>Date.parse(sim.createdAt||'2026-10-08T12:00:00Z')+week*7*86400000;
 const news=require('./news-service').createNewsService({repository:sim.repository,submissions,now});
 const draft=news.staffList(sim.leagueId,actor).filter(a=>a.week===week&&a.status==='DRAFT').sort((a,b)=>b.newsworthiness-a.newsworthiness||a.id.localeCompare(b.id))[0];
 if(draft)news.review(sim.leagueId,actor,{id:draft.id,action:'approve'});
 const published=news.publishDue(sim.leagueId).filter(a=>a.week===week);
 let sportsbook=null;
 if(coverage) {
  coverage.service.settle(sim.leagueId);const mine=coverage.service.mine(sim.leagueId,coverage.actor);
  sportsbook={betId:coverage.betId,profile:mine.profile,settlement:mine.bets.find(b=>b.id===coverage.betId)?.status,
   streamLockVerified:!!coverage.streamLockVerified,ownTeamBlocked:coverage.ownTeamBlocked,startingBalanceCents:coverage.startingBalanceCents};
 }
 return {news:published.map(a=>({id:a.id,headline:a.headline,playerIds:a.playerIds})),sportsbook};
}
module.exports={beforeWeek,startGame,afterWeek};
