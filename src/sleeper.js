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

async function getWinnersBracket(leagueId) {
  return sleeperFetch(`/league/${encodeURIComponent(leagueId)}/winners_bracket`);
}

async function getLosersBracket(leagueId) {
  return sleeperFetch(`/league/${encodeURIComponent(leagueId)}/losers_bracket`);
}

async function getTradedPicks(leagueId) {
  return sleeperFetch(`/league/${encodeURIComponent(leagueId)}/traded_picks`);
}

async function getLeagueDrafts(leagueId) {
  return sleeperFetch(`/league/${encodeURIComponent(leagueId)}/drafts`);
}

async function getDraft(draftId) {
  return sleeperFetch(`/draft/${encodeURIComponent(draftId)}`);
}

async function getDraftPicks(draftId) {
  return sleeperFetch(`/draft/${encodeURIComponent(draftId)}/picks`);
}

async function getDraftTradedPicks(draftId) {
  return sleeperFetch(`/draft/${encodeURIComponent(draftId)}/traded_picks`);
}

async function getPlayers(sport = "nfl") {
  return sleeperFetch(`/players/${encodeURIComponent(sport)}`);
}

async function getSportState(sport = "nfl") {
  return sleeperFetch(`/state/${encodeURIComponent(sport)}`);
}

async function getStats(sport, season, period) {
  return sleeperFetch(`/stats/${encodeURIComponent(sport)}/regular/${encodeURIComponent(season)}/${encodeURIComponent(period)}`);
}

async function getProjections(sport, season, period) {
  return sleeperFetch(`/projections/${encodeURIComponent(sport)}/regular/${encodeURIComponent(season)}/${encodeURIComponent(period)}`);
}

async function getTrendingPlayers(sport, type = "add") {
  return sleeperFetch(`/players/${encodeURIComponent(sport)}/trending/${encodeURIComponent(type)}`);
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
  getDraft,
  getDraftPicks,
  getDraftTradedPicks,
  getLeague,
  getLeagueBundle,
  getLeagueDrafts,
  getLeagueUsers,
  getLosersBracket,
  getMatchups,
  getPlayers,
  getProjections,
  getRosters,
  getSportState,
  getStats,
  getTransactions,
  getTradedPicks,
  getTrendingPlayers,
  getUser,
  getUserLeagues,
  getWinnersBracket,
};
