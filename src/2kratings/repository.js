const fs = require("fs");
const path = require("path");

const DATA_ROOT = path.join(process.cwd(), "data", "2kratings");
const ROSTERS_ROOT = path.join(DATA_ROOT, "rosters");
const FREE_AGENCY_ROOT = path.join(DATA_ROOT, "free-agency");

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value) {
  return normalizeText(value).replace(/\s+/g, "-");
}

function existingDateDirectories(rootDirectory) {
  if (!fs.existsSync(rootDirectory)) return [];
  return fs.readdirSync(rootDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
}

function latestDate(rootDirectory) {
  return existingDateDirectories(rootDirectory)[0] || null;
}

function latestSnapshot() {
  const rosterDate = latestDate(ROSTERS_ROOT);
  const freeAgencyDate = latestDate(FREE_AGENCY_ROOT);
  return {
    rosterDate,
    freeAgencyDate,
    rosterDirectory: rosterDate ? path.join(ROSTERS_ROOT, rosterDate) : null,
    freeAgencyFile: freeAgencyDate ? path.join(FREE_AGENCY_ROOT, freeAgencyDate, "free-agency.json") : null,
  };
}

function latestRosterFiles() {
  const snapshot = latestSnapshot();
  if (!snapshot.rosterDirectory || !fs.existsSync(snapshot.rosterDirectory)) return [];
  return fs.readdirSync(snapshot.rosterDirectory)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));
}

function loadTeams() {
  const snapshot = latestSnapshot();
  return latestRosterFiles()
    .map((fileName) => readJson(path.join(snapshot.rosterDirectory, fileName), null))
    .filter(Boolean)
    .map((payload) => ({
      name: payload.team?.name || "Unknown Team",
      slug: payload.team?.slug || slugify(payload.team?.name || path.basename(payload.team?.url || "", ".json")),
      url: payload.team?.url || null,
      rosterDate: payload.rosterDate || snapshot.rosterDate,
      playerCount: Number(payload.playerCount || payload.players?.length || 0),
      filePath: path.join(snapshot.rosterDirectory, `${payload.team?.slug || slugify(payload.team?.name || "")}.json`),
    }));
}

function loadTeamRoster(query) {
  const teams = loadTeams();
  const normalized = normalizeText(query);
  const team = teams.find((entry) => normalizeText(entry.name) === normalized)
    || teams.find((entry) => entry.slug === slugify(query))
    || teams.find((entry) => normalizeText(entry.name).includes(normalized));

  if (!team) return null;
  return readJson(team.filePath, null);
}

function loadFreeAgency() {
  const snapshot = latestSnapshot();
  if (!snapshot.freeAgencyFile) return null;
  return readJson(snapshot.freeAgencyFile, null);
}

function loadAllPlayers({ includeFreeAgency = true } = {}) {
  const teams = loadTeams();
  const players = [];

  for (const team of teams) {
    const payload = readJson(team.filePath, null);
    if (!payload?.players) continue;
    for (const player of payload.players) {
      players.push(player);
    }
  }

  if (includeFreeAgency) {
    const freeAgency = loadFreeAgency();
    for (const player of freeAgency?.players || []) {
      players.push(player);
    }
  }

  return players;
}

function sortPlayersByOverall(players) {
  return [...players].sort((left, right) => {
    const overallDelta = Number(right.overall || 0) - Number(left.overall || 0);
    if (overallDelta !== 0) return overallDelta;
    return String(left.name || "").localeCompare(String(right.name || ""));
  });
}

function filterByPosition(players, position = null) {
  if (!position) return players;
  const normalized = String(position).trim().toUpperCase();
  return players.filter((player) => player.position1 === normalized || player.position2 === normalized);
}

function topPlayers({ limit = 10, position = null, includeFreeAgency = false } = {}) {
  const players = filterByPosition(loadAllPlayers({ includeFreeAgency }), position);
  return sortPlayersByOverall(players).slice(0, Math.max(1, limit));
}

function topFreeAgents({ limit = 10, position = null } = {}) {
  const freeAgency = loadFreeAgency();
  const players = filterByPosition(freeAgency?.players || [], position);
  return sortPlayersByOverall(players).slice(0, Math.max(1, limit));
}

function findPlayer(query) {
  const normalized = normalizeText(query);
  const players = loadAllPlayers({ includeFreeAgency: true });
  return players.find((player) => normalizeText(player.name) === normalized)
    || players.find((player) => slugify(player.name) === slugify(query))
    || players.find((player) => normalizeText(player.name).includes(normalized))
    || null;
}

module.exports = {
  DATA_ROOT,
  FREE_AGENCY_ROOT,
  ROSTERS_ROOT,
  findPlayer,
  latestSnapshot,
  loadAllPlayers,
  loadFreeAgency,
  loadTeamRoster,
  loadTeams,
  normalizeText,
  slugify,
  topFreeAgents,
  topPlayers,
};
