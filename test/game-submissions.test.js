const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ChannelType } = require("discord.js");
const { createFantasyHQRepository } = require("../src/fantasyhq/repository");
const { createGameSubmissionService, downloadDiscordImage } = require("../src/fantasyhq/game-submissions");
const { createDiscordGameSubmissions, gamePayload } = require("../src/fantasyhq/discord-game-submissions");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=", "base64");

function fixture(t, download = async () => png) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "game-submissions-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const repository = createFantasyHQRepository({ dataRoot });
  repository.saveLeague("league", { currentPhase: "REGULAR_SEASON", currentSeasonId: "1" });
  repository.saveTeams("league", [
    { teamId: "a", teamName: "Team A", abbreviation: "A", conference: "East" },
    { teamId: "b", teamName: "Team B", abbreviation: "B", conference: "East" },
  ]);
  repository.saveOwners("league", [{ teamId: "a", userId: "gm" }, { teamId: "b", userId: "opponent" }]);
  repository.saveGuildLeagueBinding("guild", { leagueId: "league", seasonId: "1" });
  repository.saveSchedule({ leagueId: "league", seasonId: "1", weeks: [{
    week: 1, weekId: "week-one", games: [{ team1Id: "a", team2Id: "b" }], byes: [],
  }] });
  const actor = { guildId: "guild", discordThreadId: "thread", userId: "gm", privateThread: true };
  const service = createGameSubmissionService({ repository, download });
  const { game } = service.bind({ ...actor, weekNumber: 1, teamQuery: "A" });
  game.inGameDate='10/24/2027';
  const record=service.load(game.gameId);record.game.inGameDate=game.inGameDate;
  fs.writeFileSync(path.join(dataRoot,'game-history',game.gameId,'record.json'),JSON.stringify(record));
  const attachment = id => ({ id, name: id + ".png", contentType: "image/png", size: png.length,
    url: `https://cdn.discordapp.com/attachments/thread/${id}/box.png` });
  return { service, repository, actor, game, attachment, dataRoot };
}

test("Discord Submit Game collects 0/2, 1/2, 2/2 and preserves originals without finalizing", async t => {
  const { service, repository, actor, game, attachment } = fixture(t);
  const adapter = createDiscordGameSubmissions(service, { extractor:null });
  const replies = [];
  const channel = { type: ChannelType.PrivateThread };
  const source = { guildId: "guild", channelId: "thread", channel };
  const button = { ...source, user: { id: "gm" }, customId: gamePayload(game).components[1].components[0].data.custom_id,
    deferReply: async () => {}, editReply: async p => replies.push(p) };
  await adapter.button(button);
  assert.match(replies.at(-1).embeds[0].data.description, /0 \/ 2/);
  const upload = (id, userId = "gm") => adapter.message({ ...source, id: "message-" + id, author: { id: userId, bot: false },
    attachments: new Map([[id, attachment(id)]]), reply: async p => replies.push(p) });
  await upload("one");
  assert.match(replies.at(-1).embeds[0].data.description, /1 \/ 2/);
  await adapter.button({ ...button, user:{id:"opponent"} });
  await upload("two", "opponent");
  assert.equal(replies.at(-1).embeds[0].data.title, "BOX SCORES RECEIVED");
  assert.match(replies.at(-1).embeds[0].data.description, /2 \/ 2 team box scores received/);
  const record = service.load(game.gameId);
  assert.equal(record.submissions[0].status, "RECEIVED");
  assert.deepEqual(record.game, game);
  assert.equal(record.media.length, 2);
  for (const media of record.media) {
    assert.equal(media.gameId, game.gameId);
    assert.equal(media.submissionId, record.submissions[0].submissionId);
    assert.ok(["gm", "opponent"].includes(media.uploadedBy));
    assert.ok(media.discordAttachment.messageId);
    assert.deepEqual(service.readOriginal(game.gameId, media.mediaId), png);
  }
  // Delete the simulated Discord thread and make all Discord downloads fail.
  delete source.channel;
  const restarted = createGameSubmissionService({ repository, download: async () => { throw new Error("Thread deleted"); } });
  assert.deepEqual(restarted.load(game.gameId), record);
  for (const media of record.media) assert.deepEqual(restarted.readOriginal(game.gameId, media.mediaId), png);
  await restarted.begin(game.gameId, actor);
  assert.equal(restarted.load(game.gameId).submissions.length, 2);
  assert.deepEqual(restarted.load(game.gameId).media, record.media);
});

