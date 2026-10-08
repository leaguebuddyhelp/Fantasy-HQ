require('dotenv').config();
const path = require('path');
const { acquireWriterLease, createStorageBackup, restoreStorageBackup } = require('../src/fantasyhq/storage-safety');
const [action, source, destination] = process.argv.slice(2);
try {
  if (action === 'restore') {
    if (!source || !destination) throw Error('Usage: npm run league:restore -- BACKUP_DIRECTORY NEW_DATA_DIRECTORY');
    console.log(JSON.stringify(restoreStorageBackup(path.resolve(source), path.resolve(destination))));
  } else if (action === 'backup') {
    const root = path.resolve(source || process.env.FANTASYHQ_DATA_ROOT || 'data/fantasyhq');
    const lease = acquireWriterLease(root);
    try { console.log(JSON.stringify(createStorageBackup(root))); } finally { lease.release(); }
  } else throw Error('Choose backup or restore.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
