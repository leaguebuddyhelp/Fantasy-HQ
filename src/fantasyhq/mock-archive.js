const fs = require('node:fs'), path = require('node:path');
const { atomicWrite, read, locked } = require('./mock-storage');
function canArchive(mock, now = Date.now()) {
    if (!['CLEANED','CANCELLED','FAILED'].includes(mock?.status)) return false;
    const timestamp = Date.parse(mock.updatedAt || mock.createdAt || '');
    if (!Number.isFinite(timestamp) || now - timestamp < 3600000) return false;
    return mock.status !== 'CLEANED' || !(mock.participants || []).some(participant => {
        const delivery = mock.dmDelivery?.[participant.userId];
        return !delivery || (!delivery.delivered && !delivery.permanent && (delivery.attempts || 0) < 3);
    });
}
function archiveFinished(root, { now = Date.now(), selected = null, limit = 5 } = {}) {
    const file = path.join(root,'live.json');
    if (!fs.existsSync(file)) return { archived: [], bytesBefore: 0, bytesAfter: 0 };
    const before = read(file,{mocks:{}});
    if (!Object.values(before.mocks || {}).some(mock => canArchive(mock,now) && (!selected || selected.has(mock.id)))) return { archived: [], bytesBefore: fs.statSync(file).size, bytesAfter: fs.statSync(file).size };
    return locked(root, () => {
        const state = read(file,{mocks:{}}), archived = [], bytesBefore = fs.statSync(file).size;
        for (const [id,mock] of Object.entries(state.mocks || {})) {
            if (archived.length >= limit) break;
            if (!/^[a-f0-9-]{36}$/.test(id) || mock.id !== id || !canArchive(mock,now) || (selected && !selected.has(id))) continue;
            const destination = path.join(root,'archive',id+'.json');
            if (fs.existsSync(destination)) {
                if (JSON.stringify(read(destination)) !== JSON.stringify(mock)) continue;
            } else atomicWrite(destination,mock);
            // Publication is copy-first: interruption leaves the full record in
            // the live file, the archive, or both, never in neither location.
            delete state.mocks[id]; archived.push(id);
        }
        if (archived.length) atomicWrite(file,state);
        return { archived, bytesBefore, bytesAfter: fs.statSync(file).size };
    });
}
module.exports = { canArchive, archiveFinished };
