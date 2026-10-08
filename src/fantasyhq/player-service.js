const { contractView } = require('../shared/player-contract');
const { randomUUID } = require("crypto");

const { activeMemberships, diffObject, normalizeText, numberOrNull, stringOrNull } = require("./service-helpers");
const { createFantasyHQRepository } = require("./repository");
const { leagueAge, leagueSeasonStartYear, evaluatePlayerTradeValue, playerTradeValue } = require("./asset-valuation");

const EDITABLE_PLAYER_FIELDS = [
  "name",
  "teamId",
  "overall",
  "jerseyNumber",
  "nationality",
  "position1",
  "position2",
  "archetype",
  "height",
  "heightCm",
  "weightLbs",
  "wingspan",
  "yearsInNBA",
  "birthdate",
  "priorToNBA",
  "profileUrl",
  "imageUrl",
];

function validatePlayerPatch(patch = {}) {
  const next = Object.fromEntries(Object.entries(patch).filter(([key]) => EDITABLE_PLAYER_FIELDS.includes(key)));
  if ("overall" in next) {
    const overall = numberOrNull(next.overall);
    if (overall == null || overall < 0 || overall > 99) {
      throw new Error("OVR must be a number between 0 and 99.");
    }
    next.overall = overall;
  }
  for (const numericField of ["jerseyNumber", "heightCm", "weightLbs", "yearsInNBA"]) {
    if (numericField in next) {
      next[numericField] = numberOrNull(next[numericField]);
    }
  }
  for (const stringField of ["name", "nationality", "position1", "position2", "archetype", "height", "wingspan", "birthdate", "priorToNBA", "profileUrl", "imageUrl", "teamId"]) {
    if (stringField in next) next[stringField] = stringOrNull(next[stringField]);
  }
  return next;
}

