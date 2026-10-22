const { normalizeStatScope } = require('./stat-scope');
const PERCENTAGE_ATTEMPTS = Object.freeze({ FGPercent: 'FGA', threePPercent: '3PA', FTPercent: 'FTA' });

function regularSeasonMinimumAttempts(currentWeek = 0) {
  return Math.max(1, Number(currentWeek) || 0) * 10;
}

// Eligibility only controls leaderboards. Raw profile percentages remain intact.
function percentageQualification(player, { scope = 'REGULAR_SEASON', currentWeek = 0 } = {}) {
  normalizeStatScope(scope);
  const games = Number(player.GP || 0);
  const fieldGoalMinimum = scope === 'REGULAR_SEASON'
    ? regularSeasonMinimumAttempts(currentWeek)
    : Math.max(0, games) * 8;
  return Object.fromEntries(Object.entries(PERCENTAGE_ATTEMPTS).map(([key, attempts]) => [key, {
    attempts: Number(player[attempts] || 0),
    minimumAttempts: key === 'FGPercent' ? fieldGoalMinimum : Math.max(0, games) * 5,
    eligible: games > 0 && Number(player[attempts]) > 0 && Number(player[attempts]) >= (key === 'FGPercent' ? fieldGoalMinimum : Math.max(0, games) * 5),
  }]));
}
function qualifiesForPercentage(player, key, options) {
  if (!PERCENTAGE_ATTEMPTS[key]) return true;
  return percentageQualification(player, options)[key].eligible;
}
module.exports = { PERCENTAGE_ATTEMPTS, regularSeasonMinimumAttempts, percentageQualification, qualifiesForPercentage };
