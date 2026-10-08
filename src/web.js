if (require.main === module) {
  require("dotenv").config();
}

const fs = require("fs");
const http = require("http");
const path = require("path");

const { createDataIssuesService } = require("./fantasyhq/data-issues-service");
const { createLeagueService } = require("./fantasyhq/league-service");
const { createPlayerService } = require("./fantasyhq/player-service");
const { createPlayerStatsService } = require("./fantasyhq/player-stats-service");
const { createPreseasonValidator } = require("./fantasyhq/preseason-validator");
const { createRosterService } = require("./fantasyhq/roster-service");
const { createSetupService } = require("./fantasyhq/setup-service");
const { createTeamService } = require("./fantasyhq/team-service");
const { createTeamStatsService } = require("./fantasyhq/team-stats-service");
const { createGameSubmissionService } = require("./fantasyhq/game-submissions");
const { createPlayerUpgradeService } = require("./fantasyhq/player-upgrades-service");

const ROOT_DIR = path.resolve(__dirname, "..");
const WEB_DIR = path.join(ROOT_DIR, "web");
const DRAFT_CLASS_DIR = path.join(ROOT_DIR, "draft_class");
const DRAFT_IMAGE_DIR = path.join(DRAFT_CLASS_DIR, "images");
const setupService = createSetupService();
const leagueService = createLeagueService({ repository: setupService.repository });
const playerStatsService = createPlayerStatsService({ repository: setupService.repository, publishedOnly: true });
const teamService = createTeamService({ repository: setupService.repository, playerStatsService, publishedOnly: true });
const teamStatsService = createTeamStatsService({ repository: setupService.repository, publishedOnly: true });
const webGameSubmissions = createGameSubmissionService({ repository: setupService.repository });
const webPlayerUpgrades = createPlayerUpgradeService({ repository: setupService.repository, submissions: webGameSubmissions });
webGameSubmissions.setFinalizationHandler(record => webPlayerUpgrades.reconcileFinalizedGames({ leagueId: record.game.leagueId, seasonId: record.game.seasonId }));
let playerUpgradeRuntime = { service: webPlayerUpgrades, submissions: webGameSubmissions };
const invalidateUpgradeRequests = event => (playerUpgradeRuntime.invalidatePlayerRequests || (value => playerUpgradeRuntime.service.invalidatePlayerRequests(value)))(event);
const playerService = createPlayerService({ repository: setupService.repository, onRosterMovement: invalidateUpgradeRequests });
const rosterService = createRosterService({ repository: setupService.repository, onRosterMovement: invalidateUpgradeRequests });
const dataIssuesService = createDataIssuesService({ repository: setupService.repository });
const preseasonValidator = createPreseasonValidator({ repository: setupService.repository, dataIssuesService });

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const BOARD_TYPES = {
  "top-ten": { id: "top-ten", label: "Early Top Ten", target: 10, pattern: /early top ten/i },
  "big-board": { id: "big-board", label: "Year Big Board", target: 75, pattern: /big board/i },
};

function draftClassFiles(boardId = null) {
  try {
    return fs.readdirSync(DRAFT_CLASS_DIR)
      .filter((file) => file.toLowerCase().endsWith(".json"))
      .filter((file) => !/recruiting|transfer portal/i.test(file))
      .filter((file) => !boardId || BOARD_TYPES[boardId]?.pattern.test(file))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

function classLabel(fileName) {
  return String(fileName || "")
    .replace(/\.json$/i, "")
    .replace(/\s+-\s+(Early Top Ten|Big Board)$/i, "");
}

function resolveDraftClass(selection, boardId = "top-ten") {
  const files = draftClassFiles(boardId);
  if (!files.length) return null;
  if (!selection) return files[0];
  const normalized = String(selection).trim().toLowerCase();
  return files.find((file) => file.toLowerCase() === normalized)
    || files.find((file) => classLabel(file).toLowerCase() === normalized)
    || null;
}

function publicImageUrl(image) {
  const value = String(image || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const normalized = value.replaceAll("\\", "/").replace(/^images\//i, "");
  const webpPath = normalized.replace(/\.[^.]+$/, ".webp");
  const optimizedFile = safeFile(DRAFT_IMAGE_DIR, webpPath);
  const servedPath = optimizedFile && fs.existsSync(optimizedFile) ? webpPath : normalized;
  return `/draft-assets/${servedPath.split("/").map(encodeURIComponent).join("/")}`;
}

function bundledImageMap(fileName) {
  const classId = String(fileName || "")
    .replace(/\.json$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const classImageDirectory = path.join(DRAFT_IMAGE_DIR, classId);
  const images = new Map();
  if (!fs.existsSync(classImageDirectory)) return images;

  for (const position of fs.readdirSync(classImageDirectory, { withFileTypes: true })) {
    if (!position.isDirectory()) continue;
    const positionDirectory = path.join(classImageDirectory, position.name);
    for (const file of fs.readdirSync(positionDirectory)) {
      const match = file.match(/^(\d{3})-/);
      if (!match) continue;
      const absolutePath = path.join(positionDirectory, file);
      if (!fs.statSync(absolutePath).isFile()) continue;
      images.set(Number(match[1]), path.relative(DRAFT_CLASS_DIR, absolutePath).replaceAll(path.sep, "/"));
    }
  }
  return images;
}

function readProspects(fileName) {
  const raw = JSON.parse(fs.readFileSync(path.join(DRAFT_CLASS_DIR, fileName), "utf8"));
  const bundledImages = bundledImageMap(fileName);
  return Object.values(raw || {})
    .sort((a, b) => Number(a.board_number || a.id_number || 0) - Number(b.board_number || b.id_number || 0))
    .map((prospect) => {
      const rank = Number(prospect.board_number || prospect.id_number || 0);
      return {
        ...prospect,
        rank,
        image: publicImageUrl(prospect.image || bundledImages.get(rank)),
      };
    });
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": MIME_TYPES[".json"],
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendNoContent(response, status = 204) {
  response.writeHead(status, { "Cache-Control": "no-store" });
  response.end();
}

function safeFile(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(resolvedRoot, relativePath);
  if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  return resolvedFile;
}

function sendFile(response, filePath, cacheControl = "no-cache") {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
  });
  fs.createReadStream(filePath).pipe(response);
}

function parseJsonBody(request, maxBytes = 512000) {
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0, oversized = false;
    request.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes > maxBytes) { oversized = true; reject(new Error(`Request body must be ${Math.floor(maxBytes / 1024)} KB or smaller.`)); } else if (!oversized) chunks.push(chunk); });
    request.on("end", () => {
      if (oversized) return;
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(require('./shared/website-auth').bindWebsiteOperator(request, JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      } catch (error) {
        reject(new Error("Invalid JSON request body."));
      }
    });
    request.on("error", reject);
  });
}

function adminKeyValue() {
  return String(process.env.WEBSITE_ADMIN_KEY || "").trim();
}

function websiteOperator(body = {}) {
  const operator = String(body.operator || "").trim();
  if (!operator || operator.length > 100) throw new Error("Enter your commissioner name (up to 100 characters).");
  return operator;
}

function isAdminRequest(request) { return !!require('./shared/website-auth').websitePrincipal(request); }

function leagueSitePayload() {
  const guildId = process.env.GUILD_ID;
  if (!guildId) return null;
  if (!leagueService.repository.loadGuildLeagueBinding(guildId) && !process.env.FANTASYHQ_LEAGUE_ID) return null;

  const context = leagueService.getBoundLeagueContext({ guildId });
  const repository = leagueService.repository;
  const teams = teamService.listTeams(context.league.leagueId, context.seasonId);
  const players = playerService.listPlayers(context.league.leagueId, context.seasonId);
  const memberships = rosterService.currentRosterEntries(context.league.leagueId, context.seasonId);
  const owners = repository.loadOwners(context.league.leagueId);
  const settings = repository.loadSettings(context.league.leagueId);
  const dashboard = setupService.getSetupDashboard({
    leagueId: context.league.leagueId,
    seasonId: context.seasonId,
  });
  const preseason = preseasonValidator.validate({
    leagueId: context.league.leagueId,
    seasonId: context.seasonId,
  });

  const schedule = repository.scheduleExists(context.league.leagueId, context.seasonId)
    ? repository.loadSchedule(context.league.leagueId, context.seasonId)
    : null;

  const teamNameById = new Map(teams.map((team) => [team.teamId, team.teamName]));

  const serializedTeams = [...teams].map((team) => ({
    teamId: team.teamId,
    teamName: team.teamName,
    abbreviation: team.abbreviation,
    conference: team.conference,
    ownerUserId: team.ownerUserId,
    ownerDisplayName: team.ownerDisplayName,
    rosterSize: team.rosterSize,
    rosterImported: team.rosterSize > 0,
    schedule: team.schedule,
  }));

  const schedulePreview = schedule ? schedule.weeks.slice(0, 2).map((week) => ({
    week: week.week,
    games: week.games.map((game) => ({
      team1Name: teamNameById.get(game.team1Id) || game.team1Id,
      team2Name: teamNameById.get(game.team2Id) || game.team2Id,
      conference: game.conference,
    })),
    byes: week.byes.map((bye) => ({
      teamName: teamNameById.get(bye.teamId) || bye.teamId,
      conference: bye.conference,
    })),
  })) : [];

  return {
    league: {
      leagueId: context.league.leagueId,
      leagueName: context.league.leagueName,
      seasonNumber: context.league.seasonNumber,
      currentPhase: context.league.currentPhase,
      currentWeek: context.league.currentWeek,
    },
    summary: {
      teams: context.teams.length,
      players: players.length,
      weeks: schedule?.weeks?.length || 0,
      games: schedule ? schedule.weeks.reduce((count, week) => count + week.games.length, 0) : 0,
      ownersAssigned: owners.length,
      rostersImported: new Set(memberships.map((entry) => entry.membership.teamId)).size,
      eastTeams: teams.filter((team) => team.conference === "East").length,
      westTeams: teams.filter((team) => team.conference === "West").length,
    },
    settings: settings || null,
    teams: serializedTeams,
    players,
    schedulePreview,
    admin: {
      readyToActivate: preseason.ready,
      rosterIssues: preseason.issues.filter((issue) => issue.type === "empty-roster" || issue.type === "suspicious-roster-size").length,
      dataWarnings: preseason.warnings.length,
      unassignedTeams: dashboard.unassignedTeams,
      errors: preseason.errors,
      warnings: preseason.warnings,
    },
    preseason,
  };
}

function boundLeagueContext() {
  const guildId = process.env.GUILD_ID;
  if (!guildId) throw new Error("GUILD_ID is required for website league data.");
  return leagueService.getBoundLeagueContext({ guildId });
}

let gameThreadRuntime;
function setGameThreadRuntime(runtime) { gameThreadRuntime = runtime; }
function setPlayerUpgradeRuntime(runtime) { playerUpgradeRuntime = runtime; }
function unsafeRequestHandler(request, response) {
  const url = new URL(request.url, "http://localhost");
  if (require("./fantasyhq/box-score/review-route").handleBoxScoreReview(request, response, url, {
    authorized: isAdminRequest(request),
    ...(playerUpgradeRuntime?.submissions ? { submissions: playerUpgradeRuntime.submissions } : {}),
  })) return;

  if (['/api/league/coach-session','/api/league/sportsbook','/api/league/sportsbook/mine','/api/league/sportsbook/bet','/api/league/admin/sportsbook'].includes(url.pathname)) {
    (async () => {
      try {
        const repository = gameThreadRuntime?.repository || setupService.repository;
        const context = repository.loadLeagueContext({guildId: process.env.GUILD_ID}), leagueId = context.league.leagueId;
        const sessions = require('./fantasyhq/coach-web-session').createCoachWebSessions({repository,
          fetchMember: async (guildId,userId) => {
            if(!gameThreadRuntime?.client?.isReady()) throw Error('Discord must be connected to verify coach access.');
            const guild = await gameThreadRuntime.client.guilds.fetch(guildId);
            return guild.members.fetch({user:userId,force:true});
          }});
        const sportsbook = require('./fantasyhq/sportsbook-service').createSportsbookService({repository,
          submissions: playerUpgradeRuntime?.submissions || webGameSubmissions});
        if(url.pathname === '/api/league/coach-session') {
          if(request.method !== 'POST') {sendJson(response,405,{error:'Method not allowed.'});return;}
          const body = await parseJsonBody(request,4096);
          if(body.action === 'logout') {response.setHeader('Set-Cookie',sessions.logout(leagueId,request));sendJson(response,200,{signedOut:true});return;}
          const result = await sessions.exchange(leagueId,body.token,request);
          response.setHeader('Set-Cookie',result.cookie);sendJson(response,200,{coachUserId:result.actor.id,teamId:result.actor.teamId});return;
        }
        if(url.pathname === '/api/league/admin/sportsbook') {
          if(!isAdminRequest(request)) {sendJson(response,403,{error:'Staff authorization required.'});return;}
          if(request.method !== 'GET') {sendJson(response,405,{error:'Method not allowed.'});return;}
          sendJson(response,200,sportsbook.staff(leagueId,{id:require('./shared/website-auth').websitePrincipal(request).principal,authorized:true}));return;
        }
        if(url.pathname === '/api/league/sportsbook') {
          if(request.method !== 'GET') {sendJson(response,405,{error:'Method not allowed.'});return;}
          const state=sportsbook.refresh(leagueId),simulationId=repository.loadSettings(leagueId).simulationId||null;
          sendJson(response,200,{seasonId:context.seasonId,week:context.league.currentWeek,
            markets:state.markets.filter(m=>m.seasonId===context.seasonId&&m.simulationId===simulationId&&(!url.searchParams.get('gameId')||m.gameId===url.searchParams.get('gameId'))),
            games:(playerUpgradeRuntime?.submissions||webGameSubmissions).records().filter(r=>r.game.leagueId===leagueId&&r.game.seasonId===context.seasonId&&(simulationId?r.game.simulationId===simulationId:!r.game.simulationId)).map(r=>({gameId:r.game.gameId,week:r.game.weekNumber,team1Id:r.game.team1Id,team2Id:r.game.team2Id,team1Name:r.game.team1Name,team2Name:r.game.team2Name})),
            leaderboard:sportsbook.leaderboard(leagueId)});return;
        }
        if(url.pathname === '/api/league/sportsbook/mine') {
          if(request.method !== 'GET') {sendJson(response,405,{error:'Method not allowed.'});return;}
          const actor=await sessions.authenticate(leagueId,request);sendJson(response,200,{...sportsbook.mine(leagueId,actor),coachUserId:actor.id,teamId:actor.teamId});return;
        }
        if(request.method !== 'POST') {sendJson(response,405,{error:'Method not allowed.'});return;}
        const actor=await sessions.authenticate(leagueId,request,{mutation:true}),body=await parseJsonBody(request,64*1024);
        if(body.action==='preview') sendJson(response,200,sportsbook.preview(leagueId,actor,{marketIds:body.marketIds,wager:body.wager}));
        else if(body.action==='confirm') sendJson(response,200,sportsbook.confirm(leagueId,actor,body.token));
        else sendJson(response,400,{error:'Choose preview or confirm.'});
      } catch(error) {sendJson(response,400,{error:error.message});}
    })();return;
  }

  const weeklyTeamMatch = url.pathname.match(/^\/api\/league\/weekly\/([^/]+)$/);
  if (url.pathname === '/api/league/admin/weekly' || weeklyTeamMatch) {
    const staff = !weeklyTeamMatch;
    if (staff && !isAdminRequest(request, url)) { sendJson(response, 403, { error: 'Admin authorization required.' }); return; }
    if (request.method !== 'GET') { sendJson(response, 405, { error: 'Method not allowed.' }); return; }
    try {
      const repository = gameThreadRuntime?.repository || setupService.repository;
      const service = require('./fantasyhq/weekly-dashboard-service').createWeeklyDashboardService({ repository, ...(playerUpgradeRuntime?.submissions ? { submissions: playerUpgradeRuntime.submissions } : {}) });
      const guildId = process.env.GUILD_ID;
      sendJson(response, 200, staff ? service.report(guildId) : service.teamDashboard(guildId, decodeURIComponent(weeklyTeamMatch[1]), false));
    } catch (error) { sendJson(response, 400, { error: error.message }); }
    return;
  }

  if (url.pathname === "/api/league/admin/game-cleanup") {
    if (!isAdminRequest(request, url)) { sendJson(response, 403, { error: 'Admin authorization required.' }); return; }
    (async () => {
      try {
        if (!gameThreadRuntime?.client.isReady() || !gameThreadRuntime.cleanupService) throw Error('Start the connected bot with npm start.');
        const guild = await gameThreadRuntime.client.guilds.fetch(process.env.GUILD_ID), service = gameThreadRuntime.cleanupService;
        if (request.method === 'GET') { sendJson(response, 200, service.list(guild.id, { authorized: true, id: 'website-commissioner' })); return; }
        if (request.method !== 'POST') { sendJson(response, 405, { error: 'Method not allowed.' }); return; }
        let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 4096) throw Error('Request too large.'); }
        const input = JSON.parse(body), operator = String(input.operator || '').trim(); if (!operator || operator.length > 100) throw Error('Enter your commissioner name.');
        const league = (gameThreadRuntime.repository || setupService.repository).loadLeagueContext({ guildId: guild.id }).league;
        const actor = { authorized: true, id: 'website-commissioner:' + operator, operator, commissionerUserId: league.commissionerUserId || 'website-admin' };
        if (input.action === 'prepare') sendJson(response, 200, await service.prepare(guild, actor, input.week));
        else if (input.action === 'confirm') sendJson(response, 200, await service.cleanup(guild, actor, input.token));
        else if (input.action === 'cancel') { service.cancel(input.token, actor); sendJson(response, 200, { cancelled: true }); }
        else throw Error('Unknown action.');
      } catch (error) { sendJson(response, 400, { error: error.message }); }
    })(); return;
  }

  if (url.pathname === '/api/league/admin/backups') {
    if (!isAdminRequest(request)) { sendJson(response, 403, { error: 'Commissioner website key required.' }); return; }
    if (request.method !== 'POST') { sendJson(response, 405, { error: 'Use POST to create a backup.' }); return; }
    (async () => { try {
      const body = await parseJsonBody(request); websiteOperator(body);
      const repository = playerUpgradeRuntime?.repository || leagueService.repository;
      sendJson(response, 200, require('./fantasyhq/storage-safety').createStorageBackup(repository.dataRoot));
    } catch(error) { sendJson(response, 400, { error: error.message }); } })(); return;
  }
  if (url.pathname === '/api/league/admin/news') {
    if(!isAdminRequest(request)){sendJson(response,403,{error:'Staff website credentials required.'});return;}
    (async()=>{try{
      const context=boundLeagueContext(),principal=require('./shared/website-auth').websitePrincipal(request),actor={id:principal?.operator||context.league.commissionerUserId,authorized:true,staffAuthorized:true};
      const service=require('./fantasyhq/news-service').createNewsService({repository:setupService.repository,submissions:webGameSubmissions}),leagueId=context.league.leagueId;
      if(request.method==='GET'){sendJson(response,200,{articles:service.staffList(leagueId,actor)});return;}
      if(request.method!=='POST'){sendJson(response,405,{error:'Method not allowed.'});return;}const body=await parseJsonBody(request);websiteOperator(body);sendJson(response,200,service.review(leagueId,actor,body));
    }catch(error){sendJson(response,400,{error:error.message});}})();return;
  }

  if (url.pathname === '/api/league/admin/offseason-free-agency') {
    if (!isAdminRequest(request)) { sendJson(response, 403, {error:'Staff website credentials required.'}); return; }
    (async()=>{try{
      const context=boundLeagueContext(),principal=require('./shared/website-auth').websitePrincipal(request),repository=playerUpgradeRuntime?.repository||leagueService.repository;
      const service=require('./fantasyhq/offseason-free-agency').createOffseasonFreeAgencyService({repository}),actor={id:principal?.operator||context.league.commissionerUserId,authorized:true,staffAuthorized:true},leagueId=context.league.leagueId;
      if(request.method==='GET'){
        if(url.searchParams.get('imageId')){const original=service.readOriginal(leagueId,actor,url.searchParams.get('imageId'));if(url.searchParams.get('preview')==='1'){original.bytes=await require('./fantasyhq/offseason-image').normalize(original.bytes);original.contentType='image/png';}response.writeHead(200,{'Content-Type':original.contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(original.bytes);}
        else sendJson(response,200,service.inspect(leagueId,actor,{staff:true}));return;
      }
      if(request.method!=='POST'){sendJson(response,405,{error:'Method not allowed.'});return;}const body=await parseJsonBody(request,34*1024*1024);websiteOperator(body);
      if(['open','extend','pause','resume','close','complete'].includes(body.action))sendJson(response,200,service.stageAction(leagueId,actor,body));
      else if(body.action==='prepare-approval')sendJson(response,200,service.prepareApproval(leagueId,actor,body.offerIds));
      else if(body.action==='confirm-approval')sendJson(response,200,service.confirmApproval(leagueId,actor,body.token));
      else if(body.action==='reject')sendJson(response,200,service.reject(leagueId,actor,body));
      else if(body.action==='upload'){if(typeof body.base64!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64))throw Error('Invalid image upload.');sendJson(response,200,await service.upload(leagueId,actor,{filename:body.filename,bytes:Buffer.from(body.base64,'base64')}));}
      else if(body.action==='retry')sendJson(response,200,{image:await service.retry(leagueId,actor,body.imageId)});
      else if(body.action==='prepare-verification')sendJson(response,200,service.prepareVerification(leagueId,actor,body));
      else if(body.action==='confirm-verification')sendJson(response,200,service.confirmVerification(leagueId,actor,body.token));
      else throw Error('Unknown offseason free-agency action.');
    }catch(error){sendJson(response,400,{error:error.message});}})();return;
  }

  if (url.pathname === '/api/league/admin/offseason-rosters') {
    if (!isAdminRequest(request)) { sendJson(response, 403, { error: 'Commissioner website key required.' }); return; }
    (async () => { try {
      const context = boundLeagueContext(), principal = require('./shared/website-auth').websitePrincipal(request);
      if (principal?.operator && principal.operator !== context.league.commissionerUserId) throw Error('Use commissioner credentials for offseason roster controls.');
      const repository = playerUpgradeRuntime?.repository || leagueService.repository;
      const service = require('./fantasyhq/offseason-roster-service').createOffseasonRosterService({ repository });
      const actor = { authorized: true, id: context.league.commissionerUserId }, leagueId = context.league.leagueId;
      if (request.method === 'GET') { sendJson(response, 200, service.inspect(leagueId)); return; }
      if (request.method !== 'POST') { sendJson(response, 405, { error: 'Method not allowed.' }); return; }
      const body = await parseJsonBody(request); websiteOperator(body);
      if (['open','extend'].includes(body.action)) sendJson(response, 200, service.windowAction(leagueId, actor, body));
      else if (body.action === 'prepare') sendJson(response, 200, service.prepareCompletion(leagueId, actor));
      else if (body.action === 'confirm') sendJson(response, 200, service.confirmCompletion(leagueId, actor, body.token));
      else if (body.action === 'prepare-waiver') sendJson(response, 200, service.prepareWaiver(leagueId, actor, body.playerId));
      else if (body.action === 'confirm-waiver') sendJson(response, 200, service.confirmWaiver(leagueId, actor, body.token));
      else throw Error('Unknown roster action.');
    } catch(error) { sendJson(response, 400, { error: error.message }); } })(); return;
  }

  if (url.pathname === '/api/league/admin/offseason-import') {
    if (!isAdminRequest(request)) { sendJson(response, 403, { error: 'Commissioner website key required.' }); return; }
    (async () => { try {
      const context = boundLeagueContext(), principal = require('./shared/website-auth').websitePrincipal(request);
      if (principal?.operator && principal.operator !== context.league.commissionerUserId) throw Error('Use credentials keyed by the commissioner Discord user ID for offseason imports.');
      const repository = playerUpgradeRuntime?.repository || leagueService.repository;
      const step = url.searchParams.get('step') || repository.loadOffseason(context.league.leagueId)?.seasons[context.seasonId]?.step;
      const service = require('./fantasyhq/offseason-import-service').createOffseasonImportService({ repository, step });
      const actor = { authorized: true, id: context.league.commissionerUserId }, leagueId = context.league.leagueId;
      if (request.method === 'GET') {
        if (url.searchParams.get('imageId')) {
          const original = service.readOriginal(leagueId, actor, url.searchParams.get('imageId'));
          if(url.searchParams.get('preview')==='1'){original.bytes=await require('./fantasyhq/offseason-image').normalize(original.bytes);original.contentType='image/png';}
          response.writeHead(200, { 'Content-Type': original.contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(original.bytes);
        } else sendJson(response, 200, service.inspect(leagueId, actor, url.searchParams.get('salaryCap')));
        return;
      }
      if (request.method !== 'POST') { sendJson(response, 405, { error: 'Method not allowed.' }); return; }
      const body = await parseJsonBody(request, 34 * 1024 * 1024); websiteOperator(body);
      if (body.action === 'upload') {
        if (typeof body.base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64)) throw Error('Invalid image upload.');
        sendJson(response, 200, await service.upload(leagueId, actor, { filename: body.filename, bytes: Buffer.from(body.base64, 'base64') }));
      } else if (body.action === 'retry') sendJson(response, 200, { image: await service.retry(leagueId, actor, body.imageId) });
      else if (body.action === 'review') sendJson(response, 200, service.review(leagueId, actor, body));
      else if (body.action === 'prepare') sendJson(response, 200, service.prepare(leagueId, actor, body));
      else if (body.action === 'confirm') sendJson(response, 200, service.confirm(leagueId, actor, body.token));
      else throw Error('Choose upload, retry, save review, prepare or confirm.');
    } catch (error) { sendJson(response, 400, { error: error.message }); } })(); return;
  }

  if (url.pathname === '/api/league/admin/retirements') {
    if (!isAdminRequest(request)) { sendJson(response, 403, { error: 'Commissioner website key required.' }); return; }
    (async () => { try {
      const context = boundLeagueContext(), principal = require('./shared/website-auth').websitePrincipal(request);
      if (principal?.operator && principal.operator !== context.league.commissionerUserId) throw Error('Use credentials keyed by the commissioner Discord user ID for retirement imports.');
      const repository = playerUpgradeRuntime?.repository || leagueService.repository;
      const service = require('./fantasyhq/retirement-import-service').createRetirementImportService({ repository });
      const actor = { authorized: true, id: context.league.commissionerUserId }, leagueId = context.league.leagueId;
      if (request.method === 'GET') {
        if (url.searchParams.get('imageId')) {
          const original = service.readOriginal(leagueId, actor, url.searchParams.get('imageId'));
          if(url.searchParams.get('preview')==='1'){original.bytes=await require('./fantasyhq/offseason-image').normalize(original.bytes);original.contentType='image/png';}
          response.writeHead(200, { 'Content-Type': original.contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(original.bytes);
        } else sendJson(response, 200, service.inspect(leagueId, actor));
        return;
      }
      if (request.method !== 'POST') { sendJson(response, 405, { error: 'Method not allowed.' }); return; }
      const body = await parseJsonBody(request, 34 * 1024 * 1024); websiteOperator(body);
      if (body.action === 'upload') {
        if (typeof body.base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64)) throw Error('Invalid image upload.');
        sendJson(response, 200, await service.upload(leagueId, actor, { filename: body.filename, bytes: Buffer.from(body.base64, 'base64') }));
      } else if (body.action === 'retry') sendJson(response, 200, { image: await service.retry(leagueId, actor, body.imageId) });
      else if (body.action === 'prepare') sendJson(response, 200, service.prepare(leagueId, actor, body));
      else if (body.action === 'confirm') sendJson(response, 200, service.confirm(leagueId, actor, body.token));
      else throw Error('Choose upload, retry, prepare or confirm.');
    } catch (error) { sendJson(response, 400, { error: error.message }); } })(); return;
  }

  if (url.pathname === '/api/league/admin/offseason') {
    if (!isAdminRequest(request)) { sendJson(response, 403, { error: 'Commissioner website key required.' }); return; }
    (async () => { try {
      const context = boundLeagueContext(), principal = require('./shared/website-auth').websitePrincipal(request);
      if (principal?.operator && principal.operator !== context.league.commissionerUserId) throw Error('Use credentials keyed by the commissioner Discord user ID for offseason transitions.');
      const repository = playerUpgradeRuntime?.repository || leagueService.repository;
      const service = require('./fantasyhq/offseason-service').createOffseasonService({ repository });
      const leagueId = context.league.leagueId;
      if (request.method === 'GET') { sendJson(response, 200, service.inspect(leagueId)); return; }
      if (request.method !== 'POST') { sendJson(response, 405, { error: 'Method not allowed.' }); return; }
      const body = await parseJsonBody(request), operator = websiteOperator(body);
      const actor = { authorized: true, id: context.league.commissionerUserId, operator };
      if (body.action === 'prepare') sendJson(response, 200, service.prepareNext(leagueId, actor));
      else if (body.action === 'confirm') sendJson(response, 200, service.confirmNext(leagueId, actor, body.token));
      else if (body.action === 'cancel') sendJson(response, 200, service.cancel(leagueId, actor, body.token));
      else throw Error('Choose prepare, confirm or cancel.');
    } catch (error) { sendJson(response, 400, { error: error.message }); } })(); return;
  }

  if (url.pathname === '/api/league/admin/playoffs') {
    if (!isAdminRequest(request, url)) { sendJson(response, 403, { error: 'Admin authorization required.' }); return; }
    (async () => { try {
      const service = require('./fantasyhq/season-transition').createSeasonTransitionService({ submissions: gameThreadRuntime?.weekService?.submissions || playerUpgradeRuntime.submissions });
      if (request.method === 'GET') { sendJson(response,200,service.inspect(process.env.GUILD_ID)); return; }
      if (request.method !== 'POST') { sendJson(response,405,{error:'Method not allowed.'}); return; }
      const body = await parseJsonBody(request), operator=websiteOperator(body), context=boundLeagueContext(),principal=require('./shared/website-auth').websitePrincipal(request);
      if(principal?.operator && principal.operator!==context.league.commissionerUserId)throw Error('Confirm playoffs using the commissioner Discord control. Individual website credentials must be keyed by the commissioner Discord user ID for this action.');
      const actor = {authorized:true,id:context.league.commissionerUserId,operator};
      if (body.action === 'prepare') sendJson(response,200,service.prepare(process.env.GUILD_ID,actor));
      else if (body.action === 'confirm') sendJson(response,200,service.confirm(process.env.GUILD_ID,actor,body.token));
      else throw Error('Choose prepare or confirm.');
    } catch(error) { sendJson(response,400,{error:error.message}); } })(); return;
  }

  if (url.pathname === "/api/league/admin/week") {
    if (!isAdminRequest(request, url)) { sendJson(response, 403, { error: 'Admin authorization required.' }); return; }
    (async () => {
      try {
        if (!gameThreadRuntime?.client.isReady() || !gameThreadRuntime.weekService) throw Error('Start the connected bot with npm start.');
        const guild = await gameThreadRuntime.client.guilds.fetch(process.env.GUILD_ID), service = gameThreadRuntime.weekService;
        if (request.method === 'GET') { sendJson(response, 200, service.inspect(guild.id)); return; }
        if (request.method !== 'POST') { sendJson(response, 405, { error: 'Method not allowed.' }); return; }
        let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 4096) throw Error('Request too large.'); }
        const input = JSON.parse(body), operator = String(input.operator || '').trim(); if (!operator || operator.length > 100) throw Error('Enter your commissioner name.');
        const league = (gameThreadRuntime.repository || setupService.repository).loadLeagueContext({ guildId: guild.id }).league;
        const actor = { authorized: true, id: 'website-commissioner:' + operator, operator, commissionerUserId: league.commissionerUserId || 'website-admin' };
        if (input.action === 'prepare') sendJson(response, 200, service.prepare(guild.id, actor, input.force === true));
        else if (input.action === 'confirm') sendJson(response, 200, await service.advance(guild, actor, input.token));
        else if (input.action === 'cancel') { service.cancel(input.token, actor); sendJson(response, 200, { cancelled: true }); }
        else throw Error('Unknown action.');
      } catch (error) { sendJson(response, 400, { error: error.message }); }
    })(); return;
  }

  if (url.pathname === "/api/league/admin/game-threads") {
    if (!isAdminRequest(request, url)) { sendJson(response, 403, { error: "Admin authorization required." }); return; }
    (async () => {
      try {
        if (!gameThreadRuntime?.client.isReady()) throw Error("Discord bot must be running and connected. Start the app with npm start.");
        const guild = await gameThreadRuntime.client.guilds.fetch(process.env.GUILD_ID);
        const service = gameThreadRuntime.service;
        if (request.method === 'GET') {
          const channels = await guild.channels.fetch();
          let state; try { state = service.status(guild.id); } catch (error) { state = { ...service.configuration(guild.id), games: [], notice: error.message }; }
          sendJson(response, 200, { ...state, channels: [...channels.values()].filter(c => c?.type === 0).map(c => ({ id: c.id, name: c.name })) });
        } else if (request.method === 'POST') {
          let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 4096) throw Error('Request too large.'); }
          const input = JSON.parse(body), operator = websiteOperator(input), repository = gameThreadRuntime.repository || setupService.repository;
          const context = repository.loadLeagueContext({ guildId: guild.id }), userId = context.league.commissionerUserId || 'website-admin';
          if (input.action === 'configure') {
            const result = await service.configure(guild, input.channelId);
            repository.appendAuditLog(context.league.leagueId, { action: 'website.games-channel.configured', userId, operator, leagueId: context.league.leagueId, timestamp: new Date().toISOString(), metadata: { gamesChannelId: result.gamesChannelId } });
            sendJson(response, 200, result);
          }
          else if (input.action === 'create') {
            const result = await service.create(guild);
            repository.appendAuditLog(context.league.leagueId, { action: 'website.game-threads.created', userId, operator, leagueId: context.league.leagueId, timestamp: new Date().toISOString(), metadata: { week: result.week, created: result.created, existing: result.existing, failed: result.failed } });
            sendJson(response, 200, result);
          }
          else throw Error('Unknown action.');
        } else sendJson(response, 405, { error: 'Method not allowed.' });
      } catch (error) { sendJson(response, 400, { error: error.message }); }
    })(); return;
  }

  if (url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/draft-classes") {
    const boards = Object.values(BOARD_TYPES).map((board) => ({
      id: board.id,
      label: board.label,
      target: board.target,
      classes: draftClassFiles(board.id).map((file) => ({ file, label: classLabel(file) })),
    }));
    sendJson(response, 200, { boards });
    return;
  }

  if (url.pathname === "/api/prospects") {
    const boardId = BOARD_TYPES[url.searchParams.get("board")]?.id || "top-ten";
    const board = BOARD_TYPES[boardId];
    const file = resolveDraftClass(url.searchParams.get("class"), boardId);
    if (!file) {
      sendJson(response, 404, { error: "Draft class not found" });
      return;
    }
    try {
      sendJson(response, 200, {
        board: { id: board.id, label: board.label, target: board.target },
        draftClass: { file, label: classLabel(file) },
        prospects: readProspects(file),
      });
    } catch (error) {
      console.error("Website draft data error:", error);
      sendJson(response, 500, { error: "Unable to load draft class" });
    }
    return;
  }

  if (url.pathname === "/api/league-site") {
    try {
      const payload = leagueSitePayload();
      if (!payload) {
        sendJson(response, 200, { league: null });
        return;
      }
      sendJson(response, 200, payload);
    } catch (error) {
      console.error("Website league data error:", error);
      sendJson(response, 500, { error: "Unable to load league website data" });
    }
    return;
  }

  if (url.pathname === '/api/league/playoffs' && request.method === 'GET') {
    try {
      const context=boundLeagueContext(),repository=leagueService.repository;
      const seasonId=String(url.searchParams.get('season') || context.seasonId);
      let playoffs=repository.loadPlayoffs(context.league.leagueId,seasonId);
      const records=require('./fantasyhq/game-submissions').createGameSubmissionService({repository}).records();
      if(playoffs?.version===2)playoffs=require('./fantasyhq/postseason-service').recalculate(playoffs,records);
      const games=playoffs?.version===2 ? records.filter(r=>r.game.leagueId===context.league.leagueId&&r.game.seasonId===seasonId&&playoffs.series.some(s=>s.gameIds.includes(r.game.gameId)&&require('./fantasyhq/postseason-service').approvedPostseasonGame(r,playoffs,s))).map(r=>({gameId:r.game.gameId,seriesId:r.game.seriesId,gameNumber:r.game.seriesGameNumber,result:r.game.result,finalizedAt:r.game.finalizedAt})) : [];
      const archiveRoot=require('path').join(context.paths.leagueRoot,'postseason');
      const seasons=[...new Set([context.seasonId,...(fs.existsSync(archiveRoot)?fs.readdirSync(archiveRoot).filter(n=>/^[a-zA-Z0-9_-]+\.json$/.test(n)).map(n=>n.slice(0,-5)):[])])];
      sendJson(response,200,{playoffs,games,seasons,seasonId,championships:repository.loadChampionships(context.league.leagueId).seasons,testMode:repository.loadSettings(context.league.leagueId)?.testMode===true});
    }catch(error){sendJson(response,400,{error:error.message});}return;
  }

  if (url.pathname === "/api/league/standings" && request.method === "GET") {
    try { const context = boundLeagueContext(); sendJson(response, 200, require('./fantasyhq/standings-service').createStandingsService({ repository: leagueService.repository, publishedOnly: true }).getStandings(context.league.leagueId, context.seasonId)); }
    catch (error) { sendJson(response, 400, { error: error.message }); } return;
  }

  if (url.pathname === "/api/league/stats" && request.method === "GET") {
    try {
      const context = boundLeagueContext();
      sendJson(response, 200, createPlayerStatsService({repository:leagueService.repository,publishedOnly:true,scope:require('./fantasyhq/stat-scope').normalizeStatScope(url.searchParams.get('scope') || undefined)}).getSeasonSnapshot(context.league.leagueId,url.searchParams.get('season') || context.seasonId));
    } catch (error) { sendJson(response, 400, { error: error.message || "Unable to load player statistics" }); }
    return;
  }

  if (url.pathname === "/api/league/team-stats" && request.method === "GET") {
    try {
      const context = boundLeagueContext();
      sendJson(response, 200, createTeamStatsService({repository:leagueService.repository,publishedOnly:true,scope:require('./fantasyhq/stat-scope').normalizeStatScope(url.searchParams.get('scope') || undefined)}).getSeasonSnapshot(context.league.leagueId,url.searchParams.get('season') || context.seasonId));
    } catch (error) { sendJson(response, 400, { error: error.message || "Unable to load team statistics" }); }
    return;
  }

  const teamStatsGameMatch = url.pathname.match(/^\/api\/league\/team-stats\/([^/]+)\/games$/);
  if (teamStatsGameMatch && request.method === "GET") {
    try {
      const context = boundLeagueContext();
      const data = createTeamStatsService({repository:leagueService.repository,publishedOnly:true,scope:require('./fantasyhq/stat-scope').normalizeStatScope(url.searchParams.get('scope') || undefined)}).getTeamStatsAndGameLog(context.league.leagueId,url.searchParams.get('season') || context.seasonId, decodeURIComponent(teamStatsGameMatch[1]));
      if (!data) { sendJson(response, 404, { error: "Team not found." }); return; }
      sendJson(response, 200, data);
    } catch (error) { sendJson(response, 400, { error: error.message || "Unable to load team game log" }); }
    return;
  }

  const playerStatsGameMatch = url.pathname.match(/^\/api\/league\/stats\/players\/([^/]+)\/games$/);
  if (playerStatsGameMatch && request.method === "GET") {
    try {
      const context = boundLeagueContext(), playerId = decodeURIComponent(playerStatsGameMatch[1]);
      const player = playerService.getPlayer(context.league.leagueId, context.seasonId, playerId);
      const data = createPlayerStatsService({repository:leagueService.repository,publishedOnly:true,scope:require('./fantasyhq/stat-scope').normalizeStatScope(url.searchParams.get('scope') || undefined)}).getPlayerStatsAndGameLog(context.league.leagueId,url.searchParams.get('season') || context.seasonId, playerId);
      sendJson(response, 200, { player: { playerId: player.playerId, name: player.name }, stats: data.stats, games: data.games, warnings: data.warnings });
    } catch (error) { sendJson(response, 404, { error: error.message || "Player game log not found" }); }
    return;
  }

  if (url.pathname === "/api/league/teams" && request.method === "GET") {
    try {
      const context = boundLeagueContext();
      sendJson(response, 200, {
        teams: teamService.listTeams(context.league.leagueId, context.seasonId),
      });
    } catch (error) {
      console.error("Website teams data error:", error);
      sendJson(response, 500, { error: error.message || "Unable to load teams" });
    }
    return;
  }

  const teamMatch = url.pathname.match(/^\/api\/league\/teams\/([^/]+)$/);
  if (teamMatch && request.method === "GET") {
    try {
      const context = boundLeagueContext();
      sendJson(response, 200, {
        team: teamService.getTeam(context.league.leagueId, context.seasonId, decodeURIComponent(teamMatch[1])),
      });
    } catch (error) {
      console.error("Website team detail error:", error);
      sendJson(response, 500, { error: error.message || "Unable to load team" });
    }
    return;
  }

  if (url.pathname === '/api/league/streams' && request.method === 'GET') {
    try {const context=boundLeagueContext(),streams=require('./fantasyhq/streams-service').createStreamsService({repository:setupService.repository,submissions:webGameSubmissions}).list(context.league.leagueId,{gameId:url.searchParams.get('gameId'),seasonId:url.searchParams.get('seasonId')});sendJson(response,200,{streams});}
    catch(error){sendJson(response,500,{error:error.message});}return;
  }

  if (url.pathname === '/api/league/news' && request.method === 'GET') {
    try {
      const context=boundLeagueContext(),repository=setupService.repository,service=require('./fantasyhq/news-service').createNewsService({repository,submissions:webGameSubmissions});
      const filters=Object.fromEntries(['q','sort','seasonId','week','phase','teamId','playerId','category','storyline'].map(k=>[k,url.searchParams.get(k)]));const players=new Map(repository.loadPlayers(context.league.leagueId).map(p=>[p.playerId,p]));
      const enrich=a=>({...a,players:a.playerIds.map(id=>players.get(id)).filter(Boolean),teams:a.teamIds.map(id=>context.teams.find(t=>t.teamId===id)).filter(Boolean)}),all=service.list(context.league.leagueId),articles=service.list(context.league.leagueId,filters).map(enrich);
      if(url.searchParams.get('id')){const story=all.find(a=>a.id===url.searchParams.get('id'));if(!story){sendJson(response,404,{error:'Article not found.'});return;}sendJson(response,200,{article:enrich(story),related:all.filter(a=>a.id!==story.id&&(a.category===story.category||a.playerIds.some(id=>story.playerIds.includes(id))||a.teamIds.some(id=>story.teamIds.includes(id)))).slice(0,4).map(enrich)});return;}
      sendJson(response,200,{articles,featured:articles.slice().sort((a,b)=>Number(b.featured)-Number(a.featured)||(.65*b.newsworthiness+.35*Math.max(0,100-(Date.now()-Date.parse(b.publishedAt))/8640000))-(.65*a.newsworthiness+.35*Math.max(0,100-(Date.now()-Date.parse(a.publishedAt))/8640000))||b.publishedAt.localeCompare(a.publishedAt)).slice(0,5),trending:articles.slice().sort((a,b)=>Object.values(b.reactions||{}).reduce((n,v)=>n+v,0)-Object.values(a.reactions||{}).reduce((n,v)=>n+v,0)||b.publishedAt.localeCompare(a.publishedAt)).slice(0,5),seasons:[...new Set(all.map(a=>a.seasonId))],categories:[...new Set(all.map(a=>a.category))],storylines:[...new Set(all.map(a=>a.storyline))],teams:context.teams.map(t=>({teamId:t.teamId,teamName:t.teamName}))});
    } catch(error){sendJson(response,500,{error:error.message});}return;
  }

  if (url.pathname === '/api/league/power-rankings' && request.method === 'GET') {
    try {
      const context = boundLeagueContext(), service = require('./fantasyhq/power-rankings').createPowerRankingsService({repository:setupService.repository,submissions:webGameSubmissions});
      const all = service.list(context.league.leagueId), history = service.list(context.league.leagueId,{seasonId:url.searchParams.get('seasonId')});
      sendJson(response, 200, {current:all.filter(s=>s.seasonId===context.seasonId||(s.preseason&&s.sourceSeasonId===context.seasonId)).at(-1)||null,history,seasons:[...new Set(all.map(s=>s.seasonId))]});
    } catch(error) { sendJson(response, 500, {error:error.message}); } return;
  }

  if (url.pathname === '/api/league/progression' && request.method === 'GET') {
    try {
      const context = boundLeagueContext();
      const filters = Object.fromEntries(['seasonId','teamId','playerId'].map(key => [key,url.searchParams.get(key)]));
      sendJson(response, 200, require('./fantasyhq/progression-history').createProgressionHistoryService({repository:setupService.repository}).summary(context.league.leagueId,filters));
    } catch(error) { sendJson(response, 500, {error:error.message}); } return;
  }

  if (url.pathname === '/api/league/player-of-the-week' && request.method === 'GET') {
    try {
      const context = boundLeagueContext(), repository = setupService.repository;
      const service = require('./fantasyhq/player-of-week').createPlayerOfWeekService({ repository, submissions: webGameSubmissions });
      const all = service.list(context.league.leagueId);
      const filters = Object.fromEntries(['seasonId', 'week', 'conference', 'teamId', 'playerId'].map(key => [key, url.searchParams.get(key)]));
      const players = new Map(repository.loadPlayers(context.league.leagueId).map(p => [p.playerId, p]));
      const enrich = w => ({ ...w, player: players.get(w.playerId) || { playerId: w.playerId, name: w.playerName } });
      const latestWeek = Math.max(0, ...all.filter(w => w.seasonId === context.seasonId).map(w => w.week));
      sendJson(response, 200, { leagueId: context.league.leagueId, seasonId: context.seasonId,
        current: all.filter(w => w.seasonId === context.seasonId && w.week === latestWeek).map(enrich),
        history: service.list(context.league.leagueId, filters).map(enrich), seasons: [...new Set(all.map(w => w.seasonId))],
        teams: context.teams.map(t => ({ teamId: t.teamId, teamName: t.teamName })),
        players: [...new Map(all.map(w => [w.playerId, { playerId: w.playerId, name: w.playerName }])).values()] });
    } catch (error) { sendJson(response, 500, { error: error.message || 'Unable to load weekly awards.' }); }
    return;
  }

  if (url.pathname === "/api/league/players" && request.method === "GET") {
    try {
      const context = boundLeagueContext();
      sendJson(response, 200, {
        players: playerService.listPlayers(context.league.leagueId, context.seasonId),
      });
    } catch (error) {
      console.error("Website players data error:", error);
      sendJson(response, 500, { error: error.message || "Unable to load players" });
    }
    return;
  }

  const playerMatch = url.pathname.match(/^\/api\/league\/players\/([^/]+)$/);
  if (playerMatch && request.method === "GET") {
    try {
      const context = boundLeagueContext();
      sendJson(response, 200, {
        player: playerService.getPlayer(context.league.leagueId, context.seasonId, decodeURIComponent(playerMatch[1])),
      });
    } catch (error) {
      console.error("Website player detail error:", error);
      sendJson(response, 500, { error: error.message || "Unable to load player" });
    }
    return;
  }

  const adminPlayerMatch = url.pathname.match(/^\/api\/league\/admin\/players\/([^/]+)$/);

  if (url.pathname === "/api/league/schedule" && request.method === "GET") {
    try {
      const context = boundLeagueContext();
      const schedule = setupService.repository.scheduleExists(context.league.leagueId, context.seasonId)
        ? setupService.repository.loadSchedule(context.league.leagueId, context.seasonId)
        : null;
      const teams = teamService.listTeams(context.league.leagueId, context.seasonId);
      sendJson(response, 200, { schedule, teams });
    } catch (error) {
      console.error("Website schedule data error:", error);
      sendJson(response, 500, { error: error.message || "Unable to load schedule" });
    }
    return;
  }

  if (url.pathname === "/api/league/admin/data-issues" && request.method === "GET") {
    if (!isAdminRequest(request, url)) {
      sendJson(response, 403, { error: "Admin authorization required." });
      return;
    }
    try {
      const context = boundLeagueContext();
      sendJson(response, 200, {
        issues: dataIssuesService.issuesForLeague(context.league.leagueId, context.seasonId),
      });
    } catch (error) {
      console.error("Website data issues error:", error);
      sendJson(response, 500, { error: error.message || "Unable to load data issues" });
    }
    return;
  }

  if (url.pathname === "/api/league/admin/audit-log" && request.method === "GET") {
    if (!isAdminRequest(request, url)) {
      sendJson(response, 403, { error: "Admin authorization required." });
      return;
    }
    try {
      const context = boundLeagueContext();
      const auditLog = setupService.repository.loadAuditLog(context.league.leagueId)
        .sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)));
      sendJson(response, 200, { auditLog });
    } catch (error) {
      console.error("Website audit log error:", error);
      sendJson(response, 500, { error: error.message || "Unable to load audit log" });
    }
    return;
  }

  if (url.pathname === "/api/league/admin/preseason/validate" && request.method === "GET") {
    if (!isAdminRequest(request, url)) {
      sendJson(response, 403, { error: "Admin authorization required." });
      return;
    }
    try {
      const context = boundLeagueContext();
      sendJson(response, 200, preseasonValidator.validate({ leagueId: context.league.leagueId, seasonId: context.seasonId }));
    } catch (error) {
      console.error("Website preseason validation error:", error);
      sendJson(response, 500, { error: error.message || "Unable to validate preseason" });
    }
    return;
  }

  if (url.pathname === "/api/league/admin/start-season" && request.method === "POST") {
    if (!isAdminRequest(request, url)) {
      sendJson(response, 403, { error: "Admin authorization required." });
      return;
    }
    parseJsonBody(request).then((body) => {
      const context = boundLeagueContext(), operator = websiteOperator(body);
      const league = leagueService.startRegularSeason({
        leagueId: context.league.leagueId,
        seasonId: context.seasonId,
        actingUserId: context.league.commissionerUserId || "website-admin",
        operator,
        validator: (params) => preseasonValidator.validate(params),
      });
      sendJson(response, 200, { league });
    }).catch((error) => {
      console.error("Website start season error:", error);
      sendJson(response, 400, { error: error.message || "Unable to start regular season" });
    });
    return;
  }

  if (adminPlayerMatch && request.method === "PATCH") {
    if (!isAdminRequest(request, url)) {
      sendJson(response, 403, { error: "Admin authorization required." });
      return;
    }
    parseJsonBody(request)
      .then((body) => {
        const context = boundLeagueContext(), operator = websiteOperator(body), { operator: ignoredOperator, ...patch } = body;
        const player = playerService.updatePlayer({
          leagueId: context.league.leagueId,
          seasonId: context.seasonId,
          playerId: decodeURIComponent(adminPlayerMatch[1]),
          patch,
          actingUserId: context.league.commissionerUserId || "website-admin",
          operator,
        });
        sendJson(response, 200, { player });
      })
      .catch((error) => {
        console.error("Website player update error:", error);
        sendJson(response, 400, { error: error.message || "Unable to update player" });
      });
    return;
  }

  if (url.pathname === "/api/league/admin/rosters/add-player" && request.method === "POST") {
    if (!isAdminRequest(request, url)) {
      sendJson(response, 403, { error: "Admin authorization required." });
      return;
    }
    parseJsonBody(request)
      .then((body) => {
        const context = boundLeagueContext(), operator = websiteOperator(body), { operator: ignoredOperator, ...playerInput } = body;
        const player = playerService.addPlayer({
          leagueId: context.league.leagueId,
          seasonId: context.seasonId,
          teamId: body.teamId,
          player: playerInput,
          actingUserId: context.league.commissionerUserId || "website-admin",
          operator,
        });
        sendJson(response, 200, { player });
      })
      .catch((error) => {
        console.error("Website add player error:", error);
        sendJson(response, 400, { error: error.message || "Unable to add player" });
      });
    return;
  }

  if (url.pathname === "/api/league/admin/rosters/move-player" && request.method === "POST") {
    if (!isAdminRequest(request, url)) {
      sendJson(response, 403, { error: "Admin authorization required." });
      return;
    }
    parseJsonBody(request)
      .then((body) => {
        const context = boundLeagueContext(), operator = websiteOperator(body);
        const membership = rosterService.movePlayer({
          leagueId: context.league.leagueId,
          seasonId: context.seasonId,
          playerId: body.playerId,
          fromTeamId: body.fromTeamId,
          toTeamId: body.toTeamId,
          actingUserId: context.league.commissionerUserId || "website-admin",
          operator,
        });
        sendJson(response, 200, { membership });
      })
      .catch((error) => {
        console.error("Website move player error:", error);
        sendJson(response, 400, { error: error.message || "Unable to move player" });
      });
    return;
  }

  if (url.pathname === "/api/league/admin/rosters/remove-player" && request.method === "POST") {
    if (!isAdminRequest(request, url)) {
      sendJson(response, 403, { error: "Admin authorization required." });
      return;
    }
    parseJsonBody(request)
      .then((body) => {
        const context = boundLeagueContext(), operator = websiteOperator(body);
        const membership = rosterService.removePlayer({
          leagueId: context.league.leagueId,
          seasonId: context.seasonId,
          playerId: body.playerId,
          teamId: body.teamId,
          actingUserId: context.league.commissionerUserId || "website-admin",
          operator,
        });
        sendJson(response, 200, { membership });
      })
      .catch((error) => {
        console.error("Website remove player error:", error);
        sendJson(response, 400, { error: error.message || "Unable to remove player" });
      });
    return;
  }

  if (url.pathname === "/api/league/admin/rosters/bulk-update" && request.method === "PATCH") {
    if (!isAdminRequest(request, url)) {
      sendJson(response, 403, { error: "Admin authorization required." });
      return;
    }
    parseJsonBody(request)
      .then((body) => {
        const context = boundLeagueContext(), operator = websiteOperator(body);
        const result = rosterService.bulkUpdateRoster({
          leagueId: context.league.leagueId,
          seasonId: context.seasonId,
          teamId: body.teamId,
          updates: body.updates,
          actingUserId: context.league.commissionerUserId || "website-admin",
          operator,
        });
        sendJson(response, 200, { result });
      })
      .catch((error) => {
        console.error("Website bulk roster update error:", error);
        sendJson(response, 400, { error: error.message || "Unable to bulk update roster" });
      });
    return;
  }

  if (url.pathname === "/api/league/admin/import/preview" && request.method === "POST") {
    if (!isAdminRequest(request, url)) {
      sendJson(response, 403, { error: "Admin authorization required." });
      return;
    }
    parseJsonBody(request)
      .then((body) => {
        const context = boundLeagueContext();
        const preview = rosterService.diffRosterImport({
          leagueId: context.league.leagueId,
          seasonId: context.seasonId,
          teamId: body.teamId,
        });
        sendJson(response, 200, { preview });
      })
      .catch((error) => {
        console.error("Website roster preview error:", error);
        sendJson(response, 400, { error: error.message || "Unable to preview import" });
      });
    return;
  }

  if (url.pathname === "/api/league/admin/import/apply" && request.method === "POST") {
    if (!isAdminRequest(request, url)) {
      sendJson(response, 403, { error: "Admin authorization required." });
      return;
    }
    parseJsonBody(request)
      .then((body) => {
        const context = boundLeagueContext(), operator = websiteOperator(body);
        const preview = rosterService.applyRosterImport({
          leagueId: context.league.leagueId,
          seasonId: context.seasonId,
          teamId: body.teamId,
          actingUserId: context.league.commissionerUserId || "website-admin",
          operator,
        });
        sendJson(response, 200, { preview });
      })
      .catch((error) => {
        console.error("Website roster import apply error:", error);
        sendJson(response, 400, { error: error.message || "Unable to apply import" });
      });
    return;
  }

  if (url.pathname.startsWith("/ratings-assets/")) {
    const slug = url.pathname.slice("/ratings-assets/".length);
    if (!/^[a-z0-9-]+$/.test(slug)) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const root = path.join(ROOT_DIR, "data", "2kratings", "images");
    const portrait = ["png", "webp", "jpg", "jpeg"].map((extension) => path.join(root, `${slug}.${extension}`))
      .find((file) => fs.existsSync(file));
    sendFile(response, portrait, "public, max-age=3600");
    return;
  }

  if (url.pathname.startsWith("/draft-assets/")) {
    const relativePath = decodeURIComponent(url.pathname.slice("/draft-assets/".length));
    sendFile(response, safeFile(DRAFT_IMAGE_DIR, relativePath), "public, max-age=31536000, immutable");
    return;
  }

  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const filePath = safeFile(WEB_DIR, requested);
  if (filePath && fs.existsSync(filePath)) {
    sendFile(response, filePath);
    return;
  }
  sendFile(response, path.join(WEB_DIR, "index.html"));
}

function requestHandler(request, response) {
  try { return unsafeRequestHandler(request, response); }
  catch (error) {
    if (!response.headersSent) sendJson(response, error instanceof URIError ? 400 : 500, { error: error instanceof URIError ? 'Invalid URL encoding.' : 'Request could not be completed.' });
    else response.destroy?.();
    if (!(error instanceof URIError)) console.error('Website request failed:', error.message);
  }
}

function startWebsite({ port = Number(process.env.PORT || 3000), host = "0.0.0.0" } = {}) {
  const server = http.createServer(requestHandler);
  server.on("error", (error) => console.error("Website server error:", error));
  server.listen(port, host, () => {
    console.log(`Draft website listening on http://${host}:${port}`);
  });
  return server;
}

module.exports = { requestHandler, startWebsite, setGameThreadRuntime, setPlayerUpgradeRuntime };

if (require.main === module) {
  require('./fantasyhq/storage-safety').acquireWriterLease(require('./fantasyhq/repository').createFantasyHQRepository().dataRoot);
  startWebsite();
}
