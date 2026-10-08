const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const sharp = require('sharp');
const { requireCommissioner } = require('./postseason-state');
const { playerCandidates } = require('./box-score/normalize');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const processing = new Map();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function createRetirementImportService({ repository, step = 'RETIREMENTS', importKey = 'retirements', candidatePool = null, now = Date.now, recognize = bytes => require('./box-score/tesseract-provider').withOcrWorker(async worker => {
  await worker.setParameters({ tessedit_pageseg_mode: '11' });
  const result = await worker.recognize(bytes, {}, { text: true, blocks: true });
  const dimensions=await sharp(bytes).metadata();
  return {text:result.data.text,width:dimensions.width,height:dimensions.height,lines:(result.data.blocks||[]).flatMap(block=>(block.paragraphs||[]).flatMap(paragraph=>(paragraph.lines||[]).map(line=>({text:line.text,bbox:line.bbox,confidence:line.confidence})))).slice(0,2000)};
}), backup = () => require('./storage-safety').createStorageBackup(repository.dataRoot, { label: 'retirement-import' }) }) {
  if (!/^[a-z][a-z0-9-]*$/.test(importKey) || !require('./offseason-state').PHASE_BY_STEP[step]) throw Error('Invalid offseason evidence type.');
  function context(leagueId, actor) {
    const c = repository.loadLeague(leagueId); requireCommissioner(c, actor);
    const state = repository.loadOffseason(leagueId), season = state?.seasons[c.seasonId];
    if (c.league.currentPhase !== require('./offseason-state').PHASE_BY_STEP[step] || season?.step !== step) throw Error(`Open the ${importKey} offseason step before importing.`);
    return { c, state, season };
  }
  function collection(season) { season.imports ||= {}; return season.imports[importKey] ||= { images: [], revision: 0 }; }
  function save(leagueId, state, entry, files = []) {
    repository.commitLeagueFiles({ leagueId, files: [...files, { name: 'offseason.json', value: state }, { name: 'audit-log.json', value: [...repository.loadAuditLog(leagueId), entry] }] });
  }
  function audit(c, actor, action, metadata) { return { action, seasonId: c.seasonId, userId: actor.id, timestamp: new Date(now()).toISOString(), metadata }; }
  function candidates(leagueId, text) {
    const players = (candidatePool ? candidatePool(leagueId) : repository.loadPlayers(leagueId)).filter(p => !p.retiredAt);
    return String(text).split(/\r?\n/).map(line => ({ text: line.trim(), candidates: playerCandidates(line, players).slice(0, 25).map(p => ({ playerId: p.playerId, name: p.name, teamId: p.teamId })) })).filter(row => row.candidates.length);
  }
  function inspect(leagueId, actor) {
    const { season } = context(leagueId, actor), batch = collection(season);
    return { images: batch.images.map(image => ({ ...image, candidates: candidates(leagueId, image.text || ''), proposals:require('./offseason-table-ocr').tableProposals({step,text:image.text||'',...(image.layout||{}),players:(candidatePool?candidatePool(leagueId):repository.loadPlayers(leagueId)).filter(p=>!p.retiredAt),teams:repository.loadLeague(leagueId).teams}) })),
      revision: batch.revision, confirmed: !!season.receipts?.[step] };
  }
  async function upload(leagueId, actor, { bytes, filename }) {
    const { c, state, season } = context(leagueId, actor), batch = collection(season);
    if (season.receipts?.[step]) throw Error(`${importKey} already confirmed.`);
    const metadata = await require('./offseason-image').metadata(bytes);
    const hash = sha(bytes);
    // Re-read after decoding: another upload may have completed while sharp yielded.
    const fresh = context(leagueId, actor), current = collection(fresh.season);
    if (fresh.c.seasonId !== c.seasonId || fresh.season.receipts?.[step]) throw Error('Retirement import changed. Refresh before uploading.');
    const duplicate = current.images.find(image => image.sha256 === hash);
    if (duplicate) return { duplicate: true, image: duplicate };
    if (current.images.length >= 60) throw Error('Retirement import supports up to 60 images.');
    const imageId = randomUUID(), relative = `offseason-evidence/${c.seasonId}/${importKey}/${imageId}.${metadata.format === 'jpeg' ? 'jpg' : metadata.format === 'heif' ? 'heic' : 'png'}`;
    if (!/^[a-zA-Z0-9_-]+$/.test(c.seasonId)) throw Error('Invalid evidence season ID.');
    const target = path.join(repository.buildLeaguePaths(repository.dataRoot, leagueId).leagueRoot, relative);
    require('./storage-safety').assertWriterLease(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const fd = fs.openSync(target, 'wx');
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const image = { imageId, filename: path.basename(String(filename || 'retirements')).slice(0, 120), originalPath: relative, sha256: hash, status: 'PROCESSING', uploadedBy: actor.id, uploadedAt: new Date(now()).toISOString() };
    current.images.push(image); current.revision++; fresh.season.revision++; delete fresh.season.pending; delete current.pending;
    save(leagueId, fresh.state, audit(c, actor, `offseason.${importKey}.evidence.saved`, { imageId, sha256: hash }));
    return { duplicate: false, image: await retry(leagueId, actor, imageId) };
  }
  function retry(leagueId, actor, imageId) {
    const { c, state, season } = context(leagueId, actor), batch = collection(season);
    if (season.receipts?.[step]) throw Error(`${importKey} already confirmed.`);
    const key = `${repository.dataRoot}:${leagueId}:${imageId}`;
    if (processing.has(key)) return processing.get(key);
    const image = batch.images.find(i => i.imageId === imageId);
    if (!image) throw Error('Unknown retirement evidence.');
    const { bytes } = readOriginal(leagueId, actor, imageId);
    image.status = 'PROCESSING'; image.error = null; batch.revision++; season.revision++; delete season.pending; delete batch.pending;
    save(leagueId, state, audit(c, actor, `offseason.${importKey}.evidence.processing`, { imageId }));
    const task = (async () => {
      let text = '', error = null, layout = null;
      try {
        const decoded = await require('./offseason-image').normalize(bytes);
        const result=await recognize(decoded);
        text = String(typeof result==='string'?result:result?.text||'').slice(0,50000);
        if(result&&typeof result==='object')layout={lines:result.lines||[],width:result.width,height:result.height};
      } catch (failure) { error = failure.message; }
      const final = context(leagueId, actor), finalBatch = collection(final.season), stored = finalBatch.images.find(i => i.imageId === imageId);
      if (!stored || final.c.seasonId !== c.seasonId) throw Error('Retirement import changed while OCR was processing.');
      Object.assign(stored, { text, layout, status: error ? 'NEEDS_MANUAL_REVIEW' : 'READY_FOR_REVIEW', error, processedAt: new Date(now()).toISOString() });
      finalBatch.revision++; final.season.revision++; delete final.season.pending; delete finalBatch.pending;
      save(leagueId, final.state, audit(c, actor, `offseason.${importKey}.evidence.processed`, { imageId, status: stored.status }));
      return { ...stored, candidates: candidates(leagueId, text) };
    })().finally(() => processing.delete(key));
    processing.set(key, task); return task;
  }
  function source(leagueId, batch) {
    return digest([repository.loadPlayers(leagueId), repository.loadRosterMemberships(leagueId), repository.loadTrades(leagueId), repository.loadFreeAgencyState(leagueId), batch.images, batch.revision]);
  }
  function prepare(leagueId, actor, { playerIds, noRetirements = false, reviewedAllImages = false }) {
    const { c, state, season } = context(leagueId, actor), batch = collection(season);
    if (season.receipts?.[step]) throw Error(`${importKey} already confirmed.`);
    if (!reviewedAllImages || !batch.images.length || batch.images.some(i => i.status === 'PROCESSING')) throw Error('Review every uploaded retirement image before confirming.');
    if (!Array.isArray(playerIds) || new Set(playerIds).size !== playerIds.length || (!playerIds.length && !noRetirements) || (playerIds.length && noRetirements)) throw Error('Select unique retired players or explicitly confirm no retirements.');
    const players = repository.loadPlayers(leagueId);
    const selected = playerIds.map(id => {
      const p = players.find(p => p.playerId === id && !p.retiredAt);
      if (!p) throw Error('Select an active permanent player ID.');
      const lock = require('./transaction-locks').playerTransactionLock(repository, leagueId, c.seasonId, id);
      if (lock) throw Error(`${p.name}: ${lock}`);
      const fa = repository.loadFreeAgencyState(leagueId);
      if (fa.windows.some(w => w.playerId === id && require('./transaction-locks').ACTIVE_WINDOWS.has(w.status))) throw Error(`${p.name}: resolve the active FA window first.`);
      return { playerId: id, name: p.name, teamId: p.teamId };
    });
    const pending = { token: randomUUID(), actorId: actor.id, sourceDigest: source(leagueId, batch), playerIds, noRetirements, expiresAt: now() + 300000 };
    batch.pending = pending;
    save(leagueId, state, audit(c, actor, 'offseason.retirement.review.prepared', { token: pending.token, selected }));
    return { token: pending.token, selected, noRetirements, imageCount: batch.images.length };
  }
  function confirm(leagueId, actor, token) {
    const { c, state, season } = context(leagueId, actor), batch = collection(season);
    if (season.receipts?.[step]?.requestId === token) return season.receipts.RETIREMENTS;
    const pending = batch.pending;
    if (!pending || pending.token !== token || pending.actorId !== actor.id || pending.expiresAt <= now() || pending.sourceDigest !== source(leagueId, batch)) throw Error('Retirement review expired or changed. Review again.');
    // Check preserved originals at the final commit point; OCR derivatives are not evidence.
    for (const image of batch.images) {
      const expected = `offseason-evidence/${c.seasonId}/${importKey}/${image.imageId}.`;
      if (!['jpg', 'png', 'heic'].some(ext => image.originalPath === expected + ext) || !/^[a-zA-Z0-9_-]+$/.test(image.imageId)) throw Error('Invalid retirement evidence path.');
      if (sha(fs.readFileSync(path.join(repository.buildLeaguePaths(repository.dataRoot, leagueId).leagueRoot, image.originalPath))) !== image.sha256) throw Error('Retirement evidence changed. Restore the original before confirming.');
    }
    const timestamp = new Date(now()).toISOString(), ids = new Set(pending.playerIds);
    const players = repository.loadPlayers(leagueId), memberships = repository.loadRosterMemberships(leagueId);
    for (const p of players) if (ids.has(p.playerId)) { p.retirementHistory = [...(p.retirementHistory || []), { seasonId: c.seasonId, teamId: p.teamId, retiredAt: timestamp, evidenceIds: batch.images.map(i => i.imageId) }]; p.retiredAt = timestamp; p.retiredSeasonId = c.seasonId; p.teamId = null; }
    for (const m of memberships) if (ids.has(m.playerId) && String(m.seasonId) === c.seasonId && m.active !== false && !m.endedAt) { m.active = false; m.endedAt = timestamp; m.endedReason = 'RETIREMENT'; }
    const receipt = { requestId: token, confirmedBy: actor.id, confirmedAt: timestamp, playerIds: pending.playerIds, evidenceIds: batch.images.map(i => i.imageId), noRetirements: pending.noRetirements };
    const safetyBackup = backup(); season.receipts ||= {}; season.receipts.RETIREMENTS = receipt; season.revision++; delete season.pending; delete batch.pending;
    save(leagueId, state, audit(c, actor, 'offseason.retirements.confirmed', { ...receipt, backupId: safetyBackup?.id || null }), [
      { name: 'players.json', value: players }, { name: 'roster-memberships.json', value: memberships },
    ]);
    return receipt;
  }
  function readOriginal(leagueId, actor, imageId) {
    const { c, season } = context(leagueId, actor), image = collection(season).images.find(i => i.imageId === imageId);
    if (!image || !/^[a-zA-Z0-9_-]+$/.test(imageId) || !/^[a-zA-Z0-9_-]+$/.test(c.seasonId)) throw Error('Unknown retirement evidence.');
    const extension = image.originalPath.split('.').at(-1);
    if (!['jpg', 'png', 'heic'].includes(extension) || image.originalPath !== `offseason-evidence/${c.seasonId}/${importKey}/${imageId}.${extension}`) throw Error('Invalid retirement evidence path.');
    const bytes = fs.readFileSync(path.join(repository.buildLeaguePaths(repository.dataRoot, leagueId).leagueRoot, image.originalPath));
    if (sha(bytes) !== image.sha256) throw Error('Retirement evidence integrity check failed.');
    return { bytes, contentType: extension === 'jpg' ? 'image/jpeg' : extension === 'heic' ? 'image/heic' : 'image/png' };
  }
  return { inspect, upload, prepare, confirm, readOriginal, retry };
}
function createOffseasonEvidenceService(options) {
  if (!['LOTTERY', 'DRAFT', 'OPTIONS', 'FREE_AGENCY', 'PROGRESSION'].includes(options.step)) throw Error('Unknown import step.');
  const service = createRetirementImportService(options);
  return Object.fromEntries(['inspect', 'upload', 'retry', 'readOriginal'].map(key => [key, service[key]]));
}
module.exports = { createRetirementImportService, createOffseasonEvidenceService };
