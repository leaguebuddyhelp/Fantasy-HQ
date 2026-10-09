const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { generateSchedule } = require('../src/fantasyhq/schedule-generator');
const { createLeagueService } = require('../src/fantasyhq/league-service');
const { createGameSubmissionService } = require('../src/fantasyhq/game-submissions');
const { createWeeklyDashboardService } = require('../src/fantasyhq/weekly-dashboard-service');
const { createDiscordWeeklyDashboard, staffPayload, coachPayload } = require('../src/fantasyhq/discord-weekly-dashboard');
const { createWeekAdvancementService } = require('../src/fantasyhq/week-advancement');
function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lb-weekly-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repository=createFantasyHQRepository({dataRoot:root});
 const teams=['East','West'].flatMap(c=>Array.from({length:15},(_,i)=>({teamId:`${c}-${i}`,teamName:`${c} Team ${i}`,abbreviation:`${c[0]}${i}`,conference:c})));
 repository.saveLeague('l',{leagueName:'Weekly league',currentSeasonId:'1',currentPhase:'PRESEASON'});repository.saveTeams('l',teams);repository.saveGuildLeagueBinding('g',{leagueId:'l',seasonId:'1'});
 repository.saveSchedule(generateSchedule({leagueId:'l',seasonId:'1',teams}));createLeagueService({repository}).startRegularSeason({leagueId:'l',seasonId:'1',validator:()=>({ready:true})});
 const week=repository.loadSchedule('l','1').weeks[0], a=week.games[0], b=week.games[1];
 repository.saveOwners('l',[{teamId:a.team1Id,userId:'coach-a'},{teamId:b.team1Id,userId:'coach-b'},{teamId:b.team2Id,userId:'coach-c'}]);
 fs.writeFileSync(path.join(repository.buildLeaguePaths(root,'l').leagueRoot,'role-ownership.json'),JSON.stringify({roleIds:{[a.team1Id]:'role-a',[b.team1Id]:'role-b',[b.team2Id]:'role-c'}}));
 repository.saveSettings('l',{testMode:true,freeAgencyTestWindowSeconds:60,discordChannels:{staff:'staff',submitTrade:'trade',freeAgency:'fa',tradeCommittee:'committee'}});
 const submissions=createGameSubmissionService({repository}), service=createWeeklyDashboardService({repository,submissions,now:()=>Date.parse('2026-10-07T12:00:00Z')});
 const weekService=createWeekAdvancementService({submissions,threads:{create:async()=>({created:14})}});
 const sent=[],edits=[],messages=new Map();let unsafe=false;
 const roles=new Map([['g',{id:'g',name:'@everyone'}],['staff-role',{id:'staff-role',name:'LEAGUEbuddy Commish'}],['coach-role',{id:'coach-role',name:'LEAGUEbuddy Coach'}],['bot-role',{id:'bot-role',name:'Bot'}]]);
 const channel={id:'staff',isTextBased:()=>true,permissionsFor:role=>({has:()=>role?.id==='staff-role'||role?.id==='bot-role'||unsafe&&role?.id==='coach-role'}),
  messages:{fetch:async arg=>{if(typeof arg!=='string')return messages;if(messages.has(arg))return messages.get(arg);throw Object.assign(Error('Unknown message'),{code:10008});}},
  send:async payload=>{sent.push(payload);const message={id:`message-${sent.length}`,author:{id:'bot'},embeds:payload.embeds.map(e=>e.toJSON()),edit:async p=>{edits.push(p);message.embeds=p.embeds.map(e=>e.toJSON());return message;}};messages.set(message.id,message);return message;}};
 const guild={id:'g',members:{me:{id:'bot',roles:{botRole:{id:'bot-role'}}}},roles:{everyone:roles.get('g'),fetch:async()=>roles},channels:{fetch:async()=>channel}};
 const discord=()=>createDiscordWeeklyDashboard({repository,service,weekService});
 async function bind(match=a){return submissions.bind({guildId:'g',weekNumber:1,teamQuery:match.team1Id,privateThread:true,discordThreadId:`thread-${match.team1Id}`}).game;}
 async function final(game){await submissions.mutate(game.gameId,r=>{r.submissions=[{submissionId:'s',status:'FINAL'}];r.extractions=[{extractionId:'e',submissionId:'s',status:'READY_FOR_REVIEW',issues:[]}];Object.assign(r.game,{status:'FINAL',finalizedAt:'2026-10-07T10:00:00Z',result:{submissionId:'s',extractionId:'e',scores:{[r.game.team1Id]:100,[r.game.team2Id]:90}}});});}
 return {repository,submissions,service,weekService,guild,channel,sent,edits,messages,a,b,week,discord,bind,final,setUnsafe:value=>{unsafe=value;}};
}
test('matchup totals use current assigned coaches in Test Mode; official approvals alone count as completed',async t=>{
 const f=fixture(t);let view=f.service.report('g');
 assert.deepEqual(view.groups.map(g=>[g.type,g.total,g.final]),[['CPU_VS_CPU',12,0],['HUMAN_VS_CPU',1,0],['HUMAN_VS_HUMAN',1,0]]);
 const game=await f.bind();await f.submissions.mutate(game.gameId,r=>{r.game.status='FINAL';});assert.equal(f.service.report('g').final,0);
 await f.final(game);view=f.service.report('g');assert.equal(view.final,1);assert.equal(view.groups[1].final,1);assert.equal(view.blockers.unresolved,13);
 assert.equal(f.repository.loadSchedule('l','1').statsPublication?.throughWeek||0,0);
 f.repository.saveOwners('l',[]);assert.equal(f.service.report('g').groups[0].total,14);
});
test('game checklist distinguishes missing sides, review, processing, OCR failures and byes',async t=>{
 const f=fixture(t),game=await f.bind();
 await f.submissions.mutate(game.gameId,r=>{r.game.inGameDate='Nov 18';r.submissions=[{submissionId:'s',status:'COLLECTING'}];r.media=[{submissionId:'s',teamId:f.a.team1Id}];});
 let coach=f.service.teamDashboard('g',f.a.team1Id);assert.equal(coach.game.ownUploaded,true);assert.match(coach.nextAction,/other side/);assert.equal(coach.game.screenshots,1);
 assert.match(f.service.teamDashboard('g',f.a.team2Id).nextAction,/submit your team/);
 await f.submissions.mutate(game.gameId,r=>{r.submissions[0].status='REVIEW_REQUIRED';r.submissions[0].latestExtractionId='e';r.extractions=[{extractionId:'e',submissionId:'s',status:'REVIEW_REQUIRED',normalized:{}}];r.media.push({submissionId:'s',teamId:f.a.team2Id});});
 let view=f.service.report('g');assert.equal(view.blockers.pendingReviews,1);assert.match(view.games[0].reviewUrl,/submissions\/s\/review/);assert.match(f.service.teamDashboard('g',f.a.team1Id).nextAction,/Staff to review/);
 await f.submissions.mutate(game.gameId,r=>{r.submissions[0].status='PROCESSING';});view=f.service.report('g');assert.equal(view.blockers.processing,1);assert.equal(view.blockers.pendingReviews,0);
 await f.submissions.mutate(game.gameId,r=>{r.submissions[0].status='EXTRACTION_FAILED';r.extractions[0].status='EXTRACTION_FAILED';});assert.equal(f.service.report('g').blockers.extractionFailures,1);
 assert.equal(f.service.teamDashboard('g',f.week.byes[0].teamId).bye,true);
});
test('public dashboards omit transactions; private dashboards include only the coach’s team and current season',t=>{
 const f=fixture(t),team=f.a.team1Id;
 f.repository.saveTrades('l',[{tradeId:'own',seasonId:'1',status:'PENDING_GM_APPROVAL',participatingTeams:[team,f.a.team2Id],currentVersion:{gmDecisions:[]}}, {tradeId:'other',seasonId:'1',status:'PENDING_COMMITTEE',participatingTeams:[f.b.team1Id,f.b.team2Id]}, {tradeId:'old',seasonId:'0',status:'PENDING_COMMITTEE',participatingTeams:[team]}]);
 f.repository.saveFreeAgencyState('l',{windows:[{id:'w',seasonId:'1',status:'OPEN'}],offers:[{id:'o',seasonId:'1',windowId:'w',teamId:team,playerId:'p',status:'PENDING_REVIEW',salary:999999},{id:'other',seasonId:'1',windowId:'w',teamId:f.b.team1Id,playerId:'secret',status:'APPROVED'}],waivers:[{id:'v',seasonId:'1',teamId:team,playerId:'cut',status:'PENDING'}]});
 const publicView=f.service.teamDashboard('g',team);assert.equal(publicView.transactions,undefined);assert.doesNotMatch(JSON.stringify(publicView),/secret|999999/);
 const privateView=f.service.teamDashboard('g',team,true);assert.deepEqual(privateView.transactions.trades.map(t=>t.id),['own']);assert.deepEqual(privateView.transactions.offers.map(o=>o.id),['o']);assert.equal(privateView.transactions.waivers.length,1);assert.doesNotMatch(JSON.stringify(privateView),/secret|999999/);
 assert.equal(f.service.report('g').transactions.trades.length,2);
});
test('weekly Staff report edits the same message, coalesces concurrent sends and survives restarts',async t=>{
 const f=fixture(t), adapter=f.discord();await Promise.all([adapter.ensureReport(f.guild),adapter.ensureReport(f.guild)]);
 assert.equal(f.sent.length,1);assert.equal(f.edits.length,0);
 await f.discord().ensureReport(f.guild);assert.equal(f.sent.length,1);assert.equal(f.edits.length,0);
 await f.final(await f.bind());await adapter.ensureReport(f.guild);assert.equal(f.edits.length,1);assert.match(f.edits[0].embeds[0].data.description,/1\/14/);
 await adapter.ensureReport(f.guild);assert.equal(f.edits.length,1);
 assert.equal(f.repository.loadSettings('l').freeAgencyTestWindowSeconds,60);
});
test('new week closes the previous report and posts one new report; stale advance buttons are rejected',async t=>{
 const f=fixture(t), adapter=f.discord();await adapter.ensureReport(f.guild);
 const oldMessage=[...f.messages.values()][0];
 await f.weekService.advance(f.guild,{authorized:true,id:'staff'},f.weekService.prepare('g',{authorized:true,id:'staff'},true).token);
 await Promise.all([adapter.ensureReport(f.guild),adapter.ensureReport(f.guild)]);assert.equal(f.sent.length,2);assert.match(oldMessage.embeds[0].title,/CLOSED/);assert.match(f.sent[1].embeds[0].data.title,/WEEK 2/);
 assert.equal(Object.values(f.repository.loadSettings('l').weeklyStaffReports).filter(r=>r.closed).length,1);
 let reply;await adapter.button({guildId:'g',channelId:'staff',message:{id:oldMessage.id},customId:'weeklystaff:review:1',user:{id:'staff'},memberPermissions:{has:()=>true},deferReply:async()=>{},editReply:async p=>{reply=p;}});
 assert.match(reply.content,/stale/);assert.equal(f.repository.loadLeague('l').league.currentWeek,2);
});
test('Staff report recovers a sent message when saving its receipt fails; a deleted report is replaced once',async t=>{
 const f=fixture(t),save=f.repository.saveSettings;let fail=true;
 f.repository.saveSettings=(...args)=>{if(fail){fail=false;throw Error('Disk failed');}return save(...args);};
 await assert.rejects(f.discord().ensureReport(f.guild),/Disk failed/);assert.equal(f.sent.length,1);
 await f.discord().ensureReport(f.guild);assert.equal(f.sent.length,1);
 f.messages.clear();await f.discord().ensureReport(f.guild);assert.equal(f.sent.length,2);
 await f.discord().ensureReport(f.guild);assert.equal(f.sent.length,2);
});
test('Staff-only channel access and current Coach identity are enforced before revealing dashboard work',async t=>{
 const f=fixture(t);f.setUnsafe(true);await assert.rejects(f.discord().ensureReport(f.guild),/Staff-only/);assert.equal(f.sent.length,0);f.setUnsafe(false);
 let reply;const interaction={guildId:'g',user:{id:'coach-a'},member:{roles:['role-a']},customId:'myweek:refresh',deferReply:async o=>assert.equal(o.flags,64),editReply:async p=>{reply=p;}};
 await f.discord().button(interaction);assert.match(reply.embeds[0].data.title,/MY WEEK/);
 await f.discord().button({...interaction,member:{roles:['role-b']}});assert.match(reply.content,/must match/);
 await f.discord().button({...interaction,customId:'weeklystaff:review:1',memberPermissions:{has:()=>false}});assert.match(reply.content,/Commish/);
});
test('weekly embeds stay within Discord limits and provide only existing navigation actions',t=>{
 const f=fixture(t);const report=staffPayload(f.service.report('g'));
 const e=report.embeds[0].toJSON();assert.ok(e.description.length<=4096);assert.ok(e.fields.every(x=>x.value.length<=1024));assert.ok(e.fields.reduce((n,x)=>n+x.name.length+x.value.length,e.title.length+e.description.length+e.footer.text.length)<6000);
 assert.equal(report.components[0].components[0].data.custom_id,'weeklystaff:advance:1');
 assert.equal(report.components[0].components[0].data.label,'Create Next Week Threads');
 assert.equal(report.components[0].components[1].data.custom_id,'weeklystaff:delete:1');
 const coach=coachPayload(f.service.teamDashboard('g',f.a.team1Id,true));assert.equal(coach.components[0].components[1].data.custom_id,'fa:active');assert.equal(coach.embeds.length,1);
});
module.exports={fixture};

