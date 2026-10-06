const { createHash, randomUUID } = require("crypto");

const { loadFreeAgency, loadTeamRoster } = require("../2kratings/repository");
const { bootstrapTeamsFrom2KRatings } = require("./bootstrap");
const { PHASES } = require("./constants");
const { requirePhase } = require("./phase-guards");
const { createFantasyHQRepository } = require("./repository");
const { generateSchedule } = require("./schedule-generator");
const { validateSchedule } = require("./schedule-validator");
const { validateSetupState } = require("./setup-validator");

function stablePlayerId(teamId, player) {
  const input = [
    teamId,
    player.profileUrl || "",
    player.name || "",
    player.birthdate || "",
  ].join("|");
  return `ply_${createHash("sha1").update(input).digest("hex").slice(0, 12)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function defaultSettings(league) {
  return {
    leagueId: league.leagueId,
    seasonNumber: league.seasonNumber,
    regularSeasonWeeks: 15,
    conferenceOnlySchedule: true,
    gamesPerTeam: 14,
    byesPerTeam: 1,
    playoffTeams: 8,
    playoffSeriesLengths: {
      firstRound: 7,
      conferenceSemifinals: 7,
      conferenceFinals: 7,
      finals: 7,
    },
    gameDeadlineHours: 168,
    resultConfirmationRequired: true,
    commissionerApprovalRequired: false,
    requireAllOwners: true,
  };
}

function normalizeOwnerRecord(leagueId, teamId, userId, actingUserId) {
  const timestamp = nowIso();
  return {
    leagueId,
    teamId,
    userId: String(userId),
    assignedAt: timestamp,
    assignedByUserId: String(actingUserId),
    updatedAt: timestamp,
  };
}

function createSetupService(options = {}) {
  const repository = options.repository || createFantasyHQRepository(options);
  const sourceTeamsLoader = options.sourceTeamsLoader || bootstrapTeamsFrom2KRatings;
  const sourceRosterLoader = options.sourceRosterLoader || loadTeamRoster;

  const sourceFreeAgencyLoader = options.sourceFreeAgencyLoader || loadFreeAgency;

  function appendAuditLog(leagueId, action, userId, metadata = {}) {
    repository.appendAuditLog(leagueId, {
      action,
      userId: userId ? String(userId) : null,
      leagueId,
      timestamp: nowIso(),
      metadata,
    });
  }

  function getLeagueContextByBinding({ guildId, leagueId = null, seasonId = null } = {}) {
    return repository.loadLeagueContext({ guildId, leagueId, seasonId });
  }

  function loadOwnersMap(leagueId) {
    return new Map(repository.loadOwners(leagueId).map((owner) => [owner.teamId, owner]));
  }

  function createLeague({ leagueId, leagueName, seasonNumber, commissionerUserId, guildId }) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(leagueId)) throw new Error("Use 1–64 letters, numbers, hyphens, or underscores for the league ID, for example 2k-test-03.");
    if (repository.leagueExists(leagueId)) throw new Error("That league ID already exists. Use /league setup to continue it, /admin bind to reconnect it, or choose a new ID.");
    if (repository.loadGuildLeagueBinding(guildId)) throw new Error("This server already has a league. Use /league setup to continue, or /league delete before starting fresh.");
    const nextLeague = repository.saveLeague(leagueId, {
      leagueName,
      name: leagueName,
      seasonNumber,
      currentSeasonId: seasonNumber,
      commissionerUserId,
      guildId,
      currentPhase: PHASES.SETUP,
      currentWeek: null,
      createdAt: nowIso(),
    });

    if (!repository.loadSettings(leagueId)) {
      repository.saveSettings(leagueId, defaultSettings(nextLeague));
    }
    repository.saveGuildLeagueBinding(guildId, {
      leagueId,
      seasonId: String(nextLeague.currentSeasonId),
    });
    appendAuditLog(leagueId, "league.created", commissionerUserId, {
      leagueName: nextLeague.leagueName,
      seasonNumber: nextLeague.seasonNumber,
      guildId,
    });
    return nextLeague;
  }

  function createLeagueWithRosters(options) {
    const league = createLeague(options);
    const args = { leagueId: league.leagueId, seasonId: String(league.currentSeasonId), actingUserId: options.commissionerUserId };
    if (options.testMode) updateSettings({ ...args, updates: { requireAllOwners: false, testMode: true } });
    try { return { league, imported: importRosters(args), importError: null }; }
    catch (error) { return { league, imported: null, importError: error.message }; }
  }

  function importRosters({ leagueId, seasonId, actingUserId }) {
    const context = repository.loadLeague(leagueId, seasonId);
    requirePhase(context.league, PHASES.SETUP);

    const importedTeams = sourceTeamsLoader();
    const importedAt = nowIso();
    const normalizedTeams = importedTeams.map((team) => {
      const roster = sourceRosterLoader(team.teamName || team.name);
      return {
        leagueId,
        teamId: team.teamId,
        teamName: team.teamName,
        abbreviation: team.abbreviation,
        conference: team.conference,
        assignedUserId: null,
        rosterImportedAt: importedAt,
        rosterSource: "2kratings",
        rosterDate: roster?.rosterDate || null,
        playerCount: Number(roster?.playerCount || roster?.players?.length || 0),
      };
    });

    const playersById = new Map();
    const memberships = [];

    for (const team of normalizedTeams) {
      const roster = sourceRosterLoader(team.teamName);
      for (const player of roster?.players || []) {
        const playerId = stablePlayerId(team.teamId, player);
        if (!playersById.has(playerId)) {
          playersById.set(playerId, {
            leagueId,
            playerId,
            name: player.name,
            overall: player.overall ?? null,
            nationality: player.nationality,
            birthdate: player.birthdate,
            priorToNBA: player.priorToNBA,
            height: player.height,
            heightCm: player.heightCm,
            weightLbs: player.weightLbs,
            wingspan: player.wingspan,
            yearsInNBA: player.yearsInNBA,
            archetype: player.archetype,
            imageUrl: player.imageUrl,
            profileUrl: player.profileUrl,
            position1: player.position1 ?? null,
            position2: player.position2 ?? null,
            jerseyNumber: player.jerseyNumber ?? null,
            createdAt: importedAt,
            updatedAt: importedAt,
          });
        }

        memberships.push({
          leagueId,
          seasonId: String(context.seasonId),
          teamId: team.teamId,
          playerId,
          jerseyNumber: player.jerseyNumber ?? null,
          position1: player.position1 ?? null,
          position2: player.position2 ?? null,
          importedAt,
          source: "2kratings",
        });
      }
    }

    repository.saveTeams(leagueId, normalizedTeams);
    repository.savePlayers(leagueId, [...playersById.values()]);
    repository.saveRosterMemberships(leagueId, memberships);
    const draftPicksInitialized = require("./trade-service").createTradeService({ repository })
      .initializeDraftPicks({ leagueId, seasonId: context.seasonId, actingUserId }).created;
    const freeAgents = importFreeAgents({ leagueId, seasonId, actingUserId });

    appendAuditLog(leagueId, "rosters.imported", actingUserId, {
      teamCount: normalizedTeams.length,
      playerCount: playersById.size,
      seasonId: context.seasonId,
    });

    return {
      teamsImported: normalizedTeams.length,
      playersImported: playersById.size + freeAgents.imported,
      freeAgentsImported: freeAgents.imported,
      draftPicksInitialized,
      seasonId: context.seasonId,
    };
  }

  function importFreeAgents({ leagueId, seasonId, actingUserId }) {
    const context = repository.loadLeague(leagueId, seasonId);
    requirePhase(context.league, [PHASES.SETUP, PHASES.PRESEASON]);
    const snapshot = sourceFreeAgencyLoader();
    if (!Array.isArray(snapshot?.players)) throw new Error("No local free-agent snapshot found.");
    const players = repository.loadPlayers(leagueId);
    const profileKey = (p) => String(p.profileUrl || "").trim().replace(/\/$/, "").toLowerCase();
    const nameKey = (p) => String(p.name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const profiles = new Set(players.map(profileKey).filter(Boolean));
    const names = new Set(players.map(nameKey).filter(Boolean));
    let imported = 0;
    for (const source of snapshot.players) {
      if (!source.name || profiles.has(profileKey(source)) || names.has(nameKey(source))) continue;
      const now = nowIso();
      const player = { ...source, leagueId, playerId: stablePlayerId("free-agent", source), teamId: null, createdAt: now, updatedAt: now };
      players.push(player);
      if (profileKey(source)) profiles.add(profileKey(source));
      names.add(nameKey(source));
      imported += 1;
    }
    repository.savePlayers(leagueId, players);
    appendAuditLog(leagueId, "free-agents.imported", actingUserId, { imported, skipped: snapshot.players.length - imported });
    return { imported, skipped: snapshot.players.length - imported };
  }

  function assignOwner({ leagueId, seasonId, teamId, userId, actingUserId }) {
    const context = repository.loadLeague(leagueId, seasonId);
    requirePhase(context.league, PHASES.SETUP);
    const team = context.teams.find((entry) => entry.teamId === teamId);
    if (!team) throw new Error(`Unknown team "${teamId}".`);

    const owners = repository.loadOwners(leagueId).filter((entry) => entry.teamId !== teamId);
    const record = normalizeOwnerRecord(leagueId, teamId, userId, actingUserId);
    owners.push(record);
    repository.saveOwners(leagueId, owners);
    appendAuditLog(leagueId, "team.owner.assigned", actingUserId, { teamId, userId });
    return record;
  }

  function unassignOwner({ leagueId, seasonId, teamId, actingUserId }) {
    const context = repository.loadLeague(leagueId, seasonId);
    requirePhase(context.league, PHASES.SETUP);
    const owners = repository.loadOwners(leagueId);
    const existing = owners.find((entry) => entry.teamId === teamId);
    repository.saveOwners(leagueId, owners.filter((entry) => entry.teamId !== teamId));
    appendAuditLog(leagueId, "team.owner.removed", actingUserId, {
      teamId,
      previousUserId: existing?.userId || null,
    });
  }

  function updateSettings({ leagueId, seasonId, actingUserId, updates }) {
    const context = repository.loadLeague(leagueId, seasonId);
    requirePhase(context.league, PHASES.SETUP);
    const current = repository.loadSettings(leagueId) || defaultSettings(context.league);
    const next = {
      ...current,
      ...updates,
      playoffSeriesLengths: {
        ...current.playoffSeriesLengths,
        ...(updates.playoffSeriesLengths || {}),
      },
    };
    repository.saveSettings(leagueId, next);
    appendAuditLog(leagueId, "league.settings.updated", actingUserId, { updates });
    return next;
  }

  function generatePendingSchedule({ leagueId, seasonId, actingUserId }) {
    const context = repository.loadLeague(leagueId, seasonId);
    requirePhase(context.league, PHASES.SETUP);
    const schedule = generateSchedule({
      leagueId,
      seasonId: String(context.seasonId),
      teams: context.teams,
    });
    const validation = validateSchedule(schedule, context.teams);
    if (!validation.valid) {
      throw new Error(validation.errors.join("\n"));
    }
    const pending = {
      pendingScheduleId: randomUUID(),
      leagueId,
      seasonId: String(context.seasonId),
      generatedByUserId: String(actingUserId),
      generatedAt: nowIso(),
      schedule,
    };
    repository.savePendingSchedule(leagueId, pending);
    appendAuditLog(leagueId, "schedule.generated", actingUserId, {
      seasonId: context.seasonId,
      pendingScheduleId: pending.pendingScheduleId,
    });
    return pending;
  }

  function getPendingSchedule({ leagueId }) {
    return repository.loadPendingSchedule(leagueId);
  }

  function confirmPendingSchedule({ leagueId, seasonId, actingUserId }) {
    const context = repository.loadLeague(leagueId, seasonId);
    requirePhase(context.league, PHASES.SETUP);
    const pending = repository.loadPendingSchedule(leagueId);
    if (!pending?.schedule) throw new Error("No pending schedule is available to confirm.");
    const validation = validateSchedule(pending.schedule, context.teams);
    if (!validation.valid) throw new Error(validation.errors.join("\n"));
    const saved = repository.saveSchedule(pending.schedule);
    repository.clearPendingSchedule(leagueId);
    appendAuditLog(leagueId, "schedule.confirmed", actingUserId, {
      seasonId: context.seasonId,
      generatedAt: pending.generatedAt,
    });
    return saved;
  }

  function clearPendingSchedule({ leagueId, actingUserId }) {
    repository.clearPendingSchedule(leagueId);
    appendAuditLog(leagueId, "schedule.pending.cleared", actingUserId, {});
  }

  function validateSetup({ leagueId, seasonId }) {
    const context = repository.loadLeague(leagueId, seasonId);
    const settings = repository.loadSettings(leagueId) || defaultSettings(context.league);
    const owners = repository.loadOwners(leagueId);
    const memberships = repository.loadRosterMemberships(leagueId)
      .filter((entry) => String(entry.seasonId) === String(context.seasonId));
    const schedule = repository.scheduleExists(leagueId, context.seasonId)
      ? repository.loadSchedule(leagueId, context.seasonId)
      : null;

    const validation = validateSetupState({
      league: context.league,
      teams: context.teams,
      owners,
      rosterMemberships: memberships,
      settings,
      schedule,
    });
    validation.errors.push(...(repository.loadRoleOwnership(leagueId).conflicts || []));
    validation.ready = validation.errors.length === 0;
    return validation;
  }

  function getSetupDashboard({ leagueId, seasonId }) {
    const context = repository.loadLeague(leagueId, seasonId);
    const settings = repository.loadSettings(leagueId) || defaultSettings(context.league);
    const owners = repository.loadOwners(leagueId);
    const ownerMap = loadOwnersMap(leagueId);
    const memberships = repository.loadRosterMemberships(leagueId)
      .filter((entry) => String(entry.seasonId) === String(context.seasonId));
    const validator = validateSetup({ leagueId, seasonId: context.seasonId });
    const unassignedTeams = context.teams.filter((team) => !ownerMap.has(team.teamId)).map((team) => team.teamName);
    const playerCount = repository.loadPlayers(leagueId).length;

    return {
      league: context.league,
      settings,
      validator,
      totals: {
        teams: context.teams.length,
        ownersAssigned: owners.length,
        players: playerCount,
        rostersImported: new Set(memberships.map((entry) => entry.teamId)).size,
      },
      unassignedTeams,
    };
  }

  function activateLeague({ leagueId, seasonId, actingUserId }) {
    const context = repository.loadLeague(leagueId, seasonId);
    requirePhase(context.league, PHASES.SETUP);
    const validation = validateSetup({ leagueId, seasonId: context.seasonId });
    if (!validation.ready) {
      throw new Error(`League is not ready to activate:\n${validation.errors.join("\n")}`);
    }
    const nextLeague = repository.saveLeague(leagueId, {
      ...context.league,
      currentPhase: PHASES.PRESEASON,
      currentWeek: null,
    });
    appendAuditLog(leagueId, "league.activated", actingUserId, {
      previousPhase: PHASES.SETUP,
      nextPhase: PHASES.PRESEASON,
      seasonId: context.seasonId,
    });
    return nextLeague;
  }

  return {
    activateLeague,
    appendAuditLog,
    assignOwner,
    clearPendingSchedule,
    confirmPendingSchedule,
    createLeague,
    createLeagueWithRosters,
    generatePendingSchedule,
    getLeagueContextByBinding,
    getPendingSchedule,
    getSetupDashboard,
    importRosters,
    importFreeAgents,
    repository,
    unassignOwner,
    updateSettings,
    validateSetup,
  };
}

module.exports = {
  createSetupService,
  defaultSettings,
  stablePlayerId,
};
