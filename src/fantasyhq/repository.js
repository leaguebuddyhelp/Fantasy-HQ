const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

function normalizeConference(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["east", "eastern", "eastern conference"].includes(normalized)) return "East";
  if (["west", "western", "western conference"].includes(normalized)) return "West";
  throw new Error(`Unsupported conference value "${value}". Expected East or West.`);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx');
    try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, filePath);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function normalizeTeam(leagueId, team = {}) {
  const teamId = String(team.teamId || "").trim();
  const teamName = String(team.teamName || team.name || "").trim();
  const abbreviation = String(team.abbreviation || team.abbr || "").trim();
  if (!teamId) throw new Error(`League ${leagueId} includes a team without teamId.`);
  if (!teamName) throw new Error(`League ${leagueId} includes a team without teamName.`);
  if (!abbreviation) throw new Error(`League ${leagueId} includes a team without abbreviation.`);

  return {
    leagueId,
    teamId,
    teamName,
    abbreviation,
    conference: normalizeConference(team.conference),
    assignedUserId: team.assignedUserId ? String(team.assignedUserId) : null,
    rosterImportedAt: team.rosterImportedAt ? String(team.rosterImportedAt) : null,
    rosterSource: team.rosterSource ? String(team.rosterSource) : null,
    rosterDate: team.rosterDate ? String(team.rosterDate) : null,
    playerCount: Number(team.playerCount || 0),
  };
}

function buildLeaguePaths(dataRoot, leagueId) {
  const leagueRoot = path.join(dataRoot, "leagues", leagueId);
  return {
    leagueRoot,
    leagueFile: path.join(leagueRoot, "league.json"),
    teamsFile: path.join(leagueRoot, "teams.json"),
    ownersFile: path.join(leagueRoot, "owners.json"),
    settingsFile: path.join(leagueRoot, "settings.json"),
    playersFile: path.join(leagueRoot, "players.json"),
    rosterMembershipsFile: path.join(leagueRoot, "roster-memberships.json"),
    draftPicksFile: path.join(leagueRoot, "draft-picks.json"),
    tradesFile: path.join(leagueRoot, "trades.json"),
    playerUpgradesFile: path.join(leagueRoot, "player-upgrades.json"),
    auditLogFile: path.join(leagueRoot, "audit-log.json"),
    pendingScheduleFile: path.join(leagueRoot, "pending-schedule.json"),
    schedulesRoot: path.join(leagueRoot, "schedules"),
    currentScheduleFile: path.join(leagueRoot, "current-schedule.json"),
  };
}

function resolveSeasonId(leagueRecord = {}, overrideSeasonId = null) {
  return String(
    overrideSeasonId
    || leagueRecord.currentSeasonId
    || process.env.FANTASYHQ_SEASON_ID
    || new Date().getFullYear(),
  ).trim();
}

function normalizeSchedule(schedule = {}) {
  const weeks = Array.isArray(schedule.weeks) ? schedule.weeks : [];
  return {
    leagueId: String(schedule.leagueId || "").trim(),
    seasonId: String(schedule.seasonId || "").trim(),
    generatedAt: String(schedule.generatedAt || "").trim(),
    savedAt: schedule.savedAt ? String(schedule.savedAt) : null,
    weeks,
  };
}

function normalizeLeagueRecord(leagueId, leagueRecord = {}) {
  const seasonId = resolveSeasonId(leagueRecord, leagueRecord.currentSeasonId || leagueRecord.seasonNumber || null);
  const numericSeason = Number(leagueRecord.seasonNumber || seasonId || 1);
  const now = new Date().toISOString();
  return {
    leagueId,
    name: String(leagueRecord.name || leagueRecord.leagueName || leagueId).trim(),
    leagueName: String(leagueRecord.leagueName || leagueRecord.name || leagueId).trim(),
    seasonNumber: Number.isFinite(numericSeason) ? numericSeason : 1,
    currentSeasonId: seasonId,
    commissionerUserId: leagueRecord.commissionerUserId ? String(leagueRecord.commissionerUserId) : null,
    guildId: leagueRecord.guildId ? String(leagueRecord.guildId) : null,
    currentPhase: String(leagueRecord.currentPhase || "SETUP").trim(),
    currentWeek: leagueRecord.currentWeek == null ? null : Number(leagueRecord.currentWeek),
    regularSeasonStatus: leagueRecord.regularSeasonStatus || null,
    regularSeasonCompletedAt: leagueRecord.regularSeasonCompletedAt || null,
    createdAt: String(leagueRecord.createdAt || now),
    updatedAt: String(leagueRecord.updatedAt || now),
  };
}

