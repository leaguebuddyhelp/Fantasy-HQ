const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const TRANSACTION_FILES = new Set([
  'players.json', 'roster-memberships.json', 'draft-picks.json', 'trades.json',
  'free-agency.json', 'audit-log.json', 'league.json', 'playoffs.json', 'thread-cleanup-confirmations.json',
  'coach-web-sessions.json', 'sportsbook.json', 'news.json', 'power-rankings.json', 'player-upgrades.json', 'awards.json', 'championships.json', 'offseason.json',
]);
function validateTransactionFiles(files) {
  if (!Array.isArray(files) || !files.length) throw Error('Transaction requires file entries.');
  const names = new Set();
  for (const entry of files) {
    if (!entry || typeof entry.name !== 'string' || names.has(entry.name)
      || (!TRANSACTION_FILES.has(entry.name) && !/^(schedules|postseason|season-archives)\/[a-zA-Z0-9_-]+\.json$/.test(entry.name) && entry.name !== 'current-schedule.json')
      || !entry.value || typeof entry.value !== 'object') throw Error('Transaction contains an invalid file entry.');
    if (['players.json', 'roster-memberships.json', 'draft-picks.json', 'trades.json', 'audit-log.json'].includes(entry.name) && !Array.isArray(entry.value)) throw Error('Transaction array schema is invalid.');
    if (entry.name === 'coach-web-sessions.json') require('./coach-web-session').validateSessions(entry.value);
    if (entry.name === 'sportsbook.json') require('./sportsbook-service').validateSportsbook(entry.value);
    if (entry.name === 'news.json') require('./news-service').validateNews(entry.value);
    if (entry.name === 'power-rankings.json') require('./power-rankings').validateRankings(entry.value);
    if (entry.name === 'offseason.json') require('./offseason-state').validateOffseason(entry.value);
    if ((entry.name.startsWith('schedules/') || entry.name === 'current-schedule.json') && !Array.isArray(entry.value.weeks)) throw Error('Transaction schedule schema is invalid.');
    names.add(entry.name);
  }
}

function normalizeConference(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["east", "eastern", "eastern conference"].includes(normalized)) return "East";
  if (["west", "western", "western conference"].includes(normalized)) return "West";
  throw new Error(`Unsupported conference value "${value}". Expected East or West.`);
}

function readJson(filePath, fallback = null) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const name = path.basename(filePath);
    if (['players.json','roster-memberships.json','draft-picks.json','trades.json','audit-log.json','owners.json'].includes(name) && !Array.isArray(value)) throw Error('Invalid schema: expected an array.');
    if (['league.json','settings.json','free-agency.json','player-upgrades.json','guild-leagues.json','role-ownership.json'].includes(name) && (!value || typeof value !== 'object' || Array.isArray(value))) throw Error('Expected an object.');
    if (name === 'free-agency.json' && ['windows','offers','waivers'].some(k => !Array.isArray(value[k])) || (name === 'free-agency.json' && ['drafts','deliveries'].some(k => k in value && !Array.isArray(value[k])))) throw Error('Invalid free agency collections.');
    if ((path.basename(path.dirname(filePath)) === 'schedules' || name === 'current-schedule.json') && (!value || !Array.isArray(value.weeks))) throw Error('Expected schedule weeks.');
    if (name === 'player-upgrades.json' && ['tenures','requests','newUserEntitlements'].some(k => k in value && !Array.isArray(value[k]))) throw Error('Invalid upgrade collections.');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback);
    throw new Error(`Cannot read league storage ${filePath}: ${error.message}. Existing data was preserved; restore or repair this file before continuing.`, { cause: error });
  }
}

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function writeJson(filePath, value) {
  require('./storage-safety').assertWriterLease(filePath);
  // Never replace unreadable canonical storage with an empty/default state.
  if (fs.existsSync(filePath)) readJson(filePath);
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
    ...(schedule.statsPublication ? { statsPublication: structuredClone(schedule.statsPublication) } : {}),
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
  if (!Array.isArray(payload)) throw new Error(`Invalid league storage ${filePath}: expected an array. Existing data was preserved.`);
  if (payload.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry))) throw Error(`Invalid league storage ${filePath}: expected object records. Existing data was preserved.`);
  return payload;
}

