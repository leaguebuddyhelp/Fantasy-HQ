const { PHASES, WEEK_STATUSES } = require("./constants");
const { createFantasyHQRepository } = require("./repository");
const { validateSchedule } = require("./schedule-validator");

function createLeagueService(options = {}) {
  const repository = options.repository || createFantasyHQRepository(options);

  function getBoundLeagueContext({ guildId, leagueId = null, seasonId = null } = {}) {
    return repository.loadLeagueContext({ guildId, leagueId, seasonId });
  }

  function getLeagueStatus({ guildId, leagueId = null, seasonId = null } = {}) {
    const context = getBoundLeagueContext({ guildId, leagueId, seasonId });
    const owners = repository.loadOwners(context.league.leagueId);
    const players = repository.loadPlayers(context.league.leagueId);
    const memberships = repository.loadRosterMemberships(context.league.leagueId)
      .filter((entry) => String(entry.seasonId) === String(context.seasonId));
    const schedule = repository.scheduleExists(context.league.leagueId, context.seasonId)
      ? repository.loadSchedule(context.league.leagueId, context.seasonId)
      : null;

    return {
      league: context.league,
      seasonId: context.seasonId,
      counts: {
        teams: context.teams.length,
        owners: owners.length,
        players: players.length,
        rosterMemberships: memberships.length,
        weeks: schedule?.weeks?.length || 0,
        games: schedule ? schedule.weeks.reduce((count, week) => count + week.games.length, 0) : 0,
      },
    };
  }

  // Reuse the saved schedule's weeks; games and byes stay nested in their original week.
  function initializeRegularSeasonWeeks({ leagueId, seasonId }) {
    const context = repository.loadLeague(leagueId);
    const activeSeasonId = context.seasonId;
    if (seasonId != null && String(seasonId) !== activeSeasonId) {
      throw new Error("Can only initialize the league's current season.");
    }
    if (![PHASES.PRESEASON, PHASES.REGULAR_SEASON].includes(context.league.currentPhase)) {
      throw new Error("Regular-season weeks can only be initialized from PRESEASON or REGULAR_SEASON.");
    }
    if (context.league.currentWeek != null && context.league.currentWeek !== 1) {
      throw new Error("Cannot reinitialize a season that has already progressed.");
    }

    const schedule = repository.loadSchedule(leagueId, activeSeasonId);
    if (schedule.leagueId !== leagueId || schedule.seasonId !== activeSeasonId) {
      throw new Error("Saved schedule does not belong to this league and season.");
    }
    const numbers = schedule.weeks.map(week => week.week);
    if (numbers.length !== 15 || new Set(numbers).size !== 15
      || numbers.some(number => !Number.isInteger(number) || number < 1 || number > 15)) {
      throw new Error("Expected exactly one saved week for each week number 1–15.");
    }
    const validation = validateSchedule(schedule, context.teams);
    if (!validation.valid) throw new Error(`Cannot initialize weeks:
${validation.errors.join("\n")}`);

    const weeks = schedule.weeks.map(week => {
      const status = week.week === 1 ? WEEK_STATUSES.ACTIVE : WEEK_STATUSES.UPCOMING;
      if (week.status != null && week.status !== status) {
        throw new Error("Existing week status conflicts with initialization; refusing to reset it.");
      }
      if ((week.weekNumber != null && week.weekNumber !== week.week)
        || (week.leagueId != null && week.leagueId !== leagueId)
        || (week.seasonId != null && week.seasonId !== activeSeasonId)) {
        throw new Error("Existing week identity does not match its schedule.");
      }
      return {
        ...week,
        weekId: week.weekId || `${encodeURIComponent(leagueId)}:${encodeURIComponent(activeSeasonId)}:week:${week.week}`,
        leagueId,
        seasonId: activeSeasonId,
        weekNumber: week.week,
        status,
      };
    });
    if (new Set(weeks.map(week => week.weekId)).size !== 15) {
      throw new Error("Saved schedule contains duplicate week IDs.");
    }

    // Skip writes on retries, preserving IDs, timestamps, games, and byes exactly.
    if (JSON.stringify(weeks) !== JSON.stringify(schedule.weeks)) {
      repository.saveSchedule({ ...schedule, weeks });
    }
    if (context.league.currentWeek !== 1) {
      repository.saveLeague(leagueId, { ...context.league, currentWeek: 1 });
    }
    return repository.loadSchedule(leagueId, activeSeasonId);
  }

  function startRegularSeason({ leagueId, seasonId, actingUserId, operator, validator }) {
    const context = repository.loadLeague(leagueId, seasonId);
    if (context.league.currentPhase === PHASES.REGULAR_SEASON) {
      initializeRegularSeasonWeeks({ leagueId, seasonId: context.seasonId });
      return repository.loadLeague(leagueId).league;
    }
    if (context.league.currentPhase !== PHASES.PRESEASON) {
      throw new Error(`League must be in PRESEASON to start the regular season. Current phase: ${context.league.currentPhase}.`);
    }
    const validation = validator({ leagueId, seasonId: context.seasonId });
    if (!validation.ready) {
      throw new Error(`Cannot start season:\n${validation.errors.join("\n")}`);
    }

    initializeRegularSeasonWeeks({ leagueId, seasonId: context.seasonId });
    const nextLeague = repository.saveLeague(leagueId, {
      ...context.league,
      currentPhase: PHASES.REGULAR_SEASON,
      currentWeek: 1,
    });
    repository.appendAuditLog(leagueId, {
      action: "league.regular-season.started",
      userId: String(actingUserId || context.league.commissionerUserId || "system"),
      ...(operator ? { operator: String(operator) } : {}),
      leagueId,
      timestamp: new Date().toISOString(),
      metadata: {
        previousPhase: PHASES.PRESEASON,
        nextPhase: PHASES.REGULAR_SEASON,
        currentWeek: 1,
      },
    });
    return nextLeague;
  }

  return {
    getBoundLeagueContext,
    getLeagueStatus,
    initializeRegularSeasonWeeks,
    repository,
    startRegularSeason,
  };
}

module.exports = {
  createLeagueService,
};