test('report recovers a deleted saved Staff channel only when the replacement is unique and Staff-only',async t=>{
 const f=fixture(t),fetch=f.guild.channels.fetch;
 f.repository.saveSettings('l',{...f.repository.loadSettings('l'),discordChannels:{...f.repository.loadSettings('l').discordChannels,staff:'deleted'}});
 f.channel.name='lb-league-staff';
 f.guild.channels.fetch=async id=>{if(id==='deleted')throw Object.assign(Error('Unknown Channel'),{code:10003});if(id===undefined)return new Map([['staff',f.channel]]);return fetch(id);};
 f.setUnsafe(true);await assert.rejects(f.discord().ensureReport(f.guild),/Staff-only/);assert.equal(f.repository.loadSettings('l').discordChannels.staff,'deleted');
 f.setUnsafe(false);await f.discord().ensureReport(f.guild);assert.equal(f.repository.loadSettings('l').discordChannels.staff,'staff');assert.equal(f.sent.length,1);assert.equal(f.sent[0].components[0].components[0].data.label,'Create Next Week Threads');
});
test('Staff channel recovery refuses duplicate names and does not hide permission errors',async t=>{
 const f=fixture(t);f.guild.channels.fetch=async id=>{if(id)throw Object.assign(Error('Unknown Channel'),{code:10003});return new Map([['a',{name:'lb-league-staff'}],['b',{name:'lb-league-staff'}]]);};
 await assert.rejects(f.discord().ensureReport(f.guild),/ambiguous/);assert.equal(f.sent.length,0);
 f.guild.channels.fetch=async()=>{throw Object.assign(Error('Missing Access'),{code:50001});};
 await assert.rejects(f.discord().ensureReport(f.guild),/Missing Access/);assert.equal(f.sent.length,0);
});

