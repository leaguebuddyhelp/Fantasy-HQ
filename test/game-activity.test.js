const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { createGameSubmissionService } = require('../src/fantasyhq/game-submissions');
const { createGameActivityService, activityView } = require('../src/fantasyhq/game-activity');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-activity-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const repository = createFantasyHQRepository({ dataRoot: root }), start = Date.parse('2026-01-01T00:00:00Z'); let time = start;
    repository.saveLeague('test', { currentPhase: 'REGULAR_SEASON', currentSeasonId: '1', currentWeek: 1 }); repository.saveTeams('test', [{ teamId: 'a', teamName: 'Team A', abbreviation: 'A', conference: 'East' }, { teamId: 'b', teamName: 'Team B', abbreviation: 'B', conference: 'East' }]); repository.saveGuildLeagueBinding('guild', { leagueId: 'test', seasonId: '1' }); repository.saveOwners('test', [{ teamId: 'a', userId: 'alice' }, { teamId: 'b', userId: 'bob' }]); repository.saveSchedule({ leagueId: 'test', seasonId: '1', weeks: [{ week: 1, weekId: 'week1', status: 'ACTIVE', startedAt: new Date(start).toISOString(), deadlineAt: new Date(start + 48 * 3600000).toISOString(), games: [{ team1Id: 'a', team2Id: 'b' }] }] });
    const submissions = createGameSubmissionService({ repository, download: async () => Buffer.from([255, 216, 255, 0]) });
    const { game } = submissions.bind({ guildId: 'guild', discordThreadId: 'thread', privateThread: true, weekNumber: 1, teamQuery: 'a' });
    const sent = [], edits = []; const channel = { id: 'thread', type: 12, messages: { fetch: async () => ({ edit: async p => edits.push(p) }) }, send: async p => sent.push(p) };
    const client = { guilds: { fetch: async () => ({ channels: { fetch: async () => channel } }) } };
    const options = { submissions, now: () => time, logger: { error() { } } }; const service = createGameActivityService(options);
    const event = userId => ({ guildId: 'guild', threadId: 'thread', userId, privateThread: true, eventId: userId + '-' + time });
    return { repository, submissions, game, service, options, client, channel, sent, edits, event, setHours: h => time = start + h * 3600000, view: () => activityView(submissions.load(game.gameId), time) };
}
test('participation distinguishes neither, either and both coaches; no message content stored', async t => {
    const f = fixture(t); assert.equal(f.view().status, 'NO ACTIVITY');
    await f.service.recordActivity({ ...f.event('bob'), content: 'private conversation' }); assert.equal(f.view().status, 'WAITING ON TEAM A'); assert.equal(f.view().teams[0].participated, false);
    await f.service.recordActivity(f.event('alice')); assert.equal(f.view().status, 'ACTIVE');
    const another = fixture(t); await another.service.recordActivity(another.event('alice')); assert.equal(another.view().status, 'WAITING ON TEAM B');
    assert.ok(!JSON.stringify(f.submissions.load(f.game.gameId)).includes('private conversation')); assert.equal(f.view().count, 2);
});
test('bots, unrelated users, wrong threads and duplicate last event do not count', async t => {
    const f = fixture(t); for (const event of [{ ...f.event('alice'), bot: true }, f.event('stranger'), { ...f.event('alice'), threadId: 'other' }, { ...f.event('alice'), privateThread: false }]) assert.equal(await f.service.recordActivity(event), false);
    await f.service.recordActivity(f.event('alice')); await f.service.recordActivity(f.event('alice')); assert.equal(f.view().count, 1);
});
test('normal messages and screenshot uploads count; successful submission suppresses reminders', async t => {
    const f = fixture(t); for (const userId of ['alice', 'bob']) {
        await f.service.message({ id: 'message-' + userId, guildId: 'guild', channelId: 'thread', channel: f.channel, author: { id: userId, bot: false }, attachments: new Map() });
        const actor = { guildId: 'guild', discordThreadId: 'thread', privateThread: true, userId }; await f.submissions.beginSide(f.game.gameId, actor); await f.submissions.receiveSide(f.game.gameId, actor, [{ id: userId, name: 'box.jpg', contentType: 'image/jpeg', size: 4, url: 'https://cdn.discordapp.com/attachments/' + userId }], userId);
    }
    assert.equal(f.view().status, 'GAME SUBMITTED'); assert.equal(f.view().screenshots, 2); assert.ok(f.view().teams.every(t => t.participated)); f.setHours(43); await f.service.tick(f.client); assert.equal(f.sent.length, 0);
});
test('game buttons count only for matching linked game and owner', async t => {
    const f = fixture(t); const interaction = { id: 'click', customId: 'gamesubmit:' + f.game.gameId, guildId: 'guild', channelId: 'thread', channel: f.channel, user: { id: 'alice' } };
    await f.service.button({ ...interaction, customId: 'gamesubmit:wrong' }); assert.equal(f.view().count, 0); await f.service.button(interaction); assert.equal(f.view().status, 'WAITING ON TEAM B');
});
test('24-hour reminder identifies inactive coach; both-active games skip it', async t => {
    const f = fixture(t); await f.service.recordActivity(f.event('alice')); f.setHours(24); await f.service.tick(f.client); assert.equal(f.sent.length, 1); assert.deepEqual(f.sent[0].allowedMentions.users, ['bob']); assert.match(f.sent[0].embeds[0].toJSON().description, /Team B.*No activity/); await f.service.tick(f.client); assert.equal(f.sent.length, 1);
    const both = fixture(t); await both.service.recordActivity(both.event('alice')); await both.service.recordActivity(both.event('bob')); both.setHours(24); await both.service.tick(both.client); assert.equal(both.sent.length, 0);
});
test('6-hour warning and deadline flag persist across restart without forfeits or clock reset', async t => {
    const f = fixture(t), before = f.repository.loadSchedule('test', '1'); f.setHours(24); await f.service.tick(f.client); assert.deepEqual(f.sent[0].allowedMentions.users, ['alice', 'bob']); f.setHours(42); await f.service.tick(f.client); assert.equal(f.sent[1].embeds[0].toJSON().title, '6 HOURS REMAINING');
    const restarted = createGameActivityService(f.options); await restarted.tick(f.client); assert.equal(f.sent.length, 2); f.setHours(48); await restarted.tick(f.client); assert.equal(f.view().status, 'PAST DEADLINE'); assert.equal(f.sent[2].embeds[0].toJSON().title, 'DEADLINE REACHED'); await restarted.tick(f.client); assert.equal(f.sent.length, 3); assert.equal(f.submissions.load(f.game.gameId).game.status, 'SCHEDULED'); assert.deepEqual(f.repository.loadSchedule('test', '1'), before);
});
test('completed games stop reminders; card reflects activity and completion only on meaningful changes', async t => {
    const f = fixture(t); await f.submissions.setMessage(f.game.gameId, 'card'); await f.service.tick(f.client); const edits = f.edits.length; await f.service.tick(f.client); assert.equal(f.edits.length, edits);
    await f.service.message({ id: 'hi', guildId: 'guild', channelId: 'thread', channel: f.channel, author: { id: 'alice' } }); assert.match(f.edits.at(-1).embeds[0].toJSON().description, /WAITING ON TEAM B/);
    await f.submissions.mutate(f.game.gameId, r => r.game.status = 'FINAL'); f.setHours(49); await f.service.tick(f.client); assert.equal(f.sent.length, 0); assert.equal(f.view().status, 'COMPLETE'); assert.match(f.edits.at(-1).embeds[0].toJSON().description, /COMPLETE/);
});
test('game activity persists in service status without the removed website thread panel', async t => {
    const f = fixture(t); await f.service.recordActivity(f.event('alice')); await f.service.tick(f.client);
    const { createGameThreadService } = require('../src/fantasyhq/game-threads'); const view = createGameThreadService({ submissions: f.submissions }).status('guild'); assert.equal(view.games[0].activity.teams[0].lastActivityUserId, 'alice'); assert.equal(view.games[0].activity.teams[1].participated, false);
    const restarted = createGameActivityService(f.options); f.setHours(1); await restarted.recordActivity(f.event('bob')); assert.equal(f.view().count, 2); assert.equal(f.view().status, 'ACTIVE');
    const ui = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8'); assert.doesNotMatch(ui, /No activity yet|Commissioner attention required/);
});
test('late restart sends only current alert and failed sends are not repeatedly retried', async t => {
    const f = fixture(t); f.setHours(49); await f.service.tick(f.client); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].embeds[0].toJSON().title, 'DEADLINE REACHED'); assert.deepEqual(f.sent[0].allowedMentions.users, []);
    const failed = fixture(t); let attempts = 0; failed.channel.send = async () => { attempts++; throw Error('Discord unavailable'); }; failed.setHours(24); await failed.service.tick(failed.client); await createGameActivityService(failed.options).tick(failed.client); assert.equal(attempts, 1); assert.equal(failed.submissions.load(failed.game.gameId).game.activityReminders['24h'].error, 'Discord unavailable');
});
