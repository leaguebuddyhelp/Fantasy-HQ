const {createHash}=require('crypto');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const phrase=require('./news-phrasing');
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
  const sentences=[phrase.fill(phrase.pick(trade.tradeId,'o',phrase.TRADE_OPENERS),{teams:names.join(' and ')}),
   ...playerMoves.slice(0,2).map(move=>`${move.playerName||players.get(move.assetId)?.name||'The recorded player'} moves from ${teams.get(move.fromTeamId)} to ${teams.get(move.toTeamId)}.`),
   `The confirmed package contains ${playerMoves.length} player${playerMoves.length===1?'':'s'} and ${pickMoves.length} draft pick${pickMoves.length===1?'':'s'}.`,
   playerMoves.length?'The player moves change the personnel available to the participating rosters.':'The pick transfers change who controls the selections included in this deal.',
   `The league trade record identifies each asset and its receiving team.`,
   `The transaction is complete, giving these franchises a new roster or draft-asset mix to work with.`].slice(0,8);
  add({key:'trade:'+trade.tradeId,category:'Trades',storyline:'Roster moves',playerIds:playerMoves.map(t=>t.assetId),teamIds:participating,
   headline:phrase.fill(phrase.pick(trade.tradeId,'h',phrase.TRADE_HEADLINES),{teams:names.join(' and ')}),sentences,evidence:{tradeId:trade.tradeId,transfers,processingId:trade.processingId},at:trade.completedAt});
 }
 for(const event of (repository.loadRosterPhotoEvents?.(leagueId)||[]).filter(e=>e.seasonId===seasonId&&e.verifiedBy&&e.verifiedAt)) {
  const player=players.get(event.playerId),teamName=teams.get(event.teamId);if(!player||!teamName)continue;
  const signing=event.type==='SIGN';if(!signing&&event.type!=='WAIVE')continue;
  const terms=signing?[event.reportedYears?`${event.reportedYears} years`:null,event.reportedTotal?`$${(event.reportedTotal/1e6).toFixed(2)} million total`:null].filter(Boolean).join(' and '):'';
  add({key:'roster-report:'+event.key,category:'Free agency',storyline:'Roster moves',playerIds:[event.playerId],teamIds:[event.teamId],
   headline:phrase.fill(phrase.pick(event.key,'h',signing?phrase.SIGN_HEADLINES:phrase.WAIVE_HEADLINES),{team:teamName,name:player.name}),
   sentences:[`${teamName} ${signing?'signed':'waived'} ${player.name} according to its NBA 2K Transaction Report.`,
    `The report records the transaction on ${event.date}.`,
    terms?`The reported contract covers ${terms}.`:'The reviewed report verifies the roster move.',
    'Staff reviewed the player and team matches before saving the report.',
    'The league retains the original report photo and a record of the reviewed changes.',
    'The app records completed transactions from NBA 2K; annual salary details are included only when separately verified.'],
   evidence:{eventKey:event.key,batchId:event.batchId,playerId:event.playerId,teamId:event.teamId,type:event.type,date:event.date,reportedYears:event.reportedYears,reportedTotal:event.reportedTotal},at:event.verifiedAt});
 }
 const champions=repository.loadChampionships(leagueId).seasons?.[seasonId],champion=champions&&teams.get(champions.teamId);
 if(champion&&players.has(champions.finalsMvpPlayerId)) {
  const mvp=players.get(champions.finalsMvpPlayerId),runner=teams.get(champions.runnerUpTeamId);
  add({key:'championship',category:'Championships',storyline:'Franchise history',playerIds:[mvp.playerId],teamIds:[champions.teamId,champions.runnerUpTeamId].filter(Boolean),phase:'PLAYOFFS',newsworthiness:99,
   headline:phrase.fill(phrase.pick(seasonId,'h',phrase.CHAMPION_HEADLINES),{team:champion}),sentences:[`${champion} is the league champion following the confirmed NBA Finals result.`,
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
    headline:phrase.fill(phrase.pick(row.playerId+progression.requestId,'h',row.change>0?phrase.PROGRESSION_UP:phrase.PROGRESSION_DOWN),{name:player.name}),sentences:[`${player.name} moved from ${row.previousOverall} to ${row.overall} OVR in the verified progression report.`,
     `The recorded change is ${row.change>0?'an increase':'a decrease'} of ${Math.abs(row.change)} rating points.`,
     `${teamName} was the player’s team when progression was confirmed.`,
     `The change comes from the reviewed NBA 2K progression table rather than an estimated development projection.`,
     `A ${row.change>0?'higher':'lower'} rating changes the roster-strength picture heading into the next season.`,
     `The player’s progression history retains both ratings and the verified change.`],evidence:row,at:progression.confirmedAt});
  }
 }
 try{require('./news-extra').extraSources({repository,leagueId,context,players,teams,add});}catch(error){console.error('Extra news sources:',error.message);}
 return stories;
}
module.exports={verifiedEventSources};