function createPlayerService(options = {}) {
  const repository = options.repository || createFantasyHQRepository(options);
  const onRosterMovement = options.onRosterMovement || null;

  function notifyRosterMovement(event) {
    if (!onRosterMovement) return;
    try { Promise.resolve(onRosterMovement(event)).catch(error => console.error("Upgrade request invalidation after player change failed:", error.message)); }
    catch (error) { console.error("Upgrade request invalidation after player change failed:", error.message); }
  }

  function playerTeamIndex(leagueId, seasonId) {
    const memberships = activeMemberships(repository.loadRosterMemberships(leagueId), seasonId);
    return new Map(memberships.map((membership) => [membership.playerId, membership]));
  }

  function listPlayers(leagueId, seasonId) {
    const context = repository.loadLeague(leagueId, seasonId);
    const teams = new Map(context.teams.map((team) => [team.teamId, team]));
    const currentMemberships = playerTeamIndex(leagueId, context.seasonId);
    return repository.loadPlayers(leagueId).map((player) => {
      const membership = currentMemberships.get(player.playerId) || null;
      const team = membership ? teams.get(membership.teamId) : null;
      return {
        ...player,
        contractView: contractView(player, leagueSeasonStartYear(context.seasonId)),
        tradeValueReason: evaluatePlayerTradeValue(player, context.seasonId).contractReason,
        teamId: membership?.teamId || null,
        teamName: team?.teamName || null,
        conference: team?.conference || null,
        jerseyNumber: membership?.jerseyNumber ?? player.jerseyNumber ?? null,
        position1: membership?.position1 ?? player.position1 ?? null,
        position2: membership?.position2 ?? player.position2 ?? null,
        age: leagueAge(player.birthdate, context.seasonId) ?? player.age ?? null,
        tradeValue: playerTradeValue({ ...player, position1: membership?.position1 ?? player.position1, position2: membership?.position2 ?? player.position2 }, context.seasonId),
      };
    });
  }

  function getPlayer(leagueId, seasonId, playerId) {
    const player = listPlayers(leagueId, seasonId).find((entry) => entry.playerId === playerId);
    if (!player) throw new Error(`Unknown player "${playerId}".`);
    return { ...player, playerOfWeek: require('./player-of-week').createPlayerOfWeekService({ repository }).list(leagueId, { playerId }) };
  }

  function updatePlayer({ leagueId, seasonId, playerId, patch, actingUserId, operator }) {
    const validated = validatePlayerPatch(patch);
    const context = repository.loadLeague(leagueId, seasonId);
    if (validated.teamId && !context.teams.some(t => t.teamId === validated.teamId)) throw Error('Choose a valid league team.');
    const players = repository.loadPlayers(leagueId);
    const playerIndex = players.findIndex((entry) => entry.playerId === playerId);
    if (playerIndex === -1) throw new Error(`Unknown player "${playerId}".`);

    const current = getPlayer(leagueId, context.seasonId, playerId);
    if ('teamId' in validated && !validated.teamId && current.teamId && Number(current.overall) >= 85) throw Error('Players rated 85+ OVR cannot be waived, including by the commissioner.');
    if ('teamId' in validated && validated.teamId !== current.teamId) { const lock = require('./transaction-locks').playerTransactionLock(repository, leagueId, context.seasonId, playerId); if (lock) throw Error(lock); }
    const nextBase = {
      ...players[playerIndex],
      ...validated,
      updatedAt: new Date().toISOString(),
    };
    players[playerIndex] = nextBase;

    const memberships = repository.loadRosterMemberships(leagueId);
    let activeMembership = memberships.find((entry) => entry.playerId === playerId && entry.active !== false && !entry.endedAt && String(entry.seasonId) === String(context.seasonId));
    if (activeMembership) {
      if ("teamId" in validated && validated.teamId && validated.teamId !== activeMembership.teamId) {
        activeMembership.teamId = validated.teamId;
      }
      if ("jerseyNumber" in validated) activeMembership.jerseyNumber = validated.jerseyNumber;
      if ("position1" in validated) activeMembership.position1 = validated.position1;
      if ("position2" in validated) activeMembership.position2 = validated.position2;
      activeMembership.updatedAt = new Date().toISOString();
    }

    if ('teamId' in validated && !validated.teamId && activeMembership) { activeMembership.active = false; activeMembership.endedAt = new Date().toISOString(); activeMembership = null; }
    if ('teamId' in validated && validated.teamId && !activeMembership) { activeMembership = { leagueId, seasonId: context.seasonId, teamId: validated.teamId, playerId, active: true, source: 'manual', startedAt: new Date().toISOString() }; memberships.push(activeMembership); }
    const updated = { ...current, ...nextBase, teamId: activeMembership?.teamId || null };
    const changes = diffObject(current, updated, EDITABLE_PLAYER_FIELDS);
    repository.commitRosterTransaction({ leagueId, players, rosterMemberships: memberships, auditEntry: {
      action: "player.updated",
      userId: String(actingUserId || context.league.commissionerUserId || "system"),
      ...(operator ? { operator: String(operator) } : {}),
      leagueId,
      timestamp: new Date().toISOString(),
      metadata: {
        playerId,
        playerName: updated.name,
        changes,
      },
    } });
    if (current.teamId !== updated.teamId) notifyRosterMovement({ leagueId, seasonId: context.seasonId, playerIds: [playerId], reason: 'PLAYER_NO_LONGER_ON_ROSTER' });
    return getPlayer(leagueId, context.seasonId, playerId);
  }

  function findDuplicateCandidates(leagueId, candidate) {
    const normalizedName = normalizeText(candidate.name);
    const normalizedBirthdate = normalizeText(candidate.birthdate);
    return repository.loadPlayers(leagueId).filter((player) => {
      const sameName = normalizeText(player.name) === normalizedName;
      const sameBirthdate = normalizedBirthdate && normalizeText(player.birthdate) === normalizedBirthdate;
      return sameName || sameBirthdate;
    });
  }

  function addPlayer({ leagueId, seasonId, teamId, player, actingUserId, operator }) {
    if (!repository.loadLeague(leagueId, seasonId).teams.some(t => t.teamId === teamId)) throw Error('Choose a valid league team.');
    const validated = validatePlayerPatch(player);
    const duplicates = findDuplicateCandidates(leagueId, validated);
    if (duplicates.length && !player.forceCreate) {
      const names = duplicates.map((entry) => entry.name).join(", ");
      throw new Error(`Possible duplicate player found: ${names}. Re-submit with forceCreate if this is intentional.`);
    }
    const players = repository.loadPlayers(leagueId);
    const playerId = `ply_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const now = new Date().toISOString();
    const nextPlayer = {
      leagueId,
      playerId,
      ...validated,
      teamId,
      createdAt: now,
      updatedAt: now,
    };
    players.push(nextPlayer);

    const memberships = repository.loadRosterMemberships(leagueId);
    memberships.push({
      leagueId,
      seasonId: String(seasonId),
      teamId,
      playerId,
      jerseyNumber: validated.jerseyNumber,
      position1: validated.position1,
      position2: validated.position2,
      importedAt: now,
      updatedAt: now,
      source: "manual",
      active: true,
      startedAt: now,
    });
    repository.commitRosterTransaction({ leagueId, players, rosterMemberships: memberships, auditEntry: {
      action: "player.added",
      userId: String(actingUserId || "system"),
      ...(operator ? { operator: String(operator) } : {}),
      leagueId,
      timestamp: now,
      metadata: {
        playerId,
        teamId,
        playerName: nextPlayer.name,
      },
    } });
    return getPlayer(leagueId, seasonId, playerId);
  }

  return {
    addPlayer,
    findDuplicateCandidates,
    getPlayer,
    listPlayers,
    repository,
    updatePlayer,
  };
}

module.exports = { validatePlayerPatch,
  createPlayerService,
  EDITABLE_PLAYER_FIELDS,
  validatePlayerPatch,
};