test('Staff report Delete Threads opens a private confirmation and deletes only after confirm',async t=>{
 const f=fixture(t),deleted=[];
 for(const match of f.week.games)await f.bind(match);
 const fetch=f.guild.channels.fetch;
 f.guild.channels.fetch=async id=>id==='staff'?fetch(id):{id,guildId:'g',type:12,delete:async()=>deleted.push(id)};
 const cleanupService=require('../src/fantasyhq/game-thread-cleanup').createGameThreadCleanupService({submissions:f.submissions});
 const adapter=createDiscordWeeklyDashboard({repository:f.repository,service:f.service,weekService:f.weekService,cleanupService});
 const message=await adapter.ensureReport(f.guild);let reply;
 const interaction={guild:f.guild,guildId:'g',channelId:'staff',message:{id:message.id},user:{id:'staff'},memberPermissions:{has:()=>true},customId:'weeklystaff:delete:1',deferReply:async o=>assert.equal(o.flags,64),editReply:async p=>{reply=p;}};
 await adapter.button({...interaction,memberPermissions:{has:()=>false}});assert.match(reply.content,/Commish/);assert.equal(deleted.length,0);
 await adapter.button({...interaction,message:{id:'other'}});assert.match(reply.content,/stale/);assert.equal(deleted.length,0);
 await adapter.button(interaction);assert.equal(deleted.length,0);assert.match(reply.embeds[0].data.title,/CLEAN GAME THREADS/);
 const confirm=reply.components[0].toJSON().components[1].custom_id;
 await require('../src/fantasyhq/discord-game-cleanup').handleCleanupButton({...interaction,customId:confirm},cleanupService);
 assert.equal(deleted.length,14);assert.equal(f.repository.loadLeague('l').league.currentWeek,1);assert.equal(f.repository.loadSchedule('l','1').weeks[0].status,'ACTIVE');
});

