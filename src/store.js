const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "guilds.json");
const PLAYER_STATS_PATH = path.join(DATA_DIR, "player-stats.json");

function readStore() {
  if (!fs.existsSync(STORE_PATH)) {
    return { guilds: {} };
  }

  const raw = fs.readFileSync(STORE_PATH, "utf8");
  if (!raw.trim()) {
    return { guilds: {} };
  }

  return JSON.parse(raw);
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`);
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return fallback;
  }

  return JSON.parse(raw);
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function getGuildConfig(guildId) {
  const store = readStore();
  return store.guilds[guildId] || null;
}

function setGuildLeague(guildId, league) {
  const store = readStore();
  store.guilds[guildId] = {
    leagueId: league.league_id,
    leagueName: league.name || "Sleeper League",
    season: String(league.season || ""),
    sport: league.sport || "",
    connectedAt: new Date().toISOString(),
  };
  writeStore(store);
  return store.guilds[guildId];
}

function playerStatsKey(leagueId, season, playerId) {
  return `${leagueId}:${season}:${playerId}`;
}

function getPlayerStatsSnapshot(leagueId, season, playerId) {
  const store = readJsonFile(PLAYER_STATS_PATH, { players: {} });
  return store.players[playerStatsKey(leagueId, season, playerId)] || null;
}

function setPlayerStatsSnapshot(leagueId, season, playerId, snapshot) {
  const store = readJsonFile(PLAYER_STATS_PATH, { players: {} });
  store.players[playerStatsKey(leagueId, season, playerId)] = {
    ...snapshot,
    leagueId,
    season: String(season),
    playerId: String(playerId),
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(PLAYER_STATS_PATH, store);
  return store.players[playerStatsKey(leagueId, season, playerId)];
}

module.exports = {
  getGuildConfig,
  getPlayerStatsSnapshot,
  setGuildLeague,
  setPlayerStatsSnapshot,
};
