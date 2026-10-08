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
    const memberships = require('./service-helpers').activeMemberships(repository.loadRosterMemberships(leagueId), context.seasonId);
    const rosterCounts = context.teams.map(team => ({ team, count: memberships.filter(m => m.teamId === team.teamId).length }));

    const checks = {
      teamsValid: context.teams.length === 30,
      conferenceBalance: eastTeams === 15 && westTeams === 15,
      rostersValid: rosterCounts.every(row => row.count === 15) && new Set(memberships.map(m => m.playerId)).size === memberships.length,
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
    for (const { team, count } of rosterCounts) if (count !== 15) errors.push(`${team.teamName}: ${count}/15 players. Complete roster cutdowns before starting the regular season.`);
    if (new Set(memberships.map(m => m.playerId)).size !== memberships.length) errors.push('Resolve duplicate roster memberships before starting the regular season.');

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
