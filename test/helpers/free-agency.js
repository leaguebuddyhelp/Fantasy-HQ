const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFantasyHQRepository } = require('../../src/fantasyhq/repository');
const { activeMemberships } = require('../../src/fantasyhq/service-helpers');
const { playerTransactionLock } = require('../../src/fantasyhq/transaction-locks');
const { normalizeContractDetails } = require('../../src/fantasyhq/contract-details');
function fixture(t, { count = 15, testMode = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-fa-')); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = testMode ? path.join(base,'simulations','fixture','workspace') : base;
  const repository = createFantasyHQRepository({ dataRoot: root });
  repository.saveLeague('league', { currentPhase: 'REGULAR_SEASON', currentSeasonId: '1', currentWeek: 4 });
  repository.saveTeams('league', ['a','b','c'].map(teamId => ({ teamId, teamName: `Team ${teamId}`, abbreviation: teamId, conference: 'East' })));
  repository.saveSettings('league', { testMode, ...(testMode?{simulationId:'fixture'}:{}) });
  repository.saveOwners('league', ['a','b','c'].map(teamId => ({ teamId, userId: `coach-${teamId}` })));
  repository.saveGuildLeagueBinding('guild', { leagueId: 'league', seasonId: '1' });
  const players = [], memberships = [];
  for (const teamId of ['a','b','c']) for (let i = 0; i < count; i++) { const playerId = `${teamId}-${i}`; players.push({ playerId, name: playerId, teamId, position1: 'PG', overall: 80, contract: normalizeContractDetails({ salary: 1e7, years: '3', structure: 'Flat', option: 'None' }, { year: 2026 }).contract }); memberships.push({ playerId, teamId, seasonId: '1', active: true }); }
  for (let i = 0; i < 10; i++) players.push({ playerId: `fa-${i}`, name: `Free ${i}`, teamId: null, position1: i === 9 ? 'SG' : 'PG', position2: 'SG', overall: 85 - i });
  repository.savePlayers('league', players); repository.saveRosterMemberships('league', memberships);
  let clock = Date.UTC(2026,9,7,19);
  const state = () => repository.loadFreeAgencyState('league');
  const advance = ms => clock += ms;
  const roster = teamId => activeMemberships(repository.loadRosterMemberships('league'),'1').filter(m => m.teamId === teamId);
  return { root, repository, state, advance, roster, time: () => clock };
}
module.exports = { fixture };