function createFantasyHQRepository(options = {}) {
  const dataRoot = options.dataRoot || process.env.FANTASYHQ_DATA_ROOT || path.join(process.cwd(), "data", "fantasyhq");
  const guildLeaguesPath = path.join(dataRoot, "guild-leagues.json");

  function readGuildLeagueMap() {
    const value = readJson(guildLeaguesPath, {});
    if (!value || Array.isArray(value) || typeof value !== 'object') throw Error('Invalid guild league bindings; repair storage before continuing.');
    return value;
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

    let guildMap = readGuildLeagueMap();
    if(guildId && guildMap[String(guildId)]?.leagueId){recoverLeagueTransactions(guildMap[String(guildId)].leagueId);guildMap=readGuildLeagueMap();}
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
    if (tx.awards && (tx.awards.version !== 1 || !tx.awards.seasons || typeof tx.awards.seasons !== 'object' || Array.isArray(tx.awards.seasons))) throw Error('Invalid weekly awards journal.');
    writeJson(path.join(paths.schedulesRoot, `${tx.schedule.seasonId}.json`), tx.schedule);
    writeJson(paths.currentScheduleFile, tx.schedule);
    writeJson(paths.leagueFile, tx.league);
    writeJson(paths.auditLogFile, tx.audit);
    if (tx.awards) writeJson(path.join(paths.leagueRoot, 'awards.json'), tx.awards);
    enqueueMockRefresh(leagueId, tx.audit.at(-1));
    fs.unlinkSync(journal);
  }
  function recoverTradeTransaction(leagueId) {
    const paths = buildLeaguePaths(dataRoot, leagueId);
    const journal = path.join(paths.leagueRoot, "trade-transaction.json");
    if (!fs.existsSync(journal)) return;
    const transaction = JSON.parse(fs.readFileSync(journal, "utf8"));
    if (transaction.leagueId !== leagueId || !Array.isArray(transaction.files)) throw new Error("Trade transaction journal is invalid; league data was not loaded.");
    validateTransactionFiles(transaction.files);
    for (const entry of transaction.files) {
      const file = path.join(paths.leagueRoot, entry.name);
      if (entry.name.startsWith('season-archives/') && fs.existsSync(file) && JSON.stringify(readJson(file)) !== JSON.stringify(entry.value)) throw Error('Season archives are immutable.');
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
  function recoverResetTransaction(leagueId) {
    const paths=buildLeaguePaths(dataRoot,leagueId),file=path.join(paths.leagueRoot,'reset-transaction.json');if(!fs.existsSync(file))return;
    const tx=readJson(file);
    if(tx.leagueId!==leagueId||!Array.isArray(tx.files)||!/^[a-zA-Z0-9_-]+$/.test(String(tx.seasonId || '')))throw Error('Invalid reset journal.');
    validateTransactionFiles(tx.files);
    for(const entry of tx.files)writeJson(path.join(paths.leagueRoot,entry.name),entry.value);
    const map=readGuildLeagueMap();for(const binding of Object.values(map))if(binding.leagueId===leagueId)binding.seasonId=tx.seasonId;writeGuildLeagueMap(map);fs.unlinkSync(file);
  }
  function recoverLeagueTransactions(leagueId) {
    recoverResetTransaction(leagueId);
    recoverWeekTransaction(leagueId);
    recoverTradeTransaction(leagueId);
    recoverPlayerUpgradeTransaction(leagueId);
  }
  function commitTradeTransaction({ leagueId, players, rosterMemberships, draftPicks, trades, auditEntry, auditEntries = [], freeAgencyState = null }) {
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
        ...(freeAgencyState ? [{ name: "free-agency.json", value: freeAgencyState }] : []),
        { name: "audit-log.json", value: [...loadAuditLog(leagueId), ...auditEntries, auditEntry] },
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
  function commitWeekTransition({ leagueId, expectedWeek, schedule, league, auditEntry, awards = null }) {
    const current = loadLeague(leagueId);
    if (current.league.currentWeek !== expectedWeek || current.seasonId !== schedule.seasonId) throw new Error('Week changed. Refresh and confirm again.');
    const paths = current.paths;
    const tx = { schedule: { ...schedule, savedAt: new Date().toISOString() }, league: normalizeLeagueRecord(leagueId, league), audit: [...loadAuditLog(leagueId), auditEntry] };
    if (awards) { if (awards.version !== 1 || !awards.seasons || typeof awards.seasons !== 'object' || Array.isArray(awards.seasons)) throw Error('Invalid weekly awards.'); tx.awards = awards; }
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
    if (fs.existsSync(path.join(paths.schedulesRoot, `${resolvedSeasonId}.json`))) return true;
    if (!fs.existsSync(paths.currentScheduleFile)) return false;
    const current = readJson(paths.currentScheduleFile, {});
    const currentSeasonId = current.seasonId || readJson(paths.leagueFile, {}).currentSeasonId;
    return String(currentSeasonId) === String(resolvedSeasonId);
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
    const legacy = readJson(paths.currentScheduleFile, null);
    const legacySeasonId = legacy?.seasonId || league.currentSeasonId;
    const payload = readJson(schedulePath, null)
      || (String(legacySeasonId) === String(resolvedSeasonId) ? legacy : null);
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
    // Reuse the existing journal and recovery path for additive lifecycle files.
    loadThreadCleanupConfirmations(leagueId) {
      recoverLeagueTransactions(leagueId);
      return readJson(path.join(buildLeaguePaths(dataRoot, leagueId).leagueRoot, 'thread-cleanup-confirmations.json'), {});
    },
    commitLeagueFiles({ leagueId, files }) {
      recoverLeagueTransactions(leagueId);
      validateTransactionFiles(files);
      for (const entry of files) {
        const file = path.join(buildLeaguePaths(dataRoot, leagueId).leagueRoot, entry.name);
        if (fs.existsSync(file)) {
          const current = readJson(file);
          if (entry.name.startsWith('season-archives/') && JSON.stringify(current) !== JSON.stringify(entry.value)) throw Error('Season archives are immutable.');
        }
      }
      writeJson(path.join(buildLeaguePaths(dataRoot, leagueId).leagueRoot, 'trade-transaction.json'), { leagueId, files, committedAt: new Date().toISOString() });
      recoverTradeTransaction(leagueId);
    },
    loadOffseason(leagueId) {
      recoverLeagueTransactions(leagueId);
      const state = readJson(path.join(buildLeaguePaths(dataRoot, leagueId).leagueRoot, 'offseason.json'), null);
      if (state) require('./offseason-state').validateOffseason(state);
      return state;
    },
    loadSeasonArchive(leagueId, seasonId) {
      recoverLeagueTransactions(leagueId);
      if (!/^[a-zA-Z0-9_-]+$/.test(String(seasonId))) throw Error('Invalid archive season ID.');
      return readJson(path.join(buildLeaguePaths(dataRoot, leagueId).leagueRoot, 'season-archives', `${seasonId}.json`), null);
    },
    commitRosterTransaction({ leagueId, players, rosterMemberships, auditEntry }) {
      return commitTradeTransaction({ leagueId, players, rosterMemberships, draftPicks: loadListFile(buildLeaguePaths(dataRoot, leagueId).draftPicksFile), trades: loadListFile(buildLeaguePaths(dataRoot, leagueId).tradesFile), auditEntry });
    },
    loadFreeAgencyState(leagueId) { recoverLeagueTransactions(leagueId); return { drafts: [], deliveries: [], ...readJson(path.join(buildLeaguePaths(dataRoot, leagueId).leagueRoot, 'free-agency.json'), { version: 1, windows: [], offers: [], waivers: [], drafts: [], deliveries: [] }) }; },
    saveFreeAgencyState(leagueId, state) { recoverLeagueTransactions(leagueId); writeJson(path.join(buildLeaguePaths(dataRoot, leagueId).leagueRoot, 'free-agency.json'), state); return state; },
    commitSeasonTransition({ leagueId, league, playoffs, upgradeState, schedule, auditEntry }) {
      recoverLeagueTransactions(leagueId);
      if (!/^[a-zA-Z0-9_-]+$/.test(playoffs.seasonId)) throw Error('Invalid postseason season ID.');
      const files = [{ name: 'league.json', value: normalizeLeagueRecord(leagueId, league) }, { name: 'playoffs.json', value: playoffs }, { name: `postseason/${playoffs.seasonId}.json`, value: playoffs }, { name: 'audit-log.json', value: [...loadAuditLog(leagueId), auditEntry] }];
      if (upgradeState) files.push({ name: 'player-upgrades.json', value: upgradeState });
      if (schedule) files.push({ name: 'current-schedule.json', value: schedule }, { name: `schedules/${schedule.seasonId}.json`, value: schedule });
      writeJson(path.join(buildLeaguePaths(dataRoot, leagueId).leagueRoot, 'trade-transaction.json'), { leagueId, files, committedAt: new Date().toISOString() });
      recoverTradeTransaction(leagueId);
    },
    commitReset({leagueId,seasonId,files}) {recoverLeagueTransactions(leagueId);validateTransactionFiles(files);if(!/^[a-zA-Z0-9_-]+$/.test(String(seasonId || '')))throw Error('Invalid reset season ID.');writeJson(path.join(buildLeaguePaths(dataRoot,leagueId).leagueRoot,'reset-transaction.json'),{leagueId,seasonId,files});recoverResetTransaction(leagueId);return loadLeague(leagueId);},
    loadChampionships(leagueId) { recoverLeagueTransactions(leagueId); return readJson(path.join(buildLeaguePaths(dataRoot,leagueId).leagueRoot,'championships.json'),{version:1,seasons:{}}); },
    loadCoachWebSessions(leagueId) { recoverLeagueTransactions(leagueId); return require('./coach-web-session').validateSessions(readJson(path.join(buildLeaguePaths(dataRoot,leagueId).leagueRoot,'coach-web-sessions.json'),{version:1,links:[],sessions:[]})); },
    loadSportsbook(leagueId) { recoverLeagueTransactions(leagueId); return require('./sportsbook-service').validateSportsbook(readJson(path.join(buildLeaguePaths(dataRoot,leagueId).leagueRoot,'sportsbook.json'),{version:1,wallets:{},bets:[],markets:[],ledger:[],previews:[]})); },
    loadNews(leagueId) { recoverLeagueTransactions(leagueId); return require('./news-service').validateNews(readJson(path.join(buildLeaguePaths(dataRoot,leagueId).leagueRoot,'news.json'),{version:1,articles:[]})); },
    loadPowerRankings(leagueId) { recoverLeagueTransactions(leagueId); return require('./power-rankings').validateRankings(readJson(path.join(buildLeaguePaths(dataRoot,leagueId).leagueRoot,'power-rankings.json'),{version:1,seasons:{}})); },
    loadAwards(leagueId) { recoverLeagueTransactions(leagueId); return readJson(path.join(buildLeaguePaths(dataRoot,leagueId).leagueRoot,'awards.json'),{version:1,seasons:{}}); },
    commitAwards({leagueId,awards,auditEntry}) {
      recoverLeagueTransactions(leagueId);
      if(awards?.version!==1 || !awards.seasons || typeof awards.seasons!=='object' || Array.isArray(awards.seasons))throw Error('Invalid awards state.');
      const files=[{name:'awards.json',value:awards},{name:'audit-log.json',value:[...loadAuditLog(leagueId),auditEntry]}];
      writeJson(path.join(buildLeaguePaths(dataRoot,leagueId).leagueRoot,'trade-transaction.json'),{leagueId,files,committedAt:new Date().toISOString()});recoverTradeTransaction(leagueId);return awards;
    },
    commitPostseason({ leagueId, playoffs, auditEntry, league = null, championships = null }) {
      require('./postseason-state').validatePostseason(playoffs);
      recoverLeagueTransactions(leagueId);
      if (!/^[a-zA-Z0-9_-]+$/.test(playoffs.seasonId)) throw Error('Invalid postseason season ID.');
      const files = [{ name: 'playoffs.json', value: playoffs }, { name: `postseason/${playoffs.seasonId}.json`, value: playoffs }, { name: 'audit-log.json', value: [...loadAuditLog(leagueId), auditEntry] }];
      if (championships) files.push({name:'championships.json',value:championships});
      if (league) files.push({ name: 'league.json', value: normalizeLeagueRecord(leagueId, league) });
      writeJson(path.join(buildLeaguePaths(dataRoot, leagueId).leagueRoot, 'trade-transaction.json'), { leagueId, files, committedAt: new Date().toISOString() });
      recoverTradeTransaction(leagueId);
      return playoffs;
    },
    loadPlayoffs(leagueId, seasonId = null) { recoverLeagueTransactions(leagueId); const root = buildLeaguePaths(dataRoot,leagueId).leagueRoot; if (seasonId != null && !/^[a-zA-Z0-9_-]+$/.test(String(seasonId))) throw Error('Invalid season ID.'); const current = readJson(path.join(root,'playoffs.json'),null); return seasonId == null ? current : readJson(path.join(root,'postseason',`${seasonId}.json`),null) || (current?.seasonId === String(seasonId) ? current : null); },
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
    saveRoleOwnership(leagueId,state) { writeJson(path.join(buildLeaguePaths(dataRoot,leagueId).leagueRoot,'role-ownership.json'),state); return state; },
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
