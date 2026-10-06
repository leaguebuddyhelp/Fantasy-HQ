const test = require('node:test');
const assert = require('node:assert/strict');
const { statsPayload } = require('../src/fantasyhq/discord-league-feeds');
test('eight stat leader categories rank five players, exclude no games and zero shooting attempts', () => {
    const players = Array.from({ length: 7 }, (_, i) => ({ playerId: String(i), name: `Player ${i}`, teamName: 'Boston Celtics', GP: 2, PPG: i, RPG: i, APG: i, SPG: i, BPG: i, FGPercent: 40 + i, threePPercent: 30 + i, FTPercent: 70 + i, FGA: 10, '3PA': 5, FTA: 4 }));
    players.push({ ...players[6], name: 'No games', GP: 0, PPG: 100 });
    players.push({ ...players[6], name: 'No attempts', FGA: 0, '3PA': 0, FTA: 0, FGPercent: 100, threePPercent: 100, FTPercent: 100 });
    const embed = statsPayload(players, { seasonId: '1', league: { currentWeek: 2 } }).embeds[0].toJSON();
    assert.equal(embed.fields.length, 8);
    for (const field of embed.fields) {
        assert.equal((field.value.match(/\*\*\d\./g) || []).length, 5);
        assert.ok(!field.value.includes('No games'));
        assert.ok(field.value.length <= 1024);
    }
    for (const field of embed.fields.slice(5)) {
        assert.ok(!field.value.includes('No attempts'));
        assert.ok(field.value.startsWith('**1. Player 6**'));
        assert.ok(field.value.includes('%'));
    }
    assert.ok(JSON.stringify(embed).length < 6000);
});
test('empty stats pin explicitly shows no official stats in every category', () => {
    const embed = statsPayload([], { seasonId: '1', league: {} }).embeds[0].toJSON();
    assert.ok(embed.fields.every(field => field.value === 'No official stats yet.'));
});
