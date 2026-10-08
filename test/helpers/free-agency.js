const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFantasyHQRepository } = require('../../src/fantasyhq/repository');
const { createFreeAgencyService, HOUR_MS } = require('../../src/fantasyhq/free-agency-service');
const { activeMemberships } = require('../../src/fantasyhq/service-helpers');
const { playerTransactionLock } = require('../../src/fantasyhq/transaction-locks');
const { normalizeOffer, offerScore, rankOffers, parseContractText } = require('../../src/fantasyhq/offer-score');
function fixture(t, { count = 15, testMode = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-fa-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = createFantasyHQRepository({ dataRoot: root });
  repository.saveLeague('league', { currentPhase: 'REGULAR_SEASON', currentSeasonId: '1', currentWeek: 4 });
  repository.saveTeams('league', ['a','b','c'].map(teamId => ({ teamId, teamName: `Team ${teamId}`, abbreviation: teamId, conference: 'East' })));
  repository.saveSettings('league', { testMode });
  repository.saveOwners('league', ['a','b','c'].map(teamId => ({ teamId, userId: `coach-${teamId}` })));
  repository.saveGuildLeagueBinding('guild', { leagueId: 'league', seasonId: '1' });
  const players = [], memberships = [];
  for (const teamId of ['a','b','c']) for (let i = 0; i < count; i++) { const playerId = `${teamId}-${i}`; players.push({ playerId, name: playerId, teamId, position1: 'PG', overall: 80, contract: normalizeOffer({ salary: 1e7, years: '3', structure: 'Flat', option: 'None' }, { year: 2026 }).contract }); memberships.push({ playerId, teamId, seasonId: '1', active: true }); }
  for (let i = 0; i < 10; i++) players.push({ playerId: `fa-${i}`, name: `Free ${i}`, teamId: null, position1: i === 9 ? 'SG' : 'PG', position2: 'SG', overall: 85 - i });
  repository.savePlayers('league', players); repository.saveRosterMemberships('league', memberships);
  let clock = Date.UTC(2026,9,7,19);
  const service = createFreeAgencyService({ repository, now: () => clock });
  const state = () => repository.loadFreeAgencyState('league');
  const submit = (teamId = 'a', playerId = 'fa-0', overrides = {}) => service.offer('league', { teamId, playerId, actorUserId: `coach-${teamId}`, screenshot: { url: 'https://example.org/proof.png', path: '/tmp/proof.png' }, details: { salary: '$6.66M', years: '3+1', structure: 'Front (-5%)', option: 'Player' }, conditionalReleasePlayerId: count >= 15 ? `${teamId}-0` : null, ...overrides });
  const review = (offerId, decision = 'APPROVE', extra = {}) => service.reviewOffer('league', { offerId, decision, actorUserId: 'staff', staffAuthorized: true, ...extra });
  const advance = ms => clock += ms;
  const roster = teamId => activeMemberships(repository.loadRosterMemberships('league'),'1').filter(m => m.teamId === teamId);
  return { root, repository, service, state, submit, review, advance, roster, time: () => clock };
}
module.exports = { fixture };
