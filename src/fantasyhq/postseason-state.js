const STAGES = Object.freeze({
  PLAY_IN: { wins: 1, hours: 24 },
  FIRST_ROUND: { wins: 2, hours: 48 },
  SECOND_ROUND: { wins: 3, hours: 72 },
  CONFERENCE_FINALS: { wins: 3, hours: 72 },
  NBA_FINALS: { wins: 4, hours: 96 },
});
const STAGE_ORDER = Object.keys(STAGES);
function validateSeeds(seeds, teams) {
  const all = new Set();
  for (const conference of ['East', 'West']) {
    if (!Array.isArray(seeds?.[conference]) || seeds[conference].length !== 10) throw Error('Ten seeds are required in each conference.');
    for (const seed of seeds[conference]) {
      const id = typeof seed === 'string' ? seed : seed.teamId;
      if (!teams.some(t => t.teamId === id && t.conference === conference) || all.has(id)) throw Error('Seeds must be unique eligible teams in their own conference.');
      all.add(id);
    }
  }
  return seeds;
}
function matchup(id, stage, conference, team1Id, team2Id) {
  if (!team1Id || !team2Id || team1Id === team2Id) throw Error('Invalid postseason matchup.');
  return { id, stage, conference, team1Id, team2Id, requiredWins: STAGES[stage].wins, gameIds: [], wins: { [team1Id]: 0, [team2Id]: 0 }, winnerTeamId: null, status: 'ACTIVE', discordThreadId: null };
}
function initializePostseason({ leagueId, seasonId, seeds, teams, now = Date.now(), ...metadata }) {
  validateSeeds(seeds, teams);
  const ids = Object.fromEntries(['East','West'].map(c => [c, seeds[c].map(t => typeof t === 'string' ? t : t.teamId)]));
  return { ...metadata, version: 2, leagueId, seasonId, seeds: structuredClone(seeds), stage: 'PLAY_IN', revision: 0,
    rounds: [{ stage: 'PLAY_IN', startedAt: new Date(now).toISOString(), deadlineAt: new Date(now + 24 * 3600000).toISOString(), completedAt: null }],
    series: ['East','West'].flatMap(c => [matchup(`${c}:7-8`, 'PLAY_IN', c, ids[c][6], ids[c][7]), matchup(`${c}:9-10`, 'PLAY_IN', c, ids[c][8], ids[c][9])]),
    qualifiedSeeds: {}, conflicts: [], events: [], champion: null };
}
function validatePostseason(state) {
  if (state?.version !== 2 || !state.leagueId || !state.seasonId || !STAGES[state.stage] || !Array.isArray(state.series) || !Array.isArray(state.rounds) || !Array.isArray(state.conflicts) || !Array.isArray(state.events)) throw Error('Unsupported or corrupt postseason state. Existing data was preserved.');
  if(!Number.isInteger(state.revision)||state.revision<0||!state.qualifiedSeeds||typeof state.qualifiedSeeds!=='object')throw Error('Invalid postseason revision or qualifiers.');
  const seedIds=['East','West'].flatMap(c=>{if(!Array.isArray(state.seeds?.[c])||state.seeds[c].length!==10)throw Error('Ten seeds are required in each conference.');return state.seeds[c].map(t=>typeof t==='string'?t:t?.teamId);});
  if(seedIds.some(id=>!id)||new Set(seedIds).size!==20)throw Error('Invalid unique postseason seeds.');
  const roundStages=new Set();for(const round of state.rounds){if(!STAGES[round.stage]||roundStages.has(round.stage)||!Number.isFinite(Date.parse(round.startedAt))||!Number.isFinite(Date.parse(round.deadlineAt))||Date.parse(round.deadlineAt)<Date.parse(round.startedAt))throw Error('Invalid postseason deadline state.');roundStages.add(round.stage);}
  if(state.rounds.at(-1)?.stage!==state.stage)throw Error('Current postseason stage has no deadline.');
  const ids = new Set(), games = new Set();
  for (const s of state.series) {
    if (!s.id || ids.has(s.id) || !STAGES[s.stage] || s.requiredWins !== STAGES[s.stage].wins || !s.team1Id || !s.team2Id || s.team1Id === s.team2Id || !Array.isArray(s.gameIds)) throw Error('Invalid postseason series.');
    if(!seedIds.includes(s.team1Id)||!seedIds.includes(s.team2Id)||![s.team1Id,s.team2Id].every(id=>Number.isInteger(s.wins?.[id])&&s.wins[id]>=0&&s.wins[id]<=s.requiredWins)||s.winnerTeamId&&![s.team1Id,s.team2Id].includes(s.winnerTeamId))throw Error('Invalid postseason teams or victory state.');
    ids.add(s.id);
    for (const game of s.gameIds) { if (!game || typeof game!=='string'||games.has(game)) throw Error('A postseason game belongs to multiple series.'); games.add(game); }
  }
  return state;
}
function requireCommissioner(context, actor) {
  if (!actor?.authorized || !actor.id || context.league.commissionerUserId !== actor.id) throw Error('Only the league commissioner can perform this action.');
}
function requirePostseasonStaff(context, actor) {
  if (actor?.id === context.league.commissionerUserId && actor?.authorized) return;
  if (!actor?.staffAuthorized || !actor.id) throw Error('Staff authorization required.');
}
module.exports = { STAGES, STAGE_ORDER, validateSeeds, matchup, initializePostseason, validatePostseason, requireCommissioner, requirePostseasonStaff };
