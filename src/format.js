function managerName(user) {
  if (!user) return "Unknown Manager";
  return user.metadata?.team_name || user.display_name || user.username || "Unknown Manager";
}

function byRosterId(items) {
  return new Map(items.map((item) => [item.roster_id, item]));
}

function byUserId(users) {
  return new Map(users.map((user) => [user.user_id, user]));
}

function formatRecord(settings = {}) {
  const wins = settings.wins ?? 0;
  const losses = settings.losses ?? 0;
  const ties = settings.ties ?? 0;
  return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

function formatPoints(settings = {}) {
  const whole = settings.fpts ?? 0;
  const decimal = settings.fpts_decimal ?? 0;
  return (whole + decimal / 100).toFixed(2);
}

function sortStandings(rosters) {
  return [...rosters].sort((a, b) => {
    const bWins = b.settings?.wins ?? 0;
    const aWins = a.settings?.wins ?? 0;
    if (bWins !== aWins) return bWins - aWins;
    return Number(formatPoints(b.settings)) - Number(formatPoints(a.settings));
  });
}

function playerLabel(playerId, players) {
  const player = players[playerId];
  if (!player) return playerId;
  const name = player.full_name || `${player.first_name || ""} ${player.last_name || ""}`.trim() || playerId;
  const position = player.position ? ` ${player.position}` : "";
  const team = player.team ? ` - ${player.team}` : "";
  return `${name}${position}${team}`;
}

function findRosterByTeam(query, users, rosters) {
  const normalized = query.trim().toLowerCase();
  const userMap = byUserId(users);

  return rosters.find((roster) => {
    const user = userMap.get(roster.owner_id);
    const names = [
      user?.metadata?.team_name,
      user?.display_name,
      user?.username,
    ].filter(Boolean);

    return names.some((name) => name.toLowerCase().includes(normalized));
  });
}

function chunkLines(lines, maxLength = 3900) {
  const chunks = [];
  let current = "";

  for (const line of lines) {
    if (`${current}\n${line}`.length > maxLength) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

module.exports = {
  byRosterId,
  byUserId,
  chunkLines,
  findRosterByTeam,
  formatPoints,
  formatRecord,
  managerName,
  playerLabel,
  sortStandings,
};
