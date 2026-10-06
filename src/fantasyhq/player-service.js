const { randomUUID } = require("crypto");

const { activeMemberships, diffObject, normalizeText, numberOrNull, stringOrNull } = require("./service-helpers");
const { createFantasyHQRepository } = require("./repository");
const { leagueAge, playerTradeValue } = require("./asset-valuation");

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
  const next = { ...patch };
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
        teamId: membership?.teamId || null,
        teamName: team?.teamName || null,
        conference: team?.conference || null,
        jerseyNumber: membership?.jerseyNumber ?? player.jerseyNumber ?? null,
        position1: membership?.position1 ?? player.position1 ?? null,
        position2: membership?.position2 ?? player.position2 ?? null,
        age: leagueAge(player.birthdate, context.seasonId),
        tradeValue: playerTradeValue({ ...player, position1: membership?.position1 ?? player.position1, position2: membership?.position2 ?? player.position2 }, context.seasonId),
      };
    });
  }

  function getPlayer(leagueId, seasonId, playerId) {
    const player = listPlayers(leagueId, seasonId).find((entry) => entry.playerId === playerId);
    if (!player) throw new Error(`Unknown player "${playerId}".`);
    return player;
  }

  function updatePlayer({ leagueId, seasonId, playerId, patch, actingUserId, operator }) {
    const validated = validatePlayerPatch(patch);
    const context = repository.loadLeague(leagueId, seasonId);
    const players = repository.loadPlayers(leagueId);
    const playerIndex = players.findIndex((entry) => entry.playerId === playerId);
    if (playerIndex === -1) throw new Error(`Unknown player "${playerId}".`);

    const current = getPlayer(leagueId, context.seasonId, playerId);
    const nextBase = {
      ...players[playerIndex],
      ...validated,
      updatedAt: new Date().toISOString(),
    };
    players[playerIndex] = nextBase;
    repository.savePlayers(leagueId, players);

    const memberships = repository.loadRosterMemberships(leagueId);
    const activeMembership = memberships.find((entry) => entry.playerId === playerId && entry.active !== false && !entry.endedAt && String(entry.seasonId) === String(context.seasonId));
    if (activeMembership) {
      if ("teamId" in validated && validated.teamId && validated.teamId !== activeMembership.teamId) {
        activeMembership.teamId = validated.teamId;
      }
      if ("jerseyNumber" in validated) activeMembership.jerseyNumber = validated.jerseyNumber;
      if ("position1" in validated) activeMembership.position1 = validated.position1;
      if ("position2" in validated) activeMembership.position2 = validated.position2;
      activeMembership.updatedAt = new Date().toISOString();
      repository.saveRosterMemberships(leagueId, memberships);
    }

    const updated = getPlayer(leagueId, context.seasonId, playerId);
    const changes = diffObject(current, updated, EDITABLE_PLAYER_FIELDS);
    repository.appendAuditLog(leagueId, {
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
    });
    return updated;
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
      createdAt: now,
      updatedAt: now,
    };
    players.push(nextPlayer);
    repository.savePlayers(leagueId, players);

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
    repository.saveRosterMemberships(leagueId, memberships);
    repository.appendAuditLog(leagueId, {
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
    });
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

module.exports = {
  createPlayerService,
  EDITABLE_PLAYER_FIELDS,
  validatePlayerPatch,
};