test('Staff report next-week button respects blockers and confirms the full existing transition',async t=>{
 const f=fixture(t);let created=0,followups=0,reply;
 const weekService=createWeekAdvancementService({submissions:f.submissions,threads:{create:async()=>{created++;return {created:14};}},onAdvanced:async()=>{followups++;}});
 const adapter=createDiscordWeeklyDashboard({repository:f.repository,service:f.service,weekService});
 const message=await adapter.ensureReport(f.guild);
 const interaction={guild:f.guild,guildId:'g',channelId:'staff',message:{id:message.id},user:{id:'staff'},memberPermissions:{has:()=>true},customId:'weeklystaff:advance:1',deferReply:async o=>assert.equal(o.flags,64),editReply:async p=>{reply=p;}};
 await adapter.button(interaction);assert.match(reply.embeds[0].data.title,/CANNOT BE COMPLETED/);assert.equal(reply.components.length,0);assert.equal(created,0);
 for(const match of f.week.games)await f.final(await f.bind(match));
 await adapter.button(interaction);assert.match(reply.embeds[0].data.title,/COMPLETE WEEK 1/);assert.equal(f.repository.loadLeague('l').league.currentWeek,1);assert.equal(created,0);
 const customId=reply.components[0].toJSON().components[1].custom_id;
 await require('../src/fantasyhq/discord-week').handleWeekButton({...interaction,customId},weekService);
 assert.equal(f.repository.loadLeague('l').league.currentWeek,2);assert.equal(created,1);assert.equal(followups,1);
 assert.equal(f.repository.loadSchedule('l','1').statsPublication.throughWeek,1);assert.equal(f.repository.loadSchedule('l','1').statsPublication.gameIds.length,14);
 await adapter.ensureReport(f.guild);assert.equal(f.sent.length,2);assert.match(message.embeds[0].title,/CLOSED/);
 await adapter.button(interaction);assert.match(reply.content,/stale/);assert.equal(created,1);
});