function loadListFile(filePath) {
  const payload = readJson(filePath, []);
  return Array.isArray(payload) ? payload : [];
}

function createFantasyHQRepository(options = {}) {
  const dataRoot = options.dataRoot || process.env.FANTASYHQ_DATA_ROOT || path.join(process.cwd(), "data", "fantasyhq");
  const guildLeaguesPath = path.join(dataRoot, "guild-leagues.json");

  function readGuildLeagueMap() {
    return readJson(guildLeaguesPath, {});
  }

  function writeGuildLeagueMap(map) {
    writeJson(guildLeaguesPath, map);
  }

  function resolveLeagueBinding({ guildId, leagueId = null, seasonId = null } = {}) {
    if (leagueId) {
      return {
        leagueId: String(leagueId).trim(),
        seasonId: seasonId ? String(seasonId).trim() : null,
      };
    }

    const guildMap = readGuildLeagueMap();
    const guildBinding = guildId ? guildMap[String(guildId)] : null;
    const resolvedLeagueId = String(
      guildBinding?.leagueId
      || process.env.FANTASYHQ_LEAGUE_ID
      || "",
    ).trim();

    if (!resolvedLeagueId) {
      throw new Error(
        "No FantasyHQ league is configured for this guild. Set data/fantasyhq/guild-leagues.json or FANTASYHQ_LEAGUE_ID.",
      );
    }

    return {
      leagueId: resolvedLeagueId,
      seasonId: String(seasonId || guildBinding?.seasonId || "").trim() || null,
    };
  }

  // The journal rename is the commit point. Readers finish an interrupted commit
  // before exposing league/week state. Files retain their existing schemas/paths.
  function recoverWeekTransaction(leagueId) {
    const paths = buildLeaguePaths(dataRoot, leagueId), journal = path.join(paths.leagueRoot, 'week-transaction.json');
    if (!fs.existsSync(journal)) return;
    const tx = JSON.parse(fs.readFileSync(journal, 'utf8'));
    writeJson(path.join(paths.schedulesRoot, `${tx.schedule.seasonId}.json`), tx.schedule);
    writeJson(paths.currentScheduleFile, tx.schedule);
    writeJson(paths.leagueFile, tx.league);
    writeJson(paths.auditLogFile, tx.audit);
    enqueueMockRefresh(leagueId, tx.audit.at(-1));
    fs.unlinkSync(journal);
  }
  function recoverTradeTransaction(leagueId) {
    const paths = buildLeaguePaths(dataRoot, leagueId);
    const journal = path.join(paths.leagueRoot, "trade-transaction.json");
    if (!fs.existsSync(journal)) return;
    const transaction = JSON.parse(fs.readFileSync(journal, "utf8"));
    if (transaction.leagueId !== leagueId || !Array.isArray(transaction.files)) throw new Error("Trade transaction journal is invalid; league data was not loaded.");
    const allowed = new Set(["players.json", "roster-memberships.json", "draft-picks.json", "trades.json", "audit-log.json"]);
    for (const entry of transaction.files) {
      if (!allowed.has(entry.name) || !entry.name || !entry.value) throw new Error("Trade transaction journal contains an invalid file entry.");
    }
    for (const entry of transaction.files) writeJson(path.join(paths.leagueRoot, entry.name), entry.value);
    enqueueMockRefresh(leagueId, transaction.files.find(entry => entry.name === 'audit-log.json')?.value.at(-1));
    fs.unlinkSync(journal);
  }
  function recoverPlayerUpgradeTransaction(leagueId) {
    const paths = buildLeaguePaths(dataRoot, leagueId);
    const journal = path.join(paths.leagueRoot, "player-upgrade-transaction.json");
    if (!fs.existsSync(journal)) return;
    const transaction = JSON.parse(fs.readFileSync(journal, "utf8"));
    if (transaction.leagueId !== leagueId || !Array.isArray(transaction.files)) throw new Error("Player upgrade transaction journal is invalid; league data was not loaded.");
    const allowed = new Set(["players.json", "player-upgrades.json", "audit-log.json"]);
    for (const entry of transaction.files) {
      if (!allowed.has(entry.name) || !entry.value) throw new Error("Player upgrade transaction journal contains an invalid file entry.");
    }
    for (const entry of transaction.files) writeJson(path.join(paths.leagueRoot, entry.name), entry.value);
    fs.unlinkSync(journal);
  }
  function enqueueMockRefresh(leagueId, event) {
    if (!event) return;
    let eventId = null;
    if (event.action === 'week.advanced') eventId = `week:${event.requestId}`;
    if (event.action === 'trade.completed') {
      const paths = buildLeaguePaths(dataRoot, leagueId), league = readJson(paths.leagueFile, {});
      const year = require('./asset-valuation').leagueSeasonStartYear(league.seasonNumber || league.currentSeasonId) + 1;
      if (loadListFile(paths.draftPicksFile).some(p => Number(p.round) === 1 && Number(p.draftYear) === year && event.metadata?.affectedPickIds?.includes(p.pickId))) eventId = `trade:${event.metadata.processingId}`;
    }
    if (eventId) try { require('./mock-storage').requestRefresh({ dataRoot, buildLeaguePaths }, leagueId, event.action, eventId); }
      catch (error) { console.error('Mock refresh enqueue (recoverable from audit):', error.message); }
  }
  function recoverLeagueTransactions(leagueId) {
    recoverWeekTransaction(leagueId);
    recoverTradeTransaction(leagueId);
    recoverPlayerUpgradeTransaction(leagueId);
  }
  function commitTradeTransaction({ leagueId, players, rosterMemberships, draftPicks, trades, auditEntry }) {
    recoverLeagueTransactions(leagueId);
    const paths = buildLeaguePaths(dataRoot, leagueId);
    const transaction = {
      leagueId,
      committedAt: new Date().toISOString(),
      files: [
        { name: "players.json", value: players },
        { name: "roster-memberships.json", value: rosterMemberships },
        { name: "draft-picks.json", value: draftPicks },
        { name: "trades.json", value: trades },
        { name: "audit-log.json", value: [...loadAuditLog(leagueId), auditEntry] },
      ],
    };
    const journal = path.join(paths.leagueRoot, "trade-transaction.json");
    writeJson(journal, transaction);
    recoverTradeTransaction(leagueId);
    return { committedAt: transaction.committedAt };
  }
  function commitPlayerUpgradeTransaction({ leagueId, players, upgradeState, auditEntry }) {
    recoverLeagueTransactions(leagueId);
    const paths = buildLeaguePaths(dataRoot, leagueId);
    const transaction = {
      leagueId,
      committedAt: new Date().toISOString(),
      files: [
        { name: "players.json", value: players },
        { name: "player-upgrades.json", value: upgradeState },
        { name: "audit-log.json", value: [...loadAuditLog(leagueId), auditEntry] },
      ],
    };
    writeJson(path.join(paths.leagueRoot, "player-upgrade-transaction.json"), transaction);
    recoverPlayerUpgradeTransaction(leagueId);
    return { committedAt: transaction.committedAt };
  }
  function commitWeekTransition({ leagueId, expectedWeek, schedule, league, auditEntry }) {
    const current = loadLeague(leagueId);
    if (current.league.currentWeek !== expectedWeek || current.seasonId !== schedule.seasonId) throw new Error('Week changed. Refresh and confirm again.');
    const paths = current.paths;
    const tx = { schedule: { ...schedule, savedAt: new Date().toISOString() }, league: normalizeLeagueRecord(leagueId, league), audit: [...loadAuditLog(leagueId), auditEntry] };
    writeJson(path.join(paths.leagueRoot, 'week-transaction.json'), tx);
    recoverWeekTransaction(leagueId);
  }

  function loadLeague(leagueId, seasonId = null) {
    recoverLeagueTransactions(leagueId);
    const paths = buildLeaguePaths(dataRoot, leagueId);
    if (!fs.existsSync(paths.leagueFile)) {
      throw new Error(`Missing FantasyHQ league file at ${paths.leagueFile}.`);
    }
    const leagueRecord = normalizeLeagueRecord(leagueId, readJson(paths.leagueFile, {}) || {});
    const rawTeams = readJson(paths.teamsFile, { teams: [] });

    const rawTeamList = Array.isArray(rawTeams) ? rawTeams : rawTeams.teams;
    if (!Array.isArray(rawTeamList)) {
      throw new Error(`FantasyHQ teams file at ${paths.teamsFile} must be an array or { "teams": [] }.`);
    }

    const teams = rawTeamList.map((team) => normalizeTeam(leagueId, team));
    const resolvedSeasonId = resolveSeasonId(leagueRecord, seasonId);

    return {
      league: {
        ...leagueRecord,
        currentSeasonId: resolvedSeasonId,
      },
      seasonId: resolvedSeasonId,
      teams,
      paths,
    };
  }

  function saveLeague(leagueId, leagueRecord = {}) {
    recoverWeekTransaction(leagueId);
    const paths = buildLeaguePaths(dataRoot, leagueId);
    const existingLeague = readJson(paths.leagueFile, {}) || {};
    const nextLeague = normalizeLeagueRecord(leagueId, {
      ...existingLeague,
      ...leagueRecord,
      updatedAt: new Date().toISOString(),
      createdAt: existingLeague.createdAt || leagueRecord.createdAt,
    });
    writeJson(paths.leagueFile, nextLeague);
    return nextLeague;
  }

  function saveTeams(leagueId, teams) {
    const paths = buildLeaguePaths(dataRoot, leagueId);
    writeJson(paths.teamsFile, { teams });
    return teams;
  }

  function loadGuildLeagueBinding(guildId) {
    const guildMap = readGuildLeagueMap();
    return guildMap[String(guildId)] || null;
  }

  function saveGuildLeagueBinding(guildId, binding) {
    const guildMap = readGuildLeagueMap();
    guildMap[String(guildId)] = {
      leagueId: String(binding.leagueId || "").trim(),
      seasonId: binding.seasonId ? String(binding.seasonId).trim() : null,
    };
    writeGuildLeagueMap(guildMap);
    return guildMap[String(guildId)];
  }

  function clearGuildLeagueBinding(guildId) {
    const guildMap = readGuildLeagueMap();
    delete guildMap[String(guildId)];
    writeGuildLeagueMap(guildMap);
  }

  function scheduleExists(leagueId, seasonId = null) {
    const { paths } = loadLeague(leagueId, seasonId);
    const resolvedSeasonId = resolveSeasonId(readJson(paths.leagueFile, {}) || {}, seasonId);
    return fs.existsSync(path.join(paths.schedulesRoot, `${resolvedSeasonId}.json`))
      || fs.existsSync(paths.currentScheduleFile);
  }

  function leagueExists(leagueId) {
    const paths = buildLeaguePaths(dataRoot, leagueId);
    return fs.existsSync(paths.leagueFile);
  }

  function loadLeagueContext(options = {}) {
    const binding = resolveLeagueBinding(options);
    return loadLeague(binding.leagueId, binding.seasonId);
  }

  function loadSchedule(leagueId, seasonId = null) {
    const { league, seasonId: resolvedSeasonId, paths } = loadLeague(leagueId, seasonId);
    const schedulePath = path.join(paths.schedulesRoot, `${resolvedSeasonId}.json`);
    const payload = readJson(schedulePath, null) || readJson(paths.currentScheduleFile, null);
    if (!payload) {
      throw new Error(`No saved schedule found for league ${league.leagueId} season ${resolvedSeasonId}.`);
    }
    return normalizeSchedule(payload);
  }

  function loadScheduleContext(options = {}) {
    const binding = resolveLeagueBinding(options);
    return loadSchedule(binding.leagueId, binding.seasonId);
  }

  function saveSchedule(schedule) {
    recoverWeekTransaction(schedule.leagueId);
    const normalized = normalizeSchedule(schedule);
    if (!normalized.leagueId) throw new Error("Cannot save schedule without leagueId.");
    if (!normalized.seasonId) throw new Error("Cannot save schedule without seasonId.");

    const paths = buildLeaguePaths(dataRoot, normalized.leagueId);
    const leagueRecord = readJson(paths.leagueFile, {}) || {};
    const payload = {
      ...normalized,
      savedAt: new Date().toISOString(),
    };

    ensureDir(paths.schedulesRoot);
    writeJson(path.join(paths.schedulesRoot, `${payload.seasonId}.json`), payload);
    writeJson(paths.currentScheduleFile, payload);
    writeJson(paths.leagueFile, {
      ...leagueRecord,
      leagueId: normalized.leagueId,
      name: leagueRecord.name || normalized.leagueId,
      currentSeasonId: normalized.seasonId,
    });

    return payload;
  }

  function loadPendingSchedule(leagueId) {
    const paths = buildLeaguePaths(dataRoot, leagueId);
    return readJson(paths.pendingScheduleFile, null);
  }

  function savePendingSchedule(leagueId, schedule) {
    const paths = buildLeaguePaths(dataRoot, leagueId);
    writeJson(paths.pendingScheduleFile, schedule);
    return schedule;
  }

  function clearPendingSchedule(leagueId) {
    const paths = buildLeaguePaths(dataRoot, leagueId);
    if (fs.existsSync(paths.pendingScheduleFile)) {
      fs.unlinkSync(paths.pendingScheduleFile);
    }
  }

  function loadSettings(leagueId) {
    recoverLeagueTransactions(leagueId);
    const paths = buildLeaguePaths(dataRoot, leagueId);
    return readJson(paths.settingsFile, null);
  }

  function saveSettings(leagueId, settings) {
    const paths = buildLeaguePaths(dataRoot, leagueId);
    writeJson(paths.settingsFile, settings);
    return settings;
  }

  function loadRoleOwnership(leagueId) {
    return readJson(path.join(buildLeaguePaths(dataRoot, leagueId).leagueRoot, "role-ownership.json"), { conflicts: [], warnings: [] });
  }

  function loadOwners(leagueId) {
    const paths = buildLeaguePaths(dataRoot, leagueId);
    return loadListFile(paths.ownersFile);
  }

  function saveOwners(leagueId, owners) {
    const paths = buildLeaguePaths(dataRoot, leagueId);
    writeJson(paths.ownersFile, owners);
    return owners;
  }

  function loadPlayers(leagueId) {
    recoverLeagueTransactions(leagueId);
    const paths = buildLeaguePaths(dataRoot, leagueId);
    return loadListFile(paths.playersFile);
  }

  function savePlayers(leagueId, players) {
    recoverLeagueTransactions(leagueId);
    const paths = buildLeaguePaths(dataRoot, leagueId);
    writeJson(paths.playersFile, players);
    return players;
  }

  function loadRosterMemberships(leagueId) {
    recoverLeagueTransactions(leagueId);
    const paths = buildLeaguePaths(dataRoot, leagueId);
    return loadListFile(paths.rosterMembershipsFile);
  }

  function saveRosterMemberships(leagueId, memberships) {
    recoverLeagueTransactions(leagueId);
    const paths = buildLeaguePaths(dataRoot, leagueId);
    writeJson(paths.rosterMembershipsFile, memberships);
    return memberships;
  }

  function loadAuditLog(leagueId) {
    recoverLeagueTransactions(leagueId);
    const paths = buildLeaguePaths(dataRoot, leagueId);
    return loadListFile(paths.auditLogFile);
  }

  function appendAuditLog(leagueId, entry) {
    recoverLeagueTransactions(leagueId);
    const paths = buildLeaguePaths(dataRoot, leagueId);
    const current = loadAuditLog(leagueId);
    current.push(entry);
    writeJson(paths.auditLogFile, current);
    return entry;
  }
  function loadPlayerUpgradeState(leagueId) {
    recoverLeagueTransactions(leagueId);
    return readJson(buildLeaguePaths(dataRoot, leagueId).playerUpgradesFile, null);
  }
  function savePlayerUpgradeState(leagueId, state) {
    recoverLeagueTransactions(leagueId);
    writeJson(buildLeaguePaths(dataRoot, leagueId).playerUpgradesFile, state);
    return state;
  }

  return {
    commitWeekTransition,
    commitTradeTransaction,
    commitPlayerUpgradeTransaction,
    appendAuditLog,
    buildLeaguePaths,
    clearPendingSchedule,
    dataRoot,
    guildLeaguesPath,
    clearGuildLeagueBinding,
    leagueExists,
    loadLeague,
    loadLeagueContext,
    loadGuildLeagueBinding,
    loadPendingSchedule,
    loadSettings,
    loadOwners,
    loadRoleOwnership,
    loadPlayers,
    loadRosterMemberships,
    loadAuditLog,
    loadPlayerUpgradeState,
    loadSchedule,
    loadDraftPicks(leagueId) { recoverLeagueTransactions(leagueId); return loadListFile(buildLeaguePaths(dataRoot, leagueId).draftPicksFile); },
    saveDraftPicks(leagueId, picks) { recoverLeagueTransactions(leagueId); writeJson(buildLeaguePaths(dataRoot, leagueId).draftPicksFile, picks); return picks; },
    loadTrades(leagueId) { recoverLeagueTransactions(leagueId); return loadListFile(buildLeaguePaths(dataRoot, leagueId).tradesFile); },
    saveTrades(leagueId, trades) { recoverLeagueTransactions(leagueId); writeJson(buildLeaguePaths(dataRoot, leagueId).tradesFile, trades); return trades; },
    loadScheduleContext,
    savePendingSchedule,
    saveGuildLeagueBinding,
    saveLeague,
    saveSchedule,
    saveSettings,
    saveOwners,
    savePlayers,
    saveRosterMemberships,
    savePlayerUpgradeState,
    saveTeams,
    scheduleExists,
  };
}

module.exports = {
  createFantasyHQRepository,
  normalizeConference,
};
