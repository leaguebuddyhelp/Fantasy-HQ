const {createHash}=require('crypto');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function analysisSources({leagueId,seasonId,simulationId,logs,teams,currentWeek,throughWeek=0,existing=[],allowNew=true}) {
 const results=[],teamNames=new Map(teams.map(t=>[t.teamId,t.teamName]));
 const keyFor=key=>'news-'+hash([leagueId,seasonId,key,simulationId||'live']).slice(0,24);
 function add(key,{week,category,storyline,playerIds=[],teamIds=[],headline,sentences,evidence,newsworthiness=78}) {
  const id=keyFor(key);if(!allowNew&&!existing.some(a=>a.id===id))return;
  const facts={type:'VERIFIED_EVENT',analysis:true,headline,sentences,evidence};
  results.push({id,seasonId,week,phase:'REGULAR_SEASON',category,storyline,playerIds,teamIds,sourceGameIds:[...new Set(evidence.map(log=>log.gameId))],facts,sourceDigest:hash(facts),newsworthiness});
 }
 const weeks=[...new Set([currentWeek,...existing.filter(a=>a.facts?.analysis).map(a=>a.week)])];
 for(const week of weeks) {
  const byPlayer=new Map();
  for(const log of logs.filter(l=>l.week<=week)){const list=byPlayer.get(log.playerId)||[];list.push(log);byPlayer.set(log.playerId,list);}
  for(const [playerId,all] of byPlayer) {
   const games=all.filter(l=>l.MIN>=10).sort((a,b)=>a.week-b.week||a.gameId.localeCompare(b.gameId));if(games.length<7)continue;
   const recent=games.slice(-3),previous=games.slice(-7,-3),average=rows=>rows.reduce((sum,r)=>sum+r.PTS,0)/rows.length,a=average(recent),b=average(previous);
   if(b<10||Math.abs(a-b)<5||Math.abs(a-b)/b<.3)continue;
   const rise=a>b,latest=recent.at(-1);if(!recent.every(l=>l.teamId===latest.teamId))continue;
   add(`trend:${week}:${playerId}`,{week,category:'Trends',storyline:rise?'Breakouts':'Struggles',playerIds:[playerId],teamIds:[latest.teamId],
    headline:latest.name+(rise?' lifts the scoring pace':' sees scoring cool off'),sentences:[`${latest.name} averaged ${a.toFixed(1)} points over the latest three verified games through week ${week}.`,
     `The preceding four appearances produced ${b.toFixed(1)} points per game.`,
     `That is a ${rise?'rise':'drop'} of ${Math.abs(a-b).toFixed(1)} points compared with that earlier four-game sample.`,
     `Each appearance in this comparison includes at least ten recorded minutes.`,
     `The latest three games were played for ${teamNames.get(latest.teamId)||latest.teamName}.`,
     `Seven finalized game logs support this comparison, without implying an injury or a change in coaching plans.`],evidence:[...previous,...recent]});
  }
  if(week>throughWeek||week<1)continue;
  const gameTeams=new Map();for(const log of logs.filter(l=>l.week===week))gameTeams.set(log.gameId+':'+log.teamId,{gameId:log.gameId,teamId:log.teamId,result:log.result,score:log.score});
  const byTeam=new Map();for(const log of gameTeams.values()){const list=byTeam.get(log.teamId)||[];list.push(log);byTeam.set(log.teamId,list);}
  const ranked=[...byTeam].map(([teamId,rows])=>({teamId,rows,differential:rows.reduce((sum,l)=>{const [a,b]=l.score.split('-').map(Number);return sum+a-b;},0)})).filter(t=>Number.isFinite(t.differential)).sort((a,b)=>b.differential-a.differential||a.teamId.localeCompare(b.teamId));
  if(!ranked.length)continue;const best=ranked[0],name=teamNames.get(best.teamId),wins=best.rows.filter(l=>l.result==='W').length;
  add(`weekly-analysis:${week}`,{week,category:'Weekly review',storyline:'Week in review',teamIds:ranked.slice(0,3).map(t=>t.teamId),newsworthiness:82,
   headline:`Week ${week}: ${name} leads the margin picture`,sentences:[`${name} finished the published week ${week} results with ${wins} win${wins===1?'':'s'} and ${best.rows.length-wins} loss${best.rows.length-wins===1?'':'es'}.`,
    `Its combined scoring margin was ${best.differential>0?'+':''}${best.differential} points across ${best.rows.length} verified game${best.rows.length===1?'':'s'}.`,
    `That was the largest aggregate point differential among teams with verified player box scores that week.`,
    `${ranked.length} teams have qualifying box-score data in this weekly comparison.`,
    `The analysis counts each team's game once, so a larger roster does not multiply its result.`,
    `Administrative results without player statistics are excluded from this scoring comparison, and the official standings retain those wins and losses.`],evidence:[...gameTeams.values()]});
 }
 return results;
}
module.exports={analysisSources};
