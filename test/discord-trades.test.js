const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFantasyHQRepository } = require("../src/fantasyhq/repository");
const { createTradeService } = require("../src/fantasyhq/trade-service");
const { createDiscordTradeWorkflow } = require("../src/fantasyhq/discord-trades");

function fixture(t, testMode = false, logger = { error() { } }) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "lb-discord-trades-")), root = testMode ? path.join(base,"simulations","fixture","workspace") : base;
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const repository = createFantasyHQRepository({ dataRoot: root });
    const teams = ["alpha", "bravo", "charlie"].map(teamId => ({ teamId, teamName: `${teamId} team`, abbreviation: teamId.toUpperCase(), conference: teamId === "alpha" ? "East" : "West" }));
    repository.saveLeague("league", { currentPhase: "REGULAR_SEASON", currentSeasonId: "1", seasonNumber: 1, currentWeek: 1, guildId: "guild" });
    repository.saveGuildLeagueBinding("guild", { leagueId: "league", seasonId: "1" });
    repository.saveTeams("league", teams);
    repository.saveSettings("league", { testMode, ...(testMode?{simulationId:'fixture'}:{}), discordChannels: {} });
    repository.saveOwners("league", teams.map(team => ({ teamId: team.teamId, userId: `coach-${team.teamId}` })));
    const players = [], memberships = [];
    for (const team of teams) for (let index = 0; index < 15; index += 1) {
        const playerId = `${team.teamId}-player-${index}`;
        players.push({ playerId, name: `${team.teamName} player ${index}`, overall: 80, birthdate: "2000-01-01", position1: "SF", height: "6'7\"", wingspan: "7'0\"", yearsInNBA: 5 });
        memberships.push({ playerId, teamId: team.teamId, seasonId: "1", active: true });
    }
    repository.savePlayers("league", players);
    repository.saveRosterMemberships("league", memberships);
    const roleIds = { alpha: "team-alpha", bravo: "team-bravo", charlie: "team-charlie" };
    const ownershipPath = path.join(repository.buildLeaguePaths(root, "league").leagueRoot, "role-ownership.json");
    fs.writeFileSync(ownershipPath, JSON.stringify({ guildId: "guild", roleIds }));
    const service = createTradeService({ repository });
    service.initializeDraftPicks({ leagueId: "league", seasonId: "1" });
    const roleEntries = [
        { id: "coach", name: "LEAGUEbuddy Coach" },
        { id: "gm", name: "LEAGUEbuddy GM" },
        ...teams.map(team => ({ id: roleIds[team.teamId], name: team.teamName })),
    ];
    const roleCache = [...roleEntries];
    roleCache.find = predicate => Array.prototype.find.call(roleCache, predicate);
    const guild = { id: "guild", members: { fetch: async userId => ({ user: { id: userId, bot: false }, roles: { cache: new Set([`team-${userId.replace("coach-", "")}`]) } }) }, roles: { cache: roleCache }, channels: { fetch: async () => null } };
    const workflow = createDiscordTradeWorkflow({ repository, tradeService: service, logger });
    function interaction(customId, { kind = "button", userId = "coach-alpha", selected = [], roles = ["coach", "team-alpha"], guildContext = guild, manageGuild = false } = {}) {
        const result = {
            customId, guildId: guildContext?.id || null, guild: guildContext, user: { id: userId }, values: selected, replied: false, deferred: false,
            member: { roles: { cache: new Set(roles) }, permissions: { has: () => false } },
            memberPermissions: { has: () => manageGuild }, client: { guilds: { fetch: async () => guild } },
            isButton: () => kind === "button", isStringSelectMenu: () => kind === "select",
            reply: async payload => { result.payload = payload; result.replied = true; },
            update: async payload => { result.payload = payload; result.replied = true; },
            followUp: async payload => { result.followup = payload; },
        };
        return result;
    }
    return { guild, interaction, repository, service, teams, workflow };
}

