const {randomUUID,createHash}=require('crypto');
const {requirePostseasonStaff}=require('./postseason-state');
const GROUPS={REGULAR_SEASON:['MVP','ROY','DPOY','6MOY','MIP'],CONFERENCE_FINALS:['EAST_MVP','WEST_MVP'],NBA_FINALS:['FINALS_MVP']};
const NAMES={MVP:'Most Valuable Player',ROY:'Rookie of the Year',DPOY:'Defensive Player of the Year','6MOY':'Sixth Man of the Year',MIP:'Most Improved Player',EAST_MVP:'Eastern Conference Finals MVP',WEST_MVP:'Western Conference Finals MVP',FINALS_MVP:'NBA Finals MVP'};
const pending=new Map();
function createAwardsService({repository,submissions,now=Date.now}) {
  function sourceDigest(leagueId) {
    const records=(submissions||require('./game-submissions').createGameSubmissionService({repository})).records();
    return createHash('sha256').update(JSON.stringify([repository.loadLeague(leagueId).league,repository.loadPlayers(leagueId),repository.loadOwners(leagueId),repository.loadRosterMemberships(leagueId),records.filter(r=>r.game.leagueId===leagueId).map(r=>[r.game.gameId,r.game.status,r.game.result,r.extractions,r.playerGameStats,r.teamGameStats])])).digest('hex');
  }
  function context(leagueId,actor) {const c=repository.loadLeague(leagueId);requirePostseasonStaff(c,actor);return c;}
  function search(leagueId,actor,query) {
    const c=context(leagueId,actor),players=repository.loadPlayers(leagueId),members=repository.loadRosterMemberships(leagueId);
    const exact=players.filter(p=>require('./service-helpers').normalizeText(p.name).includes(require('./service-helpers').normalizeText(query)));
    const fuzzy=require('./box-score/normalize').playerCandidates(query,players);
    return [...new Map([...exact,...fuzzy].map(p=>[p.playerId,p])).values()].slice(0,25).map(p=>({...p,teamId:members.find(m=>m.playerId===p.playerId&&String(m.seasonId)===c.seasonId&&m.active!==false&&!m.endedAt)?.teamId||p.teamId,teamName:c.teams.find(t=>t.teamId===(members.find(m=>m.playerId===p.playerId&&String(m.seasonId)===c.seasonId&&m.active!==false&&!m.endedAt)?.teamId||p.teamId))?.teamName||'Free Agent'}));
  }
  function prepare(leagueId,actor,group,winners,reason=null) {
    const c=context(leagueId,actor),keys=GROUPS[group];if(!keys)throw Error('Unknown award group.');
    if(c.league.regularSeasonStatus!=='COMPLETED')throw Error('Complete the regular season before entering awards.');
    if(group!=='REGULAR_SEASON') {let state=repository.loadPlayoffs(leagueId,c.seasonId);if(state?.version===2)state=require('./postseason-service').recalculate(state,(submissions||require('./game-submissions').createGameSubmissionService({repository})).records());if(state?.conflicts?.length)throw Error('Resolve postseason correction conflicts before entering awards.');const stage=group==='CONFERENCE_FINALS'?'CONFERENCE_FINALS':'NBA_FINALS';const series=state?.series?.filter(s=>s.stage===stage);if(!series?.length||series.some(s=>!s.winnerTeamId))throw Error('Finish the required playoff series before entering these awards.');}
    if(!winners||keys.some(key=>!winners[key])||Object.keys(winners).some(key=>!keys.includes(key)))throw Error('Select every required award winner.');
    const awards=repository.loadAwards(leagueId),previous=awards.seasons[c.seasonId]?.[group];
    if(previous&&String(reason||'').trim().length<5)throw Error('Awards already confirmed. Supply a correction reason.');
    const players=repository.loadPlayers(leagueId),members=repository.loadRosterMemberships(leagueId),owners=repository.loadOwners(leagueId);
    const scope=group==='REGULAR_SEASON'?'REGULAR_SEASON':'PLAYOFFS';
    const statsService=require('./player-stats-service').createPlayerStatsService({repository,submissions,scope});
    const selected=keys.map(key=>{
      const player=players.find(p=>p.playerId===winners[key]);if(!player)throw Error('Select a stored permanent player ID.');
      const teamId=members.find(m=>m.playerId===player.playerId&&String(m.seasonId)===c.seasonId&&m.active!==false&&!m.endedAt)?.teamId||player.teamId||null;
      if(key==='EAST_MVP'||key==='WEST_MVP') {const conference=key==='EAST_MVP'?'East':'West';if(!c.teams.some(t=>t.teamId===teamId&&t.conference===conference))throw Error('Conference MVP must belong to that conference.');}
      return {key,awardName:NAMES[key],playerId:player.playerId,playerName:player.name,player:structuredClone(player),teamId,teamName:c.teams.find(t=>t.teamId===teamId)?.teamName||'Free Agent',coachUserId:owners.find(o=>o.teamId===teamId)?.userId||null,stats:statsService.getPlayerSeasonStats(leagueId,c.seasonId,player.playerId),scope};
    });
    const token=randomUUID(),digest=createHash('sha256').update(JSON.stringify(previous||null)).digest('hex');pending.set(token,{leagueId,seasonId:c.seasonId,group,selected,reason,actorId:actor.id,digest,sourceDigest:sourceDigest(leagueId),root:repository.dataRoot,expiresAt:now()+300000});return {token,group,selected,seasonId:c.seasonId};
  }
  function confirm(leagueId,actor,token) {
    const c=context(leagueId,actor),awards=repository.loadAwards(leagueId);
    for(const season of Object.values(awards.seasons))for(const record of Object.values(season))if(record.token===token){if(record.confirmedBy!==actor.id)throw Error('Confirmation belongs to another Staff member.');return record;}
    const p=pending.get(token),previous=awards.seasons[c.seasonId]?.[p?.group];
    if(!p||p.leagueId!==leagueId||p.actorId!==actor.id||p.seasonId!==c.seasonId||p.root!==repository.dataRoot||p.expiresAt<now()||p.sourceDigest!==sourceDigest(leagueId)||createHash('sha256').update(JSON.stringify(previous||null)).digest('hex')!==p.digest)throw Error('Award confirmation expired or changed. Review again.');
    const record={...(repository.loadSettings(leagueId)?.simulationId?{testMode:true,simulationId:repository.loadSettings(leagueId).simulationId}:{}),token,group:p.group,seasonId:c.seasonId,seasonNumber:c.league.seasonNumber,winners:p.selected,confirmedBy:actor.id,confirmedAt:new Date(now()).toISOString(),revision:(previous?.revision||0)+1,history:[...(previous?.history||[]),...(previous?[{...previous,history:undefined,correctionReason:p.reason}]:[])],publication:previous?.publication||null};
    awards.seasons[c.seasonId]||={};awards.seasons[c.seasonId][p.group]=record;
    repository.commitAwards({leagueId,awards,auditEntry:{action:previous?'awards.corrected':'awards.confirmed',userId:actor.id,seasonId:c.seasonId,timestamp:record.confirmedAt,metadata:{group:p.group,winners:p.selected.map(w=>({key:w.key,playerId:w.playerId})),reason:p.reason},requestId:token}});pending.delete(token);return record;
  }
  function delivery(leagueId,seasonId,group,messageId,revision) {
    const awards=repository.loadAwards(leagueId),record=awards.seasons[seasonId]?.[group];if(!record||record.revision!==revision)throw Error('Award publication changed. Retry the latest batch.');
    record.publication={messageId,revision,deliveredAt:new Date(now()).toISOString()};repository.commitAwards({leagueId,awards,auditEntry:{action:'awards.published',seasonId,timestamp:new Date(now()).toISOString(),metadata:{group,messageId,revision}}});return record;
  }
  return {search,prepare,confirm,delivery};
}
module.exports={createAwardsService,GROUPS,NAMES};
