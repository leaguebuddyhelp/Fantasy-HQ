const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { requireCommissioner } = require('./postseason-state');
const { atomicWrite, read } = require('./mock-storage');
const DAY = 86400000, previews = new Map(), busy = new Set();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function createStorageMaintenance({ repository, now = Date.now, backup = () => require('./storage-safety').createStorageBackup(repository.dataRoot, { label: 'before-storage-maintenance' }) }) {
    function authorize(leagueId, actor) { requireCommissioner(repository.loadLeague(leagueId), actor); }
    function rootFor(leagueId) { return repository.buildLeaguePaths(repository.dataRoot, leagueId).leagueRoot; }
    function contained(root, name) {
        const target = path.resolve(root, name);
        if (!target.startsWith(path.resolve(root) + path.sep)) throw Error('Invalid maintenance path.');
        for (let current = target; current !== path.resolve(root); current = path.dirname(current)) {
            if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('Maintenance refuses symbolic links.');
        }
        return target;
    }
    function references(root) {
        const dir = path.join(root, 'mock-draft'), found = new Set();
        if (!fs.existsSync(dir)) return found;
        const collect = value => {
            if (typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value)) found.add(value);
            else if (Array.isArray(value)) value.forEach(collect);
            else if (value && typeof value === 'object') Object.values(value).forEach(collect);
        };
        for (const name of fs.readdirSync(dir)) if (name.endsWith('.json')) {
            const file = contained(root, path.join('mock-draft', name));
            if (fs.statSync(file).isFile()) collect(JSON.parse(fs.readFileSync(file, 'utf8')));
        }
        return found;
    }
    async function inspect(leagueId, actor) {
        authorize(leagueId, actor);
        const root = rootFor(leagueId), groups = {}, largest = [], candidates = [];
        const linked = references(root), snapshots = [];
        async function scan(dir, relative = '') {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isSymbolicLink()) throw Error('Maintenance refuses symbolic links.');
                const name = path.join(relative, entry.name), file = contained(root, name);
                if (entry.isDirectory()) { if (name.split(path.sep)[0] !== 'maintenance') await scan(file, name); continue; }
                if (!entry.isFile()) continue;
                const stat = await fs.promises.stat(file), group = name.split(path.sep)[0];
                groups[group] ||= { files: 0, bytes: 0 }; groups[group].files++; groups[group].bytes += stat.size;
                largest.push({ name, bytes: stat.size }); largest.sort((a,b) => b.bytes-a.bytes); largest.length = Math.min(largest.length, 15);
                if (/^mock-draft\/snapshots\/[a-f0-9-]{36}\.json$/.test(name)) snapshots.push({ name, id: path.basename(name, '.json'), mtimeMs: stat.mtimeMs, bytes: stat.size });
                if (entry.name.endsWith('.tmp') && stat.mtimeMs < now() - DAY) candidates.push({ name, kind: 'stale-temporary', bytes: stat.size, mtimeMs: stat.mtimeMs });
            }
        }
        await scan(root);
        // Retain all referenced snapshots and the three newest unreferenced ones.
        for (const file of snapshots.filter(row => !linked.has(row.id)).sort((a,b) => b.mtimeMs-a.mtimeMs).slice(3)) {
            if (file.mtimeMs < now() - 2*DAY) candidates.push({ ...file, kind: 'unreferenced-draft-cache' });
        }
        const sessions = repository.loadCoachWebSessions(leagueId);
        const expiredSessions = [...sessions.links, ...sessions.sessions].filter(row => row.expiresAt <= now()).length;
        return { leagueId, groups, largest, candidates, expiredSessions, bytesToRemove: candidates.filter(row => row.kind !== 'stale-temporary').reduce((sum,row) => sum+row.bytes,0) };
    }
    async function prepare(leagueId, actor) {
        for (const [token, row] of previews) if (row.expiresAt <= now()) previews.delete(token);
        if (previews.size >= 20) throw Error('Too many pending cleanup previews. Wait for them to expire.');
        const view = await inspect(leagueId, actor), root = rootFor(leagueId), token = randomUUID();
        for (const row of view.candidates) row.sha256 = digest(fs.readFileSync(contained(root, row.name)));
        previews.set(token, { leagueId, actorId: actor.id, root: repository.dataRoot, expiresAt: now()+300000, candidates: view.candidates });
        return { ...view, token, preserves: ['Rosters and contracts', 'Trades and ownership', 'Schedule and game history', 'OCR originals and roster report photos', 'Referenced draft snapshots', 'All existing backups'] };
    }
    function confirm(leagueId, actor, token) {
        authorize(leagueId, actor);
        const preview = previews.get(token), key = `${repository.dataRoot}:${leagueId}`;
        if (!preview || preview.leagueId !== leagueId || preview.actorId !== actor.id || preview.root !== repository.dataRoot || preview.expiresAt <= now()) throw Error('Cleanup preview expired. Prepare again.');
        if (busy.has(key)) throw Error('Storage maintenance already running.');
        busy.add(key);
        try {
            const root = rootFor(leagueId), linked = references(root);
            const removable = preview.candidates.filter(row => {
                const file = contained(root, row.name);
                if (!fs.existsSync(file)) return false;
                const stat = fs.statSync(file);
                return stat.isFile() && stat.mtimeMs === row.mtimeMs && digest(fs.readFileSync(file)) === row.sha256 && (row.kind !== 'unreferenced-draft-cache' || !linked.has(row.id));
            });
            const sessions = repository.loadCoachWebSessions(leagueId);
            const cleaned = { ...sessions, links: sessions.links.filter(row => row.expiresAt > now()), sessions: sessions.sessions.filter(row => row.expiresAt > now()) };
            const expiredSessions = sessions.links.length + sessions.sessions.length - cleaned.links.length - cleaned.sessions.length;
            const receipt = { id: token, leagueId, at: new Date(now()).toISOString(), removed: [], expiredSessions, backupId: null, bytesRemoved: 0 };
            if (!removable.length && !expiredSessions) { previews.delete(token); return receipt; }
            const safety = backup();
            if (!safety?.id || safety.corruptFiles?.length) throw Error('A valid storage backup is required before cleanup. No files were removed.');
            receipt.backupId = safety.id;
            if (expiredSessions) repository.commitLeagueFiles({ leagueId, files: [{ name: 'coach-web-sessions.json', value: cleaned }] });
            for (const row of removable) {
                const file = contained(root, row.name);
                if (row.kind === 'stale-temporary') {
                    // Standard backups exclude .tmp files, so archive these bytes explicitly.
                    const target = contained(root, path.join('maintenance', token, row.name+'.saved'));
                    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(file, target);
                } else { fs.unlinkSync(file); receipt.bytesRemoved += row.bytes; }
                receipt.removed.push({ name: row.name, kind: row.kind, bytes: row.bytes });
            }
            atomicWrite(contained(root, path.join('maintenance', token, 'receipt.json')), receipt);
            previews.delete(token);
            return receipt;
        } finally { busy.delete(key); }
    }
    return { inspect, prepare, confirm };
}
module.exports = { createStorageMaintenance };
