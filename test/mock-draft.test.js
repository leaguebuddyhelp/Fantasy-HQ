const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Collection, ChannelType, MessageFlags } = require('discord.js');
const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { draftField, generateDraftOrder, rulesForYear } = require('../src/fantasyhq/draft-order');
const { seededRandom, project, needFor, chooseProspect, reaction, GRADES } = require('../src/fantasyhq/mock-engine');
const { createMockSimulationService, simulate, validateSnapshot } = require('../src/fantasyhq/mock-simulations');
const { createLiveMockService, CLOCK_MS } = require('../src/fantasyhq/live-mock-service');
const { atomicWrite, read, rootFor, requestRefresh } = require('../src/fantasyhq/mock-storage');
const { createDiscordMockDraft, boardEmbeds } = require('../src/fantasyhq/discord-mock-draft');
function inputFixture() {
    const teams = Array.from({ length: 30 }, (_, i) => ({ teamId: `t${i}`, teamName: `Team ${i}`, abbreviation: `T${i}`, conference: i < 15 ? 'East' : 'West' }));
    const conferences = Object.fromEntries(['East', 'West'].map(c => [c, teams.filter(t => t.conference === c).map((t, i) => ({ ...t, PCT: (15 - i) / 16, W: 15 - i, L: i, rank: i + 1 }))]));
    const prospects = Array.from({ length: 70 }, (_, i) => ({ prospectId: `class:${i + 1}`, board_number: i + 1, name: `Prospect ${i + 1}`, position_1: ['PG', 'SG', 'SF', 'PF', 'C'][i % 5], team: 'University', strength_1: 'Shooting', weakness_1: 'Handle', build: 'Two-way creator', overall: 82 - i / 3, potential: 94 - i / 4, 'draft score': 90 - i / 3 }));
    return { leagueId: 'l', seasonId: '1', draftClassId: 'class', draftYear: 2027, currentWeek: 2, teams, standings: { conferences }, prospects, rosters: Object.fromEntries(teams.map(t => [t.teamId, [{ position1: 'C', position2: 'PF', overall: 90 }]])), picks: teams.map(t => ({ pickId: `pick_${t.teamId}`, draftYear: 2027, round: 1, originalTeamId: t.teamId, currentOwnerTeamId: t.teamId })), settings: { mockDraft: {} } };
}
let saved;
test.before(async () => { saved = await simulate(inputFixture(), { seed: 'suite-baseline' }); });
function fixture(t, { clock = Date.now(), alternateClasses = false } = {}) {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-mock-')); t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
    const repository = createFantasyHQRepository({ dataRoot }), input = inputFixture();
    repository.saveLeague('l', { currentSeasonId: '1', seasonNumber: 1, currentPhase: 'REGULAR_SEASON', currentWeek: 2, guildId: 'guild' }); repository.saveTeams('l', input.teams); repository.saveSettings('l', { testMode: true, discordChannels: { scouting: 'hub' } }); repository.saveGuildLeagueBinding('guild', { leagueId: 'l', seasonId: '1' }); repository.saveDraftPicks('l', input.picks);
    repository.saveOwners('l', input.teams.map((t, i) => ({ teamId: t.teamId, userId: `u${i}` })));
    atomicWrite(path.join(repository.buildLeaguePaths(dataRoot, 'l').leagueRoot, 'role-ownership.json'), { roleIds: Object.fromEntries(input.teams.map((t, i) => [t.teamId, `r${i}`])), conflicts: [] });
    const scoutingService = { boardForContext: c => ({ file: alternateClasses && c.league.seasonNumber > 1 ? `class${c.league.seasonNumber}.json` : 'class.json', prospects: input.prospects.map(p => alternateClasses && c.league.seasonNumber > 1 ? { ...p, name: `CUS${c.league.seasonNumber} ${p.name}` } : p) }) }, standingsService = { getStandings: () => input.standings }, rosterService = { currentRosterEntries: () => [] };
    const simulations = createMockSimulationService({ repository, scoutingService, standingsService, rosterService });
    const snapshot = structuredClone(saved); snapshot.input = simulations.inputFor('l'); snapshot.draftClassId = 'class'; snapshot.metadata.processedEvents = [];
    const root = rootFor(repository, 'l'); atomicWrite(path.join(root, 'snapshots', `${snapshot.id}.json`), snapshot); atomicWrite(path.join(root, 'active.json'), { id: snapshot.id });
    let currentTime = clock;
    const live = createLiveMockService({ repository, simulations, now: () => currentTime, rng: seededRandom('live') });
    const ownerFor = slot => repository.loadOwners('l').find(o => o.teamId === slot.currentOwnerTeamId).userId;
    function ready(host = 'u0', invite = []) { let m = live.create('l', host, 'guild'); if (invite.length) m = live.invite('l', m.id, { id: host }, invite); m = live.lottery('l', m.id, { id: host }); m = live.lock('l', m.id, { id: host }); return m; }
    return { repository, input, root, simulations, live, snapshot, ready, ownerFor, now: () => currentTime, time: n => { currentTime = n; } };
}
function discordFixture(f) {
    let seq = 0, deleted = false, failDelete = false, failDM = new Set();
    const channels = new Collection(), dmChannels = new Map(), botId = 'bot';
    const client = { user: { id: botId }, guilds: { cache: new Collection() }, users: { fetch: async id => ({ createDM: async () => { if (failDM.has(id)) throw Object.assign(Error('DM closed'), { code: 50007 }); if (!dmChannels.has(id)) dmChannels.set(id, channel(`dm-${id}`, false)); return dmChannels.get(id); } }) } };
    function channel(id, thread = false) {
        const messages = new Collection(), members = new Set();
        const ch = {
            id, client, type: thread ? ChannelType.PrivateThread : ChannelType.GuildText, messages: { fetch: async arg => { if (typeof arg === 'string') { if (!messages.has(arg)) throw Object.assign(Error('Unknown message'), { code: 10008 }); return messages.get(arg); } return messages; }, fetchPins: async () => new Collection([...messages].filter(([, m]) => m.pinned)) }, send: async payload => {
                const msg = { id: `msg${++seq}`, nonce: payload.nonce, author: { id: botId }, pinned: false, embeds: [], components: [], edit: async p => { msg.embeds = (p.embeds || []).map(e => e.toJSON ? e.toJSON() : e); msg.components = (p.components || []).map(r => ({ components: r.components.map(c => ({ customId: c.data.custom_id })) })); return msg; }, delete: async () => { messages.delete(msg.id); }, pin: async () => { msg.pinned = true; } }; await msg.edit(payload); messages.set(msg.id, msg); return msg;
            }, members: { add: async userId => { members.add(userId); }, fetch: async userId => { if (!members.has(userId)) throw Object.assign(Error('Unknown member'), { code: 10007 }); return { id: userId }; } }, delete: async () => { if (failDelete) throw Error('Delete failed'); channels.delete(id); deleted = true; }, setArchived: async () => { ch.archived = false; }
        };
        ch.threads = { fetchActive: async () => ({ threads: new Collection([...channels].filter(([, t]) => t.type === ChannelType.PrivateThread)) }), fetchArchived: async () => ({ threads: new Collection() }), create: async options => { assert.equal(options.type, ChannelType.PrivateThread); assert.equal(options.invitable, false); const thread = channel(`thread${++seq}`, true); thread.name = options.name; thread.ownerId = botId; channels.set(thread.id, thread); return thread; } };
        ch._messages = messages; ch._members = members; return ch;
    }
    channels.set('hub', channel('hub'));
    const guild = { id: 'guild', client, members: { me: { id: botId }, fetch: async id => { const match = id.match(/^u(\d+)$/); if (!match) throw Object.assign(Error('Unknown member'), { code: 10007 }); return { id, user: { bot: false }, roles: { cache: new Collection([[`r${match[1]}`, { id: `r${match[1]}` }]]) } }; } }, channels: { fetch: async id => { if (!channels.has(id)) throw Object.assign(Error('Unknown channel'), { code: 10003 }); return channels.get(id); } } };
    client.guilds.cache.set('guild', guild);
    const workflow = createDiscordMockDraft({ repository: f.repository, simulations: f.simulations, live: f.live, client });
    function interaction(customId, userId = 'u0', channelId = 'hub') { return { customId, guildId: 'guild', guild, channelId, user: { id: userId }, replies: [], deferReply: async function (p) { this.deferred = true; this.deferPayload = p; }, editReply: async function (p) { this.replies.push(p); }, followUp: async function (p) { this.replies.push(p); }, reply: async function (p) { this.replied = true; this.replies.push(p); }, showModal: async function (m) { this.modal = m; }, memberPermissions: { has: () => false } }; }
    const start = async () => { const i = interaction('mock:startclass'); i.values = ['1']; await workflow.handle(i); return i; };
    return { start, workflow, interaction, guild, channels, client, dmChannels, failDM, deleted: () => deleted, failDelete: value => { failDelete = value; } };
}