test('last week offers regular season completion and closed reports have no advance or delete controls',t=>{
 const f=fixture(t),view=f.service.report('g');
 assert.equal(staffPayload({...view,week:15}).components[0].components[0].data.label,'Complete Regular Season');
 assert.ok(staffPayload({...view,closed:true}).components[0].components.every(b=>!b.data.custom_id?.startsWith('weeklystaff:')));
});

test('website weekly endpoints protect Staff data and expose only public coach progress',async t=>{
 const f=fixture(t),{requestHandler,setGameThreadRuntime}=require('../src/web');
 const oldKey=process.env.WEBSITE_ADMIN_KEY,oldGuild=process.env.GUILD_ID;process.env.WEBSITE_ADMIN_KEY='weekly-test';process.env.GUILD_ID='g';
 setGameThreadRuntime({repository:f.repository});t.after(()=>{setGameThreadRuntime(null);if(oldKey===undefined)delete process.env.WEBSITE_ADMIN_KEY;else process.env.WEBSITE_ADMIN_KEY=oldKey;if(oldGuild===undefined)delete process.env.GUILD_ID;else process.env.GUILD_ID=oldGuild;});
 f.repository.saveTrades('l',[{tradeId:'private-trade',seasonId:'1',status:'PENDING_COMMITTEE',participatingTeams:[f.a.team1Id,f.a.team2Id]}]);
 function request(url,key,method='GET'){let status,data;requestHandler({url,method,headers:key?{'x-leaguebuddy-admin-key':key}:{}},{writeHead:c=>{status=c;},end:b=>{data=JSON.parse(b);}});return {status,data};}
 assert.equal(request('/api/league/admin/weekly').status,403);assert.equal(request('/api/league/admin/weekly','wrong').status,403);
 const staff=request('/api/league/admin/weekly','weekly-test');assert.equal(staff.status,200);assert.equal(staff.data.transactions.trades[0].id,'private-trade');
 const coach=request('/api/league/weekly/'+f.a.team1Id);assert.equal(coach.status,200);assert.equal(coach.data.transactions,undefined);assert.doesNotMatch(JSON.stringify(coach.data),/private-trade/);
 assert.equal(request('/api/league/weekly/'+f.a.team1Id,null,'POST').status,405);assert.equal(request('/api/league/weekly/not-a-team').status,400);
});

