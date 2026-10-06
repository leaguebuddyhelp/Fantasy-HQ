const fs = require("fs");
const path = require("path");
const { randomUUID, createHash } = require("crypto");
const { createFantasyHQRepository } = require("./repository");

const sharedLocks = new Map();
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
function imageType(bytes) {
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new Error("Unsupported image. Upload original JPG, PNG, or WebP screenshots.");
}
async function downloadDiscordImage(attachment) {
  const url = new URL(attachment.url);
  if (url.protocol !== "https:" || !["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname)
    || !url.pathname.startsWith("/attachments/")) throw new Error("Invalid Discord attachment URL.");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("Could not store the screenshot. Please upload it again.");
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > MAX_IMAGE_BYTES) throw new Error("Each screenshot must be 25 MB or smaller.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function createGameSubmissionService(options = {}) {
  const repository = options.repository || createFantasyHQRepository();
  // Survives Discord thread cleanup; permanent league deletion removes its matching archives.
  const root = path.join(repository.dataRoot, "game-history");
  const download = options.download || downloadDiscordImage;
  let finalizationHandler = options.onFinalized || null;
  const locks = sharedLocks;
  function exclusive(id, work) {
    id = `${root}:${id}`;
    const pending = (locks.get(id) || Promise.resolve()).catch(() => { }).then(work);
    locks.set(id, pending);
    return pending.finally(() => { if (locks.get(id) === pending) locks.delete(id); });
  }
  function directory(gameId) {
    if (!/^[a-f0-9-]{36}$/.test(gameId)) throw new Error("Invalid game ID.");
    return path.join(root, gameId);
  }
  function load(gameId) {
    return JSON.parse(fs.readFileSync(path.join(directory(gameId), "record.json"), "utf8"));
  }
  function save(record) {
    const dir = directory(record.game.gameId);
    fs.mkdirSync(dir, { recursive: true });
    const temp = path.join(dir, `record-${randomUUID()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(record, null, 2));
    fs.renameSync(temp, path.join(dir, "record.json"));
  }
  function records() {
    return fs.existsSync(root) ? fs.readdirSync(root).filter(id => /^[a-f0-9-]{36}$/.test(id)).map(load) : [];
  }
  function findThread(guildId, threadId) {
    return records().find(r => r.game.guildId === guildId && r.game.discordThreadId === threadId);
  }
  function check(record, { guildId, discordThreadId, userId, privateThread, staff = false }) {
    const game = record.game;
    if (!privateThread || game.guildId !== guildId || game.discordThreadId !== discordThreadId) {
      throw new Error("Use Submit Game in this game's private thread.");
    }
    if (game.locked || game.finalizedAt || ["FINAL", "FINALIZED", "LOCKED"].includes(game.status)) {
      throw new Error("This game is locked or finalized.");
    }
    if (!staff && !repository.loadOwners(game.leagueId).some(owner => owner.userId === userId
      && [game.team1Id, game.team2Id].includes(owner.teamId))) {
      throw new Error("Only an owner of one of this game's teams can submit screenshots.");
    }
  }
  function bind({ guildId, discordThreadId, privateThread, weekNumber, teamQuery }, ensureOnly = false) {
    if (!ensureOnly && !privateThread) throw new Error("Run this action inside an existing private game thread.");
    const context = repository.loadLeagueContext({ guildId });
    if (context.league.currentPhase !== "REGULAR_SEASON") throw new Error("The league must be in REGULAR_SEASON.");
    const schedule = repository.loadSchedule(context.league.leagueId, context.seasonId);
    const team = context.teams.find(t => [t.teamName, t.abbreviation, t.teamId].some(v => v.toLowerCase() === teamQuery.toLowerCase()));
    const week = schedule.weeks.find(w => w.week === weekNumber);
    const match = week?.games.find(g => [g.team1Id, g.team2Id].includes(team?.teamId));
    if (!match) throw new Error("No scheduled game found for that team and week.");
    const existing = records().find(r => r.game.leagueId === context.league.leagueId
      && r.game.seasonId === context.seasonId && r.game.weekNumber === weekNumber
      && r.game.team1Id === match.team1Id && r.game.team2Id === match.team2Id);
    if (existing) {
      if (existing.game.guildId !== guildId) throw new Error("Game belongs to another Discord server.");
      if (!ensureOnly && existing.game.discordThreadId && (existing.game.discordThreadId !== discordThreadId || existing.game.guildId !== guildId)) throw new Error("This game is already linked to another thread.");
      if (!ensureOnly && !existing.game.discordThreadId) { existing.game.discordThreadId = discordThreadId; save(existing); }
      return existing;
    }
    if (discordThreadId && findThread(guildId, discordThreadId)) throw new Error("This thread is already linked to another game.");
    const record = {
      game: {
        gameId: randomUUID(), leagueId: context.league.leagueId, seasonId: context.seasonId,
        weekId: week.weekId, weekNumber, team1Id: match.team1Id, team2Id: match.team2Id,
        team1Name: context.teams.find(t => t.teamId === match.team1Id).teamName,
        team2Name: context.teams.find(t => t.teamId === match.team2Id).teamName,
        guildId, discordThreadId: discordThreadId || null, discordMessageId: null, status: "SCHEDULED",
        threadCreatedAt: null,
      }, submissions: [], media: []
    };
    save(record);
    return record;
  }
  function setMessage(gameId, messageId) {
    return exclusive(gameId, () => {
      const record = load(gameId);
      record.game.discordMessageId = messageId;
      save(record);
    });
  }
  function ownerTeam(record, actor) {
    const testTeamId = actor.testTeamId || record.submissions.find(s => s.status === 'COLLECTING' && s.mode === 'TEAM_SIDES')?.testActors?.[actor.userId];
    if (testTeamId) {
      if (!actor.staff || repository.loadSettings(record.game.leagueId)?.testMode !== true) throw Error('Staff authorization and explicit Test Mode are required for simulated sides.');
      if (![record.game.team1Id, record.game.team2Id].includes(testTeamId)) throw Error('Choose a team in this matchup.');
      const owner = repository.loadOwners(record.game.leagueId).find(o => o.teamId === testTeamId);
      if (owner && owner.userId !== actor.userId) throw Error('Another coach owns this team; they must submit their own box score.');
      return testTeamId;
    }

    const owners = repository.loadOwners(record.game.leagueId).filter(o => o.userId === actor.userId && [record.game.team1Id, record.game.team2Id].includes(o.teamId));
    if (owners.length !== 1) throw new Error("You must own exactly one team in this game.");
    return owners[0].teamId;
  }
  function begin(gameId, actor, perTeam = false) {
    return exclusive(gameId, () => {
      const record = load(gameId);
      check(record, actor);
      const teamId = perTeam ? ownerTeam(record, actor) : null;
      if (actor.staff && !perTeam && record.submissions.some(s => s.status === "COLLECTING" && s.mode !== "STAFF_BOTH")) throw new Error("A coach upload is in progress. Finish or cancel it before Staff Submit.");
      if (perTeam && record.submissions.some(s => s.status === "COLLECTING" && s.mode === "STAFF_BOTH")) throw new Error("Staff are collecting both screenshots. Wait for that submission.");
      if (record.submissions.some(s => s.status === "PROCESSING")) throw new Error("These box scores are processing. Please wait before starting another attempt.");
      let submission = record.submissions.find(s => s.status === "COLLECTING" && (perTeam ? s.mode === "TEAM_SIDES" : s.submittingUserId === actor.userId && (actor.staff ? s.mode === "STAFF_BOTH" : !s.mode)));
      if (!submission) {
        submission = {
          submissionId: randomUUID(), gameId, submittingUserId: actor.userId,
          discordThreadId: actor.discordThreadId, status: "COLLECTING", createdAt: new Date().toISOString(),
          ...(perTeam ? { mode: "TEAM_SIDES", participants: {} } : actor.staff ? { mode: "STAFF_BOTH", staffAuthorizedBy: actor.userId } : {})
        };
        record.submissions.push(submission);
        save(record);
        if (submission.mode === "STAFF_BOTH") repository.appendAuditLog(record.game.leagueId, { action: "game.staff-submission.started", userId: actor.userId, gameId, submissionId: submission.submissionId, timestamp: submission.createdAt });
      }
      if (perTeam) {
        submission.participants[teamId] = actor.userId;
        if (actor.testTeamId) {
          submission.testActors ||= {}; submission.testActors[actor.userId] = teamId;
          submission.soloTestAuthorizedBy = actor.userId;
          repository.appendAuditLog(record.game.leagueId, { action: 'test.game-side.started', userId: actor.userId, gameId, metadata: { teamId }, timestamp: new Date().toISOString() });
        }
        save(record);
      }
      return { game: record.game, submission, teamId, media: record.media.filter(m => m.submissionId === submission.submissionId) };
    });
  }
  function cancel(gameId, submissionId, actor) {
    return exclusive(gameId, () => {
      const record = load(gameId);
      check(record, actor);
      const submission = record.submissions.find(s => s.submissionId === submissionId && (s.mode === "TEAM_SIDES"
        ? Object.values(s.participants).includes(actor.userId) : s.submittingUserId === actor.userId));
      if (!submission || submission.status !== "COLLECTING") throw new Error("That submission is no longer collecting screenshots.");
      if (submission.mode === "TEAM_SIDES") {
        const teamId = ownerTeam(record, actor);
        if (record.media.some(m => m.submissionId === submissionId && m.teamId === teamId)) throw new Error("Your box score is already stored. Wait for processing before starting a new attempt.");
        delete submission.participants[teamId];
        if (!Object.keys(submission.participants).length && !record.media.some(m => m.submissionId === submissionId)) submission.status = "CANCELLED";
      } else submission.status = "CANCELLED";
      save(record);
    });
  }
  function receive(gameId, actor, attachments, messageId, perTeam = false) {
    return exclusive(gameId, async () => {
      let record = load(gameId);
      check(record, actor);
      const teamId = perTeam ? ownerTeam(record, actor) : null;
      const submission = record.submissions.find(s => s.status === "COLLECTING" && (perTeam
        ? s.mode === "TEAM_SIDES" && s.participants[teamId] === actor.userId
        : (actor.staff ? s.mode === "STAFF_BOTH" : !s.mode) && s.submittingUserId === actor.userId));
      if (!submission) throw new Error("Click Submit Score before uploading your box score.");
      const current = record.media.filter(m => m.submissionId === submission.submissionId);
      const fresh = [...new Map(attachments.map(a => [a.id, a])).values()]
        .filter(a => !current.some(m => m.discordAttachment.id === a.id));
      if (perTeam && (fresh.length > 1 || (fresh.length && current.some(m => m.teamId === teamId)))) throw new Error("Upload one box score for your own team. The other coach must submit theirs.");
      if (current.length + fresh.length > 2) throw new Error("Upload exactly two screenshots per submission.");
      for (const attachment of fresh) {
        if (!TYPES[attachment.contentType?.split(";")[0]] || attachment.size > MAX_IMAGE_BYTES) {
          throw new Error("Upload JPG, PNG, or WebP screenshots, each 25 MB or smaller.");
        }
      }
      for (const attachment of fresh) {
        const bytes = await download(attachment);
        const contentType = imageType(bytes);
        if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("Invalid screenshot size.");
        // Recheck ownership and game lock after the asynchronous download.
        record = load(gameId);
        check(record, actor);
        if (perTeam && ownerTeam(record, actor) !== teamId) throw new Error("Your team assignment changed during upload.");
        const mediaId = randomUUID();
        const storedFile = `originals/${mediaId}.${TYPES[contentType]}`;
        const file = path.join(directory(gameId), storedFile);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, bytes, { flag: "wx" });
        record.media.push({
          mediaId, gameId, submissionId: submission.submissionId, uploadedBy: actor.userId,
          ...(perTeam ? { teamId } : {}),
          createdAt: new Date().toISOString(), contentType, byteLength: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"), storedFile,
          discordAttachment: {
            id: attachment.id, name: attachment.name, url: attachment.url,
            proxyURL: attachment.proxyURL || null, contentType: attachment.contentType,
            size: attachment.size, messageId, discordThreadId: actor.discordThreadId
          },
        });
        const media = record.media.filter(m => m.submissionId === submission.submissionId);
        if (media.length === 2) record.submissions.find(s => s.submissionId === submission.submissionId).status = "RECEIVED";
        save(record);
      }
      record = load(gameId);
      return {
        game: record.game, teamId, submission: record.submissions.find(s => s.submissionId === submission.submissionId),
        media: record.media.filter(m => m.submissionId === submission.submissionId)
      };
    });
  }
  function readOriginal(gameId, mediaId) {
    const record = load(gameId);
    const media = record.media.find(m => m.mediaId === mediaId);
    if (!media) throw new Error("Game media not found.");
    return fs.readFileSync(path.join(directory(gameId), media.storedFile));
  }
  function mutate(gameId, update) {
    return exclusive(gameId, async () => {
      const record = load(gameId), wasFinalized = Boolean(record.game.finalizedAt || record.game.status === "FINAL");
      const result = await update(record);
      save(record);
      if (!wasFinalized && (record.game.finalizedAt || record.game.status === "FINAL") && finalizationHandler) {
        try { await finalizationHandler(structuredClone(record)); }
        catch (error) { console.error("Finalized-game follow-up failed:", error.message); }
      }
      return result;
    });
  }
  function setFinalizationHandler(handler) { finalizationHandler = typeof handler === "function" ? handler : null; }
  function authorizeExtraction(gameId, actor, staff = false) {
    const record = load(gameId);
    if (!staff) check(record, actor);
    else if (!actor.privateThread || record.game.guildId !== actor.guildId || record.game.discordThreadId !== actor.discordThreadId
      || record.game.locked || record.game.finalizedAt || ["FINAL", "FINALIZED", "LOCKED"].includes(record.game.status)) {
      throw new Error("Use the unlocked game's private thread.");
    }
  }
  function staffActor(actor) { if (!actor.staff) throw new Error("Commissioner authorization required for Staff Submit."); return actor; }
  return { beginStaff: (id, actor) => begin(id, staffActor(actor)), receiveStaff: (id, actor, attachments, messageId) => receive(id, staffActor(actor), attachments, messageId), bind, ensureGame: params => bind(params, true), records, begin, beginSide: (id, actor) => begin(id, actor, true), cancel, receive, receiveSide: (id, actor, attachments, messageId) => receive(id, actor, attachments, messageId, true), load, findThread, setMessage, readOriginal, mutate, setFinalizationHandler, authorizeExtraction, repository };
}
module.exports = { createGameSubmissionService, downloadDiscordImage, imageType };
