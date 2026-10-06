const { createDataIssuesService } = require("./data-issues-service");
const { createFantasyHQRepository } = require("./repository");
const { validateSchedule } = require("./schedule-validator");

function createPreseasonValidator(options = {}) {
  const repository = options.repository || createFantasyHQRepository(options);
  const dataIssuesService = options.dataIssuesService || createDataIssuesService({ repository });

  function validate({ leagueId, seasonId }) {
    const context = repository.loadLeague(leagueId, seasonId);
    const settings = repository.loadSettings(leagueId);
    const owners = repository.loadOwners(leagueId);
    const schedule = repository.scheduleExists(leagueId, context.seasonId)
      ? repository.loadSchedule(leagueId, context.seasonId)
      : null;
    const issues = dataIssuesService.issuesForLeague(leagueId, context.seasonId);
    const blockingIssues = issues.filter((issue) => issue.severity === "error");
    const eastTeams = context.teams.filter((team) => team.conference === "East").length;
    const westTeams = context.teams.filter((team) => team.conference === "West").length;

    const checks = {
      teamsValid: context.teams.length === 30,
      conferenceBalance: eastTeams === 15 && westTeams === 15,
      rostersValid: issues.every((issue) => issue.type !== "empty-roster"),
      dataValid: blockingIssues.length === 0,
      scheduleValid: false,
      weekOneExists: Boolean(schedule?.weeks?.some((week) => week.week === 1)),
      leagueSettingsValid: Boolean(settings),
      ownersAssigned: context.teams.every((team) => owners.some((owner) => owner.teamId === team.teamId)),
    };

    const errors = [];
    const warnings = [];
    if (!checks.teamsValid) errors.push(`Expected 30 teams, found ${context.teams.length}.`);
    if (!checks.conferenceBalance) errors.push(`Expected 15 East and 15 West teams, found ${eastTeams} East and ${westTeams} West.`);
    if (!checks.leagueSettingsValid) errors.push("League settings are missing.");

    if (schedule) {
      const validation = validateSchedule(schedule, context.teams);
      checks.scheduleValid = validation.valid;
      if (!validation.valid) errors.push(...validation.errors);
    } else {
      errors.push("A saved schedule does not exist.");
    }

    if (!checks.weekOneExists) errors.push("Week 1 does not exist.");
    for (const issue of issues) {
      if (issue.severity === "error") errors.push(issue.message);
      else warnings.push(issue.message);
    }

    if (settings?.requireAllOwners === false) {
      if (!checks.ownersAssigned) warnings.push("Not all teams have assigned owners.");
    } else if (!checks.ownersAssigned) {
      errors.push("All teams must have owners assigned.");
    }

    return {
      ready: errors.length === 0,
      checks,
      errors,
      warnings,
      issues,
    };
  }

  return {
    repository,
    validate,
  };
}

module.exports = {
  createPreseasonValidator,
};