test("pinned builder supports third teams, routed assets, value/roster feedback, and full package review", async t => {
    const f = fixture(t);
    const opened = f.interaction("trade:build");
    await f.workflow.handleTradeInteraction(opened);
    assert.equal(opened.payload.components[0].components[0].toJSON().options.length, 2);
    const selectedTeam = f.interaction("trade:select-other:alpha:0", { kind: "select", selected: ["bravo"] });
    await f.workflow.handleTradeInteraction(selectedTeam);
    const addThird = selectedTeam.payload.components[0].components[4].data.custom_id;
    const thirdPicker = f.interaction(addThird);
    await f.workflow.handleTradeInteraction(thirdPicker);
    const tradeId = addThird.split(":")[2];
    assert.equal(thirdPicker.payload.components[0].components[0].toJSON().options[0].value, "charlie");
    const addCharlie = f.interaction(`trade:select-third:${tradeId}:0`, { kind: "select", selected: ["charlie"] });
    await f.workflow.handleTradeInteraction(addCharlie);
    const addPlayer = f.interaction(`trade:add:PLAYER:${tradeId}`);
    await f.workflow.handleTradeInteraction(addPlayer);
    const sourceAlpha = f.interaction(`trade:source:PLAYER:${tradeId}:alpha`);
    await f.workflow.handleTradeInteraction(sourceAlpha);
    const choosePlayer = f.interaction(`trade:asset:PLAYER:${tradeId}:alpha`, { kind: "select", selected: [encodeURIComponent("alpha-player-0")] });
    await f.workflow.handleTradeInteraction(choosePlayer);
    const routePlayer = f.interaction(`trade:destination:${tradeId}:PLAYER:alpha:${encodeURIComponent("alpha-player-0")}`, { kind: "select", selected: ["bravo|UNPROTECTED"] });
    await f.workflow.handleTradeInteraction(routePlayer);
    assert.ok(routePlayer.payload.embeds[0].data.fields.some(field => field.value.includes("would have 14 players") || field.value.includes("would have 16 players")));
    const sourceBravo = f.interaction(`trade:source:PLAYER:${tradeId}:bravo`);
    await f.workflow.handleTradeInteraction(sourceBravo);
    const chooseBravo = f.interaction(`trade:asset:PLAYER:${tradeId}:bravo`, { kind: "select", selected: [encodeURIComponent("bravo-player-0")] });
    await f.workflow.handleTradeInteraction(chooseBravo);
    const routeBravo = f.interaction(`trade:destination:${tradeId}:PLAYER:bravo:${encodeURIComponent("bravo-player-0")}`, { kind: "select", selected: ["alpha|UNPROTECTED"] });
    await f.workflow.handleTradeInteraction(routeBravo);
    const submit = routeBravo.payload.components[1].components.find(component => component.data.label === "Submit Proposal");
    assert.equal(submit.data.disabled, false);
    const packageButton = routeBravo.payload.components[1].components[0].data.custom_id;
    const packageReview = f.interaction(packageButton);
    await f.workflow.handleTradeInteraction(packageReview);
    assert.match(packageReview.payload.embeds[0].data.title, /alpha team Package/);
    assert.match(packageReview.payload.embeds[0].data.description, /Receives from bravo team/);
});

test("trade builder disables submission while roster or value checks are invalid", async t => {
    const f = fixture(t), players = f.repository.loadPlayers("league"), memberships = f.repository.loadRosterMemberships("league");
    for (const [teamId, count] of [["alpha", 4], ["bravo", 3]]) {
        for (let index = 0; index < count; index += 1) {
            const playerId = `${teamId}-extra-${index}`;
            players.push({ playerId, name: `${teamId} extra ${index}`, overall: 80, position1: "SF" });
            memberships.push({ leagueId: "league", seasonId: "1", teamId, playerId, active: true });
        }
    }
    f.repository.savePlayers("league", players);
    f.repository.saveRosterMemberships("league", memberships);
    const draft = f.service.createDraft({ leagueId: "league", seasonId: "1", initiatingUserId: "coach-alpha", initiatingTeamId: "alpha", secondTeamId: "bravo" });
    f.service.updateDraft({
        leagueId: "league", tradeId: draft.tradeId, actorUserId: "coach-alpha", transfers: [
            { assetType: "PLAYER", assetId: "alpha-player-0", fromTeamId: "alpha", toTeamId: "bravo" },
        ]
    });
    const refresh = f.interaction(`trade:back:${draft.tradeId}`);
    await f.workflow.handleTradeInteraction(refresh);
    const submit = refresh.payload.components[1].components.find(component => component.data.label === "Submit Proposal");
    assert.equal(submit.data.disabled, true);
    assert.match(refresh.payload.embeds[0].data.fields.find(field => field.name === "What needs fixing").value, /finish with exactly 15/);
});

