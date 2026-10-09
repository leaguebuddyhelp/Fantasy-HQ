const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { bigBoardPagePayload, handleBigBoardButton, handleBigBoardCommand, handleBigBoardSelect, handleScoutCommand, handleScoutingAutocomplete, scoutingCard } = require('../src/fantasyhq/discord-scouting');

function info(level, imagePath = null, boardNumber = 1) {
    const prospect = {
        board_number: boardNumber,
        name: `Test Prospect ${boardNumber}`,
        team: 'Duke',
        position_1: 'PG',
        position_2: 'SG',
        class: 'FR',
        age: 19,
        height: `6'5"`,
        weight: 200,
        wingspan: `6'9"`,
        about: 'Playmaking guard with a strong transition game.',
        pts: 20,
        rbs: 5,
        ast: 8,
        strength_1: 'Vision',
        weakness_1: 'Shooting consistency',
        'draft score': 88.25,
        overall: 80,
        potential: 95,
        imagePath,
    };
    return {
        prospect,
        seasonNumber: 1,
        weekNumber: 2,
        remaining: 60 - (level * 10),
        level,
        reveals: [
            { label: 'Draft Grade', field: 'draft score', unlocked: level >= 1 },
            { label: 'OVR', field: 'overall', unlocked: level >= 2 },
            { label: 'Potential', field: 'potential', unlocked: level >= 3 },
        ],
    };
}

test('locked Big Board card omits hidden rating values and includes readable scouting details', () => {
    const card = scoutingCard(info(0));
    const serialized = JSON.stringify(card.embeds[0].toJSON());
    assert.match(serialized, /Test Prospect/);
    assert.match(serialized, /Playmaking guard/);
    assert.match(serialized, /Locked/);
    assert.doesNotMatch(serialized, /88\.25|"80"|"95"/);
    assert.match(serialized, /60\/60 points remaining/);
});

