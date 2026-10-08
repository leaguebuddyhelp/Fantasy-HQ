const {createHash}=require('crypto');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function verifiedEventSources(repository,leagueId) {
 const context=repository.loadLeague(leagueId),seasonId=context.seasonId,simulationId=repository.loadSettings(leagueId).simulationId||null;
 const players=new Map(repository.loadPlayers(leagueId).map(p=>[p.playerId,p]));
 const teams=new Map(context.teams.map(t=>[t.teamId,t.teamName]));
 const stories=[];
 function add({key,category,storyline,playerIds=[],teamIds=[],week=context.league.currentWeek,phase=context.league.currentPhase,newsworthiness=80,headline,sentences,evidence,at}) {
  const facts={type:'VERIFIED_EVENT',headline,sentences,evidence,at};
  stories.push({id:'news-'+digest([leagueId,seasonId,key,simulationId||'live']).slice(0,24),seasonId,week,phase,category,storyline,
   playerIds,teamIds,sourceGameIds:[],newsworthiness,facts,sourceDigest:digest(facts)});
 }
 for(const trade of repository.loadTrades(leagueId).filter(t=>t.seasonId===seasonId&&t.status==='COMPLETED'
  &&t.currentVersion?.proof?.staffDecision?.decision==='APPROVED'&&t.currentVersion?.processing?.processedAt)) {
  const transfers=trade.currentVersion.transfers;
  if(!transfers?.length||transfers.some(t=>!teams.has(t.fromTeamId)||!teams.has(t.toTeamId)))continue;
  const playerMoves=transfers.filter(t=>t.assetType==='PLAYER'),pickMoves=transfers.filter(t=>t.assetType==='PICK');
  const participating=[...new Set(transfers.flatMap(t=>[t.fromTeamId,t.toTeamId]))],names=participating.map(id=>teams.get(id));
  const sentences=[`${names.join(' and ')} completed a trade after the league approved its execution proof.`,
   ...playerMoves.slice(0,2).map(move=>`${move.playerName||players.get(move.assetId)?.name||'The recorded player'} moves from ${teams.get(move.fromTeamId)} to ${teams.get(move.toTeamId)}.`),
   `The confirmed package contains ${playerMoves.length} player${playerMoves.length===1?'':'s'} and ${pickMoves.length} draft pick${pickMoves.length===1?'':'s'}.`,
   playerMoves.length?'The player moves change the personnel available to the participating rosters.':'The pick transfers change who controls the selections included in this deal.',
   `The league trade record identifies each asset and its receiving team.`,
   `The transaction is complete, giving these franchises a new roster or draft-asset mix to work with.`].slice(0,8);
  add({key:'trade:'+trade.tradeId,category:'Trades',storyline:'Roster moves',playerIds:playerMoves.map(t=>t.assetId),teamIds:participating,
   headline:names.join(' and ')+' make their deal official',sentences,evidence:{tradeId:trade.tradeId,transfers,processingId:trade.processingId},at:trade.completedAt});
 }
 const fa=repository.loadFreeAgencyState(leagueId),regular=(fa.windows||[]).filter(w=>w.seasonId===seasonId&&w.status==='COMPLETED')
  .map(w=>({...fa.offers.find(o=>o.id===w.winnerOfferId&&o.status==='WON'),at:w.resolvedAt,offseason:false})),offseason=(fa.offseason?.[seasonId]?.offers||[])
  .filter(o=>o.status==='WON'&&o.approvedBy&&o.approvedAt).map(o=>({...o,at:o.approvedAt,offseason:true}));
 for(const offer of [...regular,...offseason]) {
  const player=players.get(offer.playerId),teamName=teams.get(offer.teamId),years=offer.contract?.seasons;
  if(!player||!teamName||!years?.length)continue;
  const salary=years[0].salary;if(!Number.isFinite(salary))continue;
  const total=years.reduce((sum,year)=>sum+year.salary,0);
  add({key:'signing:'+offer.id,category:'Free agency',storyline:'Roster moves',playerIds:[player.playerId],teamIds:[offer.teamId],
   headline:teamName+' brings '+player.name+' into the fold',sentences:[`${teamName} completed the signing of ${player.name}.`,
    `The approved contract covers ${years.length} season${years.length===1?'':'s'}, including any recorded option year.`,
    `Its first-season salary is $${(salary/1e6).toFixed(2)} million, with $${(total/1e6).toFixed(2)} million across the recorded salary schedule.`,
    `${player.name} gives the franchise another player to build its rotation around.`,
    `The completed league transaction records the player, team and agreed contract terms.`,
    `Roster and contract history preserve the signing as the franchise moves forward.`],evidence:{offerId:offer.id,teamId:offer.teamId,playerId:offer.playerId,contract:offer.contract},at:offer.at,
   phase:offer.offseason?'FREE_AGENCY':'REGULAR_SEASON'});
 }
 const champions=repository.loadChampionships(leagueId).seasons?.[seasonId],champion=champions&&teams.get(champions.teamId);
 if(champion&&players.has(champions.finalsMvpPlayerId)) {
  const mvp=players.get(champions.finalsMvpPlayerId),runner=teams.get(champions.runnerUpTeamId);
  add({key:'championship',category:'Championships',storyline:'Franchise history',playerIds:[mvp.playerId],teamIds:[champions.teamId,champions.runnerUpTeamId].filter(Boolean),phase:'PLAYOFFS',newsworthiness:99,
   headline:champion+' finishes the season on top',sentences:[`${champion} is the league champion following the confirmed NBA Finals result.`,
    runner?`${runner} finished as the recorded Finals runner-up.`:'The completed playoff bracket records the championship matchup.',
    `${mvp.name} received Finals MVP through the league’s official awards system.`,
    `The championship and MVP were finalized before this report was drafted.`,
    `The completed title becomes part of the franchise’s permanent league history.`,
    `The next offseason begins with ${champion} holding the league’s championship.`],evidence:champions,at:champions.finalizedAt});
 }
 const progression=repository.loadOffseason(leagueId)?.seasons?.[seasonId]?.receipts?.PROGRESSION;
 if(progression?.changes?.length) {
  const changes=progression.changes.filter(change=>Number.isInteger(change.change)&&change.change!==0&&players.has(change.playerId));
  for(const row of [...changes].sort((a,b)=>Math.abs(b.change)-Math.abs(a.change)||a.playerId.localeCompare(b.playerId)).slice(0,2)) {
   if(Math.abs(row.change)<3)continue;
   const player=players.get(row.playerId),teamName=row.teamName||teams.get(row.teamId);
   add({key:'progression:'+progression.requestId+':'+row.playerId,category:'Player progression',storyline:row.change>0?'Breakouts':'Struggles',playerIds:[row.playerId],teamIds:[row.teamId],phase:'OFFSEASON',newsworthiness:85,
    headline:player.name+(row.change>0?' takes a step forward':' faces a new rating reality'),sentences:[`${player.name} moved from ${row.previousOverall} to ${row.overall} OVR in the verified progression report.`,
     `The recorded change is ${row.change>0?'an increase':'a decrease'} of ${Math.abs(row.change)} rating points.`,
     `${teamName} was the player’s team when progression was confirmed.`,
     `The change comes from the reviewed NBA 2K progression table rather than an estimated development projection.`,
     `A ${row.change>0?'higher':'lower'} rating changes the roster-strength picture heading into the next season.`,
     `The player’s progression history retains both ratings and the verified change.`],evidence:row,at:progression.confirmedAt});
  }
 }
 return stories;
}
module.exports={verifiedEventSources};