test("existing Test Mode lets league staff choose a team without weakening production entry", async t => {
    const testFixture = fixture(t, true);
    const simulated = testFixture.interaction("trade:build", { userId: "commissioner", roles: [], manageGuild: true });
    await testFixture.workflow.handleTradeInteraction(simulated);
    assert.match(simulated.payload.content, /Choose the team you are building for/);
    assert.equal(simulated.payload.components[0].components[0].toJSON().options.length, 3);
    const production = fixture(t, false);
    const denied = production.interaction("trade:build", { userId: "visitor", roles: [] });
    await production.workflow.handleTradeInteraction(denied);
    assert.match(denied.payload.content, /Coaches and GMs/);
});

test("counter builder remains interactive in DMs and a team cannot bypass production ownership", async t => {
    const f = fixture(t);
    const draft = f.service.createDraft({ leagueId: "league", seasonId: "1", initiatingUserId: "coach-alpha", initiatingTeamId: "alpha", secondTeamId: "bravo" });
    f.service.updateDraft({
        leagueId: "league", tradeId: draft.tradeId, actorUserId: "coach-alpha", transfers: [
            { assetType: "PLAYER", assetId: "alpha-player-0", fromTeamId: "alpha", toTeamId: "bravo" },
            { assetType: "PLAYER", assetId: "bravo-player-0", fromTeamId: "bravo", toTeamId: "alpha" },
        ]
    });
    f.service.submitTrade({ leagueId: "league", tradeId: draft.tradeId, actorUserId: "coach-alpha" });
    f.service.counterTrade({ leagueId: "league", tradeId: draft.tradeId, version: 1, actorUserId: "coach-bravo", actorTeamId: "bravo" });
    const dm = { id: "dm", roles: f.guild.roles, channels: f.guild.channels };
    const editCounter = f.interaction(`trade:add:PLAYER:${draft.tradeId}`, { userId: "coach-bravo", roles: [], guildContext: null });
    await f.workflow.handleTradeInteraction(editCounter);
    assert.match(editCounter.payload.content, /Choose the team sending a player/);
    const attemptedTakeover = f.service.createDraft({ leagueId: "league", seasonId: "1", initiatingUserId: "coach-bravo", initiatingTeamId: "alpha", secondTeamId: "bravo" });
    f.service.updateDraft({
        leagueId: "league", tradeId: attemptedTakeover.tradeId, actorUserId: "coach-bravo", transfers: [
            { assetType: "PLAYER", assetId: "alpha-player-1", fromTeamId: "alpha", toTeamId: "bravo" },
            { assetType: "PLAYER", assetId: "bravo-player-1", fromTeamId: "bravo", toTeamId: "alpha" },
        ]
    });
    assert.throws(() => f.service.submitTrade({ leagueId: "league", tradeId: attemptedTakeover.tradeId, actorUserId: "coach-bravo" }), /assigned coach/);
});

test("trade interaction failures write the component ID and stack to the bot logger", async t => {
    const errors = [], logger = { error: (...parts) => errors.push(parts) }, f = fixture(t, false, logger);
    const interaction = f.interaction("trade:source:PLAYER:missing:alpha");
    await f.workflow.handleTradeInteraction(interaction);
    assert.match(errors[0][0], /trade:source:PLAYER:missing:alpha/);
    assert.match(errors[0][0], /user coach-alpha/);
    assert.match(String(errors[0][1]), /no longer available/);
    assert.match(interaction.payload.content, /no longer available/);
});