test('1,000 valid first rounds, realistic variation and correct all-prospect aggregates', () => {
    assert.equal(saved.simulations.length, 1000); validateSnapshot(saved);
    assert.ok(new Set(saved.simulations.map(r => r.map(s => s.prospectId).join(','))).size > 900);
    const a = saved.prospectAggregates['class:1']; assert.ok(a.avp < 5); assert.ok(a.timesSelected > 990);
    for (const p of saved.input.prospects) {
        const picks = saved.simulations.flatMap(r => r.filter(s => s.prospectId === p.prospectId).map(s => s.pickNumber)), a = saved.prospectAggregates[p.prospectId];
        assert.equal(a.timesSelected, picks.length); assert.equal(a.avp, picks.length ? picks.reduce((sum, n) => sum + n, 0) / picks.length : null);
        assert.equal(a.earliest, picks.length ? Math.min(...picks) : null); assert.equal(a.latest, picks.length ? Math.max(...picks) : null);
        for (let i = 0; i < 30; i++) { assert.equal(a.frequencyByPick[i], picks.filter(n => n === i + 1).length); assert.equal(a.availabilityByPick[i], (1000 - picks.filter(n => n < i + 1).length) / 1000); }
    }
});
test('seeded projections repeat while independent seeds vary; CPU never redrafts', () => { const input = inputFixture(), order = generateDraftOrder(input, { lottery: false }).order; assert.deepEqual(project(input, order, saved, seededRandom('same')), project(input, order, saved, seededRandom('same'))); assert.notDeepEqual(project(input, order, saved, seededRandom('a')), project(input, order, saved, seededRandom('b'))); });
test('season lottery selection, 16-team eligibility, record order, ownership and repeat restrictions', () => {
    const input = inputFixture(); assert.equal(rulesForYear(2026).drawn, 4); assert.equal(rulesForYear(2027).drawn, 16); assert.equal(rulesForYear(2030).provisional, true);
    const field = draftField(input); assert.equal(field.lottery.length, 16); assert.equal(field.lottery.reduce((n, t) => n + t.weight, 0), 37);
    input.picks[14].currentOwnerTeamId = 't0'; input.settings.mockDraft.priorOriginalPicks = { 2026: { t14: 1, t13: 3 }, 2025: { t13: 2 } };
    const tail = generateDraftOrder(input, { lottery: false }).order.slice(16);
    for (let i = 0; i < 100; i++) { const order = generateDraftOrder(input, { rng: seededRandom(i) }).order; assert.equal(new Set(order.map(s => s.originalTeamId)).size, 30); assert.deepEqual(order.slice(16), tail); assert.notEqual(order[0].originalTeamId, 't14'); assert.ok(order.findIndex(s => s.originalTeamId === 't13') >= 5); for (const t of field.lottery.filter(t => t.relegated)) assert.ok(order.findIndex(s => s.originalTeamId === t.teamId) < 12); assert.equal(order.find(s => s.originalTeamId === 't14').currentOwnerTeamId, 't0'); }
});
test('actual play-in losers override projections and legacy draws only top four', () => { const input = inputFixture(); input.settings.mockDraft.playInLoserTeamIds = ['t6', 't21']; const field = draftField(input); assert.ok(field.lottery.some(t => t.teamId === 't6')); assert.ok(!field.lottery.some(t => t.teamId === 't7')); input.draftYear = 2026; input.picks.forEach(p => p.draftYear = 2026); const order = generateDraftOrder(input, { rng: seededRandom(1) }).order; const source = draftField(input).lottery.map(t => t.teamId).filter(id => !order.slice(0, 4).some(s => s.originalTeamId === id)); assert.deepEqual(order.slice(4, 14).map(s => s.originalTeamId), source); });
test('tied records are stable and ownership cannot alter slot sources', () => { const input = inputFixture(); Object.values(input.standings.conferences).flat().forEach(t => { t.PCT = 0.5; }); const first = generateDraftOrder(input, { lottery: false }).order; input.picks.forEach(p => p.currentOwnerTeamId = 't0'); const second = generateDraftOrder(input, { lottery: false }).order; assert.deepEqual(first.map(s => s.originalTeamId), second.map(s => s.originalTeamId)); assert.equal(new Set(second.map(s => s.currentOwnerTeamId)).size, 1); });
test('CPU uses needs, earlier selections and saved market information', () => { const input = inputFixture(), p = input.prospects[0]; const before = needFor(input, 't0', p, []), after = needFor(input, 't0', p, [{ currentOwnerTeamId: 't0', prospectId: p.prospectId }]); assert.ok(after < before); const slot = { pickNumber: 1, currentOwnerTeamId: 't0' }; const scores = saved.prospectAggregates; const changed = structuredClone(saved); changed.prospectAggregates['class:2'].frequencyByPick[0] = 1000; changed.prospectAggregates['class:2'].avp = 1; assert.ok(Array.from({ length: 100 }, (_, i) => chooseProspect(input, slot, [], saved, seededRandom(i)).prospectId).some((id, i) => id !== chooseProspect(input, slot, [], changed, seededRandom(i)).prospectId)); });
test('refresh failure preserves prior snapshot; publication validates before replacement', async t => {
    const f = fixture(t), bad = createMockSimulationService({ repository: f.repository, scoutingService: { boardForContext: () => ({ file: 'class.json', prospects: f.input.prospects }) }, standingsService: { getStandings: () => f.input.standings }, rosterService: { currentRosterEntries: () => [] }, generator: async () => ({ simulationCount: 999 }) });
    await assert.rejects(bad.refresh('l', { force: true }), /1,000/); assert.equal(f.simulations.active('l').id, saved.id); assert.equal(read(path.join(f.root, 'generation.json')).pid, null);
    const fresh = await f.simulations.refresh('l', { force: true, seed: 'refresh' }); assert.notEqual(fresh.id, saved.id); assert.equal(f.simulations.active('l').id, fresh.id); assert.equal(fs.existsSync(path.join(f.root, 'snapshots', `${saved.id}.json`)), true);
    assert.equal((await f.simulations.refresh('l')).id, fresh.id);
});
test('refresh events are idempotent and unsuccessful week commits do not enqueue', t => {
    const f = fixture(t); const schedule = { leagueId: 'l', seasonId: '1', weeks: [{ week: 2, status: 'COMPLETED' }, { week: 3, status: 'ACTIVE' }] }, args = { leagueId: 'l', expectedWeek: 2, schedule, league: { ...f.repository.loadLeague('l').league, currentWeek: 3 }, auditEntry: { action: 'week.advanced', requestId: 'week-token', seasonId: '1' } };
    assert.throws(() => f.repository.commitWeekTransition({ ...args, expectedWeek: 1 }), /Week changed/); assert.equal(fs.existsSync(path.join(f.root, 'refresh.json')), false);
    f.repository.commitWeekTransition(args); requestRefresh(f.repository, 'l', 'week.advanced', 'week:week-token'); assert.equal(read(path.join(f.root, 'refresh.json')).events.length, 1);
});
test('only completed current first-round ownership transactions request trade refresh', t => {
    for (const status of ['PROPOSED', 'DENIED', 'AWAITING_PROOF']) { const f = fixture(t); f.repository.saveTrades('l', [{ status }]); assert.equal(fs.existsSync(path.join(f.root, 'refresh.json')), false); }
    for (const relevant of [true, false]) {
        const f = fixture(t), picks = f.repository.loadDraftPicks('l'); if (!relevant) picks[0].round = 2;
        f.repository.commitTradeTransaction({ leagueId: 'l', players: [], rosterMemberships: [], draftPicks: picks, trades: [{ status: 'COMPLETED' }], auditEntry: { action: 'trade.completed', metadata: { processingId: 'tx', affectedPickIds: ['pick_t0'] } } });
        assert.equal(fs.existsSync(path.join(f.root, 'refresh.json')), relevant);
    }
});
test('valid coach start is idempotent; non-coach rejected; ownership freezes at lock', t => { const f = fixture(t); assert.throws(() => f.live.create('l', 'stranger', 'guild'), /coach/); const m = f.live.create('l', 'u0', 'guild'); assert.equal(f.live.create('l', 'u0', 'guild').id, m.id); f.live.lottery('l', m.id, { id: 'u0' }); f.live.lottery('l', m.id, { id: 'u0' }); const picks = f.repository.loadDraftPicks('l'); picks[14].currentOwnerTeamId = 't0'; f.repository.saveDraftPicks('l', picks); const locked = f.live.lock('l', m.id, { id: 'u0' }); assert.equal(locked.lockedDraftOrder.find(s => s.originalTeamId === 't14').currentOwnerTeamId, 't0'); picks[14].currentOwnerTeamId = 't1'; f.repository.saveDraftPicks('l', picks); assert.equal(f.live.get('l', m.id).lockedDraftOrder.find(s => s.originalTeamId === 't14').currentOwnerTeamId, 't0'); assert.throws(() => f.live.lottery('l', m.id, { id: 'u0' }), /locked/); assert.throws(() => f.live.invite('l', m.id, { id: 'u0' }, ['u1']), /close/); });
test('invited coaches control their real teams; all other teams are CPU', t => { const f = fixture(t), m = f.ready('u0', ['u14']); const active = f.live.start('l', m.id, { id: 'u0' }); const ctrl = f.live.controller(active); assert.equal(ctrl?.teamId ?? null, active.lockedDraftOrder[0].currentOwnerTeamId === 't14' || active.lockedDraftOrder[0].currentOwnerTeamId === 't0' ? active.lockedDraftOrder[0].currentOwnerTeamId : null); assert.deepEqual(m.participants.map(p => p.teamId), ['t0', 't14']); });
test('all three owned picks get human windows and earlier picks adjust needs', t => { const f = fixture(t), picks = f.repository.loadDraftPicks('l'); picks.forEach((p, i) => { if ([12, 13, 14].includes(i)) p.currentOwnerTeamId = 't0'; }); f.repository.saveDraftPicks('l', picks); let m = f.ready(); m = f.live.start('l', m.id, { id: 'u0' }); let human = 0; while (m.status === 'ACTIVE') { const ctrl = f.live.controller(m); if (ctrl) { human++; assert.equal(m.deadlineAt - f.now(), CLOCK_MS); const p = f.live.available(m)[0]; m = f.live.commit('l', m.id, { expectedPick: m.currentPick, userId: ctrl.userId, prospectId: p.prospectId }); } else m = f.live.commit('l', m.id, { expectedPick: m.currentPick, type: 'CPU' }); } assert.equal(human, 4); assert.equal(m.selections.filter(s => s.currentOwnerTeamId === 't0').length, 4); assert.equal(m.selections.at(-1).metrics.prior >= 0, true); });
test('confirm and timeout races yield one final selection, no duplicates or repick', async t => {
    const f = fixture(t), m = f.ready('u0', f.repository.loadOwners('l').map(o => o.userId)); const active = f.live.start('l', m.id, { id: 'u0' }), p = f.live.available(active)[0], owner = f.live.controller(active).userId;
    f.time(active.deadlineAt); const results = await Promise.allSettled([Promise.resolve().then(() => f.live.commit('l', m.id, { expectedPick: 1, userId: owner, prospectId: p.prospectId })), Promise.resolve().then(() => f.live.commit('l', m.id, { expectedPick: 1, type: 'TIMEOUT_CPU' })), Promise.resolve().then(() => f.live.commit('l', m.id, { expectedPick: 1, type: 'TIMEOUT_CPU' }))]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); const next = f.live.get('l', m.id); assert.equal(next.selections.length, 1); assert.equal(next.selections[0].selectedByType, 'TIMEOUT_CPU'); assert.equal(f.live.available(next).some(p => p.prospectId === next.selections[0].prospectId), false);
});
test('human confirmation consumes prospect; search includes all remaining prospects', t => { const f = fixture(t), m = f.ready('u0', f.repository.loadOwners('l').map(o => o.userId)), active = f.live.start('l', m.id, { id: 'u0' }); assert.equal(f.live.available(active, 'Prospect 70')[0].board_number, 70); const p = f.live.available(active)[0], userId = f.live.controller(active).userId; const next = f.live.commit('l', m.id, { expectedPick: 1, userId, prospectId: p.prospectId }); assert.equal(next.selections[0].selectedByType, 'HUMAN'); assert.equal(f.live.available(next, p.name).some(a => a.prospectId === p.prospectId), false); assert.throws(() => f.live.commit('l', m.id, { expectedPick: 1, userId, prospectId: p.prospectId }), /no longer/); });
test('pause freezes clock, rejects unauthorized user and restart restores remaining time', t => { const f = fixture(t), m = f.ready('u0', f.repository.loadOwners('l').map(o => o.userId)), active = f.live.start('l', m.id, { id: 'u0' }); f.time(f.now() + 45000); assert.throws(() => f.live.pause('l', m.id, { id: 'u1' }), /host/); const paused = f.live.pause('l', m.id, { id: 'u0' }); assert.equal(paused.remainingMs, 75000); f.time(f.now() + 600000); assert.throws(() => f.live.commit('l', m.id, { expectedPick: 1, type: 'TIMEOUT_CPU' }), /no longer/); const recovered = createLiveMockService({ repository: f.repository, simulations: f.simulations, now: f.now }); assert.equal(recovered.get('l', m.id).status, 'PAUSED'); const resumed = recovered.resume('l', m.id, { id: 'u0' }); assert.equal(resumed.deadlineAt - f.now(), 75000); });
test('every reaction has a valid grade, four sentences and a distinct opening; optional data is safe', () => { const input = inputFixture(), order = generateDraftOrder(input, { lottery: false }).order, selections = project(input, order, saved, seededRandom('reactions')), openings = new Set(); selections.forEach((s, i) => { const p = input.prospects.find(p => p.prospectId === s.prospectId), r = reaction(input, s, p, selections.slice(0, i), saved.prospectAggregates[p.prospectId]); assert.ok(GRADES.includes(r.grade)); assert.equal(r.analysis.match(/\.(?:\s|$)/g).length, 4); openings.add(r.analysis.split('. ')[0]); }); assert.equal(openings.size, 30); assert.doesNotThrow(() => reaction(input, order[0], { prospectId: 'unknown', name: 'Unknown', board_number: 60 }, [], null)); });
test('pinned Hub entry is reused; start creates one private thread and no public picks', async t => { const f = fixture(t), d = discordFixture(f); await d.workflow.ensurePin(d.guild, 'l'); await d.workflow.ensurePin(d.guild, 'l'); assert.equal(d.channels.get('hub')._messages.size, 1); const a = d.interaction('mock:startclass'), b = d.interaction('mock:startclass'); a.values = ['1']; b.values = ['1']; await Promise.all([d.workflow.handle(a), d.workflow.handle(b)]); assert.equal(d.channels.size, 2); assert.equal(f.live.all('l').length, 1); assert.equal(a.deferPayload.flags, MessageFlags.Ephemeral); const m = f.live.all('l')[0]; assert.ok(d.channels.get(m.threadId)._members.has('u0')); });
test('/mockdraft stays ephemeral, contains all 30 current-owner picks and uses saved snapshot', async t => { const f = fixture(t), d = discordFixture(f), picks = f.repository.loadDraftPicks('l'); picks[14].currentOwnerTeamId = 't0'; f.repository.saveDraftPicks('l', picks); const interaction = d.interaction('unused'); interaction.deferred = true; await d.workflow.projection(interaction); assert.equal(interaction.replies.length, 1); assert.equal(interaction.replies[0].embeds.length, 1); const card = interaction.replies[0].embeds[0].toJSON(); const text = card.fields.map(f => f.value).join('\n'); assert.equal(text.match(/\*\*#\d+\*\*/g).length, 30); assert.match(card.title, /🏀/); assert.match(text, /🏀/); assert.ok(interaction.replies[0].embeds[0].length <= 6000); assert.ok(card.fields.every(f => f.value.length <= 1024)); assert.match(text, /T14 → T0/); assert.match(interaction.replies[0].embeds[0].toJSON().footer.text, /1,000/); assert.equal(d.channels.size, 1); assert.equal(require('../src/shared/discord-privacy').commandReplyFlags({ commandName: 'mockdraft' }), MessageFlags.Ephemeral); });
test('invite menu contains only configured coaches and supports all 30 via pages', async t => { const f = fixture(t), d = discordFixture(f); await d.start(); const m = f.live.all('l')[0]; for (const page of [0, 1]) { const i = d.interaction(`mock:${m.id}:invite:${page}`, 'u0', m.threadId); await d.workflow.handle(i); const select = i.replies[0].components[0].toJSON().components[0]; assert.ok(select.options.length <= 15); assert.ok(select.options.every(o => f.repository.loadOwners('l').some(c => c.userId === o.value))); assert.equal(select.type, 3); } });
test('human UI top ten, modal search, preview and irrevocable confirmation', async t => {
    const f = fixture(t), d = discordFixture(f); await d.start(); const base = f.live.all('l')[0]; f.live.invite('l', base.id, { id: 'u0' }, f.repository.loadOwners('l').map(o => o.userId)); f.live.lottery('l', base.id, { id: 'u0' }); f.live.lock('l', base.id, { id: 'u0' }); let m = f.live.start('l', base.id, { id: 'u0' }); await d.workflow.pump(d.guild, 'l', m.id); m = f.live.get('l', m.id); const userId = f.live.controller(m).userId;
    const available = d.interaction(`mock:${m.id}:available:1`, userId, m.threadId); await d.workflow.handle(available); assert.equal(available.replies[0].components[0].toJSON().components[0].options.length, 25); assert.equal(available.replies[0].embeds[0].data.description.match(/Board #/g).length, 10);
    const search = d.interaction(`mock:${m.id}:search:1`, userId, m.threadId); await d.workflow.handle(search); assert.ok(search.modal);
    const submit = d.interaction(`mock:${m.id}:searchsubmit:1`, userId, m.threadId); submit.fields = { getTextInputValue: () => 'Prospect 70' }; await d.workflow.handle(submit); assert.equal(submit.replies[0].components[0].toJSON().components[0].options[0].value, '70');
    const preview = d.interaction(`mock:${m.id}:select:1`, userId, m.threadId); preview.values = ['25']; await d.workflow.handle(preview); const confirm = preview.replies[0].components[0].toJSON().components[0].custom_id; assert.match(confirm, /:confirm:1:25$/);
    const backId = preview.replies[0].components[0].toJSON().components[1].custom_id; assert.equal(backId, `mock:${m.id}:available:1`); const back = d.interaction(backId, userId, m.threadId); await d.workflow.handle(back); assert.equal(f.live.get('l', m.id).selections.length, 0); assert.ok(back.replies[0].components.length);

    await d.workflow.handle(d.interaction(confirm, userId, m.threadId)); assert.equal(f.live.get('l', m.id).selections.length, 1); await d.workflow.handle(d.interaction(confirm, userId, m.threadId)); assert.equal(f.live.get('l', m.id).selections.length, 1);
});
test('CPU immediately advances, completion preserves 30 picks, DMs fail independently and cleanup retries', async t => { const f = fixture(t), d = discordFixture(f); await d.start(); let m = f.live.all('l')[0]; f.live.invite('l', m.id, { id: 'u0' }, ['u1']); f.live.lottery('l', m.id, { id: 'u0' }); f.live.lock('l', m.id, { id: 'u0' }); f.live.setAvailable('l', m.id, 'u0', false); f.live.setAvailable('l', m.id, 'u1', false); f.live.start('l', m.id, { id: 'u0' }); d.failDM.add('u0'); d.failDelete(true); await d.workflow.pump(d.guild, 'l', m.id); m = f.live.get('l', m.id); assert.equal(m.selections.length, 30); assert.equal(m.status, 'CLEANUP_PENDING'); assert.equal(m.dmDelivery.u0.delivered, false); assert.equal(m.dmDelivery.u1.delivered, true); assert.equal(d.dmChannels.get('u1')._messages.size, 1); assert.equal(boardEmbeds(m.input, m.selections).length, 3); assert.ok(m.cleanup.error); d.failDelete(false); await d.workflow.pump(d.guild, 'l', m.id); m = f.live.get('l', m.id); assert.equal(m.status, 'CLEANED'); assert.equal(m.recap.selections.length, 30); assert.equal(d.dmChannels.get('u1')._messages.size, 1); assert.equal(d.deleted(), true); assert.equal(fs.existsSync(path.join(f.root, 'live.json')), true); });
test('active deadline and CPU progress survive restart; paused pump cannot advance', async t => { const f = fixture(t), d = discordFixture(f); await d.start(); let m = f.live.all('l')[0]; f.live.invite('l', m.id, { id: 'u0' }, f.repository.loadOwners('l').map(o => o.userId)); f.live.lottery('l', m.id, { id: 'u0' }); f.live.lock('l', m.id, { id: 'u0' }); m = f.live.start('l', m.id, { id: 'u0' }); const deadline = m.deadlineAt; const recovered = createLiveMockService({ repository: f.repository, simulations: f.simulations }); assert.equal(recovered.get('l', m.id).deadlineAt, deadline); f.live.pause('l', m.id, { id: 'u0' }); await d.workflow.pump(d.guild, 'l', m.id); assert.equal(f.live.get('l', m.id).selections.length, 0); });
test('outbox reconciliation prevents duplicate reactions after delivery-state loss', async t => { const f = fixture(t), d = discordFixture(f); await d.start(); let m = f.live.all('l')[0]; f.live.invite('l', m.id, { id: 'u0' }, f.repository.loadOwners('l').map(o => o.userId)); f.live.lottery('l', m.id, { id: 'u0' }); f.live.lock('l', m.id, { id: 'u0' }); m = f.live.start('l', m.id, { id: 'u0' }); f.live.commit('l', m.id, { expectedPick: 1, userId: f.live.controller(m).userId, prospectId: m.input.prospects[0].prospectId }); await d.workflow.pump(d.guild, 'l', m.id); const thread = d.channels.get(m.threadId), count = thread._messages.size; f.live.mutate('l', m.id, draft => { draft.delivery = {}; }); await d.workflow.pump(d.guild, 'l', m.id); assert.equal(thread._messages.size, count); });
test('simulations refuse invalid aggregates and duplicate prospects', () => { const bad = structuredClone(saved); bad.simulations[0][1].prospectId = bad.simulations[0][0].prospectId; assert.throws(() => validateSnapshot(bad), /Invalid simulation/); const badAggregate = structuredClone(saved); badAggregate.prospectAggregates['class:1'].earliest = 30; assert.throws(() => validateSnapshot(badAggregate), /distribution/); });
test('setup start reads snapshot without regenerating; missing current snapshot blocks start', t => { const f = fixture(t); f.simulations.refresh = () => { throw Error('Must never refresh during start'); }; assert.doesNotThrow(() => f.live.create('l', 'u0', 'guild')); fs.unlinkSync(path.join(f.root, 'active.json')); assert.throws(() => f.live.create('l', 'u1', 'guild'), /not ready/); });
test('two duplicate confirms and CPU calls cannot complete one slot twice', async t => { const f = fixture(t), m = f.ready('u0', f.repository.loadOwners('l').map(o => o.userId)), active = f.live.start('l', m.id, { id: 'u0' }), args = { expectedPick: 1, userId: f.live.controller(active).userId, prospectId: active.input.prospects[0].prospectId }; const results = await Promise.allSettled([0, 1].map(() => Promise.resolve().then(() => f.live.commit('l', m.id, args)))); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.live.get('l', m.id).currentPick, 2); const allCPU = fixture(t), cpu = allCPU.ready(); allCPU.live.setAvailable('l', cpu.id, 'u0', false); allCPU.live.start('l', cpu.id, { id: 'u0' }); allCPU.live.commit('l', cpu.id, { expectedPick: 1, type: 'CPU' }); assert.throws(() => allCPU.live.commit('l', cpu.id, { expectedPick: 1, type: 'CPU' }), /no longer/); });
test('grade recognizes quality and fit beyond rank; excessive reaches remain analytical', () => { const input = inputFixture(), slot = { pickNumber: 5, currentOwnerTeamId: 't0' }, p = { ...input.prospects[17], position_1: 'PG', position_2: 'SG', potential: 98, overall: 85, 'draft score': 95, age: 19, pts: 25, ast: 8, strength_1: 'Playmaking' }; const strong = reaction(input, slot, p, [], { avp: 18 }); assert.ok(strong.score < 7); const fair = reaction(input, slot, { ...p, board_number: 5 }, [], { avp: 5 }); assert.ok(fair.score > strong.score); const weaker = reaction(input, slot, { ...p, potential: 70, overall: 60, 'draft score': 60, age: 25, pts: 2, ast: 0, position_1: 'C', position_2: 'PF' }, [], { avp: 18 }); assert.ok(strong.score > weaker.score); assert.ok(!/stupid|terrible|idiot/i.test(weaker.analysis)); });
test('search pages respect Discord limits and can reach the final remaining prospect', t => { const f = fixture(t), d = discordFixture(f), m = f.ready('u0', f.repository.loadOwners('l').map(o => o.userId)), active = f.live.start('l', m.id, { id: 'u0' }); const found = new Set(); for (let page = 0; page < 7; page++) { const payload = d.workflow.selectionPayload(active, 1, '', page, 'token'); assert.ok(payload.embeds[0].toJSON().description.length <= 4096); const menu = payload.components[0].toJSON().components[0]; assert.ok(menu.options.length <= 10); menu.options.forEach(o => found.add(o.value)); assert.ok(payload.components.every(r => r.components.length <= 5)); } assert.equal(found.size, 70); });
test('non-coach, wrong-room and stale lottery interactions cannot mutate a live mock', async t => { const f = fixture(t), d = discordFixture(f), stranger = d.interaction('mock:start', 'stranger'); await d.workflow.handle(stranger); assert.equal(f.live.all('l').length, 0); await d.start(); let m = f.live.all('l')[0]; const wrong = d.interaction(`mock:${m.id}:lottery:0`, 'u0', 'hub'); await d.workflow.handle(wrong); assert.equal(f.live.get('l', m.id).lotteryRuns, 0); await d.workflow.handle(d.interaction(`mock:${m.id}:lottery:0`, 'u0', m.threadId)); await d.workflow.handle(d.interaction(`mock:${m.id}:lottery:0`, 'u0', m.threadId)); assert.equal(f.live.get('l', m.id).lotteryRuns, 1); assert.equal(d.channels.get(m.threadId)._messages.size, 2); });
test('current owner loss immediately hands control to CPU without mutating league assets', t => { const f = fixture(t), m = f.ready('u0', f.repository.loadOwners('l').map(o => o.userId)), active = f.live.start('l', m.id, { id: 'u0' }); const before = JSON.stringify(f.repository.loadDraftPicks('l')), coach = f.live.controller(active); f.repository.saveOwners('l', f.repository.loadOwners('l').filter(o => o.userId !== coach.userId)); assert.equal(f.live.controller(active), null); const next = f.live.commit('l', m.id, { expectedPick: 1, type: 'CPU' }); assert.equal(next.selections.length, 1); assert.equal(JSON.stringify(f.repository.loadDraftPicks('l')), before); });
test('missing portraits do not break previews or completed reactions', t => { const f = fixture(t), m = f.ready(); const { reactionPayload } = require('../src/fantasyhq/discord-mock-draft'); const p = { ...m.input.prospects[0], imagePath: '/missing/mock/prospect.png' }, slot = m.lockedDraftOrder[0], r = reaction(m.input, slot, p, [], null); const payload = reactionPayload(m, { ...slot, prospect: p, boardRank: 1, avp: null, grade: r.grade, storyline: r.storyline, analysis: r.analysis }); assert.equal(payload.files, undefined); assert.ok(payload.embeds[0].toJSON().description.includes(p.name) || payload.embeds[0].toJSON().title.includes(p.name)); });
test('multi-pick haul awards consider every selection and completion cannot be repeated', t => { const f = fixture(t), picks = f.repository.loadDraftPicks('l'); picks.forEach(p => p.currentOwnerTeamId = 't0'); f.repository.saveDraftPicks('l', picks); let m = f.ready(); f.live.setAvailable('l', m.id, 'u0', false); m = f.live.start('l', m.id, { id: 'u0' }); while (m.status === 'ACTIVE') m = f.live.commit('l', m.id, { expectedPick: m.currentPick, type: 'CPU' }); const award = m.recap.awards.find(a => a.category === 'Best multi-pick haul'); assert.equal(award.pickNumbers.length, 30); assert.equal(award.teamId, 't0'); assert.throws(() => f.live.commit('l', m.id, { expectedPick: 30, type: 'CPU' }), /no longer/); assert.equal(m.deadlineAt, null); });
test('a deleted completed room still delivers persisted recap and safely cleans backend status', async t => { const f = fixture(t), d = discordFixture(f); await d.start(); let m = f.live.all('l')[0]; f.live.lottery('l', m.id, { id: 'u0' }); f.live.lock('l', m.id, { id: 'u0' }); f.live.setAvailable('l', m.id, 'u0', false); m = f.live.start('l', m.id, { id: 'u0' }); while (m.status === 'ACTIVE') m = f.live.commit('l', m.id, { expectedPick: m.currentPick, type: 'CPU' }); d.channels.delete(m.threadId); await d.workflow.pump(d.guild, 'l', m.id); assert.equal(f.live.get('l', m.id).status, 'CLEANED'); assert.equal(f.live.get('l', m.id).dmDelivery.u0.delivered, true); });
test('lottery eligibility preserves existing conference seeds even when regular-season records tie', () => { const input = inputFixture(); Object.values(input.standings.conferences).flat().forEach(t => { t.PCT = 0.5; }); const field = draftField(input); for (const team of field.lottery) assert.ok(team.seed >= 9 || [8].includes(team.seed)); assert.equal(field.lottery.find(t => t.teamId === 't7').weight, 1); assert.equal(field.lottery.some(t => t.teamId === 't6'), false); });
test('/mockdraft is identical for repeated calls, different coaches and service restarts', async t => {
    const f = fixture(t), d = discordFixture(f), first = d.interaction('unused', 'u0'), repeat = d.interaction('unused', 'u0'), other = d.interaction('unused', 'u1');
    await d.workflow.projection(first); await d.workflow.projection(repeat); await d.workflow.projection(other);
    assert.deepEqual(first.replies[0].embeds[0].toJSON(), repeat.replies[0].embeds[0].toJSON());
    assert.deepEqual(first.replies[0].embeds[0].toJSON(), other.replies[0].embeds[0].toJSON());
    const published = f.simulations.weeklyProjection('l');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'weekly-projection.json'), 'utf8')), published);
    const restarted = createMockSimulationService({ repository: f.repository, scoutingService: { boardForContext: () => ({ file: 'class.json', prospects: f.input.prospects }) }, standingsService: { getStandings: () => f.input.standings }, rosterService: { currentRosterEntries: () => [] } });
    assert.deepEqual(restarted.weeklyProjection('l'), published);
});
test('weekly command stays frozen through intraweek roster, standings, pick trades and simulation refreshes', async t => {
    const f = fixture(t), first = f.simulations.weeklyProjection('l');
    const picks = f.repository.loadDraftPicks('l'); picks[14].currentOwnerTeamId = 't0'; f.repository.saveDraftPicks('l', picks);
    f.input.standings.conferences.East[14].PCT = 0.99;
    requestRefresh(f.repository, 'l', 'trade.completed', 'trade:weekly-test');
    const refreshed = await f.simulations.refresh('l', { seed: 'new-market' });
    assert.notEqual(refreshed.id, first.simulationSnapshotId);
    assert.deepEqual(f.simulations.weeklyProjection('l'), first);
});
test('advancing the league week publishes a new weekly projection only after the fresh market is saved', async t => {
    const f = fixture(t), first = f.simulations.weeklyProjection('l');
    f.repository.saveLeague('l', { currentWeek: 3 });
    assert.deepEqual(f.simulations.weeklyProjection('l'), first);
    const snapshot = await f.simulations.refresh('l', { seed: 'next-week' });
    const next = f.simulations.weeklyProjection('l');
    assert.equal(next.week, 3); assert.equal(next.simulationSnapshotId, snapshot.id);
    assert.notDeepEqual(next.selections.map(s => s.prospectId), first.selections.map(s => s.prospectId));
    assert.deepEqual(f.simulations.weeklyProjection('l'), next);
});

test('mock command and new current-class live mock refresh from current-week standings', async t => {
    const f = fixture(t), d = discordFixture(f), previous = f.simulations.active('l');
    f.repository.saveLeague('l', { currentWeek: 3 });
    f.input.standings.conferences.East[0].PCT = 0.99;
    const originalRefresh = f.simulations.refresh.bind(f.simulations); let refreshCalls = 0;
    f.simulations.refresh = (...args) => { refreshCalls += 1; return originalRefresh(...args); };
    const command = d.interaction('unused', 'u0');
    await d.workflow.projection(command);
    const published = f.simulations.weeklyProjection('l'), current = f.simulations.active('l');
    assert.equal(published.week, 3);
    assert.notEqual(current.id, previous.id);
    assert.notEqual(current.metadata.standingsHash, previous.metadata.standingsHash);
    const start = d.interaction('mock:startclass', 'u0', 'hub'); start.values = ['1'];
    await d.workflow.handle(start);
    assert.ok(refreshCalls >= 2);
    const live = f.live.all('l')[0];
    assert.equal(f.simulations.byId('l', live.simulationSnapshotId).currentWeek, 3);
});

test('current order displays all 30 saved picks without rerunning or changing locked ownership', async t => {
    const f = fixture(t), d = discordFixture(f);
    await d.start();
    let m = f.live.all('l')[0];
    await d.workflow.handle(d.interaction(`mock:${m.id}:lottery:0`, 'u0', m.threadId));
    m = f.live.get('l', m.id);
    const thread = d.channels.get(m.threadId);
    const card = thread._messages.get(m.lotteryMessageId).embeds[0];
    assert.equal(card.description.match(/\*\*#\d+\*\*/g).length, 30);
    assert.match(card.description, /🏀/);
    assert.ok(d.workflow.panelPayload(m).components[0].components.some(b => b.data.custom_id.endsWith(':base')));
    const before = f.live.get('l', m.id);
    const view = d.interaction(`mock:${m.id}:order`, 'u0', m.threadId);
    await d.workflow.handle(view);
    assert.equal(view.replies[0].embeds.length, 1);
    assert.deepEqual(f.live.get('l', m.id), before);
    await d.workflow.pump(d.guild, 'l', m.id);
    assert.equal(thread._messages.size, 2);
    f.live.lock('l', m.id, { id: 'u0' });
    const locked = d.interaction(`mock:${m.id}:order`, 'u0', m.threadId);
    await d.workflow.handle(locked);
    assert.match(locked.replies[0].embeds[0].data.title, /Locked Draft Order/);
});
test('best available uses the existing first prospect portrait and identifies it', t => {
    const f = fixture(t), d = discordFixture(f), m = f.ready('u0', f.repository.loadOwners('l').map(o => o.userId));
    const active = f.live.start('l', m.id, { id: 'u0' });
    active.input.prospects[0].image = 'https://example.com/prospect.png';
    const payload = d.workflow.selectionPayload(active, 1);
    assert.equal(payload.embeds[0].data.thumbnail.url, 'https://example.com/prospect.png');
    assert.match(payload.embeds[0].data.footer.text, /Portrait:/);
});

test('recovery consolidates old lottery pages without drawing again or duplicating messages', async t => {
    const f = fixture(t), d = discordFixture(f);
    await d.start();
    let m = f.live.all('l')[0];
    m = f.live.lottery('l', m.id, { id: 'u0' });
    const thread = d.channels.get(m.threadId);
    const { EmbedBuilder } = require('discord.js');
    for (const start of [0, 10, 20]) await thread.send({ embeds: [new EmbedBuilder().setDescription('Old page').setFooter({ text: `Live Mock ${m.id} · lottery 1 · ${start}` })] });
    const order = structuredClone(m.lotteryOrder);
    await d.workflow.pump(d.guild, 'l', m.id);
    m = f.live.get('l', m.id);
    assert.deepEqual(m.lotteryOrder, order);
    assert.equal(m.lotteryRuns, 1);
    assert.equal(thread._messages.size, 2);
    assert.equal(thread._messages.get(m.lotteryMessageId).embeds[0].description.match(/\*\*#\d+\*\*/g).length, 30);
    await d.workflow.pump(d.guild, 'l', m.id);
    assert.equal(thread._messages.size, 2);
});

test('room turn prompt appears after the last pick, opens privately for its coach, and sends no turn DM', async t => {
    const f = fixture(t), d = discordFixture(f);
    await d.start();
    let m = f.live.all('l')[0];
    f.live.invite('l', m.id, { id: 'u0' }, f.repository.loadOwners('l').map(o => o.userId));
    f.live.lottery('l', m.id, { id: 'u0' }); f.live.lock('l', m.id, { id: 'u0' });
    m = f.live.start('l', m.id, { id: 'u0' });
    await d.workflow.pump(d.guild, 'l', m.id);
    const coach = f.live.controller(m).userId, room = d.channels.get(m.threadId);
    assert.equal(d.dmChannels.size, 0);
    const first = [...room._messages.values()].at(-1);
    assert.match(first.embeds[0].description, /is selecting their player/);
    const customId = first.components[0].components[0].customId;
    const bad = d.interaction(customId, coach === 'u0' ? 'u1' : 'u0', m.threadId);
    await d.workflow.handle(bad); assert.match(bad.replies[0].content, /not on the clock/);
    const open = d.interaction(customId, coach, m.threadId);
    await d.workflow.handle(open);
    assert.equal(open.deferPayload.flags, MessageFlags.Ephemeral);
    assert.match(open.replies[0].embeds[0].data.title, /BEST AVAILABLE/);
    f.live.commit('l', m.id, { expectedPick: 1, userId: coach, prospectId: m.input.prospects[0].prospectId });
    await d.workflow.pump(d.guild, 'l', m.id);
    const messages = [...room._messages.values()];
    assert.match(messages.at(-2).embeds[0].footer.text, /pick 1$/);
    assert.match(messages.at(-1).embeds[0].description, /Pick #2/);
    assert.equal(first.components.length, 0);
    assert.equal(d.dmChannels.size, 0);
    const count = room._messages.size;
    await d.workflow.pump(d.guild, 'l', m.id); assert.equal(room._messages.size, count);
    const next = messages.at(-1);
    f.live.pause('l', m.id, { id: 'u0' }); await d.workflow.pump(d.guild, 'l', m.id);
    assert.match(next.embeds[0].description, /Draft paused/);
    f.live.resume('l', m.id, { id: 'u0' }); await d.workflow.pump(d.guild, 'l', m.id);
    assert.doesNotMatch(next.embeds[0].description, /Draft paused/);
});
test('final recap is one complete embed with all picks, grades, takeaways and restart-safe delivery', async t => {
    const f = fixture(t), d = discordFixture(f);
    await d.start();
    let m = f.live.all('l')[0]; f.live.lottery('l', m.id, { id: 'u0' }); f.live.lock('l', m.id, { id: 'u0' }); f.live.setAvailable('l', m.id, 'u0', false); f.live.start('l', m.id, { id: 'u0' });
    d.failDelete(true); await d.workflow.pump(d.guild, 'l', m.id);
    const dm = d.dmChannels.get('u0'), message = [...dm._messages.values()][0];
    assert.equal(dm._messages.size, 1); assert.equal(message.embeds.length, 1);
    const card = message.embeds[0], text = card.fields.map(f => f.value).join('\n');
    const room = d.channels.get(m.threadId);
    const recaps = [...room._messages.values()].filter(msg => msg.embeds.some(e => e.title === '🏁 FINAL MOCK DRAFT RECAP'));
    assert.equal(recaps.length, 1);
    assert.deepEqual(recaps[0].embeds, message.embeds);
    assert.notEqual(recaps[0].nonce, message.nonce);
    assert.equal(card.thumbnail, undefined);
    assert.equal(card.image, undefined);
    const { finalRecapPayload } = require('../src/fantasyhq/discord-mock-draft');
    const completed = f.live.get('l', m.id);
    completed.selections[0].prospect.image = 'https://example.com/portrait.png';
    assert.equal(finalRecapPayload(completed).files, undefined);
    assert.equal(finalRecapPayload(completed).embeds[0].data.thumbnail, undefined);

    assert.equal(text.match(/\*\*#\d+\*\*/g).length, 30);
    assert.ok(card.fields.some(f => f.name.includes('takeaways')));
    assert.match(text, /\*\*(A|B|C|D|F)[+-]?\*\*/);
    f.live.mutate('l', m.id, draft => { draft.dmDelivery = {}; });
    await d.workflow.pump(d.guild, 'l', m.id);
    assert.equal(dm._messages.size, 1);
});

test('base order can be previewed before drawing, selected by the host, and locked without a lottery', async t => {
    const f = fixture(t), d = discordFixture(f);
    await d.start();
    let m = f.live.all('l')[0];
    assert.ok(d.workflow.panelPayload(m).components[0].components.some(b => b.data.custom_id.endsWith(':base')));
    const before = f.live.get('l', m.id), preview = d.interaction(`mock:${m.id}:base`, 'u0', m.threadId);
    await d.workflow.handle(preview);
    assert.deepEqual(f.live.get('l', m.id), before);
    assert.equal(preview.replies[0].embeds[0].data.description.match(/\*\*#\d+\*\*/g).length, 30);
    const control = preview.replies[0].components[0].components[0].data.custom_id;
    await d.workflow.handle(d.interaction(control, 'u0', m.threadId));
    m = f.live.get('l', m.id);
    assert.equal(m.orderSource, 'BASE');
    assert.deepEqual(m.lotteryOrder, generateDraftOrder(f.simulations.inputFor('l'), { lottery: false }).order);
    assert.equal(m.status, 'LOTTERY_READY');
    await d.workflow.handle(d.interaction(control, 'u0', m.threadId));
    assert.equal(f.live.get('l', m.id).lotteryRuns, 1);
    f.live.lock('l', m.id, { id: 'u0' });
    assert.throws(() => f.live.useBaseOrder('l', m.id, { id: 'u0' }, 1), /locked/);
});
test('only host or staff can select the base order; lottery remains available after selecting it', t => {
    const f = fixture(t), m = f.live.create('l', 'u0', 'guild');
    assert.throws(() => f.live.useBaseOrder('l', m.id, { id: 'u1' }, 0), /host/);
    f.live.useBaseOrder('l', m.id, { id: 'u0' }, 0);
    assert.equal(f.live.lottery('l', m.id, { id: 'u0' }).orderSource, 'LOTTERY');
});
test('CPU weights use positional strength, numeric shooting, team spacing, age and earlier picks', () => {
    const { candidateWeight, selectionFactors } = require('../src/fantasyhq/mock-engine');
    const input = inputFixture(), slot = { pickNumber: 10, currentOwnerTeamId: 't0' };
    const prospect = { ...input.prospects[0], overall: 76, potential: 90, age: 19, three_pt: 85 };
    input.rosters.t0 = [{ position1: 'PG', overall: 65, three_pt: 55 }];
    const weak = candidateWeight(input, slot, prospect, 1);
    input.rosters.t0 = [{ position1: 'PG', overall: 95, three_pt: 55 }];
    assert.ok(candidateWeight(input, slot, prospect, 1) < weak);
    const shooter = candidateWeight(input, slot, prospect, 1), nonshooter = candidateWeight(input, slot, { ...prospect, three_pt: 40 }, 1);
    assert.ok(shooter > nonshooter);
    const shootingNeed = selectionFactors(input, 't0', prospect).shooting;
    input.rosters.t0[0].three_pt = 99;
    assert.ok(selectionFactors(input, 't0', prospect).shooting < shootingNeed);
    input.rosters.t0 = [{ position1: 'C', overall: 68 }];
    assert.ok(candidateWeight(input, slot, prospect, 1) > candidateWeight(input, slot, { ...prospect, age: 24 }, 1));
    const before = selectionFactors(input, 't0', prospect).need;
    const after = selectionFactors(input, 't0', prospect, [{ currentOwnerTeamId: 't0', prospectId: prospect.prospectId, prospect }]).need;
    assert.ok(after < before);
    assert.ok(Number.isFinite(candidateWeight(input, slot, { prospectId: 'unknown', board_number: 2 }, 1)));
});
test('age-based succession and archetype fit use stable season data', () => {
    const { playerAge, fitFor } = require('../src/fantasyhq/mock-engine');
    const input = inputFixture(), p = input.prospects[0];
    assert.equal(playerAge({ birthdate: 'September 19, 1991' }, 2027), 35);
    assert.equal(playerAge({}, 2027), null);
    input.rosters.t0 = [{ position1: 'PG', overall: 90, age: 24, archetype: 'Rim Protector' }];
    const young = needFor(input, 't0', p);
    input.rosters.t0[0].age = 35;
    assert.ok(needFor(input, 't0', p) > young);
    const fits = fitFor(input, 't0', { ...p, strength_3: 'Playmaking' });
    input.rosters.t0[0].archetype = 'Shooting Playmaker';
    assert.ok(fitFor(input, 't0', { ...p, strength_3: 'Playmaking' }) < fits);
});

test('live lottery draws vary each run and reject immediate repeated draws without swapping teams', t => {
    const f = fixture(t);
    const service = createLiveMockService({ repository: f.repository, simulations: f.simulations });
    const m = service.create('l', 'u0', 'guild');
    let prior = null;
    for (let n = 0; n < 20; n++) {
        const draw = service.lottery('l', m.id, { id: 'u0' }).lotteryOrder;
        assert.notDeepEqual(draw, prior);
        assert.equal(new Set(draw.map(s => s.originalTeamId)).size, 30);
        prior = draw;
    }
    const constant = createLiveMockService({ repository: f.repository, simulations: f.simulations, rng: () => 0 });
    constant.lottery('l', m.id, { id: 'u0' });
    const before = constant.get('l', m.id);
    assert.throws(() => constant.lottery('l', m.id, { id: 'u0' }), /different lottery/);
    assert.deepEqual(constant.get('l', m.id), before);
});
test('base preview Start Draft selects and locks the base order and begins immediately', async t => {
    const f = fixture(t), d = discordFixture(f);
    await d.start();
    let m = f.live.all('l')[0];
    f.live.invite('l', m.id, { id: 'u0' }, f.repository.loadOwners('l').map(o => o.userId));
    const preview = d.interaction(`mock:${m.id}:base`, 'u0', m.threadId);
    await d.workflow.handle(preview);
    const start = preview.replies[0].components[0].components.find(b => b.data.label === 'START DRAFT');
    assert.ok(start);
    await d.workflow.handle(d.interaction(start.data.custom_id, 'u1', m.threadId));
    assert.equal(f.live.get('l', m.id).status, 'SETUP');
    await d.workflow.handle(d.interaction(start.data.custom_id, 'u0', m.threadId));
    m = f.live.get('l', m.id);
    assert.equal(m.status, 'ACTIVE'); assert.equal(m.orderSource, 'BASE');
    assert.deepEqual(m.lockedDraftOrder, f.live.baseOrder('l').order);
    const run = m.lotteryRuns;
    await d.workflow.handle(d.interaction(start.data.custom_id, 'u0', m.threadId));
    assert.equal(f.live.get('l', m.id).lotteryRuns, run);
});
test('selected base and lottery orders both offer Start Draft with at most five panel buttons', async t => {
    const f = fixture(t), d = discordFixture(f);
    await d.start();
    let m = f.live.all('l')[0];
    f.live.invite('l', m.id, { id: 'u0' }, f.repository.loadOwners('l').map(o => o.userId));
    for (const source of ['BASE', 'LOTTERY']) {
        m = source === 'BASE' ? f.live.useBaseOrder('l', m.id, { id: 'u0' }, m.lotteryRuns) : f.live.lottery('l', m.id, { id: 'u0' });
        const buttons = d.workflow.panelPayload(m).components[0].components;
        assert.ok(buttons.length <= 5);
        assert.ok(buttons.some(b => b.data.label === 'START DRAFT'));
    }
    await d.workflow.handle(d.interaction(`mock:${m.id}:startorder:${m.lotteryRuns}`, 'u0', m.threadId));
    assert.equal(f.live.get('l', m.id).status, 'ACTIVE');
    assert.equal(f.live.get('l', m.id).orderSource, 'LOTTERY');
});

test('lottery remembers earlier orders across restart and rejects nonconsecutive repeats', t => {
    const f = fixture(t); let draw = 0;
    const service = createLiveMockService({ repository: f.repository, simulations: f.simulations, rng: () => draw });
    const m = service.create('l', 'u0', 'guild');
    const first = service.lottery('l', m.id, { id: 'u0' });
    draw = 0.99;
    const second = service.lottery('l', m.id, { id: 'u0' });
    assert.notDeepEqual(first.lotteryOrder, second.lotteryOrder);
    const restarted = createLiveMockService({ repository: f.repository, simulations: f.simulations, rng: () => 0 });
    assert.throws(() => restarted.lottery('l', m.id, { id: 'u0' }), /different lottery/);
    assert.deepEqual(restarted.get('l', m.id), second);
});

test('transient recap errors retry before room cleanup and send exactly one DM', async t => {
    const f = fixture(t), d = discordFixture(f);
    await d.start();
    let m = f.live.all('l')[0]; f.live.lottery('l', m.id, { id: 'u0' }); f.live.lock('l', m.id, { id: 'u0' }); f.live.setAvailable('l', m.id, 'u0', false); f.live.start('l', m.id, { id: 'u0' });
    const original = d.client.users.fetch; let attempts = 0;
    d.client.users.fetch = async id => { if (++attempts === 1) throw Object.assign(Error('Unknown Message'), { code: 10008 }); return original(id); };
    await d.workflow.pump(d.guild, 'l', m.id);
    m = f.live.get('l', m.id);
    assert.equal(m.status, 'CLEANUP_PENDING'); assert.equal(d.deleted(), false);
    assert.equal(m.dmDelivery.u0.delivered, false);
    f.live.mutate('l', m.id, draft => { draft.dmDelivery.u0.nextRetryAt = 0; });
    await d.workflow.pump(d.guild, 'l', m.id);
    m = f.live.get('l', m.id);
    assert.equal(m.status, 'CLEANED'); assert.equal(m.dmDelivery.u0.delivered, true);
    assert.equal(m.dmDelivery.u0.attempts, 2); assert.equal(d.dmChannels.get('u0')._messages.size, 1);
});
test('archived failed recap is recovered on tick without recreating the draft room', async t => {
    const f = fixture(t), d = discordFixture(f);
    await d.start();
    let m = f.live.all('l')[0]; f.live.lottery('l', m.id, { id: 'u0' }); f.live.lock('l', m.id, { id: 'u0' }); f.live.setAvailable('l', m.id, 'u0', false); f.live.start('l', m.id, { id: 'u0' });
    await d.workflow.pump(d.guild, 'l', m.id);
    d.dmChannels.get('u0')._messages.clear();
    f.live.mutate('l', m.id, draft => { draft.dmDelivery.u0 = { delivered: false, attemptedAt: 'old', error: 'Unknown Message' }; });
    f.simulations.refresh = async () => saved;
    await d.workflow.tick(d.client);
    assert.equal(f.live.get('l', m.id).dmDelivery.u0.delivered, true);
    assert.equal(d.channels.size, 1); assert.equal(d.dmChannels.get('u0')._messages.size, 1);
});
test('crowded positions still get shooting and upside labels rather than automatic luxury labels', () => {
    const { evaluate } = require('../src/fantasyhq/mock-engine'), input = inputFixture();
    input.rosters.t0 = Array.from({ length: 5 }, () => ({ position1: 'PG', overall: 90, age: 25 }));
    const slot = { pickNumber: 1, currentOwnerTeamId: 't0' }, market = { avp: 1 };
    const p = { ...input.prospects[0], age: 19, three_pt: 90, potential: 96, overall: 74 };
    assert.notEqual(evaluate(input, slot, p, [], market).storyline, 'Luxury pick');
    const luxury = { ...p, potential: 75, overall: 70, three_pt: 50, strength_1: '', strength_2: '', build: '' };
    assert.equal(evaluate(input, slot, luxury, [], market).storyline, 'Luxury pick');
    const grades = [1, 8, 18, 35].map(rank => evaluate(input, slot, { ...p, board_number: rank }, [], { avp: rank }).grade);
    assert.ok(new Set(grades).size >= 3);
});

test('live CPU excludes major reaches even with extreme random draws and strong fit signals', () => {
    const input = inputFixture();
    input.prospects[59] = { ...input.prospects[59], position_1: 'PG', three_pt: 99, potential: 99, overall: 95, age: 18, 'draft score': 99 };
    for (const [pick, margin] of [[1, 2], [5, 2], [6, 3], [14, 3], [15, 5], [30, 5]]) {
        const selections = input.prospects.slice(0, pick - 1).map(p => ({ prospectId: p.prospectId }));
        const slot = { pickNumber: pick, currentOwnerTeamId: 't0' };
        for (const draw of [0, 0.5, 0.999999]) {
            const p = chooseProspect(input, slot, selections, saved, () => draw);
            assert.ok(p.board_number <= pick + margin);
        }
    }
    const slide = chooseProspect(input, { pickNumber: 30, currentOwnerTeamId: 't0' }, [], saved, () => 0.999999);
    assert.ok(slide.board_number <= 6);
    const depleted = input.prospects.slice(0, 60).map(p => ({ prospectId: p.prospectId }));
    assert.equal(chooseProspect(input, { pickNumber: 1, currentOwnerTeamId: 't0' }, depleted, saved, () => 0).board_number, 61);
});
test('live CPU and timeout CPU both enforce reach limits during persisted commits', t => {
    const f = fixture(t), service = createLiveMockService({ repository: f.repository, simulations: f.simulations, now: f.now, rng: () => 0.999999 });
    let m = service.create('l', 'u0', 'guild');
    service.invite('l', m.id, { id: 'u0' }, f.repository.loadOwners('l').map(o => o.userId));
    service.useBaseOrder('l', m.id, { id: 'u0' }, 0); service.lock('l', m.id, { id: 'u0' }); m = service.start('l', m.id, { id: 'u0' });
    f.time(m.deadlineAt);
    m = service.commit('l', m.id, { expectedPick: 1, type: 'TIMEOUT_CPU' });
    assert.ok(m.selections[0].boardRank <= 3);
    for (const p of m.participants) service.setAvailable('l', m.id, p.userId, false);
    while (m.status === 'ACTIVE') {
        m = service.get('l', m.id);
        const best = Math.min(...service.available(m).map(p => p.board_number)), pick = m.currentPick;
        m = service.commit('l', m.id, { expectedPick: pick, type: 'CPU' });
        const margin = pick <= 5 ? 2 : pick <= 14 ? 3 : 5;
        assert.ok(m.selections.at(-1).boardRank <= Math.max(best, Math.min(best + margin, pick + margin)));
    }
    assert.equal(m.selections.length, 30);
});

test('all regular simulation rounds and seeded projections respect the reach window', () => {
    for (const round of [...saved.simulations, project(saved.input, saved.simulations[0], saved, seededRandom('regular-reach'))]) {
        const taken = new Set();
        for (const s of round) {
            const best = Math.min(...saved.input.prospects.filter(p => !taken.has(p.prospectId)).map(p => p.board_number));
            const p = saved.input.prospects.find(p => p.prospectId === s.prospectId), margin = s.pickNumber <= 5 ? 2 : s.pickNumber <= 14 ? 3 : 5;
            assert.ok(p.board_number <= Math.max(best, Math.min(best + margin, s.pickNumber + margin)));
            taken.add(p.prospectId);
        }
    }
});
test('engine upgrades refresh the published regular projection once and preserve weekly stability afterward', t => {
    const f = fixture(t), first = f.simulations.weeklyProjection('l');
    const old = structuredClone(first); delete old.engineVersion;
    old.selections[0].prospectId = f.input.prospects.at(-1).prospectId;
    atomicWrite(path.join(f.root, 'weekly-projection.json'), old);
    const updated = f.simulations.weeklyProjection('l');
    assert.equal(updated.engineVersion, require('../src/fantasyhq/mock-engine').ENGINE_VERSION);
    assert.notEqual(updated.selections[0].prospectId, old.selections[0].prospectId);
    assert.deepEqual(f.simulations.weeklyProjection('l'), updated);
});

test('lottery result embed offers start and rerun controls, refreshes after rerun, and clears controls on start', async t => {
    const f = fixture(t), d = discordFixture(f);
    await d.start();
    let m = f.live.all('l')[0];
    f.live.invite('l', m.id, { id: 'u0' }, f.repository.loadOwners('l').map(o => o.userId));
    const lottery = d.interaction(`mock:${m.id}:lottery:0`, 'u0', m.threadId);
    await d.workflow.handle(lottery);
    m = f.live.get('l', m.id);
    const first = d.channels.get(m.threadId)._messages.get(m.lotteryMessageId);
    const buttons = first.components[0].components.map(c => c.customId);
    assert.ok(buttons.includes(`mock:${m.id}:startorder:1`));
    assert.ok(buttons.includes(`mock:${m.id}:lottery:1`));
    assert.equal(lottery.replies[0].embeds.length, 1);
    assert.equal(lottery.replies[0].components[0].components.length, 2);
    await d.workflow.handle(d.interaction(`mock:${m.id}:lottery:1`, 'u0', m.threadId));
    m = f.live.get('l', m.id);
    const latest = d.channels.get(m.threadId)._messages.get(m.lotteryMessageId);
    assert.ok(latest.components[0].components.some(c => c.customId === `mock:${m.id}:startorder:2`));
    await d.workflow.handle(d.interaction(`mock:${m.id}:startorder:1`, 'u0', m.threadId));
    assert.equal(f.live.get('l', m.id).status, 'LOTTERY_READY');
    await d.workflow.handle(d.interaction(`mock:${m.id}:startorder:2`, 'u0', m.threadId));
    assert.equal(f.live.get('l', m.id).status, 'ACTIVE');
    assert.equal(latest.components.length, 0);
});

test('live start uses the season class without a chooser; legacy selectors cannot override it', async t => {
    const f = fixture(t, { alternateClasses: true }), d = discordFixture(f);
    f.repository.saveLeague('l', { seasonNumber: 2 });
    f.repository.saveDraftPicks('l', f.input.picks.map(p => ({ ...p, draftYear: 2028 })));
    const start = d.interaction('mock:start'); await d.workflow.handle(start);
    let m = f.live.all('l')[0]; assert.equal(m.classNumber, 2); assert.equal(m.draftClassId, 'class2');
    assert.match(start.replies.at(-1).content, /private Live Mock is ready/);
    const legacy = d.interaction('mock:startclass'); legacy.values = ['4']; await d.workflow.handle(legacy);
    assert.equal(f.live.all('l').length, 1);
    f.live.lottery('l', m.id, { id: 'u0' }); m = f.live.lock('l', m.id, { id: 'u0' });
    assert.ok(m.input.prospects.every(p => p.prospectId.startsWith('class2:')));
    f.live.setAvailable('l', m.id, 'u0', false); m = f.live.start('l', m.id, { id: 'u0' });
    m = f.live.commit('l', m.id, { expectedPick: 1, type: 'CPU' });
    assert.match(m.selections[0].prospect.name, /^CUS2/);
});
test('weekly mocks follow seasons 1 through 4, remain stable and reject class overrides', async t => {
    const f = fixture(t, { alternateClasses: true });
    for (const n of [1, 2, 3, 4]) {
        f.repository.saveLeague('l', { seasonNumber: n });
        f.repository.saveDraftPicks('l', f.input.picks.map(p => ({ ...p, draftYear: 2026 + n })));
        await f.simulations.refresh('l');
        const result = await f.simulations.classProjection('l');
        assert.equal(result.draftClassId, n === 1 ? 'class' : `class${n}`);
        assert.equal(result.selections.length, 30);
        assert.equal(f.simulations.byId('l', result.simulationSnapshotId).simulationCount, 1000);
        assert.deepEqual(await f.simulations.classProjection('l'), result);
        await assert.rejects(f.simulations.classProjection('l', n === 1 ? 2 : 1), /automatically/);
    }
    assert.throws(() => f.live.create('l', 'u0', 'guild', 1), /automatically/);
    const d = discordFixture(f), command = d.interaction('unused');
    command.options = { getInteger: () => 1 }; // Old slash command registration cannot select another class.
    await d.workflow.projection(command);
    assert.match(command.replies[0].embeds[0].data.fields[0].value, /CUS4/);
});

test('all four installed boards load normalized ranks, including id_number boards', t => {
    const f = fixture(t);
    const { createScoutingService } = require('../src/fantasyhq/scouting-service');
    const scouting = createScoutingService({ repository: f.repository, draftClassDir: path.resolve('draft_class') });
    for (const n of [1, 2, 3, 4]) {
        const board = scouting.boardForContext({ league: { seasonNumber: n } });
        assert.ok(board.prospects.length >= 30);
        assert.equal(board.prospects[0].board_number, 1);
        assert.equal(new Set(board.prospects.map(p => p.board_number)).size, board.prospects.length);
    }
});


test('solo mock controls vacant teams with current staff permission and never takes an online coach pick', t => {
    const f = fixture(t);
    f.repository.saveOwners('l', [{ teamId: 't0', userId: 'u0' }]);
    let m = f.live.create('l', 'u0', 'guild');
    assert.throws(() => f.live.setSoloControl('l', m.id, { id: 'u0' }, true), /staff/);
    f.repository.saveSettings('l', { testMode: false });
    assert.throws(() => f.live.setSoloControl('l', m.id, { id: 'u0', staff: true }, true), /Test Mode/);
    f.repository.saveSettings('l', { testMode: true });
    f.live.setSoloControl('l', m.id, { id: 'u0', staff: true }, true);
    f.live.useBaseOrder('l', m.id, { id: 'u0' }, 0);
    f.live.lock('l', m.id, { id: 'u0' });
    m = f.live.start('l', m.id, { id: 'u0' });
    assert.equal(f.live.controller(m).testControlled, true);
    const prospectId = f.live.available(m)[0].prospectId;
    assert.throws(() => f.live.commit('l', m.id, { expectedPick: 1, userId: 'u0', prospectId }), /staff/i);
    f.repository.saveOwners('l', [{ teamId: 't0', userId: 'u0' }, { teamId: m.lockedDraftOrder[0].currentOwnerTeamId, userId: 'online' }]);
    assert.equal(f.live.controller(m), null);
    assert.throws(() => f.live.commit('l', m.id, { expectedPick: 1, userId: 'u0', staff: true, prospectId }));
    f.repository.saveOwners('l', [{ teamId: 't0', userId: 'u0' }]);
    f.repository.saveSettings('l', { testMode: false });
    assert.equal(f.live.controller(m), null);
    f.repository.saveSettings('l', { testMode: true });
    m = f.live.commit('l', m.id, { expectedPick: 1, userId: 'u0', staff: true, prospectId });
    assert.equal(m.selections[0].soloTestControlled, true);
});


test('Discord solo toggle exposes a vacant-team picker and confirms with the host actual identity', async t => {
    const f = fixture(t), d = discordFixture(f);
    f.repository.saveOwners('l', [{ teamId: 't0', userId: 'u0' }]);
    const fetchMember = d.guild.members.fetch;
    d.guild.members.fetch = async id => ({ ...await fetchMember(id), permissions: { has: () => id === 'u0' } });
    const staffClick = id => { const i = d.interaction(id, 'u0', f.live.all('l')[0].threadId); i.memberPermissions.has = () => true; return i; };
    await d.start();
    let m = f.live.all('l')[0];
    await d.workflow.handle(staffClick(`mock:${m.id}:solo:on`));
    assert.equal(f.live.get('l', m.id).soloControl, true);
    await d.workflow.handle(staffClick(`mock:${m.id}:usebase:0`));
    await d.workflow.handle(staffClick(`mock:${m.id}:startorder:1`));
    m = f.live.get('l', m.id);
    assert.equal(m.status, 'ACTIVE'); assert.equal(f.live.controller(m).testControlled, true);
    const denied = d.interaction(`mock:${m.id}:available:1`, 'u0', m.threadId);
    await d.workflow.handle(denied);
    assert.match(denied.replies.at(-1).content, /Only staff/);
    const available = staffClick(`mock:${m.id}:available:1`);
    await d.workflow.handle(available);
    assert.ok(available.replies.at(-1).components.length);
    const prospect = f.live.available(m)[0];
    await d.workflow.handle(staffClick(`mock:${m.id}:confirm:1:${prospect.board_number}`));
    const updated = f.live.get('l', m.id);
    assert.equal(updated.selections.length, 1);
    assert.equal(updated.selections[0].selectedByUserId, 'u0');
    assert.equal(updated.selections[0].soloTestControlled, true);
});


test('saved live picks prefer the board image mapping over stale rank-based portraits', t => {
    const f = fixture(t), m = f.ready();
    const { reactionPayload } = require('../src/fantasyhq/discord-mock-draft');
    const board = require('../draft_class/2k27_CUS04 - Big Board.json');
    for (const rank of [9, 10]) {
        const prospect = { ...m.input.prospects[0], ...board[rank], imagePath: path.resolve('draft_class', board[rank === 9 ? 10 : 9].image) };
        const slot = m.lockedDraftOrder[0], r = reaction(m.input, slot, prospect, [], null);
        const payload = reactionPayload(m, { ...slot, prospect, boardRank: rank, avp: null, grade: r.grade, storyline: r.storyline, analysis: r.analysis });
        assert.equal(payload.files[0].attachment, path.resolve('draft_class', prospect.image));
    }
});


test('live best-available panel shows needs for the pick owner and includes earlier mock selections', t => {
    const f = fixture(t), d = discordFixture(f), m = f.ready('u0', f.repository.loadOwners('l').map(o => o.userId));
    const active = f.live.start('l', m.id, { id: 'u0' });
    const teamId = active.lockedDraftOrder[0].currentOwnerTeamId;
    active.input.rosters[teamId] = [95, 85, 80].map(overall => ({ overall, age: 25, position1: 'PG' }));
    const first = d.workflow.selectionPayload(active, 1).embeds[0].toJSON();
    assert.equal(first.fields.length, 1);
    assert.match(first.fields[0].value, /PG · Low need/);
    assert.match(first.fields[0].value, /C · High need/);
    assert.match(first.fields[0].value, /3 primary/);
    assert.match(first.fields[0].name, new RegExp(active.input.teams.find(team => team.teamId === teamId).teamName));
    active.selections.push({ currentOwnerTeamId: teamId, prospect: { position_1: 'C', overall: 85, age: 19 } });
    const after = d.workflow.selectionPayload(active, 1).embeds[0].toJSON().fields[0].value;
    assert.match(after, /C · Moderate need/);
    assert.match(after, /1 primary · Rotation depth 1.0 · Best 85 OVR/);
    active.selections = [];
    active.input.rosters[teamId] = [];
    assert.match(d.workflow.selectionPayload(active, 1).embeds[0].toJSON().fields[0].value, /Roster data is unavailable/);
});

test('rotation-quality needs ignore fringe stockpiles and distinguish starter, backup and age gaps', () => {
    const { teamPositionNeeds } = require('../src/fantasyhq/mock-engine');
    const input = inputFixture(), prospect = { position_1: 'PG' };
    input.rosters.t0 = [{ position1: 'PG', overall: 72, age: 24 }];
    const weak = needFor(input, 't0', prospect);
    input.rosters.t0.push(...Array.from({ length: 12 }, () => ({ position1: 'PG', overall: 64, age: 24 })));
    assert.equal(needFor(input, 't0', prospect), weak);
    assert.equal(teamPositionNeeds(input, 't0').positions[0].priority, 'High');
    input.rosters.t0 = [{ position1: 'PG', overall: 90, age: 25 }];
    const noBackup = needFor(input, 't0', prospect);
    input.rosters.t0.push({ position1: 'PG', overall: 80, age: 24 });
    const covered = needFor(input, 't0', prospect);
    assert.ok(covered < noBackup);
    input.rosters.t0.push(...Array.from({ length: 20 }, () => ({ position1: 'PG', overall: 60 })));
    assert.equal(needFor(input, 't0', prospect), covered);
    input.rosters.t0[0].age = 36;
    assert.ok(needFor(input, 't0', prospect) > covered);
    input.rosters.t0 = [{ position1: 'SG', position2: 'PG', overall: 90, age: 25 }, { position1: 'SG', position2: 'PG', overall: 80 }];
    assert.ok(needFor(input, 't0', prospect) > covered);
    const afterPick = needFor(input, 't0', prospect, [{ currentOwnerTeamId: 't0', prospect: { position_1: 'PG', overall: 82, age: 19 } }]);
    assert.ok(afterPick < needFor(input, 't0', prospect));
});

test('CPU preserves clear elite talent tiers even when a team is crowded at their position', () => {
    const input = inputFixture();
    input.prospects[0] = { ...input.prospects[0], position_1: 'PG', 'draft score': 96, potential: 99 };
    input.rosters.t0 = [98, 96, 90].map(overall => ({ position1: 'PG', overall, age: 24 }));
    for (const draw of [0, 0.5, 0.999999]) {
        assert.equal(chooseProspect(input, { pickNumber: 1, currentOwnerTeamId: 't0' }, [], saved, () => draw).board_number, 1);
    }
});

test('all four real draft classes keep top talent within bounded slides across repeated complete rounds', async () => {
    const { createScoutingService } = require('../src/fantasyhq/scouting-service');
    const scouting = createScoutingService({ repository: {} });
    for (let classNumber = 1; classNumber <= 4; classNumber++) {
        const input = inputFixture();
        input.prospects = scouting.boardForContext({ league: { seasonNumber: classNumber } }).prospects
            .map(p => ({ ...p, prospectId: `cus${classNumber}:${p.board_number}` }));
        const snapshot = await simulate(input, { seed: `elite-regression-${classNumber}` });
        const rounds = [...snapshot.simulations, project(input, snapshot.simulations[0], snapshot, () => 0.999999)];
        for (const round of rounds) {
            for (const rank of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
                const pick = round.find(s => s.prospectId === `cus${classNumber}:${rank}`).pickNumber;
                assert.ok(pick <= rank + (rank <= 3 ? 1 : rank <= 5 ? 2 : 3), `CUS${classNumber} rank ${rank} fell to ${pick}`);
            }
            if ([1, 4].includes(classNumber)) assert.equal(round[0].prospectId, `cus${classNumber}:1`);
            if (classNumber === 4) assert.equal(round[1].prospectId, 'cus4:2');
        }
    }
});


test('mock needs count primary positions only and identify two needs even for complete elite rosters',()=>{
 const {teamPositionNeeds}=require('../src/fantasyhq/mock-engine'),input=inputFixture();
 input.rosters.t0=[{position1:'PG/SG',position2:'SG',overall:90,age:25},{position1:'PG',position2:'C',overall:88,age:25}];
 let needs=teamPositionNeeds(input,'t0');assert.equal(needs.positions.find(p=>p.position==='PG').primaryCount,2);assert.equal(needs.positions.find(p=>p.position==='SG').primaryCount,0);assert.equal(needs.positions.find(p=>p.position==='C').primaryCount,0);assert.equal(needs.targets.length,4);assert.equal(needs.positions.filter(p=>p.targeted).length,4);
 input.rosters.t0=['PG','SG','SF','PF','C'].flatMap(position1=>Array.from({length:3},()=>({position1,overall:99,age:24})));
 needs=teamPositionNeeds(input,'t0');assert.equal(needs.targets.length,2);assert.equal(new Set(needs.targets).size,2);
 input.rosters.t0.filter(p=>p.position1==='C').forEach(p=>p.overall=68);assert.equal(teamPositionNeeds(input,'t0').targets[0],'C');
});
test('weekly second round includes picks 31–60, honors asset owners, never repeats first-round prospects and stays frozen across restarts',t=>{
 const f=fixture(t),second=f.input.teams.map(team=>({pickId:'second_'+team.teamId,round:2,draftYear:2027,originalTeamId:team.teamId,currentOwnerTeamId:team.teamId}));second[0].currentOwnerTeamId='t1';f.repository.saveDraftPicks('l',[...f.input.picks,...second]);const first=f.simulations.weeklyProjection('l'),round2=f.simulations.secondRoundProjection('l',first);assert.equal(round2.length,30);assert.deepEqual(round2.map(s=>s.pickNumber),Array.from({length:30},(_,i)=>31+i));assert.equal(new Set([...first.selections,...round2].map(s=>s.prospectId)).size,60);assert.equal(round2.find(s=>s.originalTeamId==='t0').currentOwnerTeamId,'t1');
 const restart=createMockSimulationService({repository:f.repository,scoutingService:{boardForContext:()=>({file:'class.json',prospects:f.input.prospects})},standingsService:{getStandings:()=>f.input.standings}});assert.deepEqual(restart.secondRoundProjection('l',first),round2);assert.deepEqual(f.simulations.weeklyProjection('l'),first);
 const embed=require('../src/fantasyhq/discord-mock-draft').projectionEmbed(first.input,round2,first,[],2).toJSON();assert.match(embed.description,/Second Round/);assert.match(embed.fields[0].name,/31/);assert.match(embed.fields.at(-1).name,/60/);
});
