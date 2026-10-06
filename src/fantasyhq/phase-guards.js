function requirePhase(league, expectedPhases) {
  const allowed = Array.isArray(expectedPhases) ? expectedPhases : [expectedPhases];
  if (!allowed.includes(league.currentPhase)) {
    throw new Error(`This action requires phase ${allowed.join(" or ")}, but the league is currently in ${league.currentPhase}.`);
  }
}

module.exports = {
  requirePhase,
};
