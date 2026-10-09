const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createFantasyHQRepository } = require("../src/fantasyhq/repository");
const { createSetupService } = require("../src/fantasyhq/setup-service");
const { PHASES } = require("../src/fantasyhq/constants");

function buildFixtureTeams() {
  const east = Array.from({ length: 15 }, (_, index) => ({
    teamId: `east-${index + 1}`,
    teamName: `East Team ${index + 1}`,
    abbreviation: `E${String(index + 1).padStart(2, "0")}`,
    conference: "East",
    assignedUserId: null,
  }));

  const west = Array.from({ length: 15 }, (_, index) => ({
    teamId: `west-${index + 1}`,
    teamName: `West Team ${index + 1}`,
    abbreviation: `W${String(index + 1).padStart(2, "0")}`,
    conference: "West",
    assignedUserId: null,
  }));

  return [...east, ...west];
}

function buildRosterForTeam(team) {
  return {
    team: {
      name: team.teamName,
      slug: team.teamId,
    },
    rosterDate: "2026-09-29",
    playerCount: 2,
    players: [
      {
        name: `${team.teamName} Guard`,
        nationality: "United States",
        birthdate: "January 1, 2000",
        priorToNBA: "College A",
        height: "6'4\"",
        heightCm: 193,
        weightLbs: 190,
        wingspan: "6'8\"",
        yearsInNBA: 3,
        archetype: "Playmaker",
        imageUrl: null,
        profileUrl: `https://example.com/${team.teamId}-guard`,
        jerseyNumber: 1,
        position1: "PG",
        position2: "SG",
      },
      {
        name: `${team.teamName} Big`,
        nationality: "United States",
        birthdate: "February 2, 2001",
        priorToNBA: "College B",
        height: "6'10\"",
        heightCm: 208,
        weightLbs: 240,
        wingspan: "7'2\"",
        yearsInNBA: 2,
        archetype: "Rim Protector",
        imageUrl: null,
        profileUrl: `https://example.com/${team.teamId}-big`,
        jerseyNumber: 15,
        position1: "C",
        position2: "PF",
      },
    ],
  };
}

test("setup workflow completes and activates the league", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fantasyhq-setup-"));
  const repository = createFantasyHQRepository({ dataRoot: tempRoot });
  const teams = buildFixtureTeams();
  const rosters = new Map(teams.map((team) => [team.teamName, buildRosterForTeam(team)]));
  const contract = { source: 'basketball-reference', seasons: [{ season: '2026-27', salary: 30000000, option: null }], guaranteedTotal: 60000000 };
  rosters.get(teams[0].teamName).players[0].contract = contract;
  const service = createSetupService({
    repository,
    sourceTeamsLoader: () => teams,
    sourceFreeAgencyLoader: () => ({ players: [] }),
    sourceRosterLoader: (teamName) => rosters.get(teamName) || null,
  });

  const league = service.createLeague({
    leagueId: "league-setup",
    leagueName: "League Setup Test",
    seasonNumber: 2026,
    commissionerUserId: "commissioner-1",
    guildId: "guild-1",
  });

  assert.equal(league.currentPhase, PHASES.SETUP);

  const importResult = service.importRosters({
    leagueId: "league-setup",
    seasonId: "2026",
    actingUserId: "commissioner-1",
  });

  assert.equal(importResult.teamsImported, 30);
  assert.equal(importResult.playersImported, 60);
  assert.deepEqual(repository.loadPlayers('league-setup').find(player => player.name === `${teams[0].teamName} Guard`).contract, contract);

  for (const team of teams) {
    service.assignOwner({
      leagueId: "league-setup",
      seasonId: "2026",
      teamId: team.teamId,
      userId: `owner-${team.teamId}`,
      actingUserId: "commissioner-1",
    });
  }

  service.updateSettings({
    leagueId: "league-setup",
    seasonId: "2026",
    actingUserId: "commissioner-1",
    updates: {
      requireAllOwners: true,
      playoffTeams: 8,
      commissionerApprovalRequired: true,
    },
  });

  const pending = service.generatePendingSchedule({
    leagueId: "league-setup",
    seasonId: "2026",
    actingUserId: "commissioner-1",
  });
  assert.equal(pending.schedule.weeks.length, 15);

  const saved = service.confirmPendingSchedule({
    leagueId: "league-setup",
    seasonId: "2026",
    actingUserId: "commissioner-1",
  });
  assert.equal(saved.weeks.length, 15);

  const validation = service.validateSetup({
    leagueId: "league-setup",
    seasonId: "2026",
  });
  assert.equal(validation.ready, true, validation.errors.join("\n"));

  const activated = service.activateLeague({
    leagueId: "league-setup",
    seasonId: "2026",
    actingUserId: "commissioner-1",
  });

  assert.equal(activated.currentPhase, PHASES.PRESEASON);
  assert.equal(repository.loadAuditLog("league-setup").some((entry) => entry.action === "league.activated"), true);
});