test("wrong owner, guild, thread, public thread and finalized games cannot accept uploads", async t => {
  const { service, actor, game, attachment, dataRoot } = fixture(t);
  for (const change of [{ userId: "wrong" }, { guildId: "other" }, { discordThreadId: "other" }, { privateThread: false }]) {
    await assert.rejects(service.begin(game.gameId, { ...actor, ...change }));
  }
  await service.begin(game.gameId, actor);
  for (const change of [{ userId: "wrong" }, { discordThreadId: "other" }]) {
    await assert.rejects(service.receive(game.gameId, { ...actor, ...change }, [attachment("one")], "m"));
  }
  const record = service.load(game.gameId);
  record.game.status = "FINAL";
  fs.writeFileSync(path.join(dataRoot, "game-history", game.gameId, "record.json"), JSON.stringify(record));
  await assert.rejects(service.receive(game.gameId, actor, [attachment("one")], "m"), /locked or finalized/);
  assert.equal(service.load(game.gameId).media.length, 0);
});

test("non-images, excess screenshots and disguised files are rejected", async t => {
  const { service, actor, game, attachment, repository } = fixture(t);
  await service.begin(game.gameId, actor);
  await assert.rejects(service.receive(game.gameId, actor, [{ ...attachment("bad"), contentType: "text/plain" }], "m"), /JPG/);
  await assert.rejects(service.receive(game.gameId, actor, [attachment("1"), attachment("2"), attachment("3")], "m"), /exactly two/);
  const invalid = createGameSubmissionService({ repository, download: async () => Buffer.from("not an image") });
  await assert.rejects(invalid.receive(game.gameId, actor, [attachment("fake")], "m"), /Unsupported image/);
  assert.equal(service.load(game.gameId).media.length, 0);
});

test("cancelling and restarting preserves history; restart resumes an incomplete session", async t => {
  const { service, actor, game, attachment, repository } = fixture(t);
  const first = await service.begin(game.gameId, actor);
  await service.receive(game.gameId, actor, [attachment("one")], "m");
  const restarted = createGameSubmissionService({ repository, download: async () => png });
  assert.equal((await restarted.begin(game.gameId, actor)).submission.submissionId, first.submission.submissionId);
  await assert.rejects(restarted.cancel(game.gameId, first.submission.submissionId, { ...actor, userId: "opponent" }));
  await restarted.cancel(game.gameId, first.submission.submissionId, actor);
  const second = await restarted.begin(game.gameId, actor);
  assert.notEqual(second.submission.submissionId, first.submission.submissionId);
  await restarted.receive(game.gameId, actor, [attachment("two"), attachment("three")], "m2");
  const record = restarted.load(game.gameId);
  assert.deepEqual(record.submissions.map(s => s.status), ["CANCELLED", "RECEIVED"]);
  assert.equal(record.media.length, 3);
  assert.deepEqual(restarted.readOriginal(game.gameId, record.media[0].mediaId), png);
});

test("concurrent uploads are serialized, attachment redelivery is not counted twice", async t => {
  const { service, actor, game, attachment } = fixture(t);
  await Promise.all([service.begin(game.gameId, actor), service.begin(game.gameId, actor)]);
  assert.equal(service.load(game.gameId).submissions.length, 1);
  await Promise.all([
    service.receive(game.gameId, actor, [attachment("one")], "m1"),
    service.receive(game.gameId, actor, [attachment("one")], "m1"),
    service.receive(game.gameId, actor, [attachment("two")], "m2"),
  ]);
  assert.equal(service.load(game.gameId).media.length, 2);
});

