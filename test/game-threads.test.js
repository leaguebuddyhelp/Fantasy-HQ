const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { createLeagueService } = require('../src/fantasyhq/league-service');
const { generateSchedule } = require('../src/fantasyhq/schedule-generator');
const { createGameSubmissionService } = require('../src/fantasyhq/game-submissions');
const { createGameThreadService, HOURS_48 } = require('../src/fantasyhq/game-threads');
const { createGameThreadCleanupService } = require('../src/fantasyhq/game-thread-cleanup');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-threads-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const repository = createFantasyHQRepository({ dataRoot: root });
    const teams = ['East', 'West'].flatMap(conference => Array.from({ length: 15 }, (_, i) => ({ teamId: `${conference}-${i}`, teamName: `${conference} ${i}`, abbreviation: `${conference[0]}${i}`, conference })));
    repository.saveLeague('test', { currentPhase: 'PRESEASON', currentSeasonId: '1' }); repository.saveTeams('test', teams); repository.saveGuildLeagueBinding('guild', { leagueId: 'test', seasonId: '1' });
    repository.saveSchedule(generateSchedule({ leagueId: 'test', seasonId: '1', teams })); createLeagueService({ repository }).startRegularSeason({ leagueId: 'test', seasonId: '1', validator: () => ({ ready: true }) });
    repository.saveOwners('test', teams.map(team => ({ teamId: team.teamId, userId: 'coach-' + team.teamId }))); repository.saveSettings('test', { gamesChannelId: 'games' });
    const channels = new Map(), calls = []; let failCreate = false, failMember = false;
    function thread(id) { const members = new Set(), messages = new Map(); const result = { id, type: 12, guildId: 'guild', delete: async () => channels.delete(id), members: { add: async id => { if (failMember) { failMember = false; throw Error('Member failed'); } members.add(id); } }, messages: { fetch: async id => messages.get(id) }, send: async payload => { const m = { id: 'message-' + id, payload, edit: async p => m.payload = p }; messages.set(m.id, m); return m; }, memberIds: members, savedMessages: messages }; channels.set(id, result); return result; }
    const parent = { id: 'games', guildId: 'guild', type: 0, permissionsFor: () => ({ has: () => true }), threads: { create: async options => { if (failCreate) { failCreate = false; throw Error('Create failed'); } calls.push(options); return thread('thread-' + calls.length); } } }; channels.set('games', parent);
    const guild = { id: 'guild', members: { me: {} }, channels: { fetch: async id => id ? channels.get(id) || null : channels } };
    const staffUserIds = [], staffRoleIds = [];
    const submissions = createGameSubmissionService({ repository, download: async () => Buffer.from([255, 216, 255, 0]) }); let syncs = 0;
    const service = createGameThreadService({ submissions, syncOwners: async () => { syncs++; return { conflicts: [], staffUserIds, staffRoleIds }; }, logger: { error() { } } });
    return { staffUserIds, staffRoleIds, repository, submissions, service, guild, channels, calls, thread, failCreate: () => failCreate = true, failMember: () => failMember = true, syncs: () => syncs };
}
test('active week creates 14 private threads with correct coaches, games, controls and shared deadline; concurrent retry creates none', async t => {
    const f = fixture(t), before = f.repository.loadSchedule('test', '1'); const first = await f.service.create(f.guild);
    assert.equal(first.created, 14); assert.equal(first.failed, 0); assert.equal(f.syncs(), 1);
    const records = f.submissions.records(); assert.equal(records.length, 14);
    const week = f.repository.loadSchedule('test', '1').weeks[0]; assert.equal(Date.parse(week.deadlineAt) - Date.parse(week.startedAt), HOURS_48);
    const participating = new Set();
    for (const { game } of records) {
        const thread = f.channels.get(game.discordThreadId); assert.deepEqual([...thread.memberIds], ['coach-' + game.team1Id, 'coach-' + game.team2Id]); participating.add(game.team1Id); participating.add(game.team2Id); assert.equal(game.deadlineAt, week.deadlineAt);
        const payload = [...thread.savedMessages.values()][0].payload; assert.match(payload.embeds[0].toJSON().description, /:R>/); assert.equal(payload.components[0].toJSON().components[0].custom_id, 'gamedate:' + game.gameId);
        const submission = await f.submissions.beginSide(game.gameId, { guildId: 'guild', discordThreadId: thread.id, privateThread: true, userId: 'coach-' + game.team1Id }); assert.equal(submission.game.gameId, game.gameId);
    }
    assert.equal(participating.size, 28); assert.equal(week.byes.length, 2);
    const [again] = await Promise.all([f.service.create(f.guild), f.service.create(f.guild)]); assert.equal(again.existing, 14); assert.equal(again.created, 0); assert.equal(f.calls.length, 14); assert.deepEqual(f.repository.loadSchedule('test', '1').weeks[0], week);
    assert.ok(f.calls.every(c => c.type === 12 && c.invitable === false));
});
test('missing or invalid Games channel creates nothing', async t => { const f = fixture(t); f.repository.saveSettings('test', {}); await assert.rejects(f.service.create(f.guild), /Configure/); await assert.rejects(f.service.configure(f.guild, 'unknown'), /text channel/); f.channels.set('voice', { id: 'voice', guildId: 'guild', type: 2 }); await assert.rejects(f.service.configure(f.guild, 'voice'), /text channel/); assert.equal(f.calls.length, 0); });
test('vacant teams still create all 14 threads; assigning owners later adds access without duplicate threads', async t => { const f = fixture(t); const owners = f.repository.loadOwners('test'); f.repository.saveOwners('test', []); const first = await f.service.create(f.guild); assert.equal(first.failed, 0); assert.equal(first.created, 14); f.repository.saveOwners('test', owners); const next = await f.service.create(f.guild); assert.equal(next.created, 0); assert.equal(next.existing, 14); for (const { game } of f.submissions.records()) assert.equal(f.channels.get(game.discordThreadId).memberIds.size, 2); });
test('one failed creation retries and member failure keeps its linked thread', async t => { const f = fixture(t); f.failCreate(); const first = await f.service.create(f.guild); assert.equal(first.failed, 1); assert.equal(first.created, 13); assert.equal((await f.service.create(f.guild)).created, 1); const other = fixture(t); other.failMember(); assert.equal((await other.service.create(other.guild)).failed, 1); assert.equal(other.calls.length, 14); assert.equal((await other.service.create(other.guild)).created, 0); assert.equal(other.calls.length, 14); });
test('existing manually linked thread is reused regardless of its name or parent', async t => { const f = fixture(t), match = f.repository.loadSchedule('test', '1').weeks[0].games[0]; f.thread('manual'); const original = f.submissions.bind({ guildId: 'guild', discordThreadId: 'manual', privateThread: true, weekNumber: 1, teamQuery: match.team1Id }); const r = await f.service.create(f.guild); assert.equal(r.existing, 1); assert.equal(r.created, 13); assert.equal(f.submissions.load(original.game.gameId).game.discordThreadId, 'manual'); });
test('Discord command and website reject unauthorized creation', async () => {
    const { handleGameThreads } = require('../src/fantasyhq/discord-game-threads'); await assert.rejects(handleGameThreads({ guildId: 'guild', memberPermissions: { has: () => false }, member: { roles: [] } }, { create: () => { throw Error('Should not run'); } }), /Commish/);
    const { requestHandler } = require('../src/web'); let status; requestHandler({ url: '/api/league/admin/game-threads', method: 'POST', headers: {} }, { writeHead: c => status = c, end() { } }); assert.equal(status, 403);
});
test('confirmed games create replaces every active-week thread regardless of saved submissions and preserves game history', async t => {
    const f = fixture(t); await f.service.create(f.guild); const game = f.submissions.records()[0].game, oldIds = f.submissions.records().map(r => r.game.discordThreadId);
    const history = { submissions: [{ submissionId: 'saved', status: 'RECEIVED' }], media: [{ mediaId: 'image', submissionId: 'saved', storedFile: 'originals/image.jpg' }], extractions: [{ extractionId: 'ocr', submissionId: 'saved', status: 'READY_FOR_REVIEW' }] };
    await f.submissions.mutate(game.gameId, r => Object.assign(r, structuredClone(history)));
    const cleanup = createGameThreadCleanupService({ submissions: f.submissions }), { handleGameThreads, handleGameThreadsButton } = require('../src/fantasyhq/discord-game-threads'); let preview, result;
    const interaction = { guildId: 'guild', guild: f.guild, user: { id: 'commish', username: 'Commissioner' }, memberPermissions: { has: () => true }, member: { roles: [] }, editReply: async value => { preview = value; } };
    await handleGameThreads(interaction, f.service, cleanup); assert.equal(f.calls.length, 14); assert.equal(preview.embeds[0].data.title, 'REPLACE WEEK 1 GAME THREADS');
    const button = preview.components[0].toJSON().components[1]; assert.match(button.custom_id, /^gamerecreate:confirm:1:/);
    await handleGameThreadsButton({ ...interaction, customId: button.custom_id, deferReply: async () => { }, editReply: async value => { result = value; } }, f.service, cleanup);
    assert.equal(f.calls.length, 28); const records = f.submissions.records(); assert.equal(records.length, 14); assert.ok(records.every(r => !r.game.discordThreadCleanedAt)); assert.equal(new Set(records.map(r => r.game.discordThreadId)).size, 14); assert.ok(records.every(r => !oldIds.includes(r.game.discordThreadId)));
    assert.deepEqual(Object.fromEntries(['submissions', 'media', 'extractions'].map(key => [key, f.submissions.load(game.gameId)[key]])), history);
    assert.match(result.embeds[0].data.description, /14 New threads created/); assert.equal(f.repository.loadAuditLog('test').filter(e => e.action === 'games.threads.cleanup.completed').length, 1);
});
test('auto-created thread accepts both owners screenshots through existing submission flow', async t => { const f = fixture(t); await f.service.create(f.guild); const game = f.submissions.records()[0].game; let result; for (const [i, teamId] of [game.team1Id, game.team2Id].entries()) { const actor = { guildId: 'guild', discordThreadId: game.discordThreadId, privateThread: true, userId: 'coach-' + teamId }; await f.submissions.beginSide(game.gameId, actor); result = await f.submissions.receiveSide(game.gameId, actor, [{ id: String(i), name: 'box.jpg', contentType: 'image/jpeg', size: 4, url: 'https://cdn.discordapp.com/attachments/' + i }], String(i)); } assert.equal(result.media.length, 2); assert.equal(result.game.status, 'SCHEDULED'); assert.ok(result.media.every(m => m.gameId === game.gameId)); });
test('ambiguous transport failure blocks duplicate creation until manual linking recovers it', async t => { const f = fixture(t); const parent = f.channels.get('games'), create = parent.threads.create; let once = true; parent.threads.create = async options => { if (once) { once = false; throw Object.assign(Error('Timed out'), { code: 'ETIMEDOUT' }); } return create(options); }; assert.equal((await f.service.create(f.guild)).failed, 1); assert.equal((await f.service.create(f.guild)).created, 0); const missing = f.submissions.records().find(r => r.game.threadCreationPending); f.thread('recovered'); f.submissions.bind({ guildId: 'guild', privateThread: true, discordThreadId: 'recovered', weekNumber: 1, teamQuery: missing.game.team1Id }); assert.equal((await f.service.create(f.guild)).failed, 0); assert.equal(f.calls.length, 13); });
test('existing website admin endpoint configures channel, creates and reports thread links', async t => {
    const f = fixture(t), { requestHandler, setGameThreadRuntime } = require('../src/web'), { Readable } = require('stream');
    const previous = process.env.WEBSITE_ADMIN_KEY; process.env.WEBSITE_ADMIN_KEY = 'fixture-key'; t.after(() => { if (previous === undefined) delete process.env.WEBSITE_ADMIN_KEY; else process.env.WEBSITE_ADMIN_KEY = previous; setGameThreadRuntime(null); });
    setGameThreadRuntime({ client: { isReady: () => true, guilds: { fetch: async () => f.guild } }, service: f.service, repository: f.repository });
    function request(body) { return new Promise(resolve => { const req = Readable.from(body ? [JSON.stringify({ operator: 'Test Commissioner', ...body })] : []); Object.assign(req, { method: body ? 'POST' : 'GET', url: '/api/league/admin/game-threads', headers: { 'x-leaguebuddy-admin-key': 'fixture-key' } }); let code; requestHandler(req, { writeHead: c => code = c, end: b => resolve({ code, data: JSON.parse(b) }) }); }); }
    assert.equal((await request({ action: 'configure', channelId: 'games' })).code, 200);
    assert.equal((await request({ action: 'create' })).data.created, 14);
    assert.equal(f.repository.loadAuditLog('test').at(-1).operator, 'Test Commissioner');
    const read = await request(); assert.equal(read.data.gamesChannelId, 'games'); assert.equal(read.data.games.filter(g => g.discordThreadId).length, 14);
});