test('free-agent import preserves rosters and edits and is safe to repeat', (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'league-free-agents-'));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const repository = createFantasyHQRepository({ dataRoot });
  const service = createSetupService({ repository, sourceFreeAgencyLoader: () => ({ players: [
    { name: 'Roster Player', profileUrl: 'https://example.com/roster', overall: 80 },
    { name: 'Free Player', profileUrl: 'https://example.com/free', overall: 70 },
    { name: 'Free Player', profileUrl: 'https://example.com/free', overall: 70 },
  ] }) });
  service.createLeague({ leagueId: 'test', leagueName: 'Test', seasonNumber: 1, commissionerUserId: 'admin', guildId: 'guild' });
  repository.savePlayers('test', [{ playerId: 'existing', name: 'Roster Player', profileUrl: 'https://example.com/roster', overall: 95 }]);
  const memberships = [{ playerId: 'existing', teamId: 'team', seasonId: '1' }];
  repository.saveRosterMemberships('test', memberships);
  const args = { leagueId: 'test', seasonId: '1', actingUserId: 'admin' };
  assert.equal(service.importFreeAgents(args).imported, 1);
  assert.equal(service.importFreeAgents(args).imported, 0);
  assert.equal(repository.loadPlayers('test').length, 2);
  assert.equal(repository.loadPlayers('test')[0].overall, 95);
  assert.equal(repository.loadPlayers('test')[1].teamId, null);
  assert.deepEqual(repository.loadRosterMemberships('test'), memberships);
  repository.saveLeague('test', { currentPhase: PHASES.PRESEASON });
  assert.equal(service.importFreeAgents(args).imported, 0);
  repository.saveLeague('test', { currentPhase: PHASES.REGULAR_SEASON });
  assert.throws(() => service.importFreeAgents(args), /phase/i);
});

test('guided creation imports rosters and free agents and supports solo testing', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guided-setup-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const repository=createFantasyHQRepository({dataRoot:root});
  const teams=buildFixtureTeams();
  const service=createSetupService({repository,sourceTeamsLoader:()=>teams,sourceRosterLoader:name=>buildRosterForTeam(teams.find(team=>team.teamName===name)),sourceFreeAgencyLoader:()=>({players:[{name:'Test Free Agent',overall:70}]})});
  const args={leagueId:'fresh-test',leagueName:'Fresh',seasonNumber:1,commissionerUserId:'c',guildId:'g',testMode:true};
  const result=service.createLeagueWithRosters(args);
  assert.equal(result.importError,null);
  assert.equal(result.imported.teamsImported,30);
  assert.equal(result.imported.freeAgentsImported,1);
  assert.equal(repository.loadSettings('fresh-test').requireAllOwners,false);
  repository.saveLeague('fresh-test',{currentPhase:PHASES.PRESEASON});
  assert.throws(()=>service.createLeague(args),/already exists/);
  assert.equal(repository.loadLeague('fresh-test').league.currentPhase,PHASES.PRESEASON);
  assert.throws(()=>service.createLeague({...args,leagueId:'other'}),/already has a league/);
  assert.equal(repository.leagueExists('other'),false);
  assert.throws(()=>service.createLeague({...args,leagueId:'../bad',guildId:'other'}),/letters/);
});

test('failed initial import reports recovery without recreating the league',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guided-fail-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const repository=createFantasyHQRepository({dataRoot:root});
  const service=createSetupService({repository,sourceTeamsLoader:()=>{throw Error('Missing roster snapshot')}});
  const result=service.createLeagueWithRosters({leagueId:'fresh',leagueName:'Fresh',seasonNumber:1,commissionerUserId:'c',guildId:'g'});
  assert.equal(result.imported,null);
  assert.match(result.importError,/Missing roster snapshot/);
  assert.equal(repository.loadGuildLeagueBinding('g').leagueId,'fresh');
  assert.equal(repository.loadSettings('fresh').requireAllOwners,false);
});

for (const coachCount of [0, 1, 15, 30]) {
  test(`setup activates with ${coachCount} coaches despite a legacy all-owners setting`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-coach-count-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const repository = createFantasyHQRepository({ dataRoot: root });
    const teams = buildFixtureTeams();
    const service = createSetupService({ repository, sourceTeamsLoader: () => teams,
      sourceRosterLoader: name => buildRosterForTeam(teams.find(team => team.teamName === name)),
      sourceFreeAgencyLoader: () => ({ players: [] }) });
    const args = { leagueId: 'league', seasonId: '1', actingUserId: 'staff' };
    service.createLeague({ leagueId: 'league', leagueName: 'League', seasonNumber: 1,
      commissionerUserId: 'staff', guildId: 'guild' });
    service.importRosters(args);
    for (const team of teams.slice(0, coachCount)) service.assignOwner({ ...args, teamId: team.teamId, userId: `coach-${team.teamId}` });
    repository.saveSettings('league', { ...repository.loadSettings('league'), requireAllOwners: true });
    service.generatePendingSchedule(args);
    service.confirmPendingSchedule(args);
    const validation = service.validateSetup(args);
    assert.equal(validation.ready, true, validation.errors.join('\n'));
    assert.equal(validation.checks.ownersAssigned, coachCount === 30);
    assert.equal(service.activateLeague(args).currentPhase, PHASES.PRESEASON);
    assert.equal(repository.loadOwners('league').length, coachCount);
  });
}
