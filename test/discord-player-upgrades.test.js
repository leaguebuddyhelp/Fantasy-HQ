const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFantasyHQRepository } = require("../src/fantasyhq/repository");
const { createPlayerUpgradeService } = require("../src/fantasyhq/player-upgrades-service");
const { createDiscordPlayerUpgrades } = require("../src/fantasyhq/discord-player-upgrades");
const { PHASES } = require("../src/fantasyhq/constants");

function setup(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lb-discord-upgrades-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const repository = createFantasyHQRepository({ dataRoot: root });
    repository.saveLeague("league", { currentSeasonId: "2026", seasonNumber: 1, currentPhase: PHASES.REGULAR_SEASON, guildId: "guild" });
    repository.saveGuildLeagueBinding("guild", { leagueId: "league", seasonId: "2026" });
    repository.saveTeams("league", [
        { teamId: "bos", teamName: "Boston Celtics", abbreviation: "BOS", conference: "East" },
        { teamId: "nyk", teamName: "New York Knicks", abbreviation: "NYK", conference: "East" },
    ]);
    const owners = [{ teamId: "bos", userId: "coach-bos" }, { teamId: "nyk", userId: "coach-nyk" }];
    repository.saveOwners("league", owners);
    repository.saveSettings("league", { discordChannels: { playerUpgrades: "upgrades-channel" } });
    repository.savePlayers("league", [
        { playerId: "player-bos", name: "Boston Player", overall: 80, archetype: "Arc Finisher", weightLbs: 224, birthdate: "2000-01-01" },
        { playerId: "player-nyk", name: "New York Player", overall: 78, archetype: "Stretch Five", weightLbs: 240, birthdate: "2000-01-01" },
    ]);
    repository.saveRosterMemberships("league", [
        { leagueId: "league", seasonId: "2026", teamId: "bos", playerId: "player-bos", active: true },
        { leagueId: "league", seasonId: "2026", teamId: "nyk", playerId: "player-nyk", active: true },
    ]);
    repository.saveSchedule({ leagueId: "league", seasonId: "2026", weeks: Array.from({ length: 15 }, (_, index) => ({ week: index + 1, weekId: `week-${index + 1}`, games: [{ team1Id: "bos", team2Id: "nyk" }], byes: [] })) });
    const paths = repository.buildLeaguePaths(root, "league");
    fs.writeFileSync(path.join(paths.leagueRoot, "role-ownership.json"), JSON.stringify({ guildId: "guild", roleIds: { bos: "team-bos", nyk: "team-nyk" } }));

    const records = [], now = Date.parse("2026-10-05T12:00:00.000Z");
    for (let week = 1; week <= 4; week += 1) {
        const gameId = `game-${week}`, submissionId = `submission-${week}`, extractionId = `extraction-${week}`, timestamp = new Date(now + week * 1000).toISOString();
        records.push({
            game: { gameId, leagueId: "league", seasonId: "2026", weekId: `week-${week}`, weekNumber: week, team1Id: "bos", team2Id: "nyk", status: "FINAL", finalizedAt: timestamp, result: { submissionId, extractionId, scores: { bos: 101, nyk: 99 } } },
            submissions: [{ submissionId, mode: "TEAM_SIDES", status: "FINAL", createdAt: timestamp, participants: { bos: "coach-bos", nyk: "coach-nyk" } }],
            extractions: [{ extractionId, submissionId, status: "READY_FOR_REVIEW", issues: [] }],
            playerGameStats: [{ gameId, teamId: "bos", playerId: "player-bos" }, { gameId, teamId: "nyk", playerId: "player-nyk" }],
            dnpPlayers: [],
        });
    }
    const service = createPlayerUpgradeService({ repository, submissions: { records: () => records }, now: () => now });
    service.syncOwnerSnapshot({ leagueId: "league", seasonId: "2026", owners, phase: PHASES.REGULAR_SEASON });
    service.reconcileFinalizedGames({ leagueId: "league", seasonId: "2026" });

    const messages = new Map();
    let nextMessageId = 0;
    const channel = {
        id: "upgrades-channel",
        messages: {
            fetchPins: async () => ({ items: [...messages.values()].filter(message => message.pinned).map(message => ({ message, pinnedTimestamp: 1 })), hasMore: false }),
            fetch: async value => typeof value === "object" ? messages : messages.get(value) || null,
        },
        send: async payload => {
            const message = {
                id: `message-${++nextMessageId}`,
                author: { id: "bot" },
                pinned: false,
                ...payload,
                embeds: (payload.embeds || []).map(embed => embed.toJSON()),
                components: (payload.components || []).map(actionRow => actionRow.toJSON()),
                edit: async next => {
                    Object.assign(message, next);
                    message.embeds = (next.embeds || []).map(embed => embed.toJSON ? embed.toJSON() : embed);
                    message.components = (next.components || []).map(actionRow => actionRow.toJSON ? actionRow.toJSON() : actionRow);
                    return message;
                },
                pin: async () => { message.pinned = true; },
                unpin: async () => { message.pinned = false; },
            };
            messages.set(message.id, message);
            return message;
        },
    };
    const roles = new Map([
        ["team-bos", { id: "team-bos", name: "Boston Celtics" }],
        ["team-nyk", { id: "team-nyk", name: "New York Knicks" }],
        ["coach-role", { id: "coach-role", name: "LEAGUEbuddy Coach" }],
        ["staff-role", { id: "staff-role", name: "LEAGUEbuddy Commish" }],
    ]);
    const guild = {
        id: "guild",
        members: { me: { id: "bot" } },
        roles: { cache: roles },
        channels: { fetch: async id => id === channel.id ? channel : null },
    };
    const client = { guilds: { cache: new Map([[guild.id, guild]]) }, channels: { fetch: async id => id === channel.id ? channel : null }, users: { fetch: async id => ({ send: async () => { }, id }) } };
    const adapter = createDiscordPlayerUpgrades({ repository, service, client });

    function interaction(customId, { userId = "coach-bos", roles: roleIds = ["team-bos", "coach-role"], kind = "button", values = [], manageGuild = false } = {}) {
        const memberRoles = new Map(roleIds.map(id => [id, roles.get(id)]));
        const result = {
            customId, guildId: guild.id, guild, channel, user: { id: userId }, member: { roles: { cache: memberRoles } },
            memberPermissions: { has: () => manageGuild }, values,
            isButton: () => kind === "button", isStringSelectMenu: () => kind === "select", isModalSubmit: () => kind === "modal",
            deferReply: async payload => { result.deferred = true; result.deferPayload = payload; },
            editReply: async payload => { result.payload = payload; result.replied = true; },
            reply: async payload => { result.payload = payload; result.replied = true; },
            update: async payload => { result.payload = payload; result.replied = true; },
            showModal: async modal => { result.modal = modal; },
        };
        return result;
    }
    return { adapter, client, guild, messages, repository, roles, service, interaction };
}

