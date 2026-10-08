function createStreamsService({repository,submissions}) {
 function analysis(leagueId,seasonId,records=submissions.records()) {
  const c=repository.loadLeague(leagueId,seasonId),schedule=repository.scheduleExists(leagueId,seasonId)?repository.loadSchedule(leagueId,seasonId):null;
  const players=repository.loadPlayers(leagueId),members=require('./service-helpers').activeMemberships(repository.loadRosterMemberships(leagueId),seasonId);
  const games=require('./official-game').publishedRegularGames(records,{leagueId,seasonId,schedule}).games;
  const ranks=require('./power-rankings').calculateRankings({teams:c.teams,players,memberships:members,games,seasonId,key:'STREAM_PREVIEW',preseason:!games.length});
  const stats=require('./player-stats-service').createPlayerStatsService({repository,submissions:{records:()=>records},publishedOnly:true}).getSeasonPlayerStats(leagueId,seasonId);
  return {context:c,ranks,stats,hasPublishedGames:games.length>0};
 }
 function facts(game,shared=analysis(game.leagueId,game.seasonId)) {
  const {context:c,ranks,stats,hasPublishedGames}=shared,rows=ranks.teams.filter(t=>[game.team1Id,game.team2Id].includes(t.teamId)),watch=[];
  for(const teamId of [game.team1Id,game.team2Id]) {
   const eligible=stats.filter(p=>p.teamId===teamId&&p.GP>0).sort((a,b)=>(b.PPG+b.RPG+b.APG)-(a.PPG+a.RPG+a.APG)||a.playerId.localeCompare(b.playerId));
   for(const p of eligible.slice(0,2))watch.push({playerId:p.playerId,name:p.name,teamId,teamName:c.teams.find(t=>t.teamId===teamId)?.teamName,
    PPG:p.PPG,RPG:p.RPG,APG:p.APG,SPG:p.SPG,BPG:p.BPG,threePointPercent:p.threePPercent??null});
  }
  const ordered=[...rows].sort((a,b)=>b.score-a.score||a.teamId.localeCompare(b.teamId)),winner=ordered[0];
  const a=rows.find(t=>t.teamId===game.team1Id),b=rows.find(t=>t.teamId===game.team2Id),difference=ordered.length===2?ordered[0].score-ordered[1].score:0;
  const breakdown=[`${a?.teamName||game.team1Name} enters with a ${a?.wins||0}-${a?.losses||0} published record, while ${b?.teamName||game.team2Name} is ${b?.wins||0}-${b?.losses||0}.`,
   hasPublishedGames?'The preview weighs approved results, recent form, roster strength and the opponents already faced.':'With no published regular-season results yet, roster strength, star talent and depth provide the preseason context.',
   watch.length?`${watch[0].name} is a player to watch at ${watch[0].PPG.toFixed(1)} points, ${watch[0].RPG.toFixed(1)} rebounds and ${watch[0].APG.toFixed(1)} assists per approved game.`:'Players-to-watch statistics will appear after verified league games are published.'].join(' ');
  return {createdAt:new Date().toISOString(),teams:rows,playersToWatch:watch,breakdown,prediction:winner?{teamId:winner.teamId,teamName:winner.teamName,
   reason:difference>0?`${winner.teamName} leads the independent performance and roster model. This is an analytical pick, without a betting probability.`:'The model is evenly matched; this is a low-confidence pick.'}:null};
 }
 function list(leagueId,{gameId=null,seasonId=null}={}) {
  const players=new Map(repository.loadPlayers(leagueId).map(p=>[p.playerId,p])),simulationId=repository.loadSettings(leagueId).simulationId||null,records=submissions.records(),snapshots=new Map();
  return records.filter(r=>r.game.leagueId===leagueId&&(!gameId||r.game.gameId===gameId)&&(!seasonId||r.game.seasonId===seasonId)&&r.game.streamlink?.url
   &&(simulationId?r.game.simulationId===simulationId:!r.game.simulationId)).map(r=>{
    let preview=r.game.streamAnnouncement?.facts;
    if(!preview){if(!snapshots.has(r.game.seasonId))snapshots.set(r.game.seasonId,analysis(leagueId,r.game.seasonId,records));preview=facts(r.game,snapshots.get(r.game.seasonId));}
    return {gameId:r.game.gameId,seasonId:r.game.seasonId,week:r.game.weekNumber,team1Id:r.game.team1Id,team2Id:r.game.team2Id,team1Name:r.game.team1Name,team2Name:r.game.team2Name,status:r.game.status,
     inGameDate:r.game.inGameDate,url:r.game.streamlink.url,marketLocked:!!(r.game.sportsbookLockedAt||r.game.streamlink?.url),lockedAt:r.game.sportsbookLockedAt||r.game.streamlink.submittedAt,
     result:r.game.status==='FINAL'?r.game.result:null,preview:{...preview,playersToWatch:preview.playersToWatch.map(p=>({...p,player:players.get(p.playerId)||null}))}};
   }).sort((a,b)=>Number(b.status!=='FINAL')-Number(a.status!=='FINAL')||String(b.seasonId).localeCompare(String(a.seasonId),undefined,{numeric:true})||b.week-a.week||a.gameId.localeCompare(b.gameId));
 }
 return {analysis,facts,list};
}
module.exports={createStreamsService};
