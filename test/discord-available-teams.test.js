const test=require('node:test'),assert=require('node:assert/strict');
const {availableTeamsPayload,handleAvailableTeams,DIVISIONS}=require('../src/fantasyhq/discord-available-teams');
const {setTeamEmojis}=require('../src/shared/team-emojis');
const teams=Object.entries(DIVISIONS).flatMap(([conference,divisions])=>Object.entries(divisions).flatMap(([division,abbreviations])=>abbreviations.map(abbreviation=>({teamId:abbreviation,teamName:abbreviation,abbreviation,conference,division}))));
test('one clean ownership embed groups all thirty teams into six conference divisions without pinging',t=>{
 setTeamEmojis(new Map([['bos',{name:'bos',id:'111'}]]));t.after(()=>setTeamEmojis(new Map()));
 const payload=availableTeamsPayload({teams},[{teamId:'BOS',userId:'123456789',displayName:'Coach'}]);const embed=payload.embeds[0].toJSON();
 assert.equal(payload.embeds.length,1);assert.equal(embed.fields.length,6);assert.ok(embed.fields.every(f=>f.value.split('\n').length===5&&f.value.length<=1024));assert.match(embed.fields[0].value,/<:bos:111> \*\*BOS\*\* — <@123456789>/);assert.match(embed.description,/29 available/);assert.deepEqual(payload.allowedMentions.parse,[]);assert.ok(JSON.stringify(embed).length<6000);
});
test('command embed filters owned teams, handles no vacancies and excludes simulation owners',()=>{
 const owners=teams.map(t=>({teamId:t.teamId,userId:'123456789'}));let embed=availableTeamsPayload({teams},owners,{openOnly:true}).embeds[0].toJSON();assert.match(embed.description,/All teams/);assert.equal(embed.fields,undefined);
 owners[0].userId='simulation:placeholder';embed=availableTeamsPayload({teams},owners,{openOnly:true}).embeds[0].toJSON();assert.equal(embed.fields.length,1);assert.match(embed.fields[0].value,/BOS/);assert.doesNotMatch(embed.fields[0].value,/BKN/);
});
test('available command refreshes Discord ownership before reading vacancies and refreshes pin',async()=>{
 const events=[];let reply;await handleAvailableTeams({guildId:'g',guild:{id:'g'},editReply:async p=>{events.push('reply');reply=p;}},{repository:{loadLeagueContext:()=>{events.push('load');return {league:{leagueId:'l'},teams};},loadOwners:()=>[]},ownership:{invalidateMembers:()=>events.push('invalidate'),sync:async()=>events.push('scan')},feeds:{ensurePins:async()=>events.push('pin')}});
 assert.deepEqual(events,['invalidate','scan','load','reply','pin']);assert.match(reply.embeds[0].data.description,/30 available/);
});
