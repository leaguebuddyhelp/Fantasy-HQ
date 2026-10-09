const test = require('node:test');
const assert = require('node:assert/strict');
const { EmbedBuilder } = require('discord.js');
const { weekCard, teamScheduleCard, addListFields } = require('../src/shared/discord-layout');
const { generateSchedule } = require('../src/fantasyhq/schedule-generator');
const fs = require('fs'), vm = require('vm'), path = require('path');
const { createRequire } = require('module');
test('saved schedules remain readable and complete without code blocks', () => {
    const teams = ['East', 'West'].flatMap(conference => Array.from({ length: 15 }, (_, i) => ({ teamId: `${conference}-${i}`, teamName: `${conference} Team ${i}`, abbreviation: `${conference[0]}${i}`, conference })));
    const schedule = generateSchedule({ leagueId: 'test', seasonId: '1', teams }); const context = { teams, league: { name: 'Test' } };
    for (let w = 1; w <= 15; w++) { const data = weekCard(context, schedule, w).toJSON(); assert.ok(!JSON.stringify(data).includes('```')); const text = data.fields.map(f => f.value).join('\n'); for (const game of schedule.weeks[w - 1].games) { assert.ok(text.includes(teams.find(t => t.teamId === game.team1Id).teamName)); } assert.ok(data.fields.every(f => f.value.length <= 1024)); }
    const data = teamScheduleCard(context, schedule, teams[0]).toJSON(); const text = data.fields.map(f => f.value).join('\n'); for (let w = 1; w <= 15; w++)assert.ok(text.includes(`**Week ${w}**`)); assert.match(text, /bye/);
});
test('long roster lists split at field boundaries without dropping players', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `Player ${i} ${'name '.repeat(15)}`); const embed = addListFields(new EmbedBuilder().setTitle('Roster'), 'Roster', lines).toJSON(); assert.deepEqual(embed.fields.flatMap(f => f.value.split('\n')), lines); assert.ok(embed.fields.every(f => f.value.length <= 1024));
});
test('command menu removes duplicates but retains browsing and recovery', () => {
    const file = path.resolve('deploy-commands.js'); const c = { require: createRequire(file) }; vm.runInNewContext(fs.readFileSync(file, 'utf8').split('async function main()')[0] + ';globalThis.list=commands;', c);
    assert.equal(c.list.length, 25); assert.equal(new Set(c.list.map(x => x.name)).size, 25); const options = name => c.list.find(x => x.name === name).options.map(x => x.name);
    assert.deepEqual(Array.from(options('availableteams')), []);
    assert.deepEqual(Array.from(options('bigboard')), []);
    assert.deepEqual(Array.from(options('mockdraft')), []);
    assert.deepEqual(Array.from(options('toptenpreview')), []);
    assert.ok(c.list.some(x => x.name === 'website'));
    assert.ok(c.list.some(x => x.name === 'promo'));
    assert.deepEqual(Array.from(options('scout')), ['position', 'prospect']);
    assert.deepEqual(Array.from(c.list.find(x => x.name === 'scout').options[0].choices.map(choice => choice.value)), ['PG', 'SG', 'SF', 'PF', 'C']);
    assert.equal(c.list.find(x => x.name === 'scout').options[1].autocomplete, true);
    assert.deepEqual(Array.from(options('stats')), ['player']);
    assert.equal(c.list.find(x => x.name === 'stats').options[0].autocomplete, true);
    assert.deepEqual(Array.from(options('teamstats')), ['team']);
    assert.equal(c.list.find(x => x.name === 'teamstats').options[0].autocomplete, true);
    assert.deepEqual(Array.from(options('upgrades')), []);
    assert.ok(options('games').includes('create')); assert.ok(options('games').includes('cleanup')); assert.ok(options('standings').includes('conference'));
    for (const name of ['confirm', 'regenerate']) assert.ok(!options('schedule').includes(name));
    assert.ok(!options('league').includes('status')); assert.ok(options('league').includes('setup')); assert.ok(options('roster').includes('import')); assert.deepEqual(Array.from(options('admin')), ['bind']); assert.ok(!c.list.some(x => x.name === 'setup'));
});
