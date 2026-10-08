const { normalizeStatScope } = require('./stat-scope');
const PERCENTAGE_ATTEMPTS = Object.freeze({ FGPercent: 'FGA', threePPercent: '3PA', FTPercent: 'FTA' });

// Eligibility only controls leaderboards. Raw profile percentages remain intact.
function percentageQualification(player, { scope = 'REGULAR_SEASON', currentWeek = 0 } = {}) {
  normalizeStatScope(scope);
  const games = Number(player.GP || 0);
  const minimumAttempts = scope === 'REGULAR_SEASON'
    ? Math.max(0, Number(currentWeek) || 0) * 10
    : Math.max(0, games) * 8;
  return Object.fromEntries(Object.entries(PERCENTAGE_ATTEMPTS).map(([key, attempts]) => [key, {
    attempts: Number(player[attempts] || 0), minimumAttempts,
    eligible: games > 0 && Number(player[attempts]) > 0 && Number(player[attempts]) >= minimumAttempts,
  }]));
}
function qualifiesForPercentage(player, key, options) {
  if (!PERCENTAGE_ATTEMPTS[key]) return true;
  return percentageQualification(player, options)[key].eligible;
}
module.exports = { PERCENTAGE_ATTEMPTS, percentageQualification, qualifiesForPercentage };