test("download failures preserve accepted screenshots and permit a retry", async t => {
  let fail = true;
  const { service, actor, game, attachment } = fixture(t, async a => {
    if (a.id === "two" && fail) throw new Error("download failed");
    return png;
  });
  await service.begin(game.gameId, actor);
  await assert.rejects(service.receive(game.gameId, actor, [attachment("one"), attachment("two")], "m"), /download failed/);
  assert.equal(service.load(game.gameId).media.length, 1);
  fail = false;
  await service.receive(game.gameId, actor, [attachment("one"), attachment("two")], "m");
  assert.equal(service.load(game.gameId).media.length, 2);
});

test("only Discord attachment hosts can be downloaded", async () => {
  await assert.rejects(downloadDiscordImage({ url: "http://localhost/private" }), /Invalid Discord/);
  await assert.rejects(downloadDiscordImage({ url: "https://example.com/attachments/file.png" }), /Invalid Discord/);
});

test("linking a thread is idempotent and preserves the schedule", t => {
  const { service, repository, actor, game } = fixture(t);
  const before = repository.loadSchedule("league", "1");
  assert.equal(service.bind({ ...actor, weekNumber: 1, teamQuery: "B" }).game.gameId, game.gameId);
  assert.throws(() => service.bind({ ...actor, discordThreadId: "other", weekNumber: 1, teamQuery: "A" }), /another thread/);
  assert.deepEqual(repository.loadSchedule("league", "1"), before);
});

test("ownership lost during download prevents acceptance", async t => {
  let revoke;
  const { service, repository, actor, game, attachment } = fixture(t, async () => { revoke(); return png; });
  revoke = () => repository.saveOwners("league", []);
  await service.begin(game.gameId, actor);
  await assert.rejects(service.receive(game.gameId, actor, [attachment("one")], "m"), /Only an owner/);
  assert.equal(service.load(game.gameId).media.length, 0);
});

test('each coach supplies exactly one side; both sessions join one submission', async t => {
  const {service,actor,game,attachment}=fixture(t);
  const first=await service.beginSide(game.gameId,actor);
  await assert.rejects(service.receiveSide(game.gameId,actor,[attachment('one'),attachment('two')],'m'),/one box score/);
  let result=await service.receiveSide(game.gameId,actor,[attachment('one')],'m');
  assert.equal(result.media[0].teamId,'a');
  await assert.rejects(service.receiveSide(game.gameId,actor,[attachment('two')],'m'),/other coach/);
  const other={...actor,userId:'opponent'};
  await assert.rejects(service.receiveSide(game.gameId,other,[attachment('two')],'m'),/Click Submit Score/);
  const second=await service.beginSide(game.gameId,other);
  assert.equal(first.submission.submissionId,second.submission.submissionId);
  result=await service.receiveSide(game.gameId,other,[attachment('two')],'m2');
  assert.equal(result.submission.status,'RECEIVED');
  assert.deepEqual(result.media.map(m=>m.teamId),['a','b']);
  assert.deepEqual(result.media.map(m=>m.uploadedBy),['gm','opponent']);
});

