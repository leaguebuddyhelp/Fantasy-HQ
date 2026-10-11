const test=require('node:test'),assert=require('node:assert/strict');
const {promoPayload,handlePromo}=require('../src/fantasyhq/discord-promo');
const nbaTeams=require('../web/assets/nba/teams.json');
const teams=nbaTeams.map(team=>({teamId:team.abbreviation,abbreviation:team.abbreviation,teamName:team.name}));
test('promo is a regular message with recruitment text and a vertical list of open team names',()=>{
 const owners=[{teamId:'BOS',userId:'coach'},{teamId:'LAL',userId:'coach2'},
  {teamId:'CHI',userId:'old',active:false},{teamId:'DAL',userId:'simulation:placeholder'},
  {teamId:'ATL',userId:'former',endedAt:'2026-10-01'}];
 const p=promoPayload({teams},owners);
 assert.deepEqual(p.embeds,[]);
 assert.match(p.content,/LEAGUEbuddy/);
 assert.match(p.content,/48-hour game windows & automated scheduling/);
 const list=p.content.split('**OPEN TEAMS (28)**\n')[1];
 assert.ok(list);
 assert.deepEqual(list.split('\n'),teams.filter(t=>!['BOS','LAL'].includes(t.teamId)).map(t=>t.teamName).sort((a,b)=>a.localeCompare(b)));
 assert.deepEqual(p.allowedMentions,{parse:[]});
});
test('promo with all 30 full NBA names fits in one Discord message',()=>{
 const p=promoPayload({teams},[]);
 assert.ok(p.content.length<=2000);
 assert.equal(p.content.split('**OPEN TEAMS (30)**\n')[1].split('\n').length,30);
});
test('promo scans ownership before reading vacancy data on every invocation',async()=>{
 const events=[];let owners=[];
 const dependencies={repository:{loadLeagueContext:()=>{events.push('read');return {league:{leagueId:'league'},teams};},loadOwners:()=>owners},ownership:{invalidateMembers:()=>events.push('invalidate'),sync:async()=>events.push('sync')}};
 const responses=[],i={guildId:'guild',guild:{id:'guild'},editReply:async p=>responses.push(p)};
 await handlePromo(i,dependencies);owners=[{teamId:'BOS',userId:'coach'}];await handlePromo(i,dependencies);
 assert.deepEqual(events,['invalidate','sync','read','invalidate','sync','read']);
 assert.match(responses[0].content,/OPEN TEAMS \(30\)/);
 assert.match(responses[1].content,/OPEN TEAMS \(29\)/);
});
test('full league promo offers waiting list without claiming vacancies',()=>{
 const p=promoPayload({teams},teams.map(t=>({teamId:t.teamId,userId:'coach:'+t.teamId})));
 assert.match(p.content,/waiting list/);
 assert.doesNotMatch(p.content,/OPEN TEAMS/);
 assert.deepEqual(p.embeds,[]);
});
