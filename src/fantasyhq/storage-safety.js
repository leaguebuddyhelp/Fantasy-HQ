const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID, createHash } = require('crypto');

const activeLeases = new Map();
function assertWriterLease(file) {
  for (const [root, token] of activeLeases) if (path.resolve(file).startsWith(root + path.sep)) {
    const saved = JSON.parse(fs.readFileSync(path.join(root, '.writer-lock', 'owner.json'), 'utf8'));
    if (saved.token !== token) throw Error('League writer lease was lost. Stop this process before retrying.');
    return;
  }
  for (let dir = path.dirname(path.resolve(file)); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir,'.writer-lock'))) throw Error('League storage already has a writer. Stop it before using an offline mutation command.');
    if (dir === path.dirname(dir)) break;
  }
}
function acquireWriterLease(dataRoot, { waitMs = 0 } = {}) {
  if (waitMs > 0) {
    const deadline = Date.now() + waitMs;
    for (;;) {
      try { return acquireWriterLease(dataRoot); }
      catch (error) {
        if (error.code !== 'LEAGUE_WRITER_BUSY' || Date.now() >= deadline) throw error;
        // Railway volume handoffs can leave a recent heartbeat from the stopped
        // container. Wait for release or the existing stale-owner check.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(1000, deadline - Date.now()));
      }
    }
  }
  dataRoot = path.resolve(dataRoot);
  fs.mkdirSync(dataRoot, { recursive: true });
  if (activeLeases.has(dataRoot)) throw Error('League storage already has a writer in this process.');
  const lock = path.join(dataRoot, '.writer-lock'), recovery = path.join(dataRoot, '.writer-recovery');
  const fingerprint = pid => {
    try { const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim() + ':' + stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]; } catch { return null; }
  };
  const owner = { processIdentity: fingerprint(process.pid), token: randomUUID(), pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString(), heartbeatAt: Date.now() };
  function alive(saved) {
    if (saved.host !== os.hostname()) return !saved.heartbeatAt || Date.now() - saved.heartbeatAt < 120000; // Shared volumes require explicit operator recovery after a host change.
    const currentIdentity = fingerprint(saved.pid);
    if (saved.processIdentity && currentIdentity && saved.processIdentity !== currentIdentity) return false;
    // A previous container can reuse this startup PID. This process has not yet acquired a lease.
    if (saved.pid === process.pid && Date.parse(saved.startedAt) < Date.now() - 120000) return false;
    try { process.kill(saved.pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
  }
  try { fs.mkdirSync(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    fs.mkdirSync(recovery); // Serialize stale-owner recovery against other starters.
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'));
      if (!Number.isInteger(saved.pid) || saved.pid < 1 || alive(saved)) {
        const error = Error(`League storage already has a writer (${saved.host}, PID ${saved.pid}). Stop it before starting another bot or website writer.`);
        error.code = 'LEAGUE_WRITER_BUSY'; throw error;
      }
      fs.rmSync(lock, { recursive: true }); fs.mkdirSync(lock);
    } finally { fs.rmdirSync(recovery); }
  }
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify(owner), { flag: 'wx' });
  activeLeases.set(dataRoot, owner.token);
  const heartbeat = setInterval(() => {
    try {
      assertWriterLease(path.join(dataRoot, 'lease-check'));
      owner.heartbeatAt = Date.now(); const temp = path.join(lock, `${owner.token}.tmp`);
      fs.writeFileSync(temp, JSON.stringify(owner)); fs.renameSync(temp, path.join(lock, 'owner.json'));
    } catch (error) { console.error('League writer lease:', error.message); process.exit(1); }
  }, 10000); heartbeat.unref();
  let released = false;
  const signals = new Map(['SIGTERM','SIGINT'].map(signal => [signal, () => { release(); process.exit(signal === 'SIGTERM' ? 143 : 130); }]));
  for (const [signal, handler] of signals) process.once(signal, handler);
  function release() {
    if (released) return;
    if (fs.existsSync(path.join(lock, 'owner.json')) && JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8')).token === owner.token) fs.rmSync(lock, { recursive: true });
    released = true; clearInterval(heartbeat); activeLeases.delete(dataRoot);
    for (const [signal, handler] of signals) process.removeListener(signal, handler);
    process.removeListener('exit', release);
  }
  process.once('exit', release);
  return { release, owner };
}

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function createStorageBackup(dataRoot, { label = 'manual' } = {}) {
  assertWriterLease(path.join(dataRoot,'backup-check'));
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`;
  const parent = path.join(dataRoot, 'backups'), staging = path.join(parent, `.pending-${id}`), target = path.join(parent, id);
  fs.mkdirSync(staging, { recursive: true });
  const files = [], previousFiles = new Map();
  const previous = fs.readdirSync(parent).filter(name => !name.startsWith('.')).sort().at(-1);
  if (previous) {
    try { for (const file of JSON.parse(fs.readFileSync(path.join(parent,previous,'backup-manifest.json'),'utf8')).files) previousFiles.set(file.name,{...file,directory:path.join(parent,previous)}); } catch { /* A damaged older backup must not prevent a fresh one. */ }
  }
  function copy(relative = '') {
    for (const entry of fs.readdirSync(path.join(dataRoot, relative), { withFileTypes: true })) {
      if ((!relative && ['backups','.writer-lock','.writer-recovery'].includes(entry.name)) || entry.name.endsWith('.tmp')) continue;
      if (entry.isSymbolicLink()) throw Error('Backup refused a symbolic link.');
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) { copy(name); continue; }
      if (!entry.isFile()) throw Error('Backup refused a non-regular file.');
      const bytes = fs.readFileSync(path.join(dataRoot, name));
      // Preserve corrupt records too: integrity is recorded, restoration stays possible.
      let validJson = null; if (name.endsWith('.json')) { try { JSON.parse(bytes); validJson = true; } catch { validJson = false; } }
      fs.mkdirSync(path.dirname(path.join(staging, name)), { recursive: true });
      const digest = hash(bytes), prior = previousFiles.get(name), priorFile = prior && path.join(prior.directory,name);
      let linked = false;
      if (prior?.sha256 === digest && fs.existsSync(priorFile) && fs.lstatSync(priorFile).isFile() && hash(fs.readFileSync(priorFile)) === digest) {
        try { fs.linkSync(priorFile,path.join(staging,name)); linked = true; } catch { /* Cross-device or unsupported linking falls back to a verified copy. */ }
      }
      if (!linked) fs.writeFileSync(path.join(staging, name), bytes);
      files.push({ name, sha256: digest, bytes: bytes.length, validJson });
    }
  }
  try {
    copy(); fs.writeFileSync(path.join(staging, 'backup-manifest.json'), JSON.stringify({ version: 1, id, label, createdAt: new Date().toISOString(), files }, null, 2));
    fs.renameSync(staging, target); return { id, directory: target, files: files.length, corruptFiles: files.filter(f => f.validJson === false).map(f => f.name) };
  } catch (error) { fs.rmSync(staging, { recursive: true, force: true }); throw error; }
}

function restoreStorageBackup(backupRoot, targetRoot) {
  backupRoot = path.resolve(backupRoot); targetRoot = path.resolve(targetRoot);
  if (fs.existsSync(targetRoot)) throw Error('Restore requires a new, nonexistent target directory. Existing league storage is never overwritten.');
  const manifest = JSON.parse(fs.readFileSync(path.join(backupRoot, 'backup-manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw Error('Invalid backup manifest.');
  const names = new Set();
  for (const file of manifest.files) {
    if (!file.name || path.isAbsolute(file.name) || file.name.split(/[\\/]/).some(p => p === '..' || p === '.' || !p) || names.has(file.name)) throw Error('Unsafe backup path.');
    names.add(file.name);
    const source = path.join(backupRoot, file.name);
    for (let dir = source; dir !== path.resolve(backupRoot); dir = path.dirname(dir)) { if (fs.lstatSync(dir).isSymbolicLink()) throw Error('Backup contains a symbolic link.'); }
    if (hash(fs.readFileSync(source)) !== file.sha256) throw Error(`Backup checksum mismatch: ${file.name}`);
  }
  const staging = `${targetRoot}.restore-${randomUUID()}`;
  try {
    fs.mkdirSync(staging, { recursive: true });
    for (const file of manifest.files) { const target = path.join(staging, file.name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(backupRoot, file.name), target); }
    fs.renameSync(staging, targetRoot);
  } catch (error) { fs.rmSync(staging, { recursive: true, force: true }); throw error; }
  return { directory: targetRoot, files: manifest.files.length };
}
module.exports = { assertWriterLease, acquireWriterLease, createStorageBackup, restoreStorageBackup };