test('staff can submit both screenshots for any matchup; nonstaff, wrong-thread and finalized uploads are rejected',async t=>{
 const f=fixture(t),staff={...f.actor,userId:'commish',staff:true};f.repository.saveOwners('league',[]);
 assert.throws(()=>f.service.beginStaff(f.game.gameId,{...staff,staff:false}),/authorization/);
 await assert.rejects(f.service.beginStaff(f.game.gameId,{...staff,discordThreadId:'other'}),/private thread/);
 const start=await f.service.beginStaff(f.game.gameId,staff);assert.equal(start.submission.mode,'STAFF_BOTH');
 const result=await f.service.receiveStaff(f.game.gameId,staff,[f.attachment('one'),f.attachment('two')],'m');assert.equal(result.media.length,2);assert.ok(result.media.every(m=>m.uploadedBy==='commish'));assert.equal(result.submission.staffAuthorizedBy,'commish');assert.deepEqual(f.service.readOriginal(f.game.gameId,result.media[0].mediaId),png);
 assert.equal(f.repository.loadAuditLog('league').at(-1).action,'game.staff-submission.started');
 await f.service.mutate(f.game.gameId,r=>r.game.locked=true);await assert.rejects(f.service.beginStaff(f.game.gameId,staff),/locked/);
});
test('staff and coach collections do not mix screenshots',async t=>{const f=fixture(t);await f.service.beginSide(f.game.gameId,f.actor);await assert.rejects(f.service.beginStaff(f.game.gameId,{...f.actor,staff:true,userId:'commish'}),/coach upload/);const other=fixture(t);await other.service.beginStaff(other.game.gameId,{...other.actor,staff:true,userId:'commish'});await assert.rejects(other.service.beginSide(other.game.gameId,other.actor),/Staff are collecting/);});
test('matchup decisions preserve scores and require the opposing team for forfeits',async t=>{const f=fixture(t),{createGameDecisionService,cpuState}=require('../src/fantasyhq/game-decisions'),service=createGameDecisionService(f.service);let reply;async function click(action,user='gm',staff=false){await service.handle({guildId:'guild',channelId:'thread',channel:{type:12},user:{id:user},memberPermissions:{has:()=>staff},member:{roles:[]},customId:`gamedecision:${action}:${f.game.gameId}`,deferReply:async()=>{},editReply:async r=>reply=r});}
 await click('fair');assert.equal(f.service.load(f.game.gameId).game.matchupDecision.confirmed,false);await click('fair','opponent');assert.equal(f.service.load(f.game.gameId).game.matchupDecision.confirmed,true);assert.equal(f.service.load(f.game.gameId).game.result,undefined);
 await service.handle({guildId:'guild',channelId:'thread',channel:{type:12},user:{id:'gm'},memberPermissions:{has:()=>false},member:{roles:[]},customId:`gamedecision:forfeit:${f.game.gameId}:a`,deferReply:async()=>{},editReply:async r=>reply=r});assert.match(reply,/cannot award yourself/);
 f.repository.saveOwners('league',[]);assert.equal(cpuState(f.repository,f.game).matchupType,'CPU_VS_CPU');f.repository.saveSettings('league',{testMode:true});assert.equal(cpuState(f.repository,f.game).matchupType,'TEST');
});

test('game-date modal validates dates, saves history, reveals controls and enforces access',async t=>{
 const f=fixture(t),{createGameDateHandler,parseGameDate}=require('../src/fantasyhq/game-date');
 assert.equal(parseGameDate('2/29/2028'),'02/29/2028');
 for(const invalid of ['2/29/2027','13/1/2027','10/32/2027','tomorrow','10/24/27'])assert.throws(()=>parseGameDate(invalid));
 await f.service.mutate(f.game.gameId,r=>{delete r.game.inGameDate;r.game.discordMessageId='card';});
 let reply,modal,card;const handle=createGameDateHandler(f.service);
 const interaction={guildId:'guild',channelId:'thread',channel:{type:12,messages:{fetch:async()=>({edit:async p=>card=p})}},user:{id:'gm'},memberPermissions:{has:()=>false},member:{roles:[]},customId:`gamedate:${f.game.gameId}`,isButton:()=>true,showModal:async m=>modal=m,reply:async p=>reply=p,deferReply:async()=>{},editReply:async p=>reply=p};
 const before=gamePayload(f.service.load(f.game.gameId).game);assert.equal(before.components.length,1);assert.equal(before.components[0].components[0].data.label,'Set game date');
 await handle(interaction);assert.equal(modal.toJSON().components[0].components[0].placeholder,'Example: 10/24/2027');
 const save={...interaction,isButton:()=>false,customId:`gamedatesave:${f.game.gameId}`,fields:{getTextInputValue:()=> '10/24/2027'}};
 await handle(save);assert.equal(f.service.load(f.game.gameId).game.inGameDate,'10/24/2027');assert.match(reply,/buttons are now available/);assert.equal(card.components.length,3);assert.equal(card.embeds[0].data.fields[0].value,'**10/24/2027**');assert.equal(card.components[1].components[0].data.label,'Submit Score');
 await handle({...save,user:{id:'stranger'}});assert.match(reply.content,/Only an owner/);
 await handle({...save,channelId:'other'});assert.match(reply.content,/private thread/);
 await handle({...save,fields:{getTextInputValue:()=> '2/30/2027'}});assert.match(reply.content || reply,/valid calendar date/);assert.equal(f.service.load(f.game.gameId).game.inGameDate,'10/24/2027');
 f.repository.saveOwners('league',[]);await handle({...save,user:{id:'staff'},memberPermissions:{has:()=>true},fields:{getTextInputValue:()=> '10/25/2027'}});assert.equal(f.service.load(f.game.gameId).game.inGameDate,'10/25/2027');assert.equal(f.service.load(f.game.gameId).game.inGameDateHistory.length,2);
 await f.service.mutate(f.game.gameId,r=>{r.game.locked=true;});await handle({...save,user:{id:'staff'},memberPermissions:{has:()=>true}});assert.match(reply.content,/unlocked/);
});

