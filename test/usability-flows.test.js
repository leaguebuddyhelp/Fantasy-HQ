const test = require('node:test');
const assert = require('node:assert/strict');
const { freeAgentsPayload } = require('../src/fantasyhq/discord-preseason');
const { permanentPayload } = require('../src/fantasyhq/discord-free-agency');
const { offerWindowDuration } = require('../src/fantasyhq/free-agency-service');
const { gamePayload } = require('../src/fantasyhq/discord-game-submissions');
const { handleWeekPreview } = require('../src/fantasyhq/discord-week');

test('free-agent pages retain primary-position filters and link into private signing', () => {
  const players = Array.from({ length: 31 }, (_, i) => ({ name: `Player ${i}`, overall: 90-i, position1: 'PG', position2: 'SG', teamId: null }));
  players.push({ name: 'Owned', overall: 99, position1: 'PG', teamId: 'owned' });
  const first = freeAgentsPayload(players, 'PG');
  const controls = first.components[0].toJSON().components;
  assert.equal(controls[0].disabled, true);
  assert.equal(controls[1].custom_id, 'freeagents:page:2:PG');
  assert.equal(controls[2].custom_id, 'fa:sign');
  assert.ok(!first.embeds[0].data.description.includes('Owned'));
  const last = freeAgentsPayload(players, 'PG', 999);
  assert.match(last.embeds[0].data.description, /Player 30/);
  assert.equal(last.components[0].toJSON().components[1].disabled, true);
  assert.match(freeAgentsPayload(players, 'SG').embeds[0].data.description, /No free agents match/);
});

test('Free Agency pin displays the effective test clock and ignores test settings outside Test Mode', () => {
  assert.match(permanentPayload({testMode:true,freeAgencyTestWindowSeconds:60}).embeds[0].data.description, /60 seconds \(Test Mode\)/);
  assert.match(permanentPayload({testMode:false,freeAgencyTestWindowSeconds:60}).embeds[0].data.description, /1 hour/);
  assert.equal(offerWindowDuration({testMode:true,freeAgencyTestWindowSeconds:0}), 3600000);
});

test('finalized game cards remove submission, CPU, forfeit and date controls', () => {
  const payload = gamePayload({gameId:'g',team1Id:'a',team2Id:'b',team1Name:'Team A',team2Name:'Team B',status:'FINAL',inGameDate:'Nov 18',result:{scores:{a:100,b:90}},finalizedAt:new Date().toISOString()});
  assert.deepEqual(payload.components, []);
  assert.match(JSON.stringify(payload.embeds[0].toJSON()), /week advances/);
});

test('dashboard week review only prepares a confirmation and still requires staff', async () => {
  let prepared=0, payload;
  const service={prepare:()=>{prepared++;return {week:1,nextWeek:2,final:14,total:14,unresolved:[],token:'preview',force:false};}};
  const interaction={guildId:'g',user:{id:'staff'},memberPermissions:{has:()=>true},editReply:async p=>{payload=p;}};
  await handleWeekPreview(interaction,service);
  assert.equal(prepared,1);
  assert.equal(payload.components[0].components[1].data.custom_id, 'weekconfirm:preview');
  await assert.rejects(handleWeekPreview({...interaction,memberPermissions:{has:()=>false}},service), /need LEAGUEbuddy/);
  assert.equal(prepared,1);
});
