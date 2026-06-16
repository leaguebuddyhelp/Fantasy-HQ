require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

const BASE_URL = "https://api.sleeper.app/v1";
const DEFAULT_LEAGUE_ID = "1239729538661896192";

async function sleeperFetch(route) {
  const response = await fetch(`${BASE_URL}${route}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Fantasy-HQ-Audit/0.1",
    },
  });

  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    route,
    body,
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function points(settings = {}, key) {
  const whole = settings[key] ?? 0;
  const decimal = settings[`${key}_decimal`] ?? 0;
  return Number((whole + decimal / 100).toFixed(2));
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function compactLeague(league) {
  return {
    league_id: league.league_id,
    name: league.name,
    sport: league.sport,
    season: league.season,
    status: league.status,
    previous_league_id: league.previous_league_id,
    draft_id: league.draft_id,
    bracket_id: league.bracket_id,
    loser_bracket_id: league.loser_bracket_id,
    total_rosters: league.total_rosters,
    roster_positions: league.roster_positions,
    settings: league.settings,
    scoring_settings: league.scoring_settings,
    metadata: league.metadata,
  };
}

function summarizeRosters(rosters) {
  const standings = [...rosters]
    .sort((a, b) => {
      const winDiff = (b.settings?.wins || 0) - (a.settings?.wins || 0);
      return winDiff || points(b.settings, "fpts") - points(a.settings, "fpts");
    })
    .map((roster) => ({
      roster_id: roster.roster_id,
      owner_id: roster.owner_id,
      wins: roster.settings?.wins || 0,
      losses: roster.settings?.losses || 0,
      ties: roster.settings?.ties || 0,
      fpts: points(roster.settings, "fpts"),
      fpts_against: points(roster.settings, "fpts_against"),
      ppts: points(roster.settings, "ppts"),
      waiver_position: roster.settings?.waiver_position,
      waiver_budget_used: roster.settings?.waiver_budget_used,
      total_moves: roster.settings?.total_moves,
      division: roster.settings?.division,
      record_string: roster.metadata?.record,
      streak: roster.metadata?.streak,
      player_count: asArray(roster.players).length,
      starter_count: asArray(roster.starters).filter((playerId) => playerId && playerId !== "0").length,
      reserve_count: asArray(roster.reserve).length,
      taxi_count: asArray(roster.taxi).length,
    }));

  return {
    count: rosters.length,
    standings,
    available_roster_fields: [...new Set(rosters.flatMap((roster) => Object.keys(roster)))].sort(),
    available_settings_fields: [...new Set(rosters.flatMap((roster) => Object.keys(roster.settings || {})))].sort(),
    available_metadata_fields: [...new Set(rosters.flatMap((roster) => Object.keys(roster.metadata || {})))].sort(),
  };
}

function summarizeUsers(users) {
  return {
    count: users.length,
    commissioners: users.filter((user) => user.is_owner).map((user) => user.display_name),
    team_names: users.map((user) => ({
      user_id: user.user_id,
      display_name: user.display_name,
      team_name: user.metadata?.team_name || null,
      avatar: user.avatar || user.metadata?.avatar || null,
    })),
    available_user_fields: [...new Set(users.flatMap((user) => Object.keys(user)))].sort(),
    available_metadata_fields: [...new Set(users.flatMap((user) => Object.keys(user.metadata || {})))].sort(),
  };
}

function summarizeMatchups(matchupPages) {
  const weeks = matchupPages.map(({ period, data }) => {
    const matchups = asArray(data);
    const points = matchups.map((team) => Number(team.points || 0));

    return {
      period,
      team_entries: matchups.length,
      matchup_count: new Set(matchups.map((team) => team.matchup_id).filter(Boolean)).size,
      has_player_points: matchups.some((team) => team.players_points && Object.keys(team.players_points).length),
      has_starter_points: matchups.some((team) => team.starters_points && team.starters_points.length),
      high_score: points.length ? Math.max(...points) : 0,
      low_score: points.length ? Math.min(...points) : 0,
      total_points: Number(points.reduce((sum, score) => sum + score, 0).toFixed(2)),
      sample_fields: [...new Set(matchups.flatMap((team) => Object.keys(team)))].sort(),
    };
  });

  return {
    periods_with_data: weeks.filter((week) => week.team_entries > 0).length,
    weeks,
  };
}

function summarizeTransactions(transactionPages) {
  const weeks = transactionPages.map(({ period, data }) => {
    const transactions = asArray(data);
    return {
      period,
      count: transactions.length,
      by_type: countBy(transactions, (transaction) => transaction.type),
      completed: transactions.filter((transaction) => transaction.status === "complete").length,
      has_draft_picks: transactions.some((transaction) => asArray(transaction.draft_picks).length),
      has_waiver_budget: transactions.some((transaction) => asArray(transaction.waiver_budget).length),
      sample_fields: [...new Set(transactions.flatMap((transaction) => Object.keys(transaction)))].sort(),
    };
  });

  return {
    total: weeks.reduce((sum, week) => sum + week.count, 0),
    by_type: transactionPages.reduce((counts, { data }) => {
      for (const transaction of asArray(data)) {
        counts[transaction.type] = (counts[transaction.type] || 0) + 1;
      }
      return counts;
    }, {}),
    weeks,
  };
}

function summarizePlayerStats(statPages) {
  const periods = statPages.map(({ period, data }) => {
    const playerStats = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    const rows = Object.values(playerStats).filter((stats) => stats && Object.keys(stats).length);
    const fantasyPoints = rows.map((stats) => Number(stats.sp || 0));

    return {
      period,
      player_count: rows.length,
      stat_fields: [...new Set(rows.flatMap((stats) => Object.keys(stats)))].sort(),
      high_fantasy_points: fantasyPoints.length ? Math.max(...fantasyPoints) : 0,
    };
  });

  return {
    periods_with_data: periods.filter((period) => period.player_count > 0).length,
    all_stat_fields: [...new Set(periods.flatMap((period) => period.stat_fields))].sort(),
    periods,
  };
}

function summarizeBracket(items) {
  const games = asArray(items);
  return {
    count: games.length,
    rounds: [...new Set(games.map((game) => game.r).filter(Boolean))].sort((a, b) => a - b),
    decided_games: games.filter((game) => game.w).length,
    games,
  };
}

function summarizeDraft(draft, picks, tradedPicks) {
  return {
    draft,
    picks_count: picks.length,
    rounds: [...new Set(picks.map((pick) => pick.round).filter(Boolean))].sort((a, b) => a - b),
    picked_count: picks.filter((pick) => pick.player_id).length,
    traded_picks_count: tradedPicks.length,
    pick_fields: [...new Set(picks.flatMap((pick) => Object.keys(pick)))].sort(),
    traded_pick_fields: [...new Set(tradedPicks.flatMap((pick) => Object.keys(pick)))].sort(),
    sample_picks: picks.slice(0, 10),
  };
}

async function main() {
  const leagueId = process.argv[2] || DEFAULT_LEAGUE_ID;
  const leagueResponse = await sleeperFetch(`/league/${leagueId}`);
  if (!leagueResponse.ok || !leagueResponse.body?.league_id) {
    throw new Error(`Could not fetch league ${leagueId}: ${leagueResponse.status}`);
  }

  const league = leagueResponse.body;
  const lastScoredLeg = league.settings?.last_scored_leg || league.settings?.leg || 22;
  const periods = Array.from({ length: lastScoredLeg }, (_, index) => index + 1);

  const [
    rostersResponse,
    usersResponse,
    winnersBracketResponse,
    losersBracketResponse,
    tradedPicksResponse,
    draftsResponse,
  ] = await Promise.all([
    sleeperFetch(`/league/${leagueId}/rosters`),
    sleeperFetch(`/league/${leagueId}/users`),
    sleeperFetch(`/league/${leagueId}/winners_bracket`),
    sleeperFetch(`/league/${leagueId}/losers_bracket`),
    sleeperFetch(`/league/${leagueId}/traded_picks`),
    sleeperFetch(`/league/${leagueId}/drafts`),
  ]);

  const matchupResponses = await Promise.all(periods.map((period) => sleeperFetch(`/league/${leagueId}/matchups/${period}`)));
  const transactionResponses = await Promise.all(periods.map((period) => sleeperFetch(`/league/${leagueId}/transactions/${period}`)));
  const statsResponses = await Promise.all(periods.map((period) => sleeperFetch(`/stats/${league.sport}/regular/${league.season}/${period}`)));
  const projectionResponses = await Promise.all(periods.map((period) => sleeperFetch(`/projections/${league.sport}/regular/${league.season}/${period}`)));
  const [trendingAddsResponse, trendingDropsResponse] = await Promise.all([
    sleeperFetch(`/players/${league.sport}/trending/add`),
    sleeperFetch(`/players/${league.sport}/trending/drop`),
  ]);

  const draftId = league.draft_id || asArray(draftsResponse.body)[0]?.draft_id;
  const [draftResponse, draftPicksResponse, draftTradedPicksResponse] = draftId
    ? await Promise.all([
        sleeperFetch(`/draft/${draftId}`),
        sleeperFetch(`/draft/${draftId}/picks`),
        sleeperFetch(`/draft/${draftId}/traded_picks`),
      ])
    : [{ body: null }, { body: [] }, { body: [] }];

  const report = {
    generated_at: new Date().toISOString(),
    league: compactLeague(league),
    endpoints_scanned: {
      league: leagueResponse.route,
      rosters: rostersResponse.route,
      users: usersResponse.route,
      matchups: matchupResponses.map((response) => response.route),
      transactions: transactionResponses.map((response) => response.route),
      stats: statsResponses.map((response) => response.route),
      projections: projectionResponses.map((response) => response.route),
      trending_adds: trendingAddsResponse.route,
      trending_drops: trendingDropsResponse.route,
      winners_bracket: winnersBracketResponse.route,
      losers_bracket: losersBracketResponse.route,
      traded_picks: tradedPicksResponse.route,
      league_drafts: draftsResponse.route,
      draft: draftResponse.route,
      draft_picks: draftPicksResponse.route,
      draft_traded_picks: draftTradedPicksResponse.route,
    },
    rosters: summarizeRosters(asArray(rostersResponse.body)),
    users: summarizeUsers(asArray(usersResponse.body)),
    matchups: summarizeMatchups(matchupResponses.map((response, index) => ({ period: periods[index], data: response.body }))),
    transactions: summarizeTransactions(transactionResponses.map((response, index) => ({ period: periods[index], data: response.body }))),
    stats: summarizePlayerStats(statsResponses.map((response, index) => ({ period: periods[index], data: response.body }))),
    projections: summarizePlayerStats(projectionResponses.map((response, index) => ({ period: periods[index], data: response.body }))),
    trending: {
      adds: asArray(trendingAddsResponse.body),
      drops: asArray(trendingDropsResponse.body),
    },
    winners_bracket: summarizeBracket(winnersBracketResponse.body),
    losers_bracket: summarizeBracket(losersBracketResponse.body),
    traded_picks: {
      count: asArray(tradedPicksResponse.body).length,
      fields: [...new Set(asArray(tradedPicksResponse.body).flatMap((pick) => Object.keys(pick)))].sort(),
      sample: asArray(tradedPicksResponse.body).slice(0, 10),
    },
    league_drafts: {
      count: asArray(draftsResponse.body).length,
      drafts: asArray(draftsResponse.body),
    },
    draft_detail: summarizeDraft(draftResponse.body, asArray(draftPicksResponse.body), asArray(draftTradedPicksResponse.body)),
  };

  const reportDir = path.join(process.cwd(), "reports");
  fs.mkdirSync(reportDir, { recursive: true });

  const jsonPath = path.join(reportDir, `sleeper-${league.season}-${leagueId}-audit.json`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify({
    report: jsonPath,
    league: report.league,
    roster_count: report.rosters.count,
    matchup_periods_with_data: report.matchups.periods_with_data,
    transaction_total: report.transactions.total,
    transaction_types: report.transactions.by_type,
    stat_periods_with_data: report.stats.periods_with_data,
    projection_periods_with_data: report.projections.periods_with_data,
    winners_bracket_games: report.winners_bracket.count,
    losers_bracket_games: report.losers_bracket.count,
    traded_picks: report.traded_picks.count,
    draft_picks: report.draft_detail.picks_count,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
