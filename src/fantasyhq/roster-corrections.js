const { randomUUID, createHash } = require('crypto');
const pending = new Map();
const FIELDS = { move: ['playerId','fromTeamId','toTeamId'], remove: ['playerId','teamId'], bulk: ['teamId','updates'], update: ['playerId','patch'], add: ['teamId','player'], assign: ['teamId','playerId','contractDetails'] };
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, stable(value[k])]));
  return value;
}
function payload(action, args) {
  if (!FIELDS[action]) throw Error('Unknown roster correction action.');
  return Object.fromEntries(FIELDS[action].map(k => [k, args[k]]));
}
function source(repository, args) {
  return createHash('sha256').update(JSON.stringify([repository.loadLeague(args.leagueId).league, repository.loadPlayers(args.leagueId), repository.loadRosterMemberships(args.leagueId), repository.loadTrades(args.leagueId), repository.loadFreeAgencyState(args.leagueId)])).digest('hex');
}
function prepareRosterCorrection(repository, action, args, reason) {
  const context = repository.loadLeague(args.leagueId);
  if (String(args.seasonId) !== context.seasonId) throw Error('Corrections require the active league season.');
  if (!args.actingUserId || args.actingUserId !== context.league.commissionerUserId) throw Error('Only the commissioner can confirm roster corrections.');
  reason = String(reason || '').trim();
  if (reason.length < 10 || reason.length > 1000) throw Error('Give a correction reason of 10–1000 characters.');
  for (const [key, row] of pending) if (row.expiresAt <= Date.now()) pending.delete(key);
  const token = randomUUID(), details = payload(action,args);
  pending.set(token, { root: repository.dataRoot, leagueId: args.leagueId, seasonId: context.seasonId, actor: args.actingUserId, action, details: JSON.stringify(stable(details)), source: source(repository,args), reason, expiresAt: Date.now()+300000 });
  return { token, action, reason, details, expiresInSeconds: 300 };
}
function authorizeRosterEdit(repository, action, args) {
  const context = repository.loadLeague(args.leagueId);
  if (String(args.seasonId) !== context.seasonId) throw Error('Roster edits require the active league season.');
  if (['SETUP','PRESEASON'].includes(context.league.currentPhase)) return null;
  const row = pending.get(args.correctionToken);
  if (!row || row.expiresAt <= Date.now() || row.root !== repository.dataRoot || row.leagueId !== args.leagueId
    || row.seasonId !== context.seasonId || row.actor !== args.actingUserId || row.actor !== context.league.commissionerUserId
    || row.action !== action || row.details !== JSON.stringify(stable(payload(action,args))) || row.source !== source(repository,args)) {
    throw Error('Routine roster edits are closed in this phase. Preview and confirm a commissioner correction with a reason.');
  }
  pending.delete(args.correctionToken);
  return { requestId: args.correctionToken, reason: row.reason, confirmedBy: row.actor, phase: context.league.currentPhase };
}
module.exports = { prepareRosterCorrection, authorizeRosterEdit };
