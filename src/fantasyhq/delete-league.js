const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

// Game archives live outside the league folder. Select by stored league ID,
// across every season; never infer ownership from a Discord server or filename.
function gameDirectories(repository, leagueId) {
  const root = path.resolve(repository.dataRoot, 'game-history');
  if (!fs.existsSync(root)) return [];
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Unsafe game history directory.');
  const matches = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!/^[a-f0-9-]{36}$/.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('Unsafe game archive. League deletion stopped.');
    const recordFile = path.join(directory, 'record.json');
    if (fs.lstatSync(recordFile).isSymbolicLink()) throw new Error('Unsafe game record. League deletion stopped.');
    let record;
    try { record = JSON.parse(fs.readFileSync(recordFile, 'utf8')); }
    catch { throw new Error(`Cannot read game archive ${entry.name}. Repair it before deleting the league.`); }
    if (!record.game?.leagueId) throw new Error(`Game archive ${entry.name} has no league ID. League deletion stopped.`);
    if (record.game.leagueId === leagueId) matches.push(directory);
  }
  return matches;
}

function inspectDeletion(repository, guildId) {
  const binding = repository.loadGuildLeagueBinding(guildId);
  if (!binding?.leagueId) throw new Error("No league is bound to this server.");
  const leagueId = binding.leagueId;
  if (!/^[a-zA-Z0-9_-]+$/.test(leagueId)) throw new Error("This league ID cannot be deleted through Discord.");
  const root = path.resolve(repository.dataRoot, "leagues");
  const directory = path.join(root, leagueId);
  if (!fs.existsSync(directory)) throw new Error("League directory is missing.");
  if (fs.lstatSync(directory).isSymbolicLink() || path.dirname(fs.realpathSync(directory)) !== fs.realpathSync(root)) throw new Error("Unsafe league directory.");
  const bindings = JSON.parse(fs.readFileSync(repository.guildLeaguesPath, "utf8"));
  if (Object.entries(bindings).some(([id, entry]) => id !== guildId && entry.leagueId === leagueId)) throw new Error("This league is also bound to another server. Remove its other binding before deleting it.");
  const context = repository.loadLeague(leagueId);
  const stat = fs.statSync(context.paths.leagueFile);
  return { leagueId, name: context.league.leagueName, directory, bindings, fingerprint: `${stat.ino}:${stat.mtimeMs}`, players: repository.loadPlayers(leagueId).length, teams: context.teams.length, gameDirectories: gameDirectories(repository, leagueId) };
}

function deleteBoundLeague(repository, guildId, expected) {
  const current = inspectDeletion(repository, guildId);
  if (current.leagueId !== expected.leagueId || current.fingerprint !== expected.fingerprint) throw new Error("The league changed. Run /league delete again to review it.");
  const staging = path.join(repository.dataRoot, `.deleting-${randomUUID()}`);
  fs.mkdirSync(staging);
  const moved = [];
  try {
    for (const [index, source] of [current.directory, ...current.gameDirectories].entries()) {
      const destination = path.join(staging, String(index));
      fs.renameSync(source, destination);
      moved.push({ source, destination });
    }
    repository.clearGuildLeagueBinding(guildId);
  } catch (error) {
    for (const { source, destination } of moved.reverse()) fs.renameSync(destination, source);
    fs.rmdirSync(staging);
    throw error;
  }
  try { fs.rmSync(staging, { recursive: true, force: true }); }
  catch { return { ...current, cleanupPending: true }; }
  return { ...current, cleanupPending: false };
}
module.exports = { inspectDeletion, deleteBoundLeague };