test('both staff roles join all new and existing threads without duplicate coach membership', async t => {
    const f = fixture(t); f.staffUserIds.push('commish', 'assistant');
    await f.service.create(f.guild);
    for (const { game } of f.submissions.records()) assert.deepEqual([...f.channels.get(game.discordThreadId).memberIds], ['coach-' + game.team1Id, 'coach-' + game.team2Id, 'commish', 'assistant']);
    f.staffUserIds.push('new-assistant', 'commish');
    const result = await f.service.create(f.guild); assert.equal(result.created, 0); assert.equal(f.calls.length, 14);
    for (const { game } of f.submissions.records()) assert.ok(f.channels.get(game.discordThreadId).memberIds.has('new-assistant'));
});
test('role conflicts do not block games; opening messages tag only participating team roles', async t => {
    const f = fixture(t); f.repository.saveOwners('test', []); const teams = f.repository.loadLeagueContext({ guildId: 'guild' }).teams;
    const teamRoleIds = Object.fromEntries(teams.map((t, i) => [t.teamId, String(1000 + i)]));
    const service = createGameThreadService({ submissions: f.submissions, syncOwners: async () => ({ conflicts: ['Multiple team roles'], teamRoleIds, teamMemberIds: Object.fromEntries(teams.map(t => [t.teamId, ['same-member']])), staffUserIds: ['admin'] }), logger: { error() { } } });
    const result = await service.create(f.guild); assert.equal(result.created, 14); assert.equal(result.failed, 0);
    for (const { game } of f.submissions.records()) { const thread = f.channels.get(game.discordThreadId), payload = [...thread.savedMessages.values()][0].payload; assert.deepEqual(payload.allowedMentions.roles, [teamRoleIds[game.team1Id], teamRoleIds[game.team2Id]]); assert.equal(payload.content, `<@&${teamRoleIds[game.team1Id]}> <@&${teamRoleIds[game.team2Id]}>`); assert.deepEqual([...thread.memberIds], ['same-member', 'admin']); }
    await service.create(f.guild); for (const thread of [...f.channels.values()].filter(c => c.type === 12)) assert.deepEqual([...thread.savedMessages.values()][0].payload.allowedMentions, { parse: [] });
});
test('countdown waits for first successful thread and never resets on retries', async t => { const f = fixture(t); assert.equal(f.repository.loadSchedule('test', '1').weeks[0].deadlineAt, undefined); let clock = new Date('2026-10-07T12:00:00Z'); const service = createGameThreadService({ submissions: f.submissions, now: () => clock, syncOwners: async () => ({ conflicts: [], staffUserIds: [] }), logger: { error() { } } }); const parent = f.channels.get('games'), create = parent.threads.create; parent.threads.create = async () => { throw Error('Discord offline'); }; assert.equal((await service.create(f.guild)).created, 0); assert.equal(f.repository.loadSchedule('test', '1').weeks[0].deadlineAt, undefined); parent.threads.create = create; await service.create(f.guild); assert.equal(f.repository.loadSchedule('test', '1').weeks[0].deadlineAt, '2026-10-09T12:00:00.000Z'); clock = new Date('2026-10-08T12:00:00Z'); await service.create(f.guild); assert.equal(f.repository.loadSchedule('test', '1').weeks[0].deadlineAt, '2026-10-09T12:00:00.000Z'); });