function customId(component) { return component.data?.custom_id || component.custom_id; }

test("Player Upgrades pin is repaired idempotently and /upgrades responds privately", async t => {
    const f = setup(t);
    const first = await f.adapter.ensurePin(f.guild, "league");
    const again = await f.adapter.ensurePin(f.guild, "league");
    assert.equal(first.id, again.id);
    assert.equal([...f.messages.values()].filter(message => message.pinned).length, 1);
    assert.equal(f.repository.loadSettings("league").discordPins.playerUpgradesMessageId, first.id);
    const command = f.interaction("", { kind: "command" });
    await f.adapter.command(command);
    assert.equal(command.payload.embeds[0].data.title, "PLAYER UPGRADES · Boston Celtics");
    assert.equal(command.payload.components[0].components.length, 2);
});

test("restart recovery publishes a persisted pending request once", async t => {
    const f = setup(t);
    const request = f.service.createRequest({ leagueId: "league", seasonId: "2026", teamId: "bos", coachUserId: "coach-bos", source: "GAME_EARNED", type: "NORMAL", playerId: "player-bos", category: "SHOOTING", allocations: [{ attribute: "3PT", points: 1 }], phase: PHASES.REGULAR_SEASON, owners: f.repository.loadOwners("league") });
    assert.equal(request.discordMessageId, undefined);
    await f.adapter.restore(f.client);
    await f.adapter.restore(f.client);
    const ledgers = [...f.messages.values()].filter(message => message.embeds[0]?.footer?.text === `Request ${request.requestId}`);
    assert.equal(ledgers.length, 1);
    assert.equal(f.repository.loadPlayerUpgradeState("league").requests.find(entry => entry.requestId === request.requestId).discordMessageId, ledgers[0].id);
});

