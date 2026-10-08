const { contractView, teamPayroll } = require('../shared/player-contract');
const { activeMemberships } = require("./service-helpers");
const { createFantasyHQRepository } = require("./repository");
const { createPlayerStatsService } = require("./player-stats-service");
const { leagueAge, leagueSeasonStartYear, playerTradeValue } = require("./asset-valuation");
const { PICK_PROTECTIONS } = require("./asset-valuation");
const { createTradeService } = require("./trade-service");

function createTeamService(options = {}) {
  const repository = options.repository || createFantasyHQRepository(options);
  const playerStatsService = options.playerStatsService || createPlayerStatsService({ repository, publishedOnly: options.publishedOnly === true });
  const tradeService = options.tradeService || createTradeService({ repository });

  function teamSchedule(schedule, teamId, teamMap) {
    if (!schedule) return [];
    return schedule.weeks.map((week) => {
      const game = week.games.find((entry) => entry.team1Id === teamId || entry.team2Id === teamId);
      if (!game) {
        return { week: week.week, bye: true, opponent: null };
      }
      const opponentTeamId = game.team1Id === teamId ? game.team2Id : game.team1Id;
      return {
        week: week.week,
        bye: false,
        opponent: teamMap.get(opponentTeamId)?.teamName || opponentTeamId,
        conference: game.conference,
      };
    });
  }

  function listTeams(leagueId, seasonId) {
    const context = repository.loadLeague(leagueId, seasonId);
    const owners = new Map(repository.loadOwners(leagueId).map((owner) => [owner.teamId, owner]));
    const players = new Map(repository.loadPlayers(leagueId).map((player) => [player.playerId, player]));
    const memberships = activeMemberships(repository.loadRosterMemberships(leagueId), context.seasonId);
    const playerStats = new Map(playerStatsService.getSeasonPlayerStats(leagueId, context.seasonId).map(stats => [stats.playerId, stats]));
    const teamMap = new Map(context.teams.map((team) => [team.teamId, team]));
    const schedule = repository.scheduleExists(leagueId, context.seasonId)
      ? repository.loadSchedule(leagueId, context.seasonId)
      : null;

    const rosterByTeam = new Map();
    for (const membership of memberships) {
      if (!rosterByTeam.has(membership.teamId)) rosterByTeam.set(membership.teamId, []);
      rosterByTeam.get(membership.teamId).push({
        ...membership,
        player: players.has(membership.playerId) ? {
          ...players.get(membership.playerId),
          contractView: contractView(players.get(membership.playerId), leagueSeasonStartYear(context.seasonId)),
          age: leagueAge(players.get(membership.playerId).birthdate, context.seasonId) ?? players.get(membership.playerId).age ?? null,
          tradeValue: playerTradeValue({ ...players.get(membership.playerId), position1: membership.position1 ?? players.get(membership.playerId).position1, position2: membership.position2 ?? players.get(membership.playerId).position2 }, context.seasonId),
        } : null,
        seasonStats: playerStats.get(membership.playerId) || null,
      });
    }

    const standings = require("./standings-service").createStandingsService({ repository, publishedOnly: options.publishedOnly === true }).getStandings(leagueId, context.seasonId);
    const records = new Map(Object.values(standings.conferences).flat().map(t => [t.teamId, t]));
    const livePicks = tradeService.getLiveSnapshot(leagueId, context.seasonId).picks;
    const picksByTeam = new Map(context.teams.map(team => [team.teamId, []]));
    for (const pick of livePicks) {
      const originalTeam = teamMap.get(pick.originalTeamId), currentOwner = teamMap.get(pick.currentOwnerTeamId);
      if (!picksByTeam.has(pick.currentOwnerTeamId)) continue;
      picksByTeam.get(pick.currentOwnerTeamId).push({ ...pick, originalTeamName: originalTeam?.teamName || pick.originalTeamId, originalTeamAbbreviation: originalTeam?.abbreviation || pick.originalTeamId, currentOwnerTeamName: currentOwner?.teamName || pick.currentOwnerTeamId, protectionLabel: PICK_PROTECTIONS[pick.protection]?.label || "Unprotected" });
    }
    const needsInput = { draftYear: leagueSeasonStartYear(context.seasonId) + 1, prospects: [], rosters: Object.fromEntries(context.teams.map(t => [t.teamId, (rosterByTeam.get(t.teamId) || []).map(entry => ({ ...entry.player, position1: entry.position1 || entry.player?.position1 }))])) };
    return context.teams.map((team) => ({
      record: records.get(team.teamId),
      positionNeeds: require('./mock-engine').teamPositionNeeds(needsInput, team.teamId),
      ...team,
      ownerUserId: owners.get(team.teamId)?.userId || null,
      ownerDisplayName: owners.get(team.teamId)?.displayName || owners.get(team.teamId)?.username || null,
      payroll: teamPayroll((rosterByTeam.get(team.teamId) || []).map(entry => entry.player), leagueSeasonStartYear(context.seasonId)),
      rosterSize: rosterByTeam.get(team.teamId)?.length || 0,
      roster: (rosterByTeam.get(team.teamId) || []).sort((left, right) => {
        const overallDelta = Number(right.player?.overall || 0) - Number(left.player?.overall || 0);
        return overallDelta || String(left.player?.name || "").localeCompare(String(right.player?.name || ""));
      }),
      draftPicks: (picksByTeam.get(team.teamId) || []).sort((left, right) => left.draftYear - right.draftYear || left.round - right.round || left.originalTeamName.localeCompare(right.originalTeamName)),
      schedule: teamSchedule(schedule, team.teamId, teamMap),
    }));
  }

  function getTeam(leagueId, seasonId, teamId) {
    const teams = listTeams(leagueId, seasonId);
    const team = teams.find((entry) => entry.teamId === teamId);
    if (!team) throw new Error(`Unknown team "${teamId}".`);
    return team;
  }

  return {
    getTeam,
    listTeams,
    repository,
  };
}

module.exports = {
  createTeamService,
};
