const {requireLeagueStaff,canManageLeague}=require('./discord-permissions');
function cpuState(repository,game){
 const settings=repository.loadSettings(game.leagueId)||{},owners=repository.loadOwners(game.leagueId);
 const testMode=require('./simulation-guard').isSimulationRepository(repository,game.leagueId);
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
   if (g.seriesId && action==='forfeit' && staff) {
    const manager=require('./discord-postseason').createDiscordPostseason({submissions});
    const p=manager.service.prepareGameForfeit(g.leagueId,{id:i.user.id,staffAuthorized:true},gameId,winner,'Staff-confirmed postseason game forfeit');
    const {ActionRowBuilder,ButtonBuilder,ButtonStyle}=require('discord.js');
    await i.editReply({content:`Confirm game forfeit to ${winner}? No player statistics will be recorded.`,components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('post:game-forfeit-confirm:'+p.token).setLabel('Confirm Game Forfeit').setStyle(ButtonStyle.Danger))]});return;
   }
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
    if (action === 'forfeit' && staff) require('./administrative-results').recordForfeit(r, { winnerTeamId: winner, actorUserId: i.user.id, staffAuthorized: true });
   });
   const fresh=submissions.load(gameId);
   if(fresh.game.discordMessageId){try{const message=await i.channel.messages.fetch(fresh.game.discordMessageId);await message.edit(require('./discord-game-submissions').gamePayload(fresh.game,require('./game-activity').activityView(fresh)));}catch(error){await i.editReply('Decision saved; matchup card refresh failed. Run /games create to refresh it.');return;}}
   if (fresh.game.result?.type === 'FORFEIT') { await i.editReply('Staff-approved forfeit recorded: win/loss only; no player stats or scoring averages.'); return; }
   await i.editReply(`${fresh.game.matchupDecision.confirmed?'Decision recorded.':'Fair Sim requested; the other coach must also confirm.'} Scores, player stats and standings still require validated screenshots.`);
  }catch(error){await i.editReply(error.message);}
 }
 return {handle};
}
module.exports={cpuState,createGameDecisionService};
