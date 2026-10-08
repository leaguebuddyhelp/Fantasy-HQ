const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
function atomicWrite(file, value) {
    require('./storage-safety').assertWriterLease(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    try { const fd = fs.openSync(tmp, 'wx'); try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(tmp, file); }
    finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function read(file, fallback = null) { if (!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file, 'utf8')); }
function rootFor(repository, leagueId) { return path.join(repository.buildLeaguePaths(repository.dataRoot, leagueId).leagueRoot, 'mock-draft'); }
// Mutations are synchronous under a process-owned filesystem lock. No network awaits inside.
function locked(root, action) {
    fs.mkdirSync(root, { recursive: true });
    const lock = path.join(root, '.lock');
    for (let attempt = 0; attempt < 2; attempt++) {
        try { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'owner'), String(process.pid)); break; }
        catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const owner = readOwner(lock);
            let alive = true;
            try { if (owner) process.kill(owner, 0); else alive = Date.now() - fs.statSync(lock).mtimeMs < 30000; } catch (e) { alive = e.code !== 'ESRCH'; }
            if (alive || attempt) throw Error('Mock state is busy. Please retry.');
            fs.rmSync(lock, { recursive: true, force: true });
        }
    }
    try { return action(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}
function readOwner(lock) { try { return Number(fs.readFileSync(path.join(lock, 'owner'), 'utf8')); } catch { return null; } }
function requestRefresh(repository, leagueId, reason, eventId) {
    const root = rootFor(repository, leagueId);
    return locked(root, () => {
        const file = path.join(root, 'refresh.json'), previous = read(file, { events: [] });
        if (!previous.events.some(e => e.id === eventId)) previous.events.push({ id: eventId, reason, requestedAt: new Date().toISOString() });
        atomicWrite(file, previous);
    });
}
module.exports = { atomicWrite, read, rootFor, locked, requestRefresh };
