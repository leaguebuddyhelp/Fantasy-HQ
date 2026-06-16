const BASE_URL = "https://api.sleeper.app/v1";

async function sleeperFetch(path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Sleeper-Discord-Bot/0.1",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Sleeper API ${response.status} for ${path}: ${body.slice(0, 200)}`);
  }

  return response.json();
}

async function getUser(username) {
  return sleeperFetch(`/user/${encodeURIComponent(username)}`);
}

async function getUserLeagues(userId, season, sport = "nfl") {
  return sleeperFetch(`/user/${encodeURIComponent(userId)}/leagues/${encodeURIComponent(sport)}/${encodeURIComponent(season)}`);
}

async function getLeague(leagueId) {
  return sleeperFetch(`/league/${encodeURIComponent(leagueId)}`);
}

async function getLeagueUsers(leagueId) {
  return sleeperFetch(`/league/${encodeURIComponent(leagueId)}/users`);
}

async function getRosters(leagueId) {
  return sleeperFetch(`/league/${encodeURIComponent(leagueId)}/rosters`);
}

async function getMatchups(leagueId, week) {
  return sleeperFetch(`/league/${encodeURIComponent(leagueId)}/matchups/${encodeURIComponent(week)}`);
}

async function getTransactions(leagueId, week) {
  return sleeperFetch(`/league/${encodeURIComponent(leagueId)}/transactions/${encodeURIComponent(week)}`);
}

async function getPlayers(sport = "nfl") {
  return sleeperFetch(`/players/${encodeURIComponent(sport)}`);
}

async function getSportState(sport = "nfl") {
  return sleeperFetch(`/state/${encodeURIComponent(sport)}`);
}

async function getLeagueBundle(leagueId) {
  const [league, users, rosters] = await Promise.all([
    getLeague(leagueId),
    getLeagueUsers(leagueId),
    getRosters(leagueId),
  ]);

  return { league, users, rosters };
}

module.exports = {
  getLeague,
  getLeagueBundle,
  getLeagueUsers,
  getMatchups,
  getPlayers,
  getRosters,
  getSportState,
  getTransactions,
  getUser,
  getUserLeagues,
};
