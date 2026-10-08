const test = require('node:test'), assert = require('node:assert/strict');
const {fixture} = require('./helpers/free-agency');
const {createGameSubmissionService} = require('../src/fantasyhq/game-submissions');
const {createDiscordStreams} = require('../src/fantasyhq/discord-streams');
async function setup(t) {
 const f = fixture(t); f.repository.saveLeague('league', {currentWeek:1});
 f.repository.saveSchedule({leagueId:'league',seasonId:'1',weeks:[{week:1,weekId:'w1',status:'ACTIVE',games:[{team1Id:'a',team2Id:'b'}],byes:['c']}]});
 f.repository.saveSettings('league',{discordChannels:{streamlink:'streams'}});
 const submissions = createGameSubmissionService({repository:f.repository});
 const gameId = submissions.ensureGame({guildId:'guild',weekNumber:1,teamQuery:'a'}).game.gameId;
 await submissions.mutate(gameId,r=>{r.game.streamlink={url:'https://example.com/first',submittedAt:'2026-10-08T12:00:00Z'};r.game.sportsbookLockedAt='2026-10-08T12:00:00Z';});
 const messages=new Map();let sends=0,edits=0;
 const channel={id:'streams',messages:{fetch:async query=>typeof query==='string'?messages.get(query):messages},send:async body=>{sends++;const message={id:'m'+sends,embeds:body.embeds,body,createdTimestamp:Date.now(),edit:async body=>{edits++;message.body=body;message.embeds=body.embeds;}};messages.set(message.id,message);return message;}};
 const guild={channels:{fetch:async id=>{assert.equal(id,'streams');return channel;}}};
 return {...f,submissions,gameId,guild,messages,counts:()=>({sends,edits})};
}
test('stream announcements reconcile once, freeze verified preview and edit the same message for new URLs',async t=>{
 const f=await setup(t),service=createDiscordStreams(f);
 await Promise.all([service.publish(f.guild,f.gameId),service.publish(f.guild,f.gameId)]);
 assert.deepEqual(f.counts(),{sends:1,edits:0});const before=f.submissions.load(f.gameId).game;
 assert.equal(before.streamAnnouncement.publication.messageId,'m1');assert.equal(before.streamAnnouncement.facts.playersToWatch.length,0);
 assert.match(f.messages.get('m1').body.embeds[0].toJSON().description,/No published player statistics/);
 const players=f.repository.loadPlayers('league');players.find(p=>p.playerId==='b-0').overall=99;f.repository.savePlayers('league',players);
 await f.submissions.mutate(f.gameId,r=>{r.game.streamlink.url='https://example.com/new';});
 await createDiscordStreams(f).publish(f.guild,f.gameId);
 assert.deepEqual(f.counts(),{sends:1,edits:1});const after=f.submissions.load(f.gameId).game;
 assert.deepEqual(after.streamAnnouncement.facts,before.streamAnnouncement.facts);assert.equal(after.sportsbookLockedAt,before.sportsbookLockedAt);
 assert.match(f.messages.get('m1').body.embeds[0].toJSON().description,/https:\/\/example.com\/new/);
 const stream=require('../src/fantasyhq/streams-service').createStreamsService(f).list('league')[0];assert.equal(stream.marketLocked,true);assert.equal(stream.url,'https://example.com/new');assert.deepEqual(stream.preview,before.streamAnnouncement.facts);
 await createDiscordStreams(f).reconcile(f.guild,'league');assert.deepEqual(f.counts(),{sends:1,edits:1});
});
test('stream post recovery finds a sent announcement after receipt persistence fails',async t=>{
 const f=await setup(t),mutate=f.submissions.mutate;let fail=true;
 f.submissions.mutate=async (...args)=>{await mutate(...args);if(fail&&f.submissions.load(f.gameId).game.streamAnnouncement?.publication?.status==='DELIVERED'){fail=false;await mutate(f.gameId,r=>{r.game.streamAnnouncement.publication={status:'PENDING',channelId:'streams',at:new Date().toISOString()};});throw Error('Interrupted receipt');}};
 await assert.rejects(createDiscordStreams(f).publish(f.guild,f.gameId),/Interrupted/);
 await createDiscordStreams(f).publish(f.guild,f.gameId);assert.equal(f.counts().sends,1);assert.equal(f.submissions.load(f.gameId).game.streamAnnouncement.publication.messageId,'m1');
});
test('isolated simulation streams never publish into live Discord',async t=>{
 const f=await setup(t);f.repository.saveSettings('league',{simulationId:'sim'});await createDiscordStreams(f).reconcile(f.guild,'league');assert.equal(f.counts().sends,0);
 await f.submissions.mutate(f.gameId,r=>{r.game.simulationId='sim';});assert.equal(require('../src/fantasyhq/streams-service').createStreamsService(f).list('league').length,1);
 f.repository.saveSettings('league',{simulationId:null});assert.equal(require('../src/fantasyhq/streams-service').createStreamsService(f).list('league').length,0);
});
