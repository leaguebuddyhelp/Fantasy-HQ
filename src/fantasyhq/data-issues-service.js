const { activeMemberships, normalizeText } = require("./service-helpers");
const { createFantasyHQRepository } = require("./repository");

function createDataIssuesService(options = {}) {
  const repository = options.repository || createFantasyHQRepository(options);

  function issuesForLeague(leagueId, seasonId) {
    const context = repository.loadLeague(leagueId, seasonId);
    const owners = new Map(repository.loadOwners(leagueId).map((owner) => [owner.teamId, owner]));
    const players = repository.loadPlayers(leagueId);
    const playerMap = new Map(players.map((player) => [player.playerId, player]));
    const memberships = activeMemberships(repository.loadRosterMemberships(leagueId), context.seasonId);
    const issues = (repository.loadRoleOwnership(leagueId).conflicts || []).map((message) => ({ type: "owner-role-conflict", severity: "error", message }));

    const membershipByTeam = new Map();
    for (const membership of memberships) {
      if (!membershipByTeam.has(membership.teamId)) membershipByTeam.set(membership.teamId, []);
      membershipByTeam.get(membership.teamId).push(membership);
      const player = playerMap.get(membership.playerId);
      if (!player?.imageUrl) issues.push({ type: "missing-image", severity: "warning", playerId: membership.playerId, teamId: membership.teamId, message: `${player?.name || membership.playerId} is missing an image.` });
      if (!membership.position1) issues.push({ type: "missing-position", severity: "error", playerId: membership.playerId, teamId: membership.teamId, message: `${player?.name || membership.playerId} is missing a primary position.` });
      if (player?.overall == null) issues.push({ type: "missing-ovr", severity: "error", playerId: membership.playerId, teamId: membership.teamId, message: `${player?.name || membership.playerId} is missing an OVR.` });
      if (!membership.teamId) issues.push({ type: "missing-team", severity: "error", playerId: membership.playerId, teamId: null, message: `${player?.name || membership.playerId} is missing a team assignment.` });
    }

    const duplicateNameCandidates = new Map();
    for (const player of players) {
      const key = `${normalizeText(player.name)}|${normalizeText(player.birthdate)}`;
      if (!duplicateNameCandidates.has(key)) duplicateNameCandidates.set(key, []);
      duplicateNameCandidates.get(key).push(player);
    }
    for (const [key, entries] of duplicateNameCandidates.entries()) {
      if (entries.length > 1 && !key.startsWith("|")) {
        for (const player of entries) {
          issues.push({
            type: "duplicate-player-candidate",
            severity: "warning",
            playerId: player.playerId,
            message: `${player.name} looks like a duplicate player candidate.`,
          });
        }
      }
    }

    for (const team of context.teams) {
      const roster = membershipByTeam.get(team.teamId) || [];
      if (!owners.has(team.teamId)) {
        issues.push({ type: "unassigned-owner", severity: "warning", teamId: team.teamId, message: `${team.teamName} does not have an assigned owner.` });
      }
      if (!roster.length) {
        issues.push({ type: "empty-roster", severity: "error", teamId: team.teamId, message: `${team.teamName} has an empty roster.` });
      }
      if (roster.length < 10 || roster.length > 18) {
        issues.push({ type: "suspicious-roster-size", severity: "warning", teamId: team.teamId, message: `${team.teamName} has a suspicious roster size of ${roster.length}.` });
      }

      const jerseyCounts = new Map();
      for (const membership of roster) {
        const jerseyKey = membership.jerseyNumber == null ? null : String(membership.jerseyNumber);
        if (!jerseyKey) continue;
        jerseyCounts.set(jerseyKey, (jerseyCounts.get(jerseyKey) || 0) + 1);
      }
      for (const [jersey, count] of jerseyCounts.entries()) {
        if (count > 1) {
          issues.push({ type: "duplicate-jersey-number", severity: "warning", teamId: team.teamId, message: `${team.teamName} has duplicate jersey number ${jersey}.` });
        }
      }

      if (!["East", "West"].includes(team.conference)) {
        issues.push({ type: "invalid-conference", severity: "error", teamId: team.teamId, message: `${team.teamName} has an invalid conference.` });
      }
    }

    return issues;
  }

  return {
    issuesForLeague,
    repository,
  };
}

module.exports = {
  createDataIssuesService,
};
