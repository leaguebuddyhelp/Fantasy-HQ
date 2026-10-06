const { randomUUID } = require('crypto');
const { createGameSubmissionService } = require('../game-submissions');
const { activeMemberships } = require('../service-helpers');
const { createTesseractProvider } = require('./tesseract-provider');
const { normalizeExtraction } = require('./normalize');
const pending = new Map();
function createBoxScoreExtractionService(options = {}) {
  const submissions = options.submissions || createGameSubmissionService();
  const repository = submissions.repository;
  const provider = options.provider || createTesseractProvider();
  function extract(gameId, submissionId) {
    const key = `${repository.dataRoot}:${gameId}:${submissionId}`;
    if (pending.has(key)) return pending.get(key);
    const job = run(gameId, submissionId).finally(() => pending.delete(key));
    pending.set(key, job);
    return job;
  }
  async function run(gameId, submissionId) {
    const extractionId = randomUUID();
    const timestamp = new Date().toISOString();
    await submissions.mutate(gameId, record => {
      const submission = record.submissions.find(s => s.submissionId === submissionId);
      const media = record.media.filter(m => m.submissionId === submissionId);
      if (!submission || ['COLLECTING','CANCELLED'].includes(submission.status) || media.length !== 2) throw new Error('Extraction requires a completed two-image submission.');
      if (record.game.locked || record.game.finalizedAt || ['FINAL','FINALIZED','LOCKED'].includes(record.game.status)) throw new Error('Game is locked or finalized.');
      record.extractions ||= [];
      // An earlier PROCESSING attempt with no in-process job was interrupted by restart.
      for (const attempt of record.extractions.filter(e => e.submissionId === submissionId && e.status === 'PROCESSING')) {
        attempt.status = 'EXTRACTION_FAILED'; attempt.error = 'Interrupted; retried using stored originals.';
      }
      record.extractions.push({ extractionId, gameId, submissionId, mediaIds: media.map(m => m.mediaId),
        provider: provider.name, model: provider.model, timestamp, status:'PROCESSING', raw:null });
      submission.status = 'PROCESSING'; submission.latestExtractionId = extractionId;
    });
    try {
      const record = submissions.load(gameId);
      const images = record.media.filter(m => m.submissionId === submissionId).map(m => ({ ...m, bytes: submissions.readOriginal(gameId,m.mediaId) }));
      const result = await provider.extract(images);
      // Persist the provider's entire response before parsing or validating it.
      await submissions.mutate(gameId, r => Object.assign(r.extractions.find(e => e.extractionId === extractionId), { raw: result.raw, responseMetadata: { httpStatus: result.httpStatus ?? null } }));
      const parsed = provider.parse(result);
      const context = repository.loadLeague(record.game.leagueId,record.game.seasonId);
      const memberships = activeMemberships(repository.loadRosterMemberships(record.game.leagueId),record.game.seasonId);
      const players = repository.loadPlayers(record.game.leagueId);
      const rosters = Object.fromEntries([record.game.team1Id,record.game.team2Id].map(id => [id,
        players.filter(p => memberships.some(m => m.playerId === p.playerId && m.teamId === id))]));
      const output = normalizeExtraction(parsed, { game:record.game, media:images, teams:context.teams, rosters });
      const submission = record.submissions.find(s => s.submissionId === submissionId);
      if (submission.mode === 'TEAM_SIDES') {
        for (const screen of output.normalized.screenshots) {
          const source = images.find(m => m.mediaId === screen.mediaId);
          if (!source?.teamId || source.teamId !== screen.teamId) output.issues.push({code:'UPLOADED_TEAM_MISMATCH',path:screen.mediaId,message:'The uploaded player table does not match the submitting coach’s team.'});
        }
      }
      const status = output.issues.length ? 'REVIEW_REQUIRED' : 'READY_FOR_REVIEW';
      await submissions.mutate(gameId, r => {
        Object.assign(r.extractions.find(e => e.extractionId === extractionId), output, { status, finishedAt:new Date().toISOString(), rosterSnapshot:rosters });
        r.submissions.find(s => s.submissionId === submissionId).status = status;
        if (status === 'READY_FOR_REVIEW' && ['TEAM_SIDES','STAFF_BOTH'].includes(submission.mode)) {
          require('./finalize').finalizeValidatedSubmission(r, extractionId);
        }
      });
    } catch (error) {
      await submissions.mutate(gameId, r => {
        Object.assign(r.extractions.find(e => e.extractionId === extractionId), { status:'EXTRACTION_FAILED', error:error.message, finishedAt:new Date().toISOString() });
        r.submissions.find(s => s.submissionId === submissionId).status = 'EXTRACTION_FAILED';
      });
    }
    return submissions.load(gameId).extractions.find(e => e.extractionId === extractionId);
  }
  return { extract };
}
module.exports = { createBoxScoreExtractionService };
