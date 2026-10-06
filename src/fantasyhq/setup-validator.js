const { validateSchedule } = require("./schedule-validator");

function mapOwnersByTeam(owners) {
  return new Map((owners || []).map((owner) => [owner.teamId, owner]));
}

function validateSetupState({ league, teams, owners, rosterMemberships, settings, schedule }) {
  const checks = {
    leagueConfigured: Boolean(league?.leagueId && league?.leagueName && league?.commissionerUserId),
    teamCount: false,
    conferenceBalance: false,
    rostersImported: false,
    ownersAssigned: false,
    scheduleGenerated: Boolean(schedule),
    scheduleValid: false,
    leagueSettings: Boolean(settings),
  };
  const errors = [];
  const warnings = [];

  const ownerMap = mapOwnersByTeam(owners);
  const eastTeams = (teams || []).filter((team) => team.conference === "East");
  const westTeams = (teams || []).filter((team) => team.conference === "West");
  const rosteredTeamIds = new Set((rosterMemberships || []).map((membership) => membership.teamId));

  checks.teamCount = (teams || []).length === 30;
  checks.conferenceBalance = eastTeams.length === 15 && westTeams.length === 15;
  checks.rostersImported = (teams || []).length > 0 && teams.every((team) => rosteredTeamIds.has(team.teamId));
  checks.ownersAssigned = (teams || []).length > 0 && teams.every((team) => ownerMap.has(team.teamId));

  if (!checks.teamCount) errors.push(`Expected 30 teams, found ${(teams || []).length}.`);
  if (!checks.conferenceBalance) errors.push(`Expected 15 East and 15 West teams, found ${eastTeams.length} East and ${westTeams.length} West.`);

  for (const team of teams || []) {
    if (!team.teamId || !team.teamName || !team.abbreviation || !team.conference) {
      errors.push(`${team.teamName || team.teamId || "Unknown team"} is missing required team fields.`);
    }
    if (!rosteredTeamIds.has(team.teamId)) {
      errors.push(`${team.teamName} roster has not been imported.`);
    }
  }

  if (!checks.leagueConfigured) errors.push("League configuration is incomplete.");
  if (!checks.leagueSettings) errors.push("League settings have not been configured.");

  if (settings?.requireAllOwners === false) {
    if (!checks.ownersAssigned) warnings.push("Some teams do not have assigned owners, but unassigned teams are currently permitted.");
  } else if (!checks.ownersAssigned) {
    errors.push("All 30 teams must have assigned owners before activation.");
  }

  if (schedule) {
    const validation = validateSchedule(schedule, teams || []);
    checks.scheduleValid = validation.valid;
    if (!validation.valid) errors.push(...validation.errors);
  } else {
    errors.push("A confirmed schedule has not been saved.");
  }

  return {
    ready: errors.length === 0,
    checks,
    errors,
    warnings,
  };
}

module.exports = {
  validateSetupState,
};
