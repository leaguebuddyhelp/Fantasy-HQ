function createProgressionHistoryService({repository}){
 function list(leagueId,filters={}){
  const context=repository.loadLeague(leagueId),players=repository.loadPlayers(leagueId),byTeam=new Map(context.teams.map(t=>[t.teamId,t]));
  return players.flatMap(player=>(player.progressionHistory||[]).map(change=>({...change,playerId:player.playerId,playerName:player.name,player,teamName:change.teamName||byTeam.get(change.teamId)?.teamName||change.teamId})))
   .filter(change=>Object.entries(filters).every(([key,value])=>value==null||value===''||String(change[key])===String(value)))
   .sort((a,b)=>String(b.confirmedAt).localeCompare(String(a.confirmedAt))||a.playerId.localeCompare(b.playerId));
 }
 function summary(leagueId,filters={}){
  const all=list(leagueId),changes=list(leagueId,filters),byTeam=new Map();
  for(const c of changes){const t=byTeam.get(c.teamId)||{teamId:c.teamId,teamName:c.teamName,totalChange:0,players:0};t.totalChange+=c.change;t.players++;byTeam.set(c.teamId,t);}
  const rank=(sign)=>changes.filter(c=>sign*c.change>0).sort((a,b)=>sign*(b.change-a.change)||b.overall-a.overall||a.playerId.localeCompare(b.playerId)).slice(0,10);
  return {changes,risers:rank(1),fallers:rank(-1),teams:contextTeams(leagueId),seasons:[...new Set(all.map(c=>c.seasonId))],teamRankings:[...byTeam.values()].map(t=>({...t,averageChange:t.totalChange/t.players})).sort((a,b)=>b.averageChange-a.averageChange||a.teamId.localeCompare(b.teamId))};
 }
 const contextTeams=leagueId=>repository.loadLeague(leagueId).teams.map(t=>({teamId:t.teamId,teamName:t.teamName}));
 return {list,summary};
}
module.exports={createProgressionHistoryService};
