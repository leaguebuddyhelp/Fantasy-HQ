const { createHash, randomUUID } = require('crypto');
// NBA Play-In and Playoff Tie-Break Procedures: https://www.nba.com/standings
const DIVISIONS = {
 Atlantic: ['BOS','BKN','NYK','PHI','TOR'], Central: ['CHI','CLE','DET','IND','MIL'], Southeast: ['ATL','CHA','MIA','ORL','WAS'],
 Northwest: ['DEN','MIN','OKC','POR','UTA'], Pacific: ['GSW','LAC','LAL','PHX','SAC'], Southwest: ['DAL','HOU','MEM','NOP','SAS'],
};
function teamDivision(team) {
 if (typeof team.division === 'string' && team.division.trim()) { const division=team.division.trim().replace(/\s+division$/i,''); return Object.keys(DIVISIONS).find(name=>name.toLowerCase()===division.toLowerCase()) || division; }
 const metadata = Object.entries(require('./bootstrap').TEAM_METADATA || {});
 let code = String(team.abbreviation || '').toUpperCase();
 const aliases = {BRK:'BKN',CHO:'CHA',PHO:'PHX',NO:'NOP',UTAH:'UTA',WSH:'WAS'}; code=aliases[code]||code;
 if (!Object.values(DIVISIONS).some(codes=>codes.includes(code))) {
  const slug=String(team.teamName||team.teamId||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  code=metadata.find(([name])=>name===slug)?.[1].abbreviation;
 }
 return Object.entries(DIVISIONS).find(([,codes])=>codes.includes(code))?.[0] || null;
}
function compareRates(a,b) { return (a.W * (b.GP || 1)) - (b.W * (a.GP || 1)); }
function ensureStandingsDraw(repository, leagueId, seasonId) {
 const settings=repository.loadSettings(leagueId)||{};
 if(settings.standingsDrawSeeds?.[seasonId]) return settings.standingsDrawSeeds[seasonId];
 const seed=randomUUID();
 repository.saveSettings(leagueId,{...settings,standingsDrawSeeds:{...settings.standingsDrawSeeds,[seasonId]:seed}});
 repository.appendAuditLog(leagueId,{action:'standings.tiebreak.draw.created',userId:'system',seasonId:String(seasonId),timestamp:new Date().toISOString(),metadata:{seed}});
 return seed;
}
function postseasonEligibleTeams(rows) {
 const result=new Map();
 for(const c of ['East','West']) {
  const ordered=rows.filter(row=>row.conference===c).sort((a,b)=>-compareRates(a,b));
  const cutoff=ordered[Math.min(9,ordered.length-1)];
  result.set(c,new Set(ordered.filter(row=>!cutoff||compareRates(row,cutoff)>=0).map(row=>row.teamId)));
 }
 return result;
}
function rankStandings(rows, games, { drawSeed = null } = {}) {
 const unresolvedTies=[];
 function against(team,opponents) {
  let W=0,GP=0;
  for(const game of games){if(game.team1Id!==team.teamId&&game.team2Id!==team.teamId)continue;const other=game.team1Id===team.teamId?game.team2Id:game.team1Id;if(!opponents.has(other))continue;GP++;if(game.winnerTeamId===team.teamId)W++;}
  return {W,GP};
 }
 const conferenceTeams=new Map(['East','West'].map(c=>[c,rows.filter(row=>row.conference===c)]));
 const postseason=postseasonEligibleTeams(rows);
 const divisionWinners=new Set();
 function tie(group,scope,forDivision=false) {
  if(group.length<2)return group;
  if(group.every(row=>row.GP===0))return group.slice().sort((a,b)=>a.teamId.localeCompare(b.teamId));
  const sameDivision=group.every(row=>row.division&&row.division===group[0].division);
  const headIds=new Set(group.map(row=>row.teamId));
  const winnerMetric=()=>!forDivision&&group.every(row=>row.division)?group.map(row=>divisionWinners.has(row.teamId)?1:0):null;
  const headMetric=()=>group.map(row=>against(row,headIds));
  const divisionMetric=()=>sameDivision?group.map(row=>against(row,new Set(rows.filter(other=>other.division===row.division).map(other=>other.teamId)))):null;
  const conferenceMetric=()=>group.map(row=>against(row,new Set((conferenceTeams.get(row.conference)||[]).map(other=>other.teamId))));
  const ownPostseason=()=>group.map(row=>against(row,postseason.get(row.conference)||new Set()));
  const otherPostseason=()=>group.map(row=>against(row,postseason.get(row.conference==='East'?'West':'East')||new Set()));
  const criteria=group.length===2?[headMetric,winnerMetric,divisionMetric,conferenceMetric,ownPostseason,otherPostseason,()=>group.map(row=>row.DIFF)]
   :[winnerMetric,headMetric,divisionMetric,conferenceMetric,ownPostseason,()=>group.map(row=>row.DIFF)];
  for(const criterion of criteria){
   const metrics=criterion();if(!metrics)continue;
   const ratios=typeof metrics[0]==='object';
   // Missing matchup data is not a 0% record. Wait for an applicable criterion.
   if(ratios&&metrics.some(record=>!record.GP))continue;
   const compare=(a,b)=>ratios?compareRates(a,b):a-b;
   const ordered=group.map((row,i)=>({row,value:metrics[i]})).sort((a,b)=>-compare(a.value,b.value));
   const buckets=[];for(const entry of ordered){const last=buckets.at(-1);if(last&&compare(last[0].value,entry.value)===0)last.push(entry);else buckets.push([entry]);}
   if(buckets.length>1)return buckets.flatMap(bucket=>tie(bucket.map(entry=>entry.row),scope,forDivision));
  }
  if(drawSeed){const key=scope+':'+group.map(row=>row.teamId).sort().join(',');const score=row=>createHash('sha256').update(drawSeed+':'+key+':'+row.teamId).digest('hex');return group.slice().sort((a,b)=>score(a).localeCompare(score(b)));}
  unresolvedTies.push({scope,teamIds:group.map(row=>row.teamId).sort()});
  // A display order is provisional; playoff preparation records a random draw.
  return group.slice().sort((a,b)=>a.teamId.localeCompare(b.teamId));
 }
 function byRecord(teams,scope,forDivision=false){
  const ordered=teams.slice().sort((a,b)=>-compareRates(a,b));const result=[];
  for(let i=0;i<ordered.length;){const group=[ordered[i++]];while(i<ordered.length&&compareRates(group[0],ordered[i])===0)group.push(ordered[i++]);result.push(...tie(group,scope,forDivision));}
  return result;
 }
 for(const division of new Set(rows.map(row=>row.division).filter(Boolean))){const teams=rows.filter(row=>row.division===division);if(teams.some(row=>row.GP>0))divisionWinners.add(byRecord(teams,'division:'+division,true)[0].teamId);}
 const conferences=Object.fromEntries([...conferenceTeams].map(([c,teams])=>[c,byRecord(teams,'conference:'+c).map((row,i)=>({...row,rank:i+1,divisionWinner:divisionWinners.has(row.teamId)}))]));
 const pendingIds=new Set(unresolvedTies.flatMap(tie=>tie.teamIds));
 for(const teams of Object.values(conferences))for(const row of teams)if(pendingIds.has(row.teamId))row.tiebreakPending=true;
 return {conferences,unresolvedTies,tiebreakDrawRecorded:!!drawSeed};
}
module.exports={teamDivision,compareRates,postseasonEligibleTeams,rankStandings,ensureStandingsDraw};
