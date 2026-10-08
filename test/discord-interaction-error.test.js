const test = require("node:test");
const assert = require("node:assert/strict");
const { replyInteractionError } = require("../src/shared/discord-interaction-error");

test("expired or already-acknowledged interactions cannot crash the client error handler", async () => {
    const logged = [], logger = { error: (...values) => logged.push(values) };
    for (const code of [10062, 40060]) {
        const interaction = { deferred: false, replied: false, reply: async () => { throw Object.assign(new Error("expired"), { code }); } };
        await assert.doesNotReject(replyInteractionError(interaction, new Error("handler failed"), logger));
    }
    assert.equal(logged.length, 2);
});

test("active interactions receive the original failure message", async () => {
    let payload;
    const interaction = { deferred: false, replied: false, reply: async value => { payload = value; } };
    await replyInteractionError(interaction, new Error("invalid action"), { error() { } });
    assert.equal(payload.content, "Error: invalid action");
});
test('acknowledgment finishes before slow role synchronization and preserves route response options', async () => {
    const { runDiscordInteraction } = require('../src/shared/discord-interaction-error');
    for (const method of ['deferReply', 'deferUpdate', 'reply', 'update', 'showModal']) {
        const order = [], payload = { flags: 64 }, interaction = { guild: {}, member: {}, [method]: async value => { assert.equal(value, payload); order.push('ack'); } };
        const original = interaction[method];
        await runDiscordInteraction(interaction, async i => { await i[method](payload); order.push('work'); }, { refreshActor: async () => { assert.deepEqual(order, ['ack']); order.push('sync'); } });
        assert.deepEqual(order, ['ack', 'sync', 'work']); assert.equal(interaction[method], original);
    }
});

test('expired cleanup acknowledgment stops destructive work and cannot reject the gateway listener', async () => {
    const { runDiscordInteraction } = require('../src/shared/discord-interaction-error');
    let cleaned = false, synchronized = false, replies = 0;
    const interaction = { guild: {}, deferReply: async () => { throw Object.assign(Error('Unknown interaction'), { code: 10062 }); }, reply: async () => replies++ };
    await assert.doesNotReject(runDiscordInteraction(interaction, i => require('../src/fantasyhq/discord-game-cleanup').handleCleanupButton(i, {cleanup: async () => cleaned = true}), { refreshActor: async () => synchronized = true, logger: { error() {} } }));
    assert.equal(cleaned, false); assert.equal(synchronized, false); assert.equal(replies, 0);
});

test('role verification failure blocks work after acknowledgment and reports privately', async () => {
    const { runDiscordInteraction } = require('../src/shared/discord-interaction-error');
    let worked = false, reply;
    const interaction = { guild: {}, deferReply: async () => interaction.deferred = true, editReply: async value => reply = value };
    await runDiscordInteraction(interaction, async i => { await i.deferReply({ flags: 64 }); worked = true; }, { refreshActor: async () => { throw Error('roles unavailable'); }, logger: { error() {} } });
    assert.equal(worked, false); assert.match(reply, /Could not verify your current team roles/);
});

test('client diagnostics omit token-bearing Discord URLs and request bodies', () => {
    const { logDiscordClientError } = require('../src/shared/discord-interaction-error');
    const values = []; logDiscordClientError(Object.assign(Error('Unknown interaction'), { code: 10062, url: 'secret-interaction-token', requestBody: { token: 'secret' } }), { error: (...args) => values.push(args) });
    assert.doesNotMatch(JSON.stringify(values), /secret/); assert.match(JSON.stringify(values), /10062/);
});

test('transaction builders reconcile before mutation and retain source updates and private responses', async () => {
 const {runDiscordInteraction}=require('../src/shared/discord-interaction-error');const order=[];let updates=0,privateReplies=0;
 const interaction={guild:{},member:{},customId:'trade:submit:proposal',isButton:()=>true,deferUpdate:async()=>order.push('ack'),update:async()=>{throw Error('double acknowledgment');},reply:async()=>{throw Error('double acknowledgment');},editReply:async()=>updates++,followUp:async payload=>{assert.equal(payload.flags,64);privateReplies++;}};
 await runDiscordInteraction(interaction,async i=>{assert.deepEqual(order,['ack','sync']);order.push('mutation');await i.update({content:'updated'});await i.reply({content:'private',flags:64});},{refreshActor:async()=>order.push('sync')});
 assert.equal(updates,1);assert.equal(privateReplies,1);
});

test('modal-opening controls remain available without a preemptive defer', () => {
 const {updatesSourceMessage}=require('../src/shared/discord-interaction-error');
 for(const customId of ['fa:player:id','fa:edit:id','fa:correct:id','upgrades:mode:id:OVR_CHANGED','upgrades:mode:id:BOTH_CHANGED','mock:search:id','gamedate:id','post:extend'])assert.equal(updatesSourceMessage({isButton:()=>true,customId}),false,customId);
});

test('private eligibility/history responses are not converted into public source updates', () => {
 const {updatesSourceMessage}=require('../src/shared/discord-interaction-error');
 for(const action of ['eligibility','history','approve','mode','request'])assert.equal(updatesSourceMessage({isButton:()=>true,customId:'upgrades:'+action+':id:NO_CHANGE'}),false);
});
