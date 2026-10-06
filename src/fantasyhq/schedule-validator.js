function matchupKey(teamA, teamB) {
  return [teamA, teamB].sort().join("::");
}

function validateSchedule(schedule, teams) {
  const errors = [];
  const weeks = Array.isArray(schedule?.weeks) ? schedule.weeks : [];
  const teamMap = new Map(teams.map((team) => [team.teamId, team]));
  const eastTeams = teams.filter((team) => team.conference === "East");
  const westTeams = teams.filter((team) => team.conference === "West");

  const gamesPerTeam = new Map(teams.map((team) => [team.teamId, 0]));
  const byesPerTeam = new Map(teams.map((team) => [team.teamId, 0]));
  const byeWeeksPerTeam = new Map(teams.map((team) => [team.teamId, new Set()]));
  const opponentsPerTeam = new Map(teams.map((team) => [team.teamId, new Set()]));
  const matchupSet = new Set();

  function addError(message) {
    errors.push(message);
  }

  if (teams.length !== 30) addError(`Expected 30 teams, found ${teams.length}.`);
  if (eastTeams.length !== 15) addError(`Expected 15 East teams, found ${eastTeams.length}.`);
  if (westTeams.length !== 15) addError(`Expected 15 West teams, found ${westTeams.length}.`);
  if (weeks.length !== 15) addError(`Expected 15 weeks, found ${weeks.length}.`);

  let totalGames = 0;

  weeks.forEach((week) => {
    const weeklyAppearances = new Set();
    const games = Array.isArray(week.games) ? week.games : [];
    const byes = Array.isArray(week.byes) ? week.byes : [];
    const eastByeCount = byes.filter((bye) => bye.conference === "East").length;
    const westByeCount = byes.filter((bye) => bye.conference === "West").length;

    if (games.length !== 14) addError(`Week ${week.week} should have 14 games, found ${games.length}.`);
    if (byes.length !== 2) addError(`Week ${week.week} should have 2 byes, found ${byes.length}.`);
    if (eastByeCount !== 1) addError(`Week ${week.week} should have exactly 1 East bye, found ${eastByeCount}.`);
    if (westByeCount !== 1) addError(`Week ${week.week} should have exactly 1 West bye, found ${westByeCount}.`);

    games.forEach((game) => {
      totalGames += 1;
      const team1 = teamMap.get(game.team1Id);
      const team2 = teamMap.get(game.team2Id);
      if (!team1 || !team2) {
        addError(`Week ${week.week} includes an unknown team in matchup ${game.team1Id} vs ${game.team2Id}.`);
        return;
      }
      if (game.team1Id === game.team2Id) addError(`Week ${week.week} includes a self-match for ${game.team1Id}.`);
      if (team1.conference !== team2.conference) addError(`Week ${week.week} includes an East-vs-West game: ${team1.teamName} vs ${team2.teamName}.`);
      if (game.conference !== team1.conference || game.conference !== team2.conference) {
        addError(`Week ${week.week} has a conference label mismatch for ${team1.teamName} vs ${team2.teamName}.`);
      }

      const firstAppearanceKey = `${week.week}:${game.team1Id}`;
      const secondAppearanceKey = `${week.week}:${game.team2Id}`;
      if (weeklyAppearances.has(firstAppearanceKey)) addError(`Week ${week.week} schedules ${team1.teamName} more than once.`);
      if (weeklyAppearances.has(secondAppearanceKey)) addError(`Week ${week.week} schedules ${team2.teamName} more than once.`);
      weeklyAppearances.add(firstAppearanceKey);
      weeklyAppearances.add(secondAppearanceKey);

      const key = matchupKey(game.team1Id, game.team2Id);
      if (matchupSet.has(key)) addError(`Duplicate matchup found for ${team1.teamName} vs ${team2.teamName}.`);
      matchupSet.add(key);

      gamesPerTeam.set(game.team1Id, gamesPerTeam.get(game.team1Id) + 1);
      gamesPerTeam.set(game.team2Id, gamesPerTeam.get(game.team2Id) + 1);
      opponentsPerTeam.get(game.team1Id).add(game.team2Id);
      opponentsPerTeam.get(game.team2Id).add(game.team1Id);
    });

    byes.forEach((bye) => {
      const team = teamMap.get(bye.teamId);
      if (!team) {
        addError(`Week ${week.week} includes an unknown bye team ${bye.teamId}.`);
        return;
      }
      if (team.conference !== bye.conference) {
        addError(`Week ${week.week} has a bye conference mismatch for ${team.teamName}.`);
      }
      const appearanceKey = `${week.week}:${bye.teamId}`;
      if (weeklyAppearances.has(appearanceKey)) addError(`Week ${week.week} gives ${team.teamName} both a game and a bye.`);
      weeklyAppearances.add(appearanceKey);
      byesPerTeam.set(bye.teamId, byesPerTeam.get(bye.teamId) + 1);
      byeWeeksPerTeam.get(bye.teamId).add(week.week);
    });
  });

  if (totalGames !== 210) addError(`Expected 210 total games, found ${totalGames}.`);

  teams.forEach((team) => {
    const games = gamesPerTeam.get(team.teamId);
    const byes = byesPerTeam.get(team.teamId);
    const opponents = opponentsPerTeam.get(team.teamId);
    const byeWeeks = byeWeeksPerTeam.get(team.teamId);

    if (games !== 14) addError(`${team.teamName} should play 14 games, found ${games}.`);
    if (byes !== 1) addError(`${team.teamName} should have 1 bye, found ${byes}.`);
    if (byeWeeks.size !== 1) addError(`${team.teamName} should have exactly 1 unique bye week, found ${byeWeeks.size}.`);
    if (opponents.size !== 14) addError(`${team.teamName} should face 14 unique conference opponents, found ${opponents.size}.`);

    opponents.forEach((opponentTeamId) => {
      const opponent = teamMap.get(opponentTeamId);
      if (!opponent || opponent.conference !== team.conference) {
        addError(`${team.teamName} has an invalid opponent ${opponentTeamId}.`);
      }
    });
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  validateSchedule,
};