test("player selectors page through all roster assets when a team exceeds Discord's 25-option limit", async t => {
    const f = fixture(t), players = f.repository.loadPlayers("league"), memberships = f.repository.loadRosterMemberships("league");
    for (let index = 0; index < 11; index += 1) {
        const playerId = `alpha-extra-${index}`;
        players.push({ playerId, name: `Extra Player ${index}`, overall: 70, birthdate: "2000-01-01", position1: "SF" });
        memberships.push({ playerId, teamId: "alpha", seasonId: "1", active: true });
    }
    f.repository.savePlayers("league", players);
    f.repository.saveRosterMemberships("league", memberships);
    const draft = f.service.createDraft({ leagueId: "league", seasonId: "1", initiatingUserId: "coach-alpha", initiatingTeamId: "alpha", secondTeamId: "bravo" });
    const add = f.interaction(`trade:add:PLAYER:${draft.tradeId}`);
    await f.workflow.handleTradeInteraction(add);
    const sourceId = add.payload.components[0].components[0].data.custom_id;
    const chooseSource = f.interaction(sourceId);
    await f.workflow.handleTradeInteraction(chooseSource);
    const firstPage = chooseSource.payload.components[0].components[0].toJSON();
    assert.equal(firstPage.options.length, 25);
    const nextPageId = chooseSource.payload.components[1].components.find(button => button.data.label === "More players").data.custom_id;
    const secondPage = f.interaction(nextPageId);
    await f.workflow.handleTradeInteraction(secondPage);
    assert.match(secondPage.payload.content, /Page 2\/2/);
    assert.equal(secondPage.payload.components[0].components[0].toJSON().options.length, 1);
});

test('solo committee fallback handles an involved tester role while preserving independent online voters', async t => {
    for (const independent of [false, true]) {
        const f = fixture(t, true);
        f.repository.saveOwners('league', [{ teamId: 'alpha', userId: 'coach-alpha' }]);
        f.repository.saveSettings('league', { testMode: true, simulationId:'fixture', discordChannels: { tradeCommittee: 'committee' } });
        f.guild.roles.cache.push({ id: 'reviewers', name: 'LEAGUEbuddy Trade Committee' });
        f.guild.roles.fetch = async () => { };
        const ids = independent ? ['coach-alpha', 'independent'] : ['coach-alpha'];
        f.guild.members = { fetch: async () => new Map(ids.map(id => [id, { id, user: { bot: false }, roles: { cache: new Set(['reviewers']) } }])) };
        let posted;
        f.guild.channels.fetch = async () => ({ id: 'committee', send: async payload => { posted = payload; return { id: 'vote-message' }; } });
        const draft = f.service.createDraft({ leagueId: 'league', seasonId: '1', initiatingUserId: 'coach-alpha', initiatingTeamId: 'alpha', secondTeamId: 'bravo' });
        f.service.updateDraft({
            leagueId: 'league', tradeId: draft.tradeId, actorUserId: 'coach-alpha', transfers: [
                { assetType: 'PLAYER', assetId: 'alpha-player-0', fromTeamId: 'alpha', toTeamId: 'bravo' },
                { assetType: 'PLAYER', assetId: 'bravo-player-0', fromTeamId: 'bravo', toTeamId: 'alpha' },
            ]
        });
        const { trade } = f.service.submitTrade({ leagueId: 'league', tradeId: draft.tradeId, actorUserId: 'coach-alpha' });
        const click = f.interaction(`trade:gm:APPROVE:${trade.tradeId}:1:bravo`, { manageGuild: true });
        await f.workflow.handleTradeInteraction(click);
        const updated = f.service.getTrade('league', trade.tradeId);
        assert.equal(updated.status, 'PENDING_COMMITTEE', JSON.stringify(click.payload));
        assert.deepEqual(updated.currentVersion.committee.eligibleVoterIds, independent ? ['independent'] : Array.from({ length: 5 }, (_, i) => `test-committee:coach-alpha:${i + 1}`));
        assert.equal(posted.components.length, independent ? 1 : 5);
    }
});

test('a configured team role identifies the acting coach without the generic Coach badge', async t => {
    const f = fixture(t);
    const actor = f.interaction('trade:build', { roles: ['team-alpha'] });
    await f.workflow.handleTradeInteraction(actor);
    assert.match(actor.payload.content, /alpha team/);
    const stale = f.interaction('trade:build', { roles: ['team-bravo'] });
    await f.workflow.handleTradeInteraction(stale);
    assert.match(stale.payload.content, /must match/);
});