test('old submission and decision buttons cannot bypass required game date',async t=>{
 const f=fixture(t);await f.service.mutate(f.game.gameId,r=>delete r.game.inGameDate);
 let reply;const i={guildId:'guild',channelId:'thread',channel:{type:12},user:{id:'gm'},memberPermissions:{has:()=>false},member:{roles:[]},deferReply:async()=>{},editReply:async p=>reply=p};
 const adapter=createDiscordGameSubmissions(f.service,{extractor:null});
 for(const action of ['gamesubmit','gamestaff','gameextract']){await adapter.button({...i,customId:`${action}:${f.game.gameId}:latest`});assert.match(reply.content,/Set the NBA 2K game date/);}
 for(const action of ['fair','forfeit','cpu']){await require('../src/fantasyhq/game-decisions').createGameDecisionService(f.service).handle({...i,customId:`gamedecision:${action}:${f.game.gameId}:b`});assert.match(reply,/Set the NBA 2K game date/);}
 assert.equal(f.service.load(f.game.gameId).submissions.length,0);
});

test('Staff Submit and cancel controls enforce staff access; both forfeit buttons and CPU respond',async t=>{
 const f=fixture(t),adapter=createDiscordGameSubmissions(f.service,{extractor:null});let reply;
 const i={guildId:'guild',channelId:'thread',channel:{type:12},user:{id:'staff'},memberPermissions:{has:()=>true},member:{roles:[]},deferReply:async()=>{},editReply:async p=>reply=p};
 await adapter.button({...i,memberPermissions:{has:()=>false},customId:`gamestaff:${f.game.gameId}`});assert.match(reply.content,/Commish/);
 await adapter.button({...i,customId:`gamestaff:${f.game.gameId}`});assert.match(reply.embeds[0].data.description,/0 \/ 2/);
 const sid=f.service.load(f.game.gameId).submissions.at(-1).submissionId;
 await adapter.button({...i,customId:`gamecancel:${f.game.gameId}:${sid}`});assert.match(reply,/cancelled/);
 const decisions=require('../src/fantasyhq/game-decisions').createGameDecisionService(f.service);
 for(const winner of ['a','b']){await decisions.handle({...i,customId:`gamedecision:forfeit:${f.game.gameId}:${winner}`});assert.equal(f.service.load(f.game.gameId).game.matchupDecision.winnerTeamId,winner);assert.match(reply,/Decision recorded/);}
 await decisions.handle({...i,customId:`gamedecision:cpu:${f.game.gameId}`});assert.match(reply,/Staff Submit accepts both/);
 assert.equal(f.service.load(f.game.gameId).game.result,undefined);
});
