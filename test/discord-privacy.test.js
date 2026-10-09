const test = require('node:test');
const assert = require('node:assert/strict');
const { commandReplyFlags, acknowledgePrivateComponent, respondPrivately } = require('../src/shared/discord-privacy');
const { replyInteractionError } = require('../src/shared/discord-interaction-error');

test('personal, staff and destructive slash actions are private; shared information remains public', () => {
    const flags = (commandName, subcommand) => commandReplyFlags({ commandName, options: { getSubcommand: () => subcommand } });
    for (const name of ['myteam', 'mockdraft', 'bigboard', 'scout', 'upgrades', 'admin', 'league', 'roster', 'game', 'games', 'week', 'activitycheck', 'tradeblock', 'new-command']) assert.equal(flags(name), 64, name);
    for (const sub of ['create', 'cleanup']) assert.equal(flags('games', sub), 64);
    for (const sub of ['setup', 'create', 'delete', 'settings', 'roles', 'status']) assert.equal(flags('league', sub), 64);
    for (const sub of ['mine', 'preview', 'generate', 'regenerate', 'confirm']) assert.equal(flags('schedule', sub), 64);
    for (const sub of ['assign', 'unassign']) assert.equal(flags('team', sub), 64);
    for (const name of ['website', 'promo', 'availableteams', 'standings', 'stats', 'teamstats', 'player', 'ratings', 'freeagents', 'toptenpreview']) assert.equal(flags(name), 0, name);
    for (const sub of ['week', 'team', 'full']) assert.equal(flags('schedule', sub), 0);
    for (const sub of ['list', 'roster']) assert.equal(flags('team', sub), 0);
    assert.match(require('fs').readFileSync('src/index.js', 'utf8'), /deferReply\(\{ flags: require\('\.\/shared\/discord-privacy'\)\.commandReplyFlags\(interaction\) \}\)/);
});

test('personal component replies never overwrite a public source; private pagination reuses its panel', async () => {
    for (const isPrivate of [false, true]) {
        const calls = [];
        const i = { message: { flags: { has: () => isPrivate } }, deferUpdate: async () => calls.push(['update']), deferReply: async p => calls.push(['reply', p]) };
        await acknowledgePrivateComponent(i);
        assert.equal(calls[0][0], isPrivate ? 'update' : 'reply');
        if (!isPrivate) assert.equal(calls[0][1].flags, 64);
        const response = { ...i, update: async p => calls.push(['updatePayload', p]), reply: async p => calls.push(['replyPayload', p]) };
        await respondPrivately(response, { content: 'private history' });
        assert.equal(calls[1][0], isPrivate ? 'updatePayload' : 'replyPayload');
        if (!isPrivate) assert.equal(calls[1][1].flags, 64);
    }
});

test('public slash failures show detailed errors only in ephemeral followups', async () => {
    const publicMessages = [], privateMessages = [];
    const i = { deferred: true, replied: false, ephemeral: false, editReply: async p => publicMessages.push(p), followUp: async p => privateMessages.push(p) };
    await replyInteractionError(i, Error('sensitive validation detail'), { error() {} });
    assert.doesNotMatch(JSON.stringify(publicMessages), /sensitive validation detail/);
    assert.equal(privateMessages[0].flags, 64);
    assert.match(privateMessages[0].content, /sensitive validation detail/);
    i.deferred = false; i.replied = true;
    await replyInteractionError(i, Error('another private error'), { error() {} });
    assert.equal(publicMessages.length, 1);
    assert.equal(privateMessages.length, 2);
});

test('source-update failures keep shared messages intact and private errors private', async () => {
    let edited = false, payload;
    await replyInteractionError({ deferred: true, editReply: async () => edited = true, followUp: async p => payload = p }, Error('staff action denied'), { error() {} }, true);
    assert.equal(edited, false); assert.equal(payload.flags, 64);
});

test('legacy public Big Board controls cannot publish a coach unlocked scouting card', async () => {
    const { handleBigBoardSelect } = require('../src/fantasyhq/discord-scouting');
    let privateAck, edited;
    const prospect = { board_number: 1, name: 'Secret prospect', about: 'Scouting report', overall: 99, potential: 99, 'draft score': 99 };
    const i = { customId: 'bigboard:select:0', values: ['1'], guildId: 'g', user: { id: 'coach' }, message: { flags: { has: () => false } }, deferReply: async p => privateAck = p, deferUpdate: async () => assert.fail('Public source must not be updated'), editReply: async p => edited = p };
    await handleBigBoardSelect(i, { boardPage: () => ({ prospects: [{ prospect }] }), inspect: () => ({ prospect, remaining: 30, reveals: [{ label: 'OVR', field: 'overall', unlocked: true }] }) });
    assert.equal(privateAck.flags, 64); assert.match(JSON.stringify(edited), /99/);
});

test('failed role verification after a public acknowledgment cannot expose its reason or run handler work', async () => {
    const { runDiscordInteraction } = require('../src/shared/discord-interaction-error');
    const calls = []; let worked = false;
    const i = { guild: {}, member: {}, commandName: 'player', ephemeral: false,
        deferReply: async () => { i.deferred = true; calls.push('ack'); },
        editReply: async p => { assert.doesNotMatch(JSON.stringify(p), /private role diagnostic/); i.replied = true; calls.push('generic'); },
        followUp: async p => { assert.equal(p.flags, 64); assert.match(p.content, /private role diagnostic/); calls.push('private'); } };
    await runDiscordInteraction(i, async interaction => { await interaction.deferReply({ flags: 0 }); worked = true; }, {
        refreshActor: async () => { throw Error('private role diagnostic'); }, logger: { error() {} },
    });
    assert.equal(worked, false); assert.deepEqual(calls, ['ack', 'generic', 'private']);
});
