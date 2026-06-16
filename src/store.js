const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "guilds.json");

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
    connectedAt: new Date().toISOString(),
  };
  writeStore(store);
  return store.guilds[guildId];
}

module.exports = {
  getGuildConfig,
  setGuildLeague,
};
