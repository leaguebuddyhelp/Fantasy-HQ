const { randomUUID } = require("crypto");

const BYE_TEAM_ID = "__BYE__";

function shuffle(values, rng = Math.random) {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function rotateRoundRobin(teams) {
  const [fixed, ...rest] = teams;
  return [fixed, rest[rest.length - 1], ...rest.slice(0, -1)];
}

function buildConferenceRounds(teams, conference, rng = Math.random) {
  const randomizedTeams = shuffle(teams, rng);
  const rotation = [...randomizedTeams, { teamId: BYE_TEAM_ID, teamName: "BYE", conference }];
  const rounds = [];

  for (let roundIndex = 0; roundIndex < rotation.length - 1; roundIndex += 1) {
    const games = [];
    let byeTeamId = null;

    for (let index = 0; index < rotation.length / 2; index += 1) {
      const left = rotation[index];
      const right = rotation[rotation.length - 1 - index];

      if (left.teamId === BYE_TEAM_ID || right.teamId === BYE_TEAM_ID) {
        const activeTeam = left.teamId === BYE_TEAM_ID ? right : left;
        byeTeamId = activeTeam.teamId;
        continue;
      }

      games.push({
        team1Id: left.teamId,
        team2Id: right.teamId,
        conference,
      });
    }

    rounds.push({
      conference,
      games: shuffle(games, rng),
      bye: {
        teamId: byeTeamId,
        conference,
      },
    });

    const nextRotation = rotateRoundRobin(rotation);
    rotation.splice(0, rotation.length, ...nextRotation);
  }

  return shuffle(rounds, rng);
}

function generateSchedule({ leagueId, seasonId, teams, rng = Math.random }) {
  const eastTeams = teams.filter((team) => team.conference === "East");
  const westTeams = teams.filter((team) => team.conference === "West");

  const eastRounds = buildConferenceRounds(eastTeams, "East", rng);
  const westRounds = buildConferenceRounds(westTeams, "West", rng);

  const weeks = eastRounds.map((eastRound, index) => {
    const westRound = westRounds[index];
    return {
      week: index + 1,
      games: [...eastRound.games, ...westRound.games],
      byes: [eastRound.bye, westRound.bye],
    };
  });

  return {
    scheduleId: randomUUID(),
    leagueId,
    seasonId,
    generatedAt: new Date().toISOString(),
    weeks,
  };
}

module.exports = {
  BYE_TEAM_ID,
  generateSchedule,
  shuffle,
};