test('Big Board navigation renders a compact ten-player list and advances pages', async () => {
    let rendered, deferred = false;
    const pageAt = requested => {
        const page = Math.max(0, Math.min(2, Number(requested) || 0));
        return {
            page,
            totalPages: 3,
            seasonNumber: 1,
            prospects: Array.from({ length: page === 2 ? 5 : 10 }, (_, index) => info(0, null, page * 10 + index + 1)),
        };
    };
    const scoutingService = { boardPage: (guildId, userId, page) => { assert.equal(guildId, 'guild'); assert.equal(userId, 'coach'); return pageAt(page); } };
    await handleBigBoardCommand({ guildId: 'guild', user: { id: 'coach' }, editReply: async payload => { rendered = payload; } }, scoutingService);
    assert.equal(rendered.embeds.length, 1);
    assert.equal(rendered.files?.length || 0, 0);
    assert.equal(rendered.embeds[0].data.title, 'Season 1 Big Board');
    assert.match(rendered.embeds[0].data.description, /\*\*#1 Test Prospect 1\*\* · PG\/SG · Duke/);
    const choices = rendered.components[1].toJSON().components[0].options;
    assert.equal(choices.length, 10);
    assert.equal(choices[0].value, '1');
    assert.equal(rendered.components[0].toJSON().components[2].disabled, false);
    const nextId = rendered.components[0].toJSON().components[2].custom_id;
    await handleBigBoardButton({ customId: nextId, guildId: 'guild', user: { id: 'coach' }, message: { flags: { has: () => true } }, deferUpdate: async () => { deferred = true; }, editReply: async payload => { rendered = payload; } }, scoutingService);
    assert.equal(deferred, true);
    assert.equal(rendered.embeds.length, 1);
    assert.match(rendered.embeds[0].data.description, /#11 Test Prospect 11/);
    const lastId = rendered.components[0].toJSON().components[3].custom_id;
    await handleBigBoardButton({ customId: lastId, guildId: 'guild', user: { id: 'coach' }, message: { flags: { has: () => true } }, deferUpdate: async () => { }, editReply: async payload => { rendered = payload; } }, scoutingService);
    assert.equal(rendered.embeds.length, 1);
    assert.match(rendered.embeds[0].data.description, /#21 Test Prospect 21/);
    assert.equal(rendered.components[1].toJSON().components[0].options.length, 5);
});

test('selecting a Big Board player opens their full private card and Back restores the same page', async () => {
    let rendered;
    const page = { page: 1, totalPages: 3, seasonNumber: 1, total: 25, start: 10, prospects: Array.from({ length: 10 }, (_, index) => ({ prospect: { board_number: 11 + index, name: `Test Prospect ${11 + index}`, position_1: 'PG', position_2: 'SG', team: 'Duke' } })) };
    const scoutingService = {
        boardPage: (guildId, userId, pageNumber) => ({ ...page, page: pageNumber, prospects: page.prospects }),
        inspect: (guildId, userId, rank) => info(2, null, Number(rank)),
    };
    await handleBigBoardSelect({ customId: 'bigboard:select:1', values: ['14'], guildId: 'guild', user: { id: 'coach' }, message: { flags: { has: () => true } }, deferUpdate: async () => { }, editReply: async payload => { rendered = payload; } }, scoutingService);
    assert.equal(rendered.embeds[0].data.title, '#14 Test Prospect 14');
    const intel = rendered.embeds[0].data.fields.find(field => field.name === 'Scouting intel').value;
    assert.match(intel, /Draft Grade.*88\.25/);
    assert.match(intel, /OVR.*80/);
    assert.match(intel, /Locked.*Potential/);
    const backId = rendered.components[0].toJSON().components[0].custom_id;
    await handleBigBoardButton({ customId: backId, guildId: 'guild', user: { id: 'coach' }, message: { flags: { has: () => true } }, deferUpdate: async () => { }, editReply: async payload => { rendered = payload; } }, scoutingService);
    assert.equal(rendered.embeds[0].data.title, 'Season 1 Big Board');
    assert.match(rendered.embeds[0].data.description, /#11 Test Prospect 11/);
});

test('unlocked Big Board card shows only ratings revealed to this coach and attaches the portrait', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-scout-card-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const imagePath = path.join(root, 'prospect.png');
    fs.writeFileSync(imagePath, Buffer.from([137, 80, 78, 71]));
    const card = scoutingCard(info(2, imagePath));
    const serialized = JSON.stringify(card.embeds[0].toJSON());
    assert.match(serialized, /88\.25/);
    assert.match(serialized, /80/);
    assert.doesNotMatch(serialized, /Potential · \*\*95\*\*/);
    assert.equal(card.files.length, 1);
    assert.match(card.embeds[0].data.thumbnail.url, /^attachment:\/\/bigboard-1\.png$/);
});

test('prospect autocomplete returns the filtered Big Board choices', async () => {
    let result;
    await handleScoutingAutocomplete({ guildId: 'guild', options: { getFocused: () => 'char' }, respond: async choices => { result = choices; } }, {
        prospects: (guildId, focused) => {
            assert.equal(guildId, 'guild');
            assert.equal(focused, 'char');
            return [{ name: '#1 Léandre Charbonneau', value: '1' }];
        },
    });
    assert.deepEqual(result, [{ name: '#1 Léandre Charbonneau', value: '1' }]);
});

test('scout autocomplete passes the selected position filter', async () => {
    let result;
    await handleScoutingAutocomplete({ guildId: 'guild', commandName: 'scout', options: { getFocused: () => 'jo', getString: name => name === 'position' ? 'C' : null }, respond: async choices => { result = choices; } }, {
        prospects: (guildId, focused, position) => {
            assert.equal(guildId, 'guild');
            assert.equal(focused, 'jo');
            assert.equal(position, 'C');
            return [{ name: '#2 Awut Jok', value: '2' }];
        },
    });
    assert.deepEqual(result, [{ name: '#2 Awut Jok', value: '2' }]);
});

test('/scout refuses to spend points outside the configured Scouting Hub', async () => {
    let spends = 0, reply;
    const service = {
        scoutingHubChannelId: () => 'scouting-hub',
        scout: (guildId, userId, prospect, position) => { assert.equal(position, 'PG'); spends++; return info(1); },
    };
    const interaction = {
        guildId: 'guild',
        channelId: 'general',
        user: { id: 'coach' },
        options: { getString: name => name === 'position' ? 'PG' : '1' },
        editReply: async value => { reply = value; },
    };
    await handleScoutCommand(interaction, service);
    assert.equal(spends, 0);
    assert.match(reply, /<#scouting-hub>/);
    await handleScoutCommand({ ...interaction, channelId: 'scouting-hub' }, service);
    assert.equal(spends, 1);
    assert.ok(reply.embeds);
});