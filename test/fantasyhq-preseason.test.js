const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

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

function buildRosterForTeam(team, seed) {
  const roster = {
    team: {
      name: team.teamName,
      slug: team.teamId,
    },
    rosterDate: "2026-09-29",
    playerCount: 3,
    players: [
      {
        name: `${team.teamName} Guard`,
        overall: 80 + (seed % 5),
        nationality: "United States",
        birthdate: `January ${seed + 1}, 2000`,
        priorToNBA: "College A",
        height: "6'4\"",
        heightCm: 193,
        weightLbs: 190,
        wingspan: "6'8\"",
        yearsInNBA: 3,
        archetype: "Playmaker",
        imageUrl: `https://example.com/${team.teamId}-guard.png`,
        profileUrl: `https://example.com/${team.teamId}-guard`,
        jerseyNumber: 1,
        position1: "PG",
        position2: "SG",
      },
      {
        name: `${team.teamName} Wing`,
        overall: 76 + (seed % 7),
        nationality: "Canada",
        birthdate: `February ${seed + 1}, 2001`,
        priorToNBA: "College B",
        height: "6'7\"",
        heightCm: 201,
        weightLbs: 215,
        wingspan: "6'11\"",
        yearsInNBA: 2,
        archetype: "Two-Way Wing",
        imageUrl: `https://example.com/${team.teamId}-wing.png`,
        profileUrl: `https://example.com/${team.teamId}-wing`,
        jerseyNumber: 7,
        position1: "SF",
        position2: "SG",
      },
      {
        name: `${team.teamName} Big`,
        overall: 74 + (seed % 6),
        nationality: "France",
        birthdate: `March ${seed + 1}, 2002`,
        priorToNBA: "International",
        height: "6'10\"",
        heightCm: 208,
        weightLbs: 240,
        wingspan: "7'2\"",
        yearsInNBA: 1,
        archetype: "Rim Protector",
        imageUrl: `https://example.com/${team.teamId}-big.png`,
        profileUrl: `https://example.com/${team.teamId}-big`,
        jerseyNumber: 15,
        position1: "C",
        position2: "PF",
      },
    ],
  };
  for (let i = 0; i < 12; i++) roster.players.push({ ...roster.players[0], name: `${team.teamName} Reserve ${i}`, overall: 75, position1: ['PG','SG','SF','PF','C'][i % 5], profileUrl: `https://example.com/${team.teamId}-reserve-${i}`, jerseyNumber: 20 + i });
  roster.playerCount = roster.players.length;
  return roster;
}

async function jsonRequest(baseUrl, pathname, options = {}) {
  return callHandler(baseUrl, pathname, options);
}

function createMockRequest(pathname, options = {}) {
  const request = new EventEmitter();
  request.url = pathname;
  request.method = options.method || "GET";
  request.headers = options.headers || {};
  request.start = () => {
    process.nextTick(() => {
      if (options.body) request.emit("data", Buffer.from(options.body));
      request.emit("end");
    });
  };
  return request;
}

function createMockResponse() {
  let resolveResponse;
  const promise = new Promise((resolve) => {
    resolveResponse = resolve;
  });

  return {
    headers: {},
    statusCode: 200,
    chunks: [],
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      if (chunk) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      resolveResponse({
        statusCode: this.statusCode,
        headers: this.headers,
        body: Buffer.concat(this.chunks).toString("utf8"),
      });
    },
    promise,
  };
}

async function callHandler(handler, pathname, options = {}) {
  const request = createMockRequest(pathname, options);
  const response = createMockResponse();
  handler(request, response);
  request.start();
  const result = await response.promise;
  const payload = result.body ? JSON.parse(result.body) : null;
  assert.equal(result.statusCode >= 200 && result.statusCode < 300, true, payload?.error || `Request failed: ${pathname}`);
  return payload;
}

test("preseason website admin flow validates and starts the season with one coach and legacy owner requirements", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fantasyhq-preseason-"));
  const repository = createFantasyHQRepository({ dataRoot: tempRoot });
  const teams = buildFixtureTeams();
  const rosters = new Map(teams.map((team, index) => [team.teamName, buildRosterForTeam(team, index + 1)]));
  const setupService = createSetupService({
    repository,
    sourceTeamsLoader: () => teams,
    sourceFreeAgencyLoader: () => ({ players: [] }),
    sourceRosterLoader: (teamName) => rosters.get(teamName) || null,
  });

  const leagueId = "preseason-test";
  const seasonId = "2026";
  const guildId = "guild-preseason";
  const adminKey = "test-admin-key";

  setupService.createLeague({
    leagueId,
    leagueName: "Preseason Test League",
    seasonNumber: Number(seasonId),
    commissionerUserId: "commissioner-1",
    guildId,
  });
  setupService.importRosters({ leagueId, seasonId, actingUserId: "commissioner-1" });
  for (const team of teams.slice(0, 1)) {
    setupService.assignOwner({
      leagueId,
      seasonId,
      teamId: team.teamId,
      userId: `owner-${team.teamId}`,
      actingUserId: "commissioner-1",
    });
  }
  setupService.updateSettings({
    leagueId,
    seasonId,
    actingUserId: "commissioner-1",
    updates: {
      requireAllOwners: true,
      playoffTeams: 8,
      commissionerApprovalRequired: true,
    },
  });
  repository.saveSettings(leagueId, { ...repository.loadSettings(leagueId), requireAllOwners: true });
  assert.equal(repository.loadOwners(leagueId).length, 1);
  setupService.generatePendingSchedule({ leagueId, seasonId, actingUserId: "commissioner-1" });
  setupService.confirmPendingSchedule({ leagueId, seasonId, actingUserId: "commissioner-1" });
  const activated = setupService.activateLeague({ leagueId, seasonId, actingUserId: "commissioner-1" });
  assert.equal(activated.currentPhase, PHASES.PRESEASON);

  const previousEnv = {
    FANTASYHQ_DATA_ROOT: process.env.FANTASYHQ_DATA_ROOT,
    GUILD_ID: process.env.GUILD_ID,
    WEBSITE_ADMIN_KEY: process.env.WEBSITE_ADMIN_KEY,
  };
  process.env.FANTASYHQ_DATA_ROOT = tempRoot;
  process.env.GUILD_ID = guildId;
  process.env.WEBSITE_ADMIN_KEY = adminKey;

  const ratingsRepository = require("../src/2kratings/repository");
  const originalLoadTeamRoster = ratingsRepository.loadTeamRoster;
  ratingsRepository.loadTeamRoster = (teamName) => rosters.get(teamName) || null;

  delete require.cache[require.resolve("../src/fantasyhq/roster-service")];
  const webModulePath = require.resolve("../src/web");
  delete require.cache[webModulePath];
  const { requestHandler } = require("../src/web");

  const headers = {
    "x-leaguebuddy-admin-key": adminKey,
    "Content-Type": "application/json",
  };

  try {
    const leaguePayload = await jsonRequest(requestHandler, "/api/league-site");
    assert.equal(leaguePayload.league.leagueName, "Preseason Test League");
    assert.equal(leaguePayload.teams.length, 30);
    assert.equal(leaguePayload.league.currentPhase, PHASES.PRESEASON);

    const players = repository.loadPlayers(leagueId);
    const editedPlayer = players.find((player) => player.name === "East Team 1 Guard");
    assert.ok(editedPlayer);

    const editResult = await jsonRequest(requestHandler, `/api/league/admin/players/${encodeURIComponent(editedPlayer.playerId)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        overall: 91,
        nationality: "Australia",
        operator: "Test Operator",
      }),
    });
    assert.equal(editResult.player.overall, 91);
    assert.equal(editResult.player.nationality, "Australia");

    const auditAfterEdit = await jsonRequest(requestHandler, "/api/league/admin/audit-log", { headers });
    const editAudit = auditAfterEdit.auditLog.find((entry) => entry.action === "player.updated");
    assert.equal(editAudit.operator, "Test Operator");
    assert.equal(editAudit.userId, "commissioner-1");

    await jsonRequest(requestHandler, "/api/league/admin/rosters/move-player", {
      method: "POST",
      headers,
      body: JSON.stringify({
        playerId: editedPlayer.playerId,
        fromTeamId: "east-1",
        toTeamId: "east-2",
        operator: "Test Operator",
      }),
    });

    const movedTeam = await jsonRequest(requestHandler, "/api/league/teams/east-2");
    const movedMembership = movedTeam.team.roster.find((entry) => entry.player.playerId === editedPlayer.playerId);
    assert.ok(movedMembership);
    assert.equal(movedMembership.player.playerId, editedPlayer.playerId);

    const importPreview = await jsonRequest(requestHandler, "/api/league/admin/import/preview", {
      method: "POST",
      headers,
      body: JSON.stringify({ teamId: "east-2" }),
    });
    assert.equal(importPreview.preview.teamId, "east-2");
    assert.ok(Array.isArray(importPreview.preview.removed));

    const dataIssues = await jsonRequest(requestHandler, "/api/league/admin/data-issues", { headers });
    assert.equal(dataIssues.issues.filter((issue) => issue.severity === "error").length, 0);

    const unbalancedValidation = await jsonRequest(requestHandler, "/api/league/admin/preseason/validate", { headers });
    assert.equal(unbalancedValidation.ready, false);
    assert.ok(unbalancedValidation.errors.some(error => error.includes('/15 players')));
    const returningPlayer = movedTeam.team.roster.find(entry => entry.player.playerId !== editedPlayer.playerId).player;
    await jsonRequest(requestHandler, "/api/league/admin/rosters/move-player", { method: "POST", headers, body: JSON.stringify({ playerId: returningPlayer.playerId, fromTeamId: "east-2", toTeamId: "east-1", operator: "Test Operator" }) });
    const preseasonValidation = await jsonRequest(requestHandler, "/api/league/admin/preseason/validate", { headers });
    assert.equal(preseasonValidation.ready, true, preseasonValidation.errors.join("\n"));

    const originalSchedule = repository.loadSchedule(leagueId, seasonId);
    const seasonStart = await jsonRequest(requestHandler, "/api/league/admin/start-season", {
      method: "POST",
      headers,
      body: JSON.stringify({ operator: "Test Operator" }),
    });
    assert.equal(seasonStart.league.currentPhase, PHASES.REGULAR_SEASON);

    const savedLeague = repository.loadLeague(leagueId, seasonId);
    assert.equal(savedLeague.league.currentPhase, PHASES.REGULAR_SEASON);
    assert.equal(savedLeague.league.currentWeek, 1);

    const savedSchedule = repository.loadSchedule(leagueId, seasonId);
    assert.equal(savedSchedule.weeks[0].status, "ACTIVE");
    assert.equal(savedSchedule.weeks[1].status, "UPCOMING");
    assert.equal(savedSchedule.weeks.length, 15);
    assert.equal(savedSchedule.weeks.filter(week => week.status === "ACTIVE").length, 1);
    for (const week of savedSchedule.weeks) {
      assert.ok(week.weekId);
      assert.equal(week.weekNumber, week.week);
      assert.equal(week.status, week.week === 1 ? "ACTIVE" : "UPCOMING");
      assert.deepEqual(week.games, originalSchedule.weeks[week.week - 1].games);
      assert.deepEqual(week.byes, originalSchedule.weeks[week.week - 1].byes);
    }
    await jsonRequest(requestHandler, "/api/league/admin/start-season", { method: "POST", headers, body: JSON.stringify({ operator: "Test Operator" }) });
    assert.deepEqual(repository.loadSchedule(leagueId, seasonId), savedSchedule);
    assert.deepEqual(repository.loadLeague(leagueId, seasonId), savedLeague);
  } finally {
    ratingsRepository.loadTeamRoster = originalLoadTeamRoster;
    process.env.FANTASYHQ_DATA_ROOT = previousEnv.FANTASYHQ_DATA_ROOT;
    process.env.GUILD_ID = previousEnv.GUILD_ID;
    process.env.WEBSITE_ADMIN_KEY = previousEnv.WEBSITE_ADMIN_KEY;
  }
});
