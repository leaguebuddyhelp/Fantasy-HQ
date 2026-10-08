const { randomUUID } = require("crypto");

const { loadTeamRoster } = require("../2kratings/repository");
const { activeMemberships, diffObject, normalizeText } = require("./service-helpers");
const { createFantasyHQRepository } = require("./repository");

const ROSTER_COMPARISON_FIELDS = [
  "overall",
  "position1",
  "position2",
  "jerseyNumber",
  "nationality",
  "archetype",
  "height",
  "heightCm",
  "weightLbs",
  "wingspan",
  "yearsInNBA",
  "birthdate",
  "priorToNBA",
  "teamId",
];

function createRosterService(options = {}) {
  const repository = options.repository || createFantasyHQRepository(options);
  const sourceRosterLoader = options.sourceRosterLoader || loadTeamRoster;
  const onRosterMovement = options.onRosterMovement || null;

  function notifyRosterMovement(event) {
    if (!onRosterMovement) return;
    try { Promise.resolve(onRosterMovement(event)).catch(error => console.error("Upgrade request invalidation after roster change failed:", error.message)); }
    catch (error) { console.error("Upgrade request invalidation after roster change failed:", error.message); }
  }

  function currentRosterEntries(leagueId, seasonId, teamId = null) {
    const players = new Map(repository.loadPlayers(leagueId).map((player) => [player.playerId, player]));
    return activeMemberships(repository.loadRosterMemberships(leagueId), seasonId)
      .filter((membership) => !teamId || membership.teamId === teamId)
      .map((membership) => ({
        membership,
        player: players.get(membership.playerId),
      }));
  }

  function movePlayer({ leagueId, seasonId, playerId, fromTeamId, toTeamId, actingUserId, operator }) {
    const memberships = repository.loadRosterMemberships(leagueId);
    const players = repository.loadPlayers(leagueId);
    const membership = memberships.find((entry) => entry.playerId === playerId
      && entry.active !== false
      && !entry.endedAt
      && String(entry.seasonId) === String(seasonId)
      && (!fromTeamId || entry.teamId === fromTeamId));
    if (!membership) throw new Error("Active roster membership not found for that player.");
    if (!repository.loadLeague(leagueId, seasonId).teams.some(t => t.teamId === toTeamId)) throw Error('Choose a valid league team.');
    const lock = require('./transaction-locks').playerTransactionLock(repository, leagueId, String(seasonId), playerId); if (lock) throw Error(lock);
    const previousTeamId = membership.teamId;
    membership.teamId = toTeamId;
    membership.updatedAt = new Date().toISOString();
    const player = players.find(p => p.playerId === playerId); if (player) player.teamId = toTeamId;
    repository.commitRosterTransaction({ leagueId, players, rosterMemberships: memberships, auditEntry: {
      action: "roster.player.moved",
      userId: String(actingUserId || "system"),
      ...(operator ? { operator: String(operator) } : {}),
      leagueId,
      timestamp: new Date().toISOString(),
      metadata: {
        playerId,
        fromTeamId: previousTeamId,
        toTeamId,
      },
    } });
    if (previousTeamId !== toTeamId) notifyRosterMovement({ leagueId, seasonId: String(seasonId), playerIds: [playerId], reason: "PLAYER_NO_LONGER_ON_ROSTER" });
    return membership;
  }

  function removePlayer({ leagueId, seasonId, playerId, teamId, actingUserId, operator }) {
    const memberships = repository.loadRosterMemberships(leagueId);
    const players = repository.loadPlayers(leagueId);
    const membership = memberships.find((entry) => entry.playerId === playerId
      && entry.active !== false
      && !entry.endedAt
      && String(entry.seasonId) === String(seasonId)
      && (!teamId || entry.teamId === teamId));
    if (!membership) throw new Error("Active roster membership not found for that player.");
    const lock = require('./transaction-locks').playerTransactionLock(repository, leagueId, String(seasonId), playerId); if (lock) throw Error(lock);
    membership.active = false;
    membership.endedAt = new Date().toISOString();
    membership.endedReason = "ADMIN_REMOVAL";
    membership.updatedAt = membership.endedAt;
    const player = players.find(p => p.playerId === playerId); if (player) { player.teamId = null; delete player.contract; }
    repository.commitRosterTransaction({ leagueId, players, rosterMemberships: memberships, auditEntry: {
      action: "roster.player.removed",
      userId: String(actingUserId || "system"),
      ...(operator ? { operator: String(operator) } : {}),
      leagueId,
      timestamp: membership.endedAt,
      metadata: {
        playerId,
        teamId: membership.teamId,
      },
    } });
    notifyRosterMovement({ leagueId, seasonId: String(seasonId), playerIds: [playerId], reason: "PLAYER_NO_LONGER_ON_ROSTER" });
    return membership;
  }

  function bulkUpdateRoster({ leagueId, seasonId, teamId, updates, actingUserId, operator }) {
    const memberships = repository.loadRosterMemberships(leagueId);
    const players = repository.loadPlayers(leagueId);
    const playerMap = new Map(players.map((player) => [player.playerId, player]));
    const auditChanges = [];

    for (const raw of updates || []) {
      const update = { playerId: raw.playerId, ...require('./player-service').validatePlayerPatch(raw) };
      const membership = memberships.find((entry) => entry.playerId === update.playerId
        && entry.active !== false
        && !entry.endedAt
        && entry.teamId === teamId
        && String(entry.seasonId) === String(seasonId));
      if (!membership) continue;
      if ('position1' in update || 'position2' in update || 'overall' in update) { const lock = require('./transaction-locks').playerTransactionLock(repository,leagueId,String(seasonId),update.playerId); if (lock) throw Error(lock); }
      const before = {
        jerseyNumber: membership.jerseyNumber,
        position1: membership.position1,
        position2: membership.position2,
        overall: playerMap.get(update.playerId)?.overall ?? null,
      };
      if ("jerseyNumber" in update) membership.jerseyNumber = update.jerseyNumber;
      if ("position1" in update) membership.position1 = update.position1;
      if ("position2" in update) membership.position2 = update.position2;
      membership.updatedAt = new Date().toISOString();
      if ("overall" in update && playerMap.has(update.playerId)) {
        playerMap.get(update.playerId).overall = update.overall;
        playerMap.get(update.playerId).updatedAt = membership.updatedAt;
      }
      const after = {
        jerseyNumber: membership.jerseyNumber,
        position1: membership.position1,
        position2: membership.position2,
        overall: playerMap.get(update.playerId)?.overall ?? null,
      };
      const changes = diffObject(before, after, ["overall", "jerseyNumber", "position1", "position2"]);
      if (changes.length) {
        auditChanges.push({
          playerId: update.playerId,
          playerName: playerMap.get(update.playerId)?.name || update.playerId,
          changes,
        });
      }
    }

    repository.commitRosterTransaction({ leagueId, players: [...playerMap.values()], rosterMemberships: memberships, auditEntry: {
      action: "roster.bulk-updated",
      userId: String(actingUserId || "system"),
      ...(operator ? { operator: String(operator) } : {}),
      leagueId,
      timestamp: new Date().toISOString(),
      metadata: { teamId, updates: auditChanges },
    } });
    return auditChanges;
  }

  function matchImportedPlayer(currentEntries, importedPlayer, contextTeamId) {
    const byProfileUrl = currentEntries.find((entry) => entry.player?.profileUrl && importedPlayer.profileUrl
      && entry.player.profileUrl === importedPlayer.profileUrl);
    if (byProfileUrl) return { type: "existing", confidence: "exact", entry: byProfileUrl };

    const byNameBirthdate = currentEntries.find((entry) =>
      normalizeText(entry.player?.name) === normalizeText(importedPlayer.name)
      && normalizeText(entry.player?.birthdate) === normalizeText(importedPlayer.birthdate));
    if (byNameBirthdate) return { type: "existing", confidence: "high", entry: byNameBirthdate };

    const byNameTeamPosition = currentEntries.find((entry) =>
      normalizeText(entry.player?.name) === normalizeText(importedPlayer.name)
      && entry.membership.teamId === contextTeamId
      && normalizeText(entry.membership.position1) === normalizeText(importedPlayer.position1));
    if (byNameTeamPosition) return { type: "possible", confidence: "medium", entry: byNameTeamPosition };

    return null;
  }

  function diffRosterImport({ leagueId, seasonId, teamId }) {
    const context = repository.loadLeague(leagueId, seasonId);
    const team = context.teams.find((entry) => entry.teamId === teamId);
    if (!team) throw new Error(`Unknown team "${teamId}".`);
    const sourceRoster = sourceRosterLoader(team.teamName);
    if (!sourceRoster?.players) throw new Error(`No source roster found for ${team.teamName}.`);

    const currentEntries = currentRosterEntries(leagueId, context.seasonId, teamId);
    const matchedPlayerIds = new Set();
    const changes = [];
    const added = [];
    const unresolved = [];

    for (const importedPlayer of sourceRoster.players) {
      const match = matchImportedPlayer(currentEntries, importedPlayer, teamId);
      if (!match) {
        added.push(importedPlayer);
        continue;
      }
      if (match.type === "possible") {
        unresolved.push({
          imported: importedPlayer,
          existing: match.entry.player,
          confidence: match.confidence,
        });
        continue;
      }
      matchedPlayerIds.add(match.entry.player.playerId);
      const currentSnapshot = {
        ...match.entry.player,
        teamId: match.entry.membership.teamId,
        jerseyNumber: match.entry.membership.jerseyNumber,
        position1: match.entry.membership.position1,
        position2: match.entry.membership.position2,
      };
      const importedSnapshot = {
        ...importedPlayer,
        teamId,
      };
      const fieldChanges = diffObject(currentSnapshot, importedSnapshot, ROSTER_COMPARISON_FIELDS);
      // Missing payroll must never erase a previously imported contract.
      if (importedPlayer.contract && JSON.stringify(currentSnapshot.contract) !== JSON.stringify(importedPlayer.contract)) {
        fieldChanges.push({ field: 'contract', before: currentSnapshot.contract ?? null, after: structuredClone(importedPlayer.contract) });
      }
      if (fieldChanges.length) {
        changes.push({
          playerId: match.entry.player.playerId,
          playerName: match.entry.player.name,
          changes: fieldChanges,
        });
      }
    }

    const removed = currentEntries.filter((entry) => !matchedPlayerIds.has(entry.player.playerId))
      .map((entry) => entry.player);

    const unchanged = currentEntries.length - changes.length - removed.length;
    return {
      previewId: randomUUID(),
      teamId,
      teamName: team.teamName,
      unchanged,
      added,
      removed,
      changes,
      unresolved,
      sourceRosterDate: sourceRoster.rosterDate || null,
    };
  }

  function applyRosterImport({ leagueId, seasonId, teamId, actingUserId, operator }) {
    const preview = diffRosterImport({ leagueId, seasonId, teamId });
    if (preview.unresolved.length) {
      throw new Error("Cannot apply roster import while unresolved player identity matches remain.");
    }

    const players = repository.loadPlayers(leagueId), memberships = repository.loadRosterMemberships(leagueId);
    for (const change of preview.changes) {
      const player = players.find(p => p.playerId === change.playerId), membership = activeMemberships(memberships, seasonId).find(m => m.playerId === change.playerId);
      if (!player || !membership) throw Error('Import roster changed; preview again.');
      for (const item of change.changes) { if (['teamId', 'jerseyNumber', 'position1', 'position2'].includes(item.field)) membership[item.field] = item.after; player[item.field] = item.after; }
      player.updatedAt = membership.updatedAt = new Date().toISOString();
    }
    for (const removed of preview.removed) {
      const lock = require('./transaction-locks').playerTransactionLock(repository, leagueId, String(seasonId), removed.playerId); if (lock) throw Error(lock);
      const membership = activeMemberships(memberships, seasonId).find(m => m.playerId === removed.playerId && m.teamId === teamId);
      if (!membership) throw Error('Import roster changed; preview again.');
      membership.active = false; membership.endedAt = new Date().toISOString(); membership.endedReason = 'IMPORT_REMOVAL';
      const player = players.find(p => p.playerId === removed.playerId); player.teamId = null;
    }
    for (const imported of preview.added) {
      if (players.some(p => p.profileUrl && p.profileUrl === imported.profileUrl || normalizeText(p.name) === normalizeText(imported.name))) throw Error('Imported player already exists in the league; resolve their ownership before importing.');
      const playerId = `ply_${randomUUID().replaceAll('-', '').slice(0, 12)}`, stamp = new Date().toISOString();
      players.push({ ...imported, playerId, leagueId, teamId, createdAt: stamp, updatedAt: stamp });
      memberships.push({ playerId, leagueId, seasonId: String(seasonId), teamId, active: true, position1: imported.position1, position2: imported.position2, importedAt: stamp, source: 'roster-import' });
    }
    repository.commitRosterTransaction({ leagueId, players, rosterMemberships: memberships, auditEntry: { action: 'roster.import.applied', userId: String(actingUserId || 'system'), operator, leagueId, timestamp: new Date().toISOString(), metadata: { teamId, added: preview.added.length, removed: preview.removed.length, changed: preview.changes.length } } });
    notifyRosterMovement({ leagueId, seasonId: String(seasonId), playerIds: preview.removed.map(p => p.playerId), reason: 'PLAYER_NO_LONGER_ON_ROSTER' });
    return preview;
  }

  return {
    applyRosterImport,
    bulkUpdateRoster,
    currentRosterEntries,
    diffRosterImport,
    movePlayer,
    removePlayer,
    repository,
  };
}

module.exports = {
  createRosterService,
};
