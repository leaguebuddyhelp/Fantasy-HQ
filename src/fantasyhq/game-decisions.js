const {requireLeagueStaff,canManageLeague}=require('./discord-permissions');
function cpuState(repository,game){
 const settings=repository.loadSettings(game.leagueId)||{},owners=repository.loadOwners(game.leagueId);
 const testMode=settings.testMode===true || (settings.testMode==null&&settings.requireAllOwners===false);
 const cpuTeamIds=testMode?[]:[game.team1Id,game.team2Id].filter(id=>!owners.some(o=>o.teamId===id));
 return {testMode,cpuTeamIds,matchupType:testMode?'TEST':cpuTeamIds.length===2?'CPU_VS_CPU':cpuTeamIds.length===1?'HUMAN_VS_CPU':'HUMAN_VS_HUMAN'};
}
function createGameDecisionService(submissions){
 async function handle(i){
  await i.deferReply({flags:64});
  try{
   const [,action,gameId,winner]=i.customId.split(':');
   const record=submissions.load(gameId),g=record.game;
   if(i.guildId!==g.guildId||i.channelId!==g.discordThreadId||i.channel?.type!==12)throw Error('Use this game’s private thread.');
   const staff=canManageLeague(i),owners=submissions.repository.loadOwners(g.leagueId),owned=[g.team1Id,g.team2Id].filter(id=>owners.some(o=>o.teamId===id&&o.userId===i.user.id));
   if(!staff&&owned.length!==1)throw Error('Only a matchup coach or league staff can use this action.');
   if(!g.inGameDate)throw Error('Set the NBA 2K game date in the matchup message first.');
   if(action==='cpu'){
    const state=cpuState(submissions.repository,g);
    await i.editReply(state.testMode?'Test matchup: unowned teams are not automatically marked CPU. Staff Submit can collect both screenshots.':`${state.matchupType.replaceAll('_',' ')}. Staff Submit accepts both screenshots; validated box scores determine the result.`);return;
   }
   if(!['fair','forfeit'].includes(action))throw Error('Unknown matchup action.');
   await submissions.mutate(gameId,r=>{
    if(r.game.finalizedAt||r.game.locked||r.game.status==='FINAL')throw Error('This game is final.');
    r.game.decisionHistory ||= [];
    const at=new Date().toISOString();let decision;
    if(action==='fair'){
     const previous=r.game.matchupDecision;
     const approvals=new Set(previous?.type==='FAIR_SIM'?previous.approvals:[]);
     if(!staff)approvals.add(owned[0]);
     decision={type:'FAIR_SIM',approvals:[...approvals],confirmed:staff||[g.team1Id,g.team2Id].every(id=>approvals.has(id)),by:i.user.id,at};
    }else{
     if(![g.team1Id,g.team2Id].includes(winner))throw Error('Unknown winning team.');
     if(!staff&&owned[0]===winner)throw Error('Choose the opposing team to concede; you cannot award yourself a win.');
     decision={type:'FORFEIT',winnerTeamId:winner,confirmed:true,by:i.user.id,at};
    }
    r.game.matchupDecision=decision;r.game.decisionHistory.push(decision);
   });
   const fresh=submissions.load(gameId);
   if(fresh.game.discordMessageId){try{const message=await i.channel.messages.fetch(fresh.game.discordMessageId);await message.edit(require('./discord-game-submissions').gamePayload(fresh.game,require('./game-activity').activityView(fresh)));}catch(error){await i.editReply('Decision saved; matchup card refresh failed. Run /games create to refresh it.');return;}}
   await i.editReply(`${fresh.game.matchupDecision.confirmed?'Decision recorded.':'Fair Sim requested; the other coach must also confirm.'} Scores, player stats and standings still require validated screenshots.`);
  }catch(error){await i.editReply(error.message);}
 }
 return {handle};
}
module.exports={cpuState,createGameDecisionService};
