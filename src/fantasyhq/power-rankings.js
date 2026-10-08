const {activeMemberships}=require('./service-helpers');
const clamp=n=>Math.max(0,Math.min(1,n));
const avg=(values,fallback=0)=>values.length?values.reduce((a,b)=>a+b,0)/values.length:fallback;
const round=n=>Math.round(n*1000000)/1000000;
function validateRankings(state){if(state?.version!==1||!state.seasons||typeof state.seasons!=='object'||Array.isArray(state.seasons))throw Error('Invalid power rankings state.');for(const [id,season] of Object.entries(state.seasons)){if(!season||typeof season!=='object'||Array.isArray(season))throw Error('Invalid power rankings season.');for(const [key,snapshot] of Object.entries(season)){if(snapshot.seasonId!==id||snapshot.key!==key||!Array.isArray(snapshot.teams)||new Set(snapshot.teams.map(t=>t.teamId)).size!==snapshot.teams.length||snapshot.teams.some(t=>!t.teamId||!Number.isFinite(t.score)||!Number.isInteger(t.rank)))throw Error('Invalid power rankings snapshot.');}}return state;}
function calculateRankings({teams,players,memberships,games=[],previous=[],preseason=false,seasonId,key,now=Date.now()}){
 const rows=new Map(teams.map(team=>[team.teamId,{...team,wins:0,losses:0,scoringGames:0,margin:0,games:[]}])) ,byPlayer=new Map(players.map(p=>[p.playerId,p]));
 for(const {game:g} of games){const a=rows.get(g.team1Id),b=rows.get(g.team2Id);if(!a||!b)continue;const forfeit=g.result.type==='FORFEIT',winner=forfeit?g.result.winnerTeamId:g.result.scores[g.team1Id]>g.result.scores[g.team2Id]?g.team1Id:g.team2Id;for(const [team,opponent] of [[a,b],[b,a]]){const win=winner===team.teamId,margin=forfeit?null:g.result.scores[team.teamId]-g.result.scores[opponent.teamId];team.wins+=Number(win);team.losses+=Number(!win);if(margin!=null){team.margin+=margin;team.scoringGames++;}team.games.push({gameId:g.gameId,week:g.weekNumber,at:g.finalizedAt,opponentId:opponent.teamId,win,margin});}}
 for(const row of rows.values()){
  row.games.sort((a,b)=>a.week-b.week||String(a.at).localeCompare(String(b.at))||a.gameId.localeCompare(b.gameId));
  const roster=memberships.filter(m=>m.teamId===row.teamId).map(m=>byPlayer.get(m.playerId)).filter(p=>p&&!p.retiredAt),ratings=roster.map(p=>Number(p.overall)||0).sort((a,b)=>b-a);
  const top=avg(ratings.slice(0,3))/99,next=avg(ratings.slice(3,8))/99,depth=avg(ratings.slice(8,15))/99;
  row.rosterStrength=.4*top+.35*next+.25*depth;
  row.seasonPerformance=.65*(row.games.length?row.wins/row.games.length:.5)+.35*(row.scoringGames?clamp(.5+row.margin/row.scoringGames/40):.5);
  const recent=row.games.slice(-5);row.recentForm=recent.length?.65*avg(recent.map(g=>Number(g.win)))+.35*avg(recent.map(g=>g.margin==null?.5:clamp(.5+g.margin/40))):.5;
  // Independent opponent rating is calculated before SOS; no recursive dependency.
  row.independentPower=.6*row.seasonPerformance+.4*row.rosterStrength;
  const changes=roster.flatMap(p=>(p.progressionHistory||[]).filter(h=>String(h.seasonId)===String(seasonId)).slice(-1).map(h=>h.change));row.progression=clamp(.5+avg(changes)/20);row.preseasonScore=.6*row.rosterStrength+.2*top+.1*depth+.1*row.progression;
 }
 const prior=new Map(previous.map(t=>[t.teamId,t.rank]));
 const ranked=[...rows.values()].map(row=>{const opponents=row.games.map(g=>rows.get(g.opponentId));const schedule=opponents.length?.6*avg(opponents.map(o=>o.games.length?o.wins/o.games.length:.5))+.4*avg(opponents.map(o=>o.independentPower)):.5;const score=100*(preseason?row.preseasonScore:.4*row.seasonPerformance+.25*row.rosterStrength+.2*row.recentForm+.15*schedule);return {teamId:row.teamId,teamName:row.teamName,conference:row.conference,abbreviation:row.abbreviation,score:round(score),wins:row.wins,losses:row.losses,previousRank:prior.get(row.teamId)||null,breakdown:{seasonPerformance:round(row.seasonPerformance*100),rosterStrength:round(row.rosterStrength*100),recentForm:round(row.recentForm*100),strengthOfSchedule:round(schedule*100),progression:round(row.progression*100)}};}).sort((a,b)=>b.score-a.score||a.teamId.localeCompare(b.teamId)).map((t,i)=>({...t,rank:i+1,movement:t.previousRank?t.previousRank-i-1:null,enteredTop10:i<10&&(!t.previousRank||t.previousRank>10)}));
 return {seasonId:String(seasonId),key,preseason,createdAt:new Date(now).toISOString(),formulaVersion:1,sourceGameIds:games.map(r=>r.game.gameId),teams:ranked};
}
function createPowerRankingsService({repository,submissions,now=Date.now}){
 function process(leagueId,{preseason=false}={}){
  const c=repository.loadLeague(leagueId),schedule=repository.scheduleExists(leagueId,c.seasonId)?repository.loadSchedule(leagueId,c.seasonId):null,state=repository.loadPowerRankings(leagueId),simulationId=repository.loadSettings(leagueId).simulationId,week=require('./official-game').publishedThroughWeek(schedule),progression=repository.loadOffseason(leagueId)?.seasons[c.seasonId]?.receipts?.PROGRESSION;
  if(preseason&&!progression?.confirmedAt)return null;if(!preseason&&!week)return null;
  const targetSeasonId=preseason?String(Number(c.league.seasonNumber)+1):c.seasonId,key=preseason?'PRESEASON:'+progression.requestId:'W'+week;state.seasons[targetSeasonId] ||= {};if(state.seasons[targetSeasonId][key]&&!!state.seasons[targetSeasonId][key].testMode===!!simulationId)return state.seasons[targetSeasonId][key];
  const history=Object.values(state.seasons[targetSeasonId]).filter(s=>!!s.testMode===!!simulationId),previous=history.at(-1)?.teams||[],games=preseason?[]:require('./official-game').publishedRegularGames(submissions?.records()||[],{leagueId,seasonId:c.seasonId,schedule}).games;
  const snapshot=calculateRankings({teams:c.teams,players:repository.loadPlayers(leagueId),memberships:activeMemberships(repository.loadRosterMemberships(leagueId),c.seasonId),games,previous,preseason,seasonId:c.seasonId,key,now:now()});snapshot.testMode=!!simulationId;if(simulationId)snapshot.simulationId=simulationId;snapshot.seasonId=targetSeasonId;snapshot.sourceSeasonId=c.seasonId;state.seasons[targetSeasonId][key]=snapshot;repository.commitLeagueFiles({leagueId,files:[{name:'power-rankings.json',value:state},{name:'audit-log.json',value:[...repository.loadAuditLog(leagueId),{action:'power-rankings.created',timestamp:snapshot.createdAt,metadata:{seasonId:c.seasonId,key}}]}]});return snapshot;
 }
 function list(leagueId,{seasonId}={}){return Object.entries(repository.loadPowerRankings(leagueId).seasons).filter(([id])=>!seasonId||id===String(seasonId)).flatMap(([,records])=>Object.values(records)).filter(s=>!!s.testMode===!!repository.loadSettings(leagueId).simulationId).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));}
 return {process,list};
}
module.exports={calculateRankings,createPowerRankingsService,validateRankings};