test("coach request flow posts one ledger entry; Staff-only approval updates that same message", async t => {
    const f = setup(t);
    await f.adapter.ensurePin(f.guild, "league");
    let action = f.interaction("upgrades:request");
    await f.adapter.handle(action);
    assert.equal(action.deferPayload.flags, 64);
    const sourceId = customId(action.payload.components[0].components[0]);
    action = f.interaction(sourceId, { kind: "select", values: ["GAME_EARNED"] });
    await f.adapter.handle(action);
    const playerId = customId(action.payload.components[0].components[0]);
    action = f.interaction(playerId);
    await f.adapter.handle(action);
    const rebounding = action.payload.components.flatMap(actionRow => actionRow.components).find(component => component.data.label === "REBOUNDING");
    action = f.interaction(customId(rebounding));
    await f.adapter.handle(action);
    const attributeId = customId(action.payload.components[0].components[0]);
    action = f.interaction(attributeId, { kind: "select", values: ["Offensive Rebound"] });
    await f.adapter.handle(action);
    const pointsId = customId(action.payload.components[1].components[0]);
    action = f.interaction(pointsId, { kind: "select", values: ["1"] });
    await f.adapter.handle(action);
    action = f.interaction(customId(action.payload.components[2].components[0]));
    await f.adapter.handle(action);
    action = f.interaction(customId(action.payload.components[3].components[0]));
    await f.adapter.handle(action);
    action = f.interaction(customId(action.payload.components[0].components[0]));
    await f.adapter.handle(action);
    const pending = [...f.messages.values()].find(message => message.embeds[0]?.title === "PLAYER UPGRADE — PENDING STAFF APPROVAL");
    assert.ok(pending);
    assert.match(pending.content, /<@&staff-role>/);
    assert.match(pending.embeds[0].description, /\+1 Offensive Rebound/);

    const unauthorized = f.interaction(customId(pending.components[0].components[0]), { manageGuild: true });
    await f.adapter.handle(unauthorized);
    assert.match(unauthorized.payload.content, /configured Staff role/);
    assert.equal(pending.embeds[0].title, "PLAYER UPGRADE — PENDING STAFF APPROVAL");

    const approve = f.interaction(customId(pending.components[0].components[0]), { roles: ["team-bos", "coach-role", "staff-role"] });
    await f.adapter.handle(approve);
    const both = approve.payload.components.flatMap(actionRow => actionRow.components).find(component => component.data.label === "BOTH CHANGED");
    const chooseMode = f.interaction(customId(both), { roles: ["team-bos", "coach-role", "staff-role"] });
    await f.adapter.handle(chooseMode);
    const ovrModal = f.interaction(chooseMode.modal.data.custom_id, { kind: "modal", roles: ["team-bos", "coach-role", "staff-role"] });
    ovrModal.fields = { getTextInputValue: () => "85" };
    await f.adapter.handleModal(ovrModal);
    const buildMenu = ovrModal.payload.components[0].components[0];
    const confirm = f.interaction(customId(buildMenu), { kind: "select", values: ["Stretch Five"], roles: ["team-bos", "coach-role", "staff-role"] });
    await f.adapter.handle(confirm);
    assert.match(confirm.payload.content, /completed/);
    assert.equal(pending.embeds[0].title, "PLAYER UPGRADE — COMPLETED");
    assert.equal(pending.components.length, 0);
    assert.equal(f.service.playerEligibility({ leagueId: "league", seasonId: "2026", teamId: "bos" }).find(player => player.playerId === "player-bos").completedUpgradeCount, 1);
    const player = f.repository.loadPlayers("league").find(entry => entry.playerId === "player-bos");
    assert.equal(player.overall, 85);
    assert.equal(player.archetype, "Stretch Five");
    const statusCommand = f.interaction("", { kind: "command" });
    await f.adapter.command(statusCommand);
    const history = f.interaction(customId(statusCommand.payload.components[0].components[1]));
    await f.adapter.handle(history);
    assert.match(history.payload.embeds[0].data.description, /OVR 80→85 · Build Arc Finisher→Stretch Five/);
    const eligibility = f.interaction(customId(statusCommand.payload.components[0].components[0]));
    await f.adapter.handle(eligibility);
    assert.match(eligibility.payload.embeds[0].data.description, /Boston Player.*1\/2/);
});