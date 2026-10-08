const STEPS = Object.freeze([
  'WRAP_UP', 'RETIREMENTS', 'LOTTERY', 'TRADES', 'DRAFT', 'OPTIONS',
  'FREE_AGENCY', 'CUTDOWN', 'PROGRESSION', 'PREPARATION',
]);
const PHASE_BY_STEP = Object.freeze(Object.fromEntries(STEPS.map(step => [step,
  step === 'DRAFT' ? 'DRAFT' : step === 'FREE_AGENCY' ? 'FREE_AGENCY' : 'OFFSEASON',
])));
function validateOffseason(state) {
  if (!state || state.version !== 1 || !state.seasons || typeof state.seasons !== 'object' || Array.isArray(state.seasons)) throw Error('Invalid offseason state.');
  for (const [seasonId, season] of Object.entries(state.seasons)) {
    if (season.seasonId !== seasonId || !STEPS.includes(season.step) || !Array.isArray(season.completedSteps)
      || !Number.isInteger(season.revision) || season.revision < 1 || !Array.isArray(season.history)) throw Error('Invalid offseason season record.');
    const index = STEPS.indexOf(season.step);
    if (JSON.stringify(season.completedSteps) !== JSON.stringify(STEPS.slice(0, index))) throw Error('Offseason steps must follow the required order.');
  }
  return state;
}
module.exports = { STEPS, PHASE_BY_STEP, validateOffseason };
