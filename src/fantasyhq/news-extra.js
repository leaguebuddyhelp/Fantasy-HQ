const phrase=require('./news-phrasing');
const money=cents=>'$'+(cents/100).toFixed(2);
function extraSources({repository,leagueId,context,players,teams,add}) {
 const seasonId=context.seasonId,lottery=repository.loadOffseason?.(leagueId)?.seasons?.[seasonId]?.receipts;
 // Draft: lottery winner and the first selections recorded from the confirmed draft report.
 const top=lottery?.LOTTERY?.order?.find(row=>row.pickNumber===1);
 if(top&&teams.has(top.currentOwnerTeamId)) {
  const team=teams.get(top.currentOwnerTeamId);
  add({key:'lottery:'+lottery.LOTTERY.requestId,category:'Draft',storyline:'Draft',teamIds:[top.currentOwnerTeamId],phase:'OFFSEASON',newsworthiness:88,
   headline:phrase.fill(phrase.pick(lottery.LOTTERY.requestId,'h',phrase.DRAFT_LOTTERY),{team}),
   sentences:[`${team} holds the No. 1 pick in the confirmed draft lottery results.`,`The order comes from the reviewed NBA 2K lottery report rather than a projection.`,`The first selection gives ${team} the first choice from the incoming draft class.`,`Other teams will draft in the order the report recorded.`,`The league keeps the confirmed order as the official draft record.`],
   evidence:{requestId:lottery.LOTTERY.requestId,pickNumber:1,teamId:top.currentOwnerTeamId},at:lottery.LOTTERY.confirmedAt});
 }
 const draft=lottery?.DRAFT;
 for(const playerId of (draft?.draftedPlayerIds||[]).slice(0,3)) {
  const player=players.get(playerId),team=teams.get(player?.teamId);if(!player||!team)continue;
  add({key:'draft:'+draft.requestId+':'+playerId,category:'Draft',storyline:'Draft',playerIds:[playerId],teamIds:[player.teamId],phase:'OFFSEASON',newsworthiness:86,
   headline:phrase.fill(phrase.pick(playerId+draft.requestId,'h',phrase.DRAFT_PICK),{team,name:player.name}),
   sentences:[`${team} selected ${player.name} in the confirmed draft results.`,`${player.name} is listed at ${player.position1||'an unlisted position'}${player.overall?` with a ${player.overall} overall`:''}.`,`The selection comes from the reviewed NBA 2K draft report.`,`${team} now adds the rookie to its roster picture.`,`The league keeps the draft report as the permanent record of the pick.`],
   evidence:{requestId:draft.requestId,playerId,teamId:player.teamId},at:draft.confirmedAt});
 }
 // Scouting: spotlight the top of the current draft board.
 if(context.league.currentPhase!=='REGULAR_SEASON') try {
  const board=require('./scouting-service').createScoutingService({repository}).boardForContext(context);
  for(const prospect of board.prospects.slice(0,3)) {
   const label=board.boardLabel||'Big Board';
   add({key:'scouting:'+seasonId+':'+label+':'+prospect.board_number,category:'Scouting',storyline:'Scouting',phase:context.league.currentPhase,newsworthiness:70-prospect.board_number,
    headline:phrase.fill(phrase.pick(seasonId+label+prospect.board_number,'h',phrase.SCOUT),{name:prospect.name}),
    sentences:[`${prospect.name}${prospect.position_1?`, a ${prospect.position_1}`:''}${prospect.team?` from ${prospect.team}`:''}, sits at No. ${prospect.board_number} on the ${label.toLowerCase()}.`,`The ranking comes from the league's own draft board.`,`Coaches can spend scouting points to reveal more about the prospect.`,`Rankings can change as the draft class is reviewed.`,`The full board is available in the league's scouting hub.`],
    evidence:{board:label,boardNumber:prospect.board_number,name:prospect.name},at:null});
  }
 } catch {}
 // Betting: biggest settled win per week and the career-profit leader.
 let book;try{book=repository.loadSportsbook(leagueId);}catch{return;}
 const owners=repository.loadOwners?.(leagueId)||[],nameOf=id=>owners.find(o=>o.userId===id)?.displayName||'A coach';
 const wins=book.bets.filter(b=>b.status==='WON'&&b.settlements.length&&!b.simulationId&&b.seasonId===seasonId);
 const byWeek=new Map();
 for(const bet of wins){const profit=bet.settlements.at(-1).returnCents-bet.stakeCents;if(profit<2000)continue;const week=bet.week||bet.legs[0]?.week||0;if(!byWeek.has(week)||profit>byWeek.get(week).profit)byWeek.set(week,{bet,profit});}
 for(const [week,{bet,profit}] of byWeek) {
  const user=nameOf(bet.userId),legs=bet.legs.length;
  add({key:'bet-win:'+seasonId+':'+week,category:'Betting',storyline:'Sportsbook',week:week||context.league.currentWeek,newsworthiness:72,
   headline:phrase.fill(phrase.pick(bet.id,'h',phrase.BETTING_WIN),{user}),
   sentences:[`${user} turned a ${money(bet.stakeCents)} ${legs>1?`${legs}-leg parlay`:'wager'} into a ${money(bet.settlements.at(-1).returnCents)} return.`,`That is a ${money(profit)} profit, the biggest settled win at the sportsbook this week.`,`All bets are placed with league dollars only.`,`Bets settle from verified box scores.`],
   evidence:{betId:bet.id,profitCents:profit},at:bet.placedAt});
 }
 const leader=Object.keys(book.wallets).map(userId=>({userId,profit:book.bets.filter(b=>b.userId===userId&&b.status!=='OPEN'&&b.settlements.length).reduce((n,b)=>n+b.settlements.at(-1).returnCents-b.stakeCents,0)})).sort((a,b)=>b.profit-a.profit||a.userId.localeCompare(b.userId))[0];
 const settledWeeks=[...byWeek.keys()].sort((a,b)=>a-b).at(-1);
 if(leader&&leader.profit>=3000&&settledWeeks) {
  const user=nameOf(leader.userId);
  add({key:'bet-leader:'+seasonId+':'+settledWeeks,category:'Betting',storyline:'Sportsbook',week:settledWeeks,newsworthiness:68,
   headline:phrase.fill(phrase.pick(leader.userId+settledWeeks,'h',phrase.BETTING_LEADER),{user}),
   sentences:[`${user} leads the sportsbook with ${money(leader.profit)} in profit.`,`The standing is calculated from every settled bet in the permanent ledger.`,`Only league dollars are involved.`,`Profit counts winnings minus stakes across all settled wagers.`,`The leaderboard updates as new games are verified.`],
   evidence:{userId:leader.userId,profitCents:leader.profit},at:null});
 }
}
module.exports={extraSources};
