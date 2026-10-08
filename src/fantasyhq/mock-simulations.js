const path = require('path');
const { randomUUID, createHash } = require('crypto');
const { atomicWrite, read, rootFor, locked, requestRefresh } = require('./mock-storage');
const { generateDraftOrder } = require('./draft-order');
const { project, chooseProspect, seededRandom, ENGINE_VERSION } = require('./mock-engine');
const { leagueSeasonStartYear } = require('./asset-valuation');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const jobs = new Map();
function validateSnapshot(snapshot) {
    if (snapshot.simulationCount !== 1000 || snapshot.simulations?.length !== 1000) throw Error('Simulation snapshot must contain exactly 1,000 rounds.');
    const ids = new Set(snapshot.input.prospects.map(p => p.prospectId));
    const teamIds = new Set(snapshot.input.teams.map(t => t.teamId));
    for (const round of snapshot.simulations) {
        if (new Set(round.map(s => s.originalTeamId)).size !== 30 || round.some(s => { const asset = snapshot.input.picks.find(p => p.originalTeamId === s.originalTeamId); return !asset || asset.currentOwnerTeamId !== s.currentOwnerTeamId || !teamIds.has(s.currentOwnerTeamId) || asset.pickId !== s.originalPickAssetId; })) throw Error('Invalid simulation pick ownership.');
        if (round.length !== 30 || new Set(round.map(s => s.prospectId)).size !== 30 || round.some((s, i) => s.pickNumber !== i + 1 || !ids.has(s.prospectId))) throw Error('Invalid simulation round.');
    }
    const actual = Object.fromEntries([...ids].map(id => [id, Array(30).fill(0)]));
    for (const round of snapshot.simulations) for (const s of round) actual[s.prospectId][s.pickNumber - 1]++;
    if (Object.keys(snapshot.prospectAggregates).length !== ids.size) throw Error('Snapshot must include every prospect.');
    for (const [id, frequencies] of Object.entries(actual)) {
        const a = snapshot.prospectAggregates[id];
        if (!a || a.frequencyByPick.length !== 30 || a.availabilityByPick.length !== 30 || frequencies.some((n, i) => n !== a.frequencyByPick[i]) || a.earliest !== (a.timesSelected ? frequencies.findIndex(n => n > 0) + 1 : null) || a.latest !== (a.timesSelected ? frequencies.findLastIndex(n => n > 0) + 1 : null)) throw Error('Snapshot distribution does not match its simulations.');
    }
    const total = Object.values(snapshot.prospectAggregates).reduce((sum, p) => sum + p.timesSelected, 0);
    if (total !== 30000) throw Error('Invalid simulation selection total.');
    for (const p of Object.values(snapshot.prospectAggregates)) {
        const count = p.frequencyByPick.reduce((sum, n) => sum + n, 0), weighted = p.frequencyByPick.reduce((sum, n, i) => sum + n * (i + 1), 0);
        if (count !== p.timesSelected || count && Math.abs(p.avp - weighted / count) > 1e-9 || p.availabilityByPick.some((n, i) => Math.abs(n - (1000 - p.frequencyByPick.slice(0, i).reduce((s, n) => s + n, 0)) / 1000) > 1e-9)) throw Error('Invalid prospect aggregates.');
    }
    return snapshot;
}
async function simulate(input, { seed = randomUUID(), previous = null } = {}) {
    const rng = seededRandom(seed), aggregates = Object.fromEntries(input.prospects.map(p => [p.prospectId, { timesSelected: 0, frequencyByPick: Array(30).fill(0), teamDestinations: {}, earliest: null, latest: null, avp: null, availabilityByPick: [], mostCommonRange: null }]));
    const simulations = [];
    for (let n = 0; n < 1000; n++) {
        const { order } = generateDraftOrder(input, { rng, lottery: !input.officialOrder });
        const round = project(input, order, previous, rng);
        simulations.push(round);
        for (const s of round) {
            const a = aggregates[s.prospectId]; a.timesSelected++; a.frequencyByPick[s.pickNumber - 1]++;
            a.teamDestinations[s.currentOwnerTeamId] = (a.teamDestinations[s.currentOwnerTeamId] || 0) + 1;
        }
        if (n % 10 === 9) await new Promise(resolve => setImmediate(resolve));
    }
    for (const a of Object.values(aggregates)) {
        a.avp = a.timesSelected ? a.frequencyByPick.reduce((sum, count, i) => sum + count * (i + 1), 0) / a.timesSelected : null;
        a.earliest = a.timesSelected ? a.frequencyByPick.findIndex(n => n > 0) + 1 : null;
        a.latest = a.timesSelected ? a.frequencyByPick.findLastIndex(n => n > 0) + 1 : null;
        let taken = 0; a.availabilityByPick = a.frequencyByPick.map(count => { const probability = (1000 - taken) / 1000; taken += count; return probability; });
        if (a.timesSelected) {
            const ranges = Array.from({ length: 6 }, (_, i) => ({ start: i * 5 + 1, end: i * 5 + 5, count: a.frequencyByPick.slice(i * 5, i * 5 + 5).reduce((s, n) => s + n, 0) }));
            a.mostCommonRange = ranges.sort((a, b) => b.count - a.count || a.start - b.start)[0];
        }
    }
    const snapshot = { id: randomUUID(), leagueId: input.leagueId, seasonId: input.seasonId, draftClassId: input.draftClassId, draftYear: input.draftYear, currentWeek: input.currentWeek, generatedAt: new Date().toISOString(), simulationCount: 1000, input, simulations, prospectAggregates: aggregates, metadata: { engineVersion: ENGINE_VERSION, seed, boardHash: hash(input.prospects), standingsHash: hash(input.standings), ownershipHash: hash(input.picks), rosterHash: hash(input.rosters), inputHash: hash(input), ...generateDraftOrder(input, { lottery: false }) } };
    return validateSnapshot(snapshot);
}
function createMockSimulationService({ repository, scoutingService, standingsService, rosterService, generator = simulate } = {}) {
    scoutingService ||= require('./scouting-service').createScoutingService({ repository });
    standingsService ||= require('./standings-service').createStandingsService({ repository });
    rosterService ||= require('./roster-service').createRosterService({ repository });
    function inputFor(leagueId, classNumber = null) {
        const c = repository.loadLeague(leagueId);
        if (classNumber != null && (!Number.isInteger(classNumber) || classNumber < 1 || classNumber > 4)) throw Error('Choose draft class CUS01 through CUS04.');
        const board = scoutingService.boardForContext(classNumber == null ? c : { ...c, league: { ...c.league, seasonNumber: classNumber } }), draftClassId = board.file.replace(/\.json$/i, '');
        if (board.prospects.length < 30) throw Error('The current Big Board needs at least 30 prospects.');
        const entries = rosterService.currentRosterEntries(leagueId, c.seasonId);
        return { leagueId, seasonId: c.seasonId, officialOrder: repository.loadOffseason(leagueId)?.seasons[c.seasonId]?.receipts?.LOTTERY?.order || null, draftClassId, currentWeek: c.league.currentWeek, draftYear: leagueSeasonStartYear(c.league.seasonNumber) + 1, teams: c.teams, prospects: board.prospects.map(p => ({ ...p, prospectId: `${draftClassId}:${p.board_number}` })), rosters: Object.fromEntries(c.teams.map(t => [t.teamId, entries.filter(e => e.membership.teamId === t.teamId).map(e => ({ ...e.player, position1: e.membership.position1 || e.player?.position1, position2: e.membership.position2 || e.player?.position2 }))])), standings: standingsService.getStandings(leagueId, c.seasonId), picks: repository.loadDraftPicks(leagueId).filter(p => [1,2].includes(Number(p.round)) && Number(p.draftYear) === leagueSeasonStartYear(c.league.seasonNumber) + 1), settings: { mockDraft: repository.loadSettings(leagueId)?.mockDraft || {} } };
    }
    const cache = new Map();
    function active(leagueId) {
        const root = rootFor(repository, leagueId), pointer = read(path.join(root, 'active.json'));
        return pointer ? byId(leagueId, pointer.id) : null;
    }
    function byId(leagueId, id) {
        if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid simulation reference.');
        const key = `${leagueId}:${id}`;
        if (cache.has(key)) return cache.get(key);
        const value = read(path.join(rootFor(repository, leagueId), 'snapshots', `${id}.json`));
        if (value) { if (cache.size >= 4) cache.delete(cache.keys().next().value); cache.set(key, value); }
        return value;
    }
    function refresh(leagueId, options = {}) {
        const key = `${repository.dataRoot}:${leagueId}`;
        if (jobs.has(key)) return jobs.get(key);
        const task = runRefresh(leagueId, options).finally(() => jobs.delete(key)); jobs.set(key, task); return task;
    }
    async function runRefresh(leagueId, options) {
        const root = rootFor(repository, leagueId), pendingFile = path.join(root, 'refresh.json'), input = inputFor(leagueId), prior = active(leagueId);
        const events = read(pendingFile, { events: [] }).events, processed = new Set(prior?.metadata.processedEvents || []);
        if (!options.force && prior?.draftClassId === input.draftClassId && prior.seasonId === input.seasonId && prior.metadata.engineVersion === ENGINE_VERSION && prior.currentWeek === input.currentWeek && prior.metadata.boardHash === hash(input.prospects) && events.every(e => processed.has(e.id))) return prior;
        const generationFile = path.join(root, 'generation.json'), claim = randomUUID();
        locked(root, () => {
            const running = read(generationFile);
            if (running?.pid) { let alive = true; try { process.kill(running.pid, 0); } catch (e) { alive = e.code !== 'ESRCH'; } if (alive) throw Error('Simulation refresh already running.'); }
            atomicWrite(generationFile, { pid: process.pid, claim });
        });
        try {
            const snapshot = await generator(input, { previous: prior?.draftClassId === input.draftClassId && prior.metadata.engineVersion === ENGINE_VERSION ? prior : null, ...(options.seed ? { seed: options.seed } : {}) });
            validateSnapshot(snapshot);
            // Never activate work generated for an old class/season; queued newer events remain pending.
            const current = repository.loadLeague(leagueId);
            if (current.seasonId !== input.seasonId || scoutingService.boardForContext(current).file.replace(/\.json$/i, '') !== input.draftClassId) throw Error('Season changed during simulation generation.');
            snapshot.metadata.processedEvents = [...new Set([...processed, ...events.map(e => e.id)])];
            locked(root, () => {
                atomicWrite(path.join(root, 'snapshots', `${snapshot.id}.json`), snapshot);
                atomicWrite(path.join(root, 'active.json'), { id: snapshot.id, generatedAt: snapshot.generatedAt });
            });
            // Weekly command output freezes independently from intraweek market refreshes.
            try { weeklyProjection(leagueId); } catch (error) { console.error('Weekly mock projection (retryable):', error.message); }
            return snapshot;
        } finally { locked(root, () => { if (read(generationFile)?.claim === claim) atomicWrite(generationFile, { pid: null }); }); }
    }
    function requireActive(leagueId, input = inputFor(leagueId)) {
        let saved = active(leagueId);
        if (saved?.draftClassId !== input.draftClassId) { const projection = read(classProjectionFile(leagueId, input.draftClassId)); saved = projection ? byId(leagueId, projection.simulationSnapshotId) : null; }
        if (!saved || saved.draftClassId !== input.draftClassId || saved.seasonId !== input.seasonId) throw Error('The current 1,000-mock snapshot is not ready. Setup or background refresh must finish first.');
        return saved;
    }
    function weeklyProjection(leagueId) {
        const input = inputFor(leagueId), root = rootFor(repository, leagueId), file = path.join(root, 'weekly-projection.json');
        return locked(root, () => {
            const existing = read(file);
            const sameClass = existing?.seasonId === input.seasonId && existing.draftClassId === input.draftClassId;
            if (sameClass && existing.week === input.currentWeek && existing.engineVersion === ENGINE_VERSION) return existing;
            const snapshot = requireActive(leagueId, input);
            if (snapshot.metadata.engineVersion !== ENGINE_VERSION) {
                if (sameClass) return existing;
                throw Error('The updated mock projection is being prepared. Please try again shortly.');
            }
            // Continue serving the last published week until its replacement market is ready.
            if (snapshot.currentWeek !== input.currentWeek) {
                if (sameClass) return existing;
                throw Error('The new weekly mock projection is being prepared. Please try again shortly.');
            }
            const generated = generateDraftOrder(input, { lottery: false });
            const seed = `weekly:${leagueId}:${input.seasonId}:${input.draftClassId}:${input.currentWeek ?? 'preseason'}`;
            const selections = project(input, generated.order, snapshot, seededRandom(seed)).map(s => ({ ...s, avp: snapshot.prospectAggregates[s.prospectId]?.avp ?? null }));
            const result = { schemaVersion: 1, engineVersion: ENGINE_VERSION, leagueId, seasonId: input.seasonId, draftClassId: input.draftClassId, week: input.currentWeek, simulationSnapshotId: snapshot.id, generatedAt: snapshot.generatedAt, input, selections, warnings: generated.warnings };
            atomicWrite(file, result);
            return read(file);
        });
    }
    function classProjectionFile(leagueId, classId) { return path.join(rootFor(repository, leagueId), `weekly-class-${hash(classId).slice(0, 16)}.json`); }
    async function classProjection(leagueId, classNumber = null) {
        if (classNumber == null || classNumber === Number(repository.loadLeague(leagueId).league.seasonNumber)) return weeklyProjection(leagueId);
        const input = inputFor(leagueId, classNumber), file = classProjectionFile(leagueId, input.draftClassId);
        const existing = read(file);
        if (existing?.seasonId === input.seasonId && existing.week === input.currentWeek && existing.engineVersion === ENGINE_VERSION) return existing;
        const jobKey = `${repository.dataRoot}:${leagueId}:class:${classNumber}`;
        if (jobs.has(jobKey)) return jobs.get(jobKey);
        const task = (async () => {
            const seed = `weekly:${leagueId}:${input.seasonId}:${input.draftClassId}:${input.currentWeek ?? 'preseason'}`;
            const snapshot = await generator(input, { seed });
            validateSnapshot(snapshot);
            const current = repository.loadLeague(leagueId);
            if (current.seasonId !== input.seasonId || current.league.currentWeek !== input.currentWeek) throw Error('League week changed while preparing this class. Try again.');
            const generated = generateDraftOrder(input, { lottery: false });
            const selections = project(input, generated.order, snapshot, seededRandom(seed)).map(s => ({ ...s, avp: snapshot.prospectAggregates[s.prospectId]?.avp ?? null }));
            const result = { schemaVersion: 1, engineVersion: ENGINE_VERSION, leagueId, seasonId: input.seasonId, draftClassId: input.draftClassId, classNumber, week: input.currentWeek, simulationSnapshotId: snapshot.id, generatedAt: snapshot.generatedAt, input, selections, warnings: generated.warnings };
            locked(rootFor(repository, leagueId), () => { atomicWrite(path.join(rootFor(repository, leagueId), 'snapshots', `${snapshot.id}.json`), snapshot); atomicWrite(file, result); });
            return result;
        })().finally(() => jobs.delete(jobKey));
        jobs.set(jobKey, task);
        return task;
    }
    function secondRoundProjection(leagueId, weekly) {
        const input = weekly.input, root = rootFor(repository, leagueId), file = path.join(root, `weekly-round2-${hash([input.seasonId,input.currentWeek,input.draftClassId]).slice(0,24)}.json`);
        const prior = read(file); if (prior?.engineVersion === ENGINE_VERSION && prior.simulationSnapshotId === weekly.simulationSnapshotId) return prior.selections;
        if (input.prospects.length < 60) throw Error('Round 2 requires at least 60 verified prospects.');
        const secondPicks = repository.loadDraftPicks(leagueId).filter(p => Number(p.round) === 2 && Number(p.draftYear) === input.draftYear);
        if (secondPicks.length !== 30 || new Set(secondPicks.map(p=>p.originalTeamId)).size !== 30) throw Error('Initialize all 30 second-round pick assets through league setup.');
        const base = generateDraftOrder({...input,officialOrder:null},{lottery:false}).order;
        const order = base.map((slot,index)=>{const asset=secondPicks.find(p=>p.originalTeamId===slot.originalTeamId);if(!asset||!input.teams.some(t=>t.teamId===asset.currentOwnerTeamId))throw Error('Reconcile second-round pick ownership first.');return {...slot,pickNumber:index+31,currentOwnerTeamId:asset.currentOwnerTeamId,originalPickAssetId:asset.pickId};});
        const selected = [...weekly.selections], snapshot = byId(leagueId,weekly.simulationSnapshotId), rng = seededRandom(`weekly-round2:${leagueId}:${input.seasonId}:${input.draftClassId}:${input.currentWeek}`);
        for(const slot of order){const p=chooseProspect(input,slot,selected,snapshot,rng);selected.push({...slot,prospectId:p.prospectId,avp:snapshot?.prospectAggregates[p.prospectId]?.avp??null});}
        const selections=selected.slice(30);locked(root,()=>atomicWrite(file,{engineVersion:ENGINE_VERSION,simulationSnapshotId:weekly.simulationSnapshotId,selections}));return selections;
    }
    function reconcileRequests(leagueId) {
        // Recover events even if a process stopped between the league transaction and enqueue.
        const input = inputFor(leagueId), prior = active(leagueId), processed = new Set(prior?.metadata.processedEvents || []);
        for (const e of repository.loadAuditLog(leagueId)) {
            const eventId = e.action === 'week.advanced' ? `week:${e.requestId}` : e.action === 'trade.completed' && input.picks.some(p => e.metadata?.affectedPickIds?.includes(p.pickId)) ? `trade:${e.metadata.processingId}` : ['offseason.progression.confirmed','offseason.options.confirmed','offseason.draft.confirmed','offseason.retirements.confirmed','offseason.cutdown.waived'].includes(e.action) ? `roster:${e.metadata?.requestId || e.timestamp}` : null;
            if (eventId && String(e.seasonId || e.result?.seasonId || input.seasonId) === input.seasonId && !processed.has(eventId)) requestRefresh(repository, leagueId, e.action, eventId);
        }
    }
    return { inputFor, active, byId, refresh, requireActive, weeklyProjection, classProjection, secondRoundProjection, reconcileRequests, repository };
}
module.exports = { createMockSimulationService, simulate, validateSnapshot, hash };