test('trade team selection and saved builders cannot act for a different team', async t => {
    const f = fixture(t);
    const tampered = f.interaction('trade:select-other:bravo:0', { kind: 'select', selected: ['charlie'] });
    await f.workflow.handleTradeInteraction(tampered);
    assert.match(tampered.payload.content, /current team only/);
    const draft = f.service.createDraft({ leagueId: 'league', seasonId: '1', initiatingUserId: 'coach-alpha', initiatingTeamId: 'alpha', secondTeamId: 'bravo' });
    f.repository.saveOwners('league', [{ userId: 'coach-alpha', teamId: 'charlie' }, { userId: 'coach-bravo', teamId: 'bravo' }]);
    for (const customId of [`trade:add:PLAYER:${draft.tradeId}`, `trade:submit:${draft.tradeId}`]) {
        const moved = f.interaction(customId, { roles: ['team-charlie'] });
        await f.workflow.handleTradeInteraction(moved);
        assert.match(moved.payload.content, /team changed/);
    }
    assert.equal(f.service.getTrade('league', draft.tradeId).status, 'DRAFT');
});

test('pending trade packages use private participant rooms and never the shared Submit Trade channel', async t => {
    for (const [validRoom, dmOpen] of [[true, true], [true, false], [false, true]]) {
        const f = fixture(t), { ChannelType } = require('discord.js');
        f.repository.saveSettings('league', { discordChannels: { submitTrade: 'submit' } });
        let sharedPosts = 0, privatePosts = 0, created = 0; const members = [];
        const thread = { id: 'proposal-room', parentId: 'submit', type: validRoom ? ChannelType.PrivateThread : ChannelType.PublicThread,
            members: { add: async id => members.push(id) }, send: async payload => { privatePosts++; assert.ok(payload.embeds.length); return { id: 'proposal-message' }; } };
        const channel = { id: 'submit', send: async () => { sharedPosts++; assert.fail('Pending package must never be posted in the shared channel'); },
            threads: { create: async options => { created++; assert.equal(options.type, ChannelType.PrivateThread); assert.equal(options.invitable, false); return thread; } } };
        f.guild.channels.fetch = async id => id === 'submit' ? channel : id === thread.id ? thread : null;
        const draft = f.service.createDraft({ leagueId: 'league', seasonId: '1', initiatingUserId: 'coach-alpha', initiatingTeamId: 'alpha', secondTeamId: 'bravo' });
        f.service.updateDraft({ leagueId: 'league', tradeId: draft.tradeId, actorUserId: 'coach-alpha', transfers: [
            { assetType: 'PLAYER', assetId: 'alpha-player-0', fromTeamId: 'alpha', toTeamId: 'bravo' },
            { assetType: 'PLAYER', assetId: 'bravo-player-0', fromTeamId: 'bravo', toTeamId: 'alpha' },
        ] });
        const click = f.interaction(`trade:submit:${draft.tradeId}`);
        click.client.users = { fetch: async () => ({ send: async () => { if (!dmOpen) throw Object.assign(Error('DMs closed'), { code: 50007 }); return { id: 'dm', channelId: 'dm-channel' }; } }) };
        await f.workflow.handleTradeInteraction(click);
        assert.equal(sharedPosts, 0); assert.equal(created, 1);
        assert.equal(privatePosts, validRoom ? 1 : 0);
        if (validRoom) {
            assert.deepEqual(members.sort(), ['coach-alpha', 'coach-bravo']);
            assert.equal(f.service.getTrade('league', draft.tradeId).currentVersion.proposalThreadId, thread.id);
            // Recovery reuses the room and package rather than broadcasting or duplicating them.
            click.client.guilds.cache = new Map([['guild', f.guild]]);
            await f.workflow.reconcile(click.client);
            assert.equal(created, 1); assert.equal(privatePosts, 1);
        } else assert.match(click.followup.content, /not a private thread/);
    }
});
