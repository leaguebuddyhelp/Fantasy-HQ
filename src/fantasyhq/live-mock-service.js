const fs = require('fs');
const path = require('path');
const { randomUUID, randomBytes, createHash } = require('crypto');
const liveRandom = () => randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
const { atomicWrite, read, rootFor, locked } = require('./mock-storage');
const { generateDraftOrder } = require('./draft-order');
const { chooseProspect, reaction } = require('./mock-engine');
const LIVE = new Set(['SETUP', 'LOTTERY_READY', 'ORDER_LOCKED', 'ACTIVE', 'PAUSED']);
const CLOCK_MS = 120000;
function awardsFor(selections) {
    if (selections.length !== 30) throw Error('Recap requires all 30 picks.');
    const sort = key => selections.slice().sort((a, b) => b.metrics[key] - a.metrics[key]);
    const awards = [];
    if (sort('value')[0].metrics.value > 0.5) awards.push({ category: 'Best value', pickNumber: sort('value')[0].pickNumber });
    const reach = sort('value').at(-1); if (reach.metrics.value < -0.7) awards.push({ category: 'Biggest reach', pickNumber: reach.pickNumber });
    if (sort('need')[0].metrics.need > 0.6) awards.push({ category: 'Best fit', pickNumber: sort('need')[0].pickNumber });
    const hauls = [...new Set(selections.map(s => s.currentOwnerTeamId))].map(teamId => {
        const picks = selections.filter(s => s.currentOwnerTeamId === teamId);
        return { teamId, pickNumbers: picks.map(s => s.pickNumber), score: picks.reduce((n, s) => n + (s.metrics.score / 12) * (1 + (31 - Math.min(s.boardRank, 30)) / 30), 0), averageGradeScore: picks.reduce((n, s) => n + s.metrics.score, 0) / picks.length };
    }).sort((a, b) => b.score - a.score);
    awards.push({ category: 'Best overall draft', ...hauls[0] });
    const multi = hauls.find(h => h.pickNumbers.length > 1); if (multi) awards.push({ category: 'Best multi-pick haul', ...multi });
    return awards;
}
function createLiveMockService({ repository, simulations, now = () => Date.now(), rng = liveRandom } = {}) {
    function file(leagueId) { return path.join(rootFor(repository, leagueId), 'live.json'); }
    function all(leagueId) { return Object.values(read(file(leagueId), { mocks: {} }).mocks); }
    function get(leagueId, id) { const mock = read(file(leagueId), { mocks: {} }).mocks[id]; if (!mock) throw Error('This mock no longer exists.'); return mock; }
    function transaction(leagueId, action) {
        return locked(rootFor(repository, leagueId), () => { const state = read(file(leagueId), { schemaVersion: 1, mocks: {} }); const result = action(state); atomicWrite(file(leagueId), state); return structuredClone(result); });
    }
    function mutate(leagueId, id, action) { return transaction(leagueId, state => { const m = state.mocks[id]; if (!m) throw Error('Unknown mock.'); action(m); m.updatedAt = new Date(now()).toISOString(); return m; }); }
    function assertCurrent(m) { const c = repository.loadLeague(m.leagueId); if (c.seasonId !== m.seasonId) throw Error('This mock belongs to an earlier league season.'); }
    function host(m, actor) { assertCurrent(m); if (actor.id !== m.hostUserId && !actor.staff) throw Error('Only the host or league staff can use this control.'); }
    function coach(leagueId, userId) {
        const matches = repository.loadOwners(leagueId).filter(o => o.userId === userId);
        if (matches.length !== 1) throw Error('A single configured league team coach is required. Sync team roles first.');
        if (!repository.loadLeague(leagueId).teams.some(t => t.teamId === matches[0].teamId)) throw Error('Your league team is unavailable.');
        const ownership = repository.loadRoleOwnership(leagueId);
        if (ownership.conflicts?.length) throw Error('Resolve team role ownership conflicts before starting a mock.');
        return matches[0];
    }
    function create(leagueId, userId, guildId, classNumber = null) {
        const owner = coach(leagueId, userId), input = simulations.inputFor(leagueId, classNumber), snapshot = simulations.requireActive(leagueId, input);
        return transaction(leagueId, state => {
            const existing = Object.values(state.mocks).find(m => LIVE.has(m.status) && m.hostUserId === userId && m.seasonId === input.seasonId);
            if (existing) { if (existing.draftClassId !== input.draftClassId) throw Error('You already have an active mock with another draft class. Finish that mock first.'); return existing; }
            const id = randomUUID();
            const m = { id, leagueId, guildId, seasonId: input.seasonId, draftClassId: input.draftClassId, classNumber: Number(repository.loadLeague(leagueId).league.seasonNumber), hostUserId: userId, simulationSnapshotId: snapshot.id, status: 'SETUP', threadId: null, participants: [{ userId, teamId: owner.teamId, available: true }], createdAt: new Date(now()).toISOString(), lotteryRuns: 0, currentPick: 1, selections: [], delivery: {}, dmDelivery: {}, cleanup: { attempts: 0 }, testMode: repository.loadSettings(leagueId)?.testMode === true };
            state.mocks[id] = m; return m;
        });
    }
    function invite(leagueId, id, actor, userIds) {
        return mutate(leagueId, id, m => { host(m, actor); if (!['SETUP', 'LOTTERY_READY'].includes(m.status)) throw Error('Invites close when draft order locks.');
            for (const userId of [...new Set(userIds)]) { const owner = coach(leagueId, userId); if (!m.participants.some(p => p.userId === userId)) m.participants.push({ userId, teamId: owner.teamId, available: true }); }
        });
    }
    function lottery(leagueId, id, actor) {
        const input = simulations.inputFor(leagueId, get(leagueId, id).classNumber);
        return mutate(leagueId, id, m => { host(m, actor); if (!['SETUP', 'LOTTERY_READY'].includes(m.status)) throw Error('Draft order is locked.');
            if (input.draftClassId !== m.draftClassId) throw Error('Draft class changed. Start a new mock.');
            const fingerprint = order => createHash('sha256').update(order.map(s => s.originalTeamId).join('|')).digest('hex');
            const previous = new Set(m.lotteryOrderHashes || []);
            if (m.lotteryOrder) previous.add(fingerprint(m.lotteryOrder));
            let generated;
            for (let attempt = 0; attempt < 100; attempt++) {
                const draw = generateDraftOrder(input, { rng });
                if (!previous.has(fingerprint(draw.order))) { generated = draw; break; }
            }
            if (!generated) throw Error('Could not draw a different lottery order. Your previous order is retained; try again.');
            m.lotteryOrderHashes = [...previous, fingerprint(generated.order)];
            m.orderSource = 'LOTTERY'; m.lotteryOrder = generated.order; m.rules = generated.rules; m.warnings = generated.warnings; m.lotteryRuns++; m.status = 'LOTTERY_READY';
        });
    }
    function baseOrder(leagueId, classNumber = null) { return generateDraftOrder(simulations.inputFor(leagueId, classNumber), { lottery: false }); }
    function useBaseOrder(leagueId, id, actor, expectedRun) {
        const input = simulations.inputFor(leagueId, get(leagueId, id).classNumber), generated = generateDraftOrder(input, { lottery: false });
        return mutate(leagueId, id, m => {
            host(m, actor);
            if (!['SETUP', 'LOTTERY_READY'].includes(m.status)) throw Error('Draft order is locked.');
            if (m.lotteryRuns !== Number(expectedRun)) throw Error('This order control is stale. View the base order again.');
            if (input.draftClassId !== m.draftClassId) throw Error('Draft class changed. Start a new mock.');
            m.orderSource = 'BASE'; m.lotteryOrder = generated.order; m.rules = generated.rules; m.warnings = generated.warnings; m.lotteryRuns++; m.status = 'LOTTERY_READY';
        });
    }
    function lock(leagueId, id, actor) {
        const input = simulations.inputFor(leagueId, get(leagueId, id).classNumber), snapshot = simulations.requireActive(leagueId, input);
        return mutate(leagueId, id, m => { host(m, actor); if (m.status === 'ORDER_LOCKED') return; if (m.status !== 'LOTTERY_READY') throw Error('Run the lottery first.');
            if (m.draftClassId !== input.draftClassId) throw Error('Draft class changed. Start a new mock.');
            m.lockedDraftOrder = m.lotteryOrder.map(slot => { const asset = input.picks.find(p => p.pickId === slot.originalPickAssetId); if (!asset) throw Error('Pick asset changed. Rerun lottery.'); return { ...slot, currentOwnerTeamId: asset.currentOwnerTeamId }; });
            m.input = input; m.simulationSnapshotId = snapshot.id; m.status = 'ORDER_LOCKED'; m.lockedAt = new Date(now()).toISOString();
        });
    }
    function start(leagueId, id, actor) { return mutate(leagueId, id, m => { host(m, actor); if (m.status === 'ACTIVE') return; if (m.status !== 'ORDER_LOCKED') throw Error('Lock the draft order first.'); m.status = 'ACTIVE'; m.startedAt = new Date(now()).toISOString(); activate(m); }); }
    function setSoloControl(leagueId, id, actor, enabled) {
        return mutate(leagueId, id, m => {
            host(m, actor);
            if (enabled && actor.id !== m.hostUserId) throw Error('The mock host must enable solo control for their account.');
            if (enabled && (!actor.staff || repository.loadSettings(leagueId)?.testMode !== true)) throw Error('Solo control requires league staff and explicit Test Mode.');
            if (!LIVE.has(m.status)) throw Error('This mock is finished.');
            m.soloControl = enabled; m.soloAuthorizedBy = enabled ? actor.id : null;
            if (m.status === 'ACTIVE') activate(m);
            repository.appendAuditLog(leagueId, { action: 'test.mock-solo-control', userId: actor.id, metadata: { mockId: id, enabled }, timestamp: new Date(now()).toISOString() });
        });
    }
    function controller(m) {
        const slot = m.lockedDraftOrder?.[m.currentPick - 1];
        const participant = slot && m.participants.find(p => p.teamId === slot.currentOwnerTeamId && p.available !== false);
        if (!participant && slot && m.soloControl && m.soloAuthorizedBy === m.hostUserId && repository.loadSettings(m.leagueId)?.testMode === true
            && !repository.loadOwners(m.leagueId).some(o => o.teamId === slot.currentOwnerTeamId)) {
            const host = m.participants.find(p => p.userId === m.hostUserId && p.available !== false);
            if (host) return { ...host, teamId: slot.currentOwnerTeamId, testControlled: true };
        }
        if (!participant || !repository.loadOwners(m.leagueId).some(o => o.teamId === participant.teamId && o.userId === participant.userId)) return null;
        return participant;
    }
    function activate(m) { m.deadlineAt = controller(m) ? now() + CLOCK_MS : null; m.remainingMs = null; }
    function commit(leagueId, id, { userId = null, prospectId = null, expectedPick, type = 'HUMAN', staff = false }) {
        return mutate(leagueId, id, m => {
            assertCurrent(m);
            if (m.status !== 'ACTIVE' || m.currentPick !== Number(expectedPick)) throw Error('That pick is no longer active.');
            const participant = controller(m), slot = m.lockedDraftOrder[m.currentPick - 1];
            if (type === 'HUMAN') {
                if (participant?.testControlled && !staff) throw Error('Staff authorization is required to pick for a vacant test team.');
                if (participant?.userId !== userId) throw Error('Only the current pick owner’s participating coach can confirm.');
                if (m.deadlineAt == null || now() >= m.deadlineAt) throw Error('The pick clock expired.');
            } else if (participant && !(type === 'TIMEOUT_CPU' && m.deadlineAt != null && now() >= m.deadlineAt)) throw Error('A human coach is still on the clock.');
            const market = simulations.byId(leagueId, m.simulationSnapshotId);
            if (!market) throw Error('Saved simulation snapshot is missing.');
            const p = type === 'HUMAN' ? m.input.prospects.find(p => p.prospectId === prospectId) : chooseProspect(m.input, slot, m.selections, market, rng);
            if (!p || m.selections.some(s => s.prospectId === p.prospectId)) throw Error('This prospect is no longer available.');
            const a = market.prospectAggregates[p.prospectId], review = reaction(m.input, slot, p, m.selections, a);
            m.selections.push({ ...slot, prospectId: p.prospectId, prospect: p, soloTestControlled: !!participant?.testControlled, selectedByType: type, selectedByUserId: type === 'HUMAN' ? userId : null, boardRank: p.board_number, avp: a?.avp ?? null, earliest: a?.earliest ?? null, latest: a?.latest ?? null, grade: review.grade, analysis: review.analysis, storyline: review.storyline, metrics: review, selectedAt: new Date(now()).toISOString() });
            m.currentPick++; m.deadlineAt = null;
            if (m.selections.length === 30) { m.status = 'COMPLETED'; m.completedAt = new Date(now()).toISOString(); m.recap = { selections: m.selections, awards: awardsFor(m.selections) }; }
            else activate(m);
        });
    }
    function pause(leagueId, id, actor) { return mutate(leagueId, id, m => { host(m, actor); if (m.status !== 'ACTIVE') throw Error('Mock is not active.'); m.remainingMs = m.deadlineAt == null ? null : Math.max(0, m.deadlineAt - now()); m.deadlineAt = null; m.status = 'PAUSED'; }); }
    function resume(leagueId, id, actor) { return mutate(leagueId, id, m => { host(m, actor); if (m.status !== 'PAUSED') throw Error('Mock is not paused.'); m.status = 'ACTIVE'; m.deadlineAt = m.remainingMs == null ? null : now() + m.remainingMs; m.remainingMs = null; }); }
    function setAvailable(leagueId, id, userId, available) { return mutate(leagueId, id, m => { const p = m.participants.find(p => p.userId === userId); if (!p) throw Error('Not a participant.'); p.available = available; }); }
    function available(m, query = '') {
        const q = String(query).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
        return m.input.prospects.filter(p => !m.selections.some(s => s.prospectId === p.prospectId) && (!q || [p.name, p.team, p.position_1, p.position_2, String(p.board_number)].some(v => String(v || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes(q))));
    }
    return { all, get, mutate, create, coach, invite, lottery, baseOrder, useBaseOrder, lock, start, commit, pause, resume, controller, available, setAvailable, setSoloControl, repository };
}
module.exports = { createLiveMockService, CLOCK_MS, awardsFor };