test('intentionally cleaned active-week threads stay deleted when creation runs again', async t => {
    const f = fixture(t); await f.service.create(f.guild);
    for (const { game } of f.submissions.records()) { f.channels.delete(game.discordThreadId); await f.submissions.mutate(game.gameId, r => { r.game.discordThreadCleanedAt = new Date().toISOString(); }); }
    const result = await f.service.create(f.guild); assert.equal(result.cleaned, 14); assert.equal(result.created, 0); assert.equal(f.calls.length, 14);
});

test('both commissioner roles appear in every thread and are allowed on the initial send; repair preserves tags without repeated pings', async t=>{
 const f=fixture(t);f.staffRoleIds.push('commish-role','assistant-role');f.staffUserIds.push('commissioner','assistant');
 await f.service.create(f.guild);
 for(const {game} of f.submissions.records()){
  const thread=f.channels.get(game.discordThreadId),payload=thread.savedMessages.get(game.discordMessageId).payload;
  assert.ok(payload.content.includes('<@&commish-role>'));assert.ok(payload.content.includes('<@&assistant-role>'));
  assert.deepEqual(payload.allowedMentions.roles,['commish-role','assistant-role']);
  assert.ok(thread.memberIds.has('commissioner'));assert.ok(thread.memberIds.has('assistant'));
 }
 await f.service.create(f.guild);
 for(const {game} of f.submissions.records()){
  const payload=f.channels.get(game.discordThreadId).savedMessages.get(game.discordMessageId).payload;
  assert.ok(payload.content.includes('<@&commish-role>'));assert.ok(payload.content.includes('<@&assistant-role>'));
  assert.deepEqual(payload.allowedMentions,{parse:[]});
 }
});