test('final regular-season closeout freezes the last report instead of creating Week 16',async t=>{
 const f=fixture(t);let schedule=f.repository.loadSchedule('l','1');schedule.weeks.forEach(w=>w.status=w.week===15?'ACTIVE':'COMPLETED');f.repository.saveSchedule(schedule);f.repository.saveLeague('l',{...f.repository.loadLeague('l').league,currentWeek:15});
 const adapter=f.discord();await adapter.ensureReport(f.guild);assert.equal(f.sent.length,1);
 const actor={authorized:true,id:'staff'};await f.weekService.advance(f.guild,actor,f.weekService.prepare('g',actor,true).token);
 await adapter.ensureReport(f.guild);assert.equal(f.sent.length,1);assert.match(f.edits.at(-1).embeds[0].data.title,/WEEK 15.*CLOSED/);
 const edited=f.edits.length;await adapter.ensureReport(f.guild);assert.equal(f.edits.length,edited);
 assert.equal(f.repository.loadLeague('l').league.regularSeasonStatus,'COMPLETED');
});

test('report recovery searches beyond the newest 100 Staff messages before sending another',async t=>{
 const f=fixture(t);await f.discord().ensureReport(f.guild);const original=[...f.messages.values()][0],settings=f.repository.loadSettings('l');delete settings.weeklyStaffReports;f.repository.saveSettings('l',settings);
 const newest=new Map(Array.from({length:100},(_,i)=>[`noise-${i}`,{id:`noise-${i}`,author:{id:'staff'},embeds:[],createdTimestamp:Date.now()}]));
 const fetch=f.channel.messages.fetch;let pages=0;
 f.channel.messages.fetch=async arg=>{if(typeof arg==='string')return fetch(arg);pages++;return arg.before?new Map([[original.id,original]]):newest;};
 await f.discord().ensureReport(f.guild);assert.equal(pages,2);assert.equal(f.sent.length,1);
});

test('weekly report sweep skips unconfigured guilds but still surfaces errors for configured leagues', async () => {
 const before=process.env.FANTASYHQ_LEAGUE_ID;delete process.env.FANTASYHQ_LEAGUE_ID;
 try {
  const reported=[],errors=[],repository={dataRoot:'temporary-test-root',loadGuildLeagueBinding:id=>id==='configured'?{leagueId:'league'}:null};
  const dashboard=createDiscordWeeklyDashboard({repository,service:{report:id=>{reported.push(id);throw Error('Configured storage is corrupt');}},logger:{error:(...args)=>errors.push(args)}});
  await dashboard.tick({guilds:{cache:new Map([['unconfigured',{id:'unconfigured'}],['configured',{id:'configured'}]])}});
  assert.deepEqual(reported,['configured']);assert.equal(errors.length,1);assert.match(errors[0][1],/corrupt/);
 } finally {if(before===undefined)delete process.env.FANTASYHQ_LEAGUE_ID;else process.env.FANTASYHQ_LEAGUE_ID=before;}
});
