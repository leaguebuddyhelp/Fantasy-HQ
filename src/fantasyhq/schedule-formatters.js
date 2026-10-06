function teamMapFromTeams(teams) {
  return new Map(teams.map((team) => [team.teamId, team]));
}

function findTeamByQuery(teams, query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return null;

  return teams.find((team) => String(team.teamId).toLowerCase() === normalized)
    || teams.find((team) => String(team.abbreviation).toLowerCase() === normalized)
    || teams.find((team) => String(team.teamName).toLowerCase() === normalized)
    || teams.find((team) => String(team.teamName).toLowerCase().includes(normalized));
}

function summarizeSchedule(schedule) {
  const weeks = Array.isArray(schedule.weeks) ? schedule.weeks : [];
  const totalGames = weeks.reduce((count, week) => count + (Array.isArray(week.games) ? week.games.length : 0), 0);
  return {
    weekCount: weeks.length,
    totalGames,
    gamesPerWeek: weeks[0]?.games?.length || 0,
    byesPerWeek: weeks[0]?.byes?.length || 0,
  };
}

function formatConferenceGames(week, teamMap, conference) {
  return week.games
    .filter((game) => game.conference === conference)
    .map((game) => `${teamMap.get(game.team1Id)?.teamName || game.team1Id} vs ${teamMap.get(game.team2Id)?.teamName || game.team2Id}`);
}

function formatWeekText(schedule, teams, weekNumber) {
  const teamMap = teamMapFromTeams(teams);
  const week = schedule.weeks.find((entry) => entry.week === weekNumber);
  if (!week) throw new Error(`Week ${weekNumber} was not found.`);

  const eastGames = formatConferenceGames(week, teamMap, "East");
  const westGames = formatConferenceGames(week, teamMap, "West");
  const eastBye = week.byes.find((bye) => bye.conference === "East");
  const westBye = week.byes.find((bye) => bye.conference === "West");

  return [
    `WEEK ${week.week}`,
    "",
    "EAST",
    ...eastGames,
    "",
    `BYE: ${teamMap.get(eastBye?.teamId)?.teamName || eastBye?.teamId || "Unknown"}`,
    "",
    "WEST",
    ...westGames,
    "",
    `BYE: ${teamMap.get(westBye?.teamId)?.teamName || westBye?.teamId || "Unknown"}`,
  ].join("\n");
}

function formatTeamScheduleText(schedule, teams, team) {
  const teamMap = teamMapFromTeams(teams);
  const lines = schedule.weeks.map((week) => {
    const game = week.games.find((entry) => entry.team1Id === team.teamId || entry.team2Id === team.teamId);
    if (!game) return `Week ${week.week}: BYE`;
    const opponentTeamId = game.team1Id === team.teamId ? game.team2Id : game.team1Id;
    const opponent = teamMap.get(opponentTeamId);
    return `Week ${week.week}: ${team.teamName} vs ${opponent?.teamName || opponentTeamId}`;
  });

  return [`${team.teamName} (${team.abbreviation})`, ...lines].join("\n");
}

function formatFullScheduleText(schedule, teams) {
  return schedule.weeks.map((week) => formatWeekText(schedule, teams, week.week)).join("\n\n");
}

module.exports = {
  findTeamByQuery,
  formatFullScheduleText,
  formatTeamScheduleText,
  formatWeekText,
  summarizeSchedule,
};
