const { randomUUID } = require("crypto");
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const { PHASES } = require("./constants");
const { STAFF_ROLES } = require("./discord-permissions");
const { NORMAL_CATEGORIES, SPECIAL_UPGRADES, validateNormalUpgrade } = require("./player-upgrades-service");
const COLOR = 0xffdc21;

const button = (customId, label, style = ButtonStyle.Secondary, disabled = false) =>
    new ButtonBuilder().setCustomId(customId).setLabel(label.slice(0, 80)).setStyle(style).setDisabled(disabled);
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const safe = value => String(value ?? "—").replace(/[\r\n]/g, " ").slice(0, 100);

function createDiscordPlayerUpgrades({ repository, service, client } = {}) {
    const drafts = new Map();
    const approvals = new Map();
    const key = (guildId, userId) => `${guildId}:${userId}`;
    const roleCache = member => member?.roles?.cache;
    const isStaff = interaction => {
        const roles = roleCache(interaction.member);
        return Boolean(roles && [...roles.values()].some(role => STAFF_ROLES.has(role.name)));
    };

    function bound(interaction) {
        const context = repository.loadLeagueContext({ guildId: interaction.guildId });
        const ownership = repository.loadRoleOwnership(context.league.leagueId);
        const roles = roleCache(interaction.member);
        if (!roles) throw new Error("Your team roles could not be verified. Try again in a moment.");
        const teamIds = context.teams.filter(team => {
            const roleId = ownership.roleIds?.[team.teamId];
            return roleId && roles.has(roleId);
        }).map(team => team.teamId);
        if (teamIds.length !== 1) throw new Error(teamIds.length ? "You hold multiple team roles. Ask Staff to resolve the ownership conflict." : "Your team Coach role is not configured. Ask Staff to repair league roles.");
        const teamId = teamIds[0], owner = repository.loadOwners(context.league.leagueId).find(entry => entry.teamId === teamId);
        if (owner?.userId !== interaction.user.id) throw new Error("Your Coach role is not the current owner assignment. Ask Staff to sync league roles.");
        return { context, teamId, coachUserId: interaction.user.id, team: context.teams.find(entry => entry.teamId === teamId) };
    }

    function statusEmbed(context, team, status) {
        const remaining = status.gamesToNextUpgrade;
        return new EmbedBuilder().setColor(COLOR).setTitle(`PLAYER UPGRADES · ${team.teamName}`)
            .setDescription([
                `Qualifying true games: **${status.qualifyingGames}**`,
                `Next game-earned upgrade: **${remaining === 0 ? "earned" : `${remaining} game${remaining === 1 ? "" : "s"} away`}**`,
                `Game-earned upgrades: **${status.gameEarnedAvailable}**`,
                `New User Upgrade: **${status.newUserStatus.replaceAll("_", " ")}**`,
                `Special: **${status.special.status === "USED" ? `used · ${status.special.type}` : status.special.status.replaceAll("_", " ")}**`,
                `Requests: **${status.requestsAllowed ? "open" : "locked outside the regular season"}**`,
            ].join("\n"))
            .setFooter({ text: `${context.league.leagueName} · Season ${context.league.seasonNumber}` });
    }

    function commandButtons() {
        return row(button("upgrades:eligibility:0", "VIEW PLAYER ELIGIBILITY", ButtonStyle.Primary), button("upgrades:history:0", "MY UPGRADE HISTORY"));
    }

    async function command(interaction) {
        try {
            const { context, teamId, coachUserId, team } = bound(interaction);
            const status = service.getStatus({ leagueId: context.league.leagueId, seasonId: context.seasonId, teamId, coachUserId, phase: context.league.currentPhase, owners: repository.loadOwners(context.league.leagueId) });
            await interaction.editReply({ embeds: [statusEmbed(context, team, status)], components: [commandButtons()] });
        } catch (error) {
            await interaction.editReply({ content: error.message, embeds: [], components: [] });
        }
    }

    function draftFor(id, interaction) {
        const draft = drafts.get(id);
        if (!draft || draft.guildId !== interaction.guildId || draft.coachUserId !== interaction.user.id) throw new Error("This upgrade builder expired. Click Request Upgrade again.");
        const current = bound(interaction);
        if (current.teamId !== draft.teamId || current.context.seasonId !== draft.seasonId) throw new Error("Your team or season changed. Restart the upgrade request.");
        return { draft, ...current };
    }

    function sourcePayload(draft, status) {
        const options = [];
        if (status.gameEarnedAvailable > 0) options.push({ label: "Game-Earned Upgrade", description: `${status.gameEarnedAvailable} available · Normal or eligible Special`, value: "GAME_EARNED" });
        if (status.newUserStatus === "AVAILABLE") options.push({ label: "New User Upgrade", description: "1 available · Normal category only", value: "NEW_USER" });
        const embed = new EmbedBuilder().setColor(COLOR).setTitle("CHOOSE UPGRADE SOURCE")
            .setDescription(options.length ? "Choose which earned upgrade to use. The balance is consumed only after Staff completes the upgrade." : "No upgrade source is currently available.");
        return { embeds: [embed], components: options.length ? [row(new StringSelectMenuBuilder().setCustomId(`upgrades:source:${draft.draftId}`).setPlaceholder("Select upgrade source").addOptions(options))] : [] };
    }

    function playerPayload(draft, eligibility, page = 0) {
        const pageSize = 15, start = page * pageSize, items = eligibility.slice(start, start + pageSize);
        const controls = items.map(player => button(`upgrades:player:${draft.draftId}:${encodeURIComponent(player.playerId)}`, `${player.name} · ${player.maxed ? "2/2 MAXED" : `${player.completedUpgradeCount}/2`}`, ButtonStyle.Secondary, player.maxed));
        const rows = [];
        for (let index = 0; index < controls.length; index += 5) rows.push(row(...controls.slice(index, index + 5)));
        const nav = [];
        if (page > 0) nav.push(button(`upgrades:players:${draft.draftId}:${page - 1}`, "Previous players"));
        if (start + pageSize < eligibility.length) nav.push(button(`upgrades:players:${draft.draftId}:${page + 1}`, "More players"));
        if (nav.length) rows.push(row(...nav));
        return {
            embeds: [new EmbedBuilder().setColor(COLOR).setTitle(`CHOOSE PLAYER · ${draft.teamName}`)
                .setDescription(items.map(player => `**${player.name}** · ${player.maxed ? "2/2 MAXED" : `${player.completedUpgradeCount}/2`}${player.usedCategories.length ? ` · Used: ${player.usedCategories.join(", ")}` : ""}`).join("\n") || "No current roster players.")],
            components: rows,
        };
    }

    function categoryPayload(draft, player) {
        const categories = Object.keys(NORMAL_CATEGORIES).map(category => {
            const used = player.usedCategories.includes(category);
            return button(`upgrades:category:${draft.draftId}:${encodeURIComponent(category)}`, used ? `${category} · USED` : category, ButtonStyle.Secondary, used);
        });
        const special = [];
        if (draft.source === "GAME_EARNED" && draft.qualifyingGames >= 4 && !draft.specialUsed) {
            special.push(...Object.keys(SPECIAL_UPGRADES).map(type => button(`upgrades:special:${draft.draftId}:${encodeURIComponent(type)}`, type)));
        }
        const all = [...categories, ...special], rows = [];
        for (let index = 0; index < all.length; index += 5) rows.push(row(...all.slice(index, index + 5)));
        return { embeds: [new EmbedBuilder().setColor(COLOR).setTitle(`CHOOSE UPGRADE · ${player.name}`).setDescription(`${player.completedUpgradeCount}/2 completed this season${player.usedCategories.length ? `\nNormal categories used: ${player.usedCategories.join(", ")}` : ""}${draft.source === "NEW_USER" ? "\nNew User upgrades cannot use a Special." : ""}`)], components: rows };
    }

    function allocationPayload(draft) {
        const category = draft.category, attributes = NORMAL_CATEGORIES[category];
        const used = draft.allocations.reduce((sum, entry) => sum + entry.points, 0);
        const points = [1, 2, 3].filter(value => used + value <= 5).map(value => ({ label: `+${value}`, value: String(value) }));
        const changes = draft.allocations.map(entry => `+${entry.points} ${entry.attribute}`).join("\n") || "No attributes added yet.";
        const rows = [row(new StringSelectMenuBuilder().setCustomId(`upgrades:attribute:${draft.draftId}`).setPlaceholder("Choose attribute").addOptions(attributes.map(attribute => ({ label: attribute, value: attribute }))))];
        if (points.length) rows.push(row(new StringSelectMenuBuilder().setCustomId(`upgrades:points:${draft.draftId}`).setPlaceholder("Choose points").addOptions(points)));
        rows.push(row(button(`upgrades:add:${draft.draftId}`, "ADD ATTRIBUTE", ButtonStyle.Primary, !draft.selectedAttribute || !draft.selectedPoints), button(`upgrades:remove:${draft.draftId}`, "REMOVE LAST", ButtonStyle.Secondary, !draft.allocations.length)));
        rows.push(row(button(`upgrades:review:${draft.draftId}`, "REVIEW UPGRADE", ButtonStyle.Success, used < 1), button(`upgrades:categories:${draft.draftId}`, "BACK TO CATEGORIES")));
        return {
            embeds: [new EmbedBuilder().setColor(COLOR).setTitle(`${category} UPGRADE`)
                .setDescription(`Points Used: **${used}/5**\n\n${changes}\n\nMaximum +3 to any one attribute. Unused points are not banked.`)], components: rows
        };
    }

    function reviewPayload(draft) {
        const details = draft.type === "NORMAL" ? `Category: **${draft.category}**\n${draft.allocations.map(entry => `+${entry.points} ${entry.attribute}`).join("\n")}` : `Special: **${draft.specialType}**\n${SPECIAL_UPGRADES[draft.specialType].attributes.join("\n")}`;
        return {
            embeds: [new EmbedBuilder().setColor(COLOR).setTitle("REVIEW PLAYER UPGRADE")
                .setDescription(`Team: **${draft.teamName}**\nPlayer: **${draft.player.name}**\nSource: **${draft.source.replaceAll("_", " ")}**\n\n${details}\n\nPlayer season limit: **${draft.player.completedUpgradeCount}/2**\nAvailable balance after approval: **${draft.availableAfter}**`)],
            components: [row(button(`upgrades:submit:${draft.draftId}`, "SUBMIT UPGRADE", ButtonStyle.Success), button(`upgrades:back:${draft.draftId}`, "BACK / EDIT"))]
        };
    }

    function changesText(request) {
        return request.type === "NORMAL"
            ? `${request.category}\n${request.allocations.map(entry => `+${entry.points} ${entry.attribute}`).join("\n")}`
            : `${request.specialType}\n${request.specialChanges.attributes.join("\n")}`;
    }

    function ledgerPayload(request, player, team) {
        const completed = request.status === "COMPLETED", rejected = request.status === "REJECTED", expired = request.status === "EXPIRED";
        const title = completed ? "PLAYER UPGRADE — COMPLETED" : rejected ? "PLAYER UPGRADE — REJECTED" : expired ? `PLAYER UPGRADE — EXPIRED${request.expirationReason ? ` · ${request.expirationReason.replaceAll("_", " ")}` : ""}` : "PLAYER UPGRADE — PENDING STAFF APPROVAL";
        const embed = new EmbedBuilder().setColor(completed ? 0x35a76f : rejected || expired ? 0x8b9098 : COLOR).setTitle(title)
            .setDescription(`Player: **${safe(player?.name || request.playerId)}**\nTeam: **${safe(team?.teamName || request.teamId)}**\nCoach: <@${request.coachUserId}>\nSource: **${request.source.replaceAll("_", " ")}**\n\n${changesText(request)}\n\nSeason upgrades: **${Math.min(2, (request.playerUpgradeCountBefore || 0) + (completed ? 1 : 0))}/2**`)
            .addFields({ name: "OVR", value: completed ? (request.before.overall === request.after.overall ? `${request.before.overall ?? "—"} — No Change` : `${request.before.overall ?? "—"} → ${request.after.overall ?? "—"}`) : safe(request.playerSnapshot?.overall), inline: true },
                { name: "Build", value: completed ? (request.before.archetype === request.after.archetype ? `${safe(request.before.archetype)} — No Change` : `${safe(request.before.archetype)} → ${safe(request.after.archetype)}`) : safe(request.playerSnapshot?.archetype), inline: true },
                { name: "Submitted", value: `<t:${Math.floor(Date.parse(request.submittedAt) / 1000)}:F>`, inline: true });
        if (completed && request.before.weightLbs !== request.after.weightLbs) embed.addFields({ name: "Weight", value: `${request.before.weightLbs} → ${request.after.weightLbs} lbs`, inline: true });
        if (completed) embed.addFields({ name: "Approved by", value: `<@${request.staffUserId}>`, inline: true }, { name: "Completed", value: `<t:${Math.floor(Date.parse(request.completedAt) / 1000)}:F>`, inline: true });
        if (request.status === "PENDING_STAFF") embed.setFooter({ text: `Request ${request.requestId}` });
        const components = request.status === "PENDING_STAFF" ? [row(button(`upgrades:approve:${request.requestId}`, "APPROVE", ButtonStyle.Success), button(`upgrades:reject:${request.requestId}`, "REJECT", ButtonStyle.Danger))] : [];
        return { content: request.status === "PENDING_STAFF" ? staffMention(request.leagueId) : "", embeds: [embed], components, allowedMentions: { roles: staffRoleIds(request.leagueId), users: [request.coachUserId] } };
    }

    function staffRoleIds(leagueId) {
        const configuredGuildId = repository.loadLeague(leagueId).league.guildId;
        const guild = configuredGuildId ? client?.guilds?.cache?.get(configuredGuildId) : [...(client?.guilds?.cache?.values?.() || [])].find(entry => repository.loadGuildLeagueBinding(entry.id)?.leagueId === leagueId);
        return guild ? [...guild.roles.cache.values()].filter(role => STAFF_ROLES.has(role.name)).map(role => role.id) : [];
    }

    function staffMention(leagueId) {
        const ids = staffRoleIds(leagueId);
        return ids.map(id => `<@&${id}>`).join(" ");
    }

    function upgradeChannel(guild, leagueId) {
        const channelId = repository.loadSettings(leagueId)?.discordChannels?.playerUpgrades;
        if (!channelId) throw new Error("Configure Player Upgrades with /league setup → Create / repair channels.");
        return guild.channels.fetch(channelId);
    }

    async function ensurePin(guild, leagueId) {
        const settings = repository.loadSettings(leagueId) || {}, channelId = settings.discordChannels?.playerUpgrades;
        if (!channelId) throw new Error("Configure the Player Upgrades channel with /league setup → Create / repair channels.");
        const channel = await guild.channels.fetch(channelId), pins = settings.discordPins || {};
        const payload = {
            embeds: [new EmbedBuilder().setColor(COLOR).setTitle("LEAGUEbuddy PLAYER UPGRADES")
                .setDescription("Every 4 qualifying true games earns 1 Game-Earned Upgrade.\n\nNormal upgrades use 1–5 points, maximum +3 to one attribute. Each player may complete 2 upgrades per season. Each team may complete 1 Special per season after the coach reaches 4 qualifying games.")],
            components: [row(button("upgrades:request", "REQUEST UPGRADE", ButtonStyle.Primary))], allowedMentions: { parse: [] }
        };
        let message = null;
        if (pins.playerUpgradesMessageId) {
            try { message = await channel.messages.fetch(pins.playerUpgradesMessageId); }
            catch (error) { if (error.code !== 10008) throw error; }
        }
        const pinned = await require("../shared/discord-pins").fetchPinnedMessages(channel);
        const matching = pinned.filter(item => item.author.id === guild.members.me.id && item.components.some(actionRow => actionRow.components.some(component => component.customId === "upgrades:request")));
        if (!message) message = matching[0] || null;
        if (message) await message.edit(payload); else message = await channel.send(payload);
        for (const duplicate of matching.filter(item => item.id !== message.id)) await duplicate.unpin("Remove duplicate LEAGUEbuddy player-upgrades pin").catch(() => { });
        if (!message.pinned) await message.pin("Permanent LEAGUEbuddy Player Upgrades entry");
        const latest = repository.loadSettings(leagueId) || {};
        repository.saveSettings(leagueId, { ...latest, discordPins: { ...latest.discordPins, playerUpgradesMessageId: message.id, playerUpgradesChannelId: channel.id } });
        return message;
    }

    async function publishRequest(guild, request) {
        const channel = await upgradeChannel(guild, request.leagueId);
        const context = repository.loadLeague(request.leagueId, request.seasonId), player = repository.loadPlayers(request.leagueId).find(entry => entry.playerId === request.playerId), team = context.teams.find(entry => entry.teamId === request.teamId);
        if (request.discordMessageId) {
            const existing = await channel.messages.fetch(request.discordMessageId).catch(error => error.code === 10008 ? null : Promise.reject(error));
            if (existing) { await existing.edit(ledgerPayload(request, player, team)); return existing; }
        }
        const messages = await channel.messages.fetch({ limit: 100 });
        const existing = [...messages.values()].find(message => message.author.id === guild.members.me.id && message.embeds.some(embed => embed.footer?.text === `Request ${request.requestId}`));
        const message = existing || await channel.send(ledgerPayload(request, player, team));
        service.setRequestDiscordReference({ leagueId: request.leagueId, requestId: request.requestId, channelId: channel.id, messageId: message.id });
        return message;
    }

    async function refreshLedger(request) {
        if (!request.discordChannelId || !request.discordMessageId) return;
        const channel = await client.channels.fetch(request.discordChannelId);
        const message = await channel.messages.fetch(request.discordMessageId);
        const context = repository.loadLeague(request.leagueId, request.seasonId), player = repository.loadPlayers(request.leagueId).find(entry => entry.playerId === request.playerId), team = context.teams.find(entry => entry.teamId === request.teamId);
        await message.edit(ledgerPayload(request, player, team));
    }

    async function refreshExpired(before, after) {
        const priorStatus = new Map((before?.requests || []).map(request => [request.requestId, request.status]));
        for (const request of after?.requests || []) {
            if (request.status !== "EXPIRED" || priorStatus.get(request.requestId) === "EXPIRED") continue;
            try { await refreshLedger(request); }
            catch (error) { console.error("Player upgrade ledger refresh failed:", error.message); }
        }
    }

    async function syncOwnerChange(change) {
        const before = repository.loadPlayerUpgradeState(change.leagueId);
        service.syncOwnerSnapshot(change);
        await refreshExpired(before, repository.loadPlayerUpgradeState(change.leagueId));
    }

    async function invalidatePlayerRequests(event) {
        const before = repository.loadPlayerUpgradeState(event.leagueId);
        const changed = service.invalidatePlayerRequests(event);
        if (changed) await refreshExpired(before, repository.loadPlayerUpgradeState(event.leagueId));
        return changed;
    }

    function approvalPayload(request) {
        return {
            embeds: [new EmbedBuilder().setColor(COLOR).setTitle("APPROVE PLAYER UPGRADE")
                .setDescription(`Player: **${safe(request.playerSnapshot?.name || request.playerId)}**\nCurrent OVR: **${safe(request.playerSnapshot?.overall)}**\nCurrent build: **${safe(request.playerSnapshot?.archetype)}**\n\nChoose whether stored player data changed in NBA 2K.`)],
            components: [row(button(`upgrades:mode:${request.requestId}:NO_CHANGE`, "NO CHANGE", ButtonStyle.Secondary), button(`upgrades:mode:${request.requestId}:OVR_CHANGED`, "OVR CHANGED")),
            row(button(`upgrades:mode:${request.requestId}:BUILD_CHANGED`, "BUILD CHANGED"), button(`upgrades:mode:${request.requestId}:BOTH_CHANGED`, "BOTH CHANGED"))]
        };
    }

    async function askApprovalMode(interaction, requestId) {
        if (!isStaff(interaction)) throw new Error("Only members with a configured Staff role can approve upgrades.");
        const state = repository.loadPlayerUpgradeState(repository.loadLeagueContext({ guildId: interaction.guildId }).league.leagueId);
        const request = state?.requests.find(entry => entry.requestId === requestId);
        if (!request || request.status !== "PENDING_STAFF") throw new Error("This upgrade request is no longer pending.");
        await interaction.reply({ ...approvalPayload(request), flags: MessageFlags.Ephemeral });
    }

    async function complete(interaction, request, mode, fields = {}) {
        let completed;
        try {
            completed = service.completeRequest({ leagueId: request.leagueId, requestId: request.requestId, staffUserId: interaction.user.id, staffAuthorized: isStaff(interaction), phase: repository.loadLeague(request.leagueId).league.currentPhase, changeMode: mode, ...fields });
        } catch (error) {
            const current = repository.loadPlayerUpgradeState(request.leagueId)?.requests.find(entry => entry.requestId === request.requestId);
            if (current?.status === "EXPIRED") await refreshLedger(current).catch(refreshError => console.error("Expired upgrade ledger refresh failed:", refreshError.message));
            throw error;
        }
        await refreshLedger(completed);
        return completed;
    }

    function buildOptions(leagueId, page) {
        const values = [...new Set(repository.loadPlayers(leagueId).map(player => String(player.archetype || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        return { values, pageCount: Math.max(1, Math.ceil(values.length / 25)), items: values.slice(page * 25, page * 25 + 25) };
    }

    function buildPicker(request, mode, page = 0) {
        const { values, pageCount, items } = buildOptions(request.leagueId, page);
        if (!values.length) throw new Error("No stored player builds are available for approval.");
        const controls = [row(new StringSelectMenuBuilder().setCustomId(`upgrades:buildselect:${request.requestId}:${mode}:${page}`).setPlaceholder("Choose stored build").addOptions(items.map(value => ({ label: value.slice(0, 100), value }))))];
        const navigation = [];
        if (page > 0) navigation.push(button(`upgrades:buildpage:${request.requestId}:${mode}:${page - 1}`, "Previous builds"));
        if (page + 1 < pageCount) navigation.push(button(`upgrades:buildpage:${request.requestId}:${mode}:${page + 1}`, "More builds"));
        if (navigation.length) controls.push(row(...navigation));
        return { embeds: [new EmbedBuilder().setColor(COLOR).setTitle("CHOOSE STORED BUILD").setDescription(`Current build: **${safe(request.playerSnapshot?.archetype)}**\nPage ${page + 1}/${pageCount}`)], components: controls };
    }

    function eligibleTeam(interaction) {
        const boundContext = bound(interaction);
        const status = service.getStatus({ leagueId: boundContext.context.league.leagueId, seasonId: boundContext.context.seasonId, teamId: boundContext.teamId, coachUserId: interaction.user.id, phase: boundContext.context.league.currentPhase, owners: repository.loadOwners(boundContext.context.league.leagueId) });
        return { ...boundContext, status };
    }

    function requestDraft(interaction) {
        const current = eligibleTeam(interaction), draftId = randomUUID();
        if (current.context.league.currentPhase !== PHASES.REGULAR_SEASON) throw new Error("Player upgrades can only be requested during the regular season.");
        const draft = { draftId, guildId: interaction.guildId, leagueId: current.context.league.leagueId, seasonId: current.context.seasonId, teamId: current.teamId, teamName: current.team.teamName, coachUserId: interaction.user.id, phase: current.context.league.currentPhase, qualifyingGames: current.status.qualifyingGames, specialUsed: current.status.special.status === "USED", gameEarnedAvailable: current.status.gameEarnedAvailable, newUserStatus: current.status.newUserStatus, availableAfter: current.status.gameEarnedAvailable };
        drafts.set(draftId, draft);
        return { draft, payload: sourcePayload(draft, current.status) };
    }

    async function beginRequest(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { payload } = requestDraft(interaction);
        await interaction.editReply(payload);
    }

    async function handleBuilder(interaction, parts) {
        const [, action, draftId, rawValue, extra] = parts;
        const { draft } = draftFor(draftId, interaction);
        if (action === "source") {
            const source = interaction.values?.[0];
            if (!new Set(["GAME_EARNED", "NEW_USER"]).has(source)) throw new Error("Choose one available upgrade source.");
            const current = eligibleTeam(interaction);
            if (source === "GAME_EARNED" && current.status.gameEarnedAvailable < 1) throw new Error("No game-earned upgrade is available.");
            if (source === "NEW_USER" && current.status.newUserStatus !== "AVAILABLE") throw new Error("No New User Upgrade is available.");
            draft.source = source;
            draft.gameEarnedAvailable = current.status.gameEarnedAvailable;
            draft.availableAfter = source === "GAME_EARNED" ? current.status.gameEarnedAvailable - 1 : current.status.gameEarnedAvailable;
            draft.step = "PLAYER";
            await interaction.update(playerPayload(draft, service.playerEligibility({ leagueId: draft.leagueId, seasonId: draft.seasonId, teamId: draft.teamId })));
            return;
        }
        if (action === "players") {
            const page = Number(rawValue) || 0;
            await interaction.update(playerPayload(draft, service.playerEligibility({ leagueId: draft.leagueId, seasonId: draft.seasonId, teamId: draft.teamId }), page));
            return;
        }
        if (action === "player") {
            const playerId = decodeURIComponent(rawValue || ""), player = service.playerEligibility({ leagueId: draft.leagueId, seasonId: draft.seasonId, teamId: draft.teamId }).find(entry => entry.playerId === playerId);
            if (!player || player.maxed) throw new Error("That player is no longer eligible.");
            draft.playerId = playerId; draft.player = player; draft.step = "CATEGORY";
            await interaction.update(categoryPayload(draft, player));
            return;
        }
        if (action === "category") {
            const category = decodeURIComponent(rawValue || "");
            if (!NORMAL_CATEGORIES[category] || draft.player.usedCategories.includes(category)) throw new Error("That normal category is unavailable for this player.");
            draft.type = "NORMAL"; draft.category = category; draft.allocations = []; draft.step = "ALLOCATE";
            await interaction.update(allocationPayload(draft));
            return;
        }
        if (action === "special") {
            const specialType = decodeURIComponent(rawValue || "");
            if (draft.source !== "GAME_EARNED" || draft.qualifyingGames < 4 || draft.specialUsed || !SPECIAL_UPGRADES[specialType]) throw new Error("That Special Upgrade is not available.");
            draft.type = "SPECIAL"; draft.specialType = specialType; draft.step = "REVIEW";
            await interaction.update(reviewPayload(draft));
            return;
        }
        if (action === "attribute") { draft.selectedAttribute = interaction.values?.[0]; await interaction.update(allocationPayload(draft)); return; }
        if (action === "points") { draft.selectedPoints = Number(interaction.values?.[0]); await interaction.update(allocationPayload(draft)); return; }
        if (action === "add") {
            const validation = validateNormalUpgrade(draft.category, [...draft.allocations, { attribute: draft.selectedAttribute, points: draft.selectedPoints }]);
            draft.allocations = validation.allocations; draft.selectedAttribute = null; draft.selectedPoints = null;
            await interaction.update(allocationPayload(draft));
            return;
        }
        if (action === "remove") { draft.allocations.pop(); await interaction.update(allocationPayload(draft)); return; }
        if (action === "review") {
            const validation = validateNormalUpgrade(draft.category, draft.allocations);
            draft.allocations = validation.allocations; draft.step = "REVIEW";
            await interaction.update(reviewPayload(draft));
            return;
        }
        if (action === "categories") { draft.step = "CATEGORY"; await interaction.update(categoryPayload(draft, draft.player)); return; }
        if (action === "back") { draft.step = draft.type === "NORMAL" ? "ALLOCATE" : "CATEGORY"; await interaction.update(draft.type === "NORMAL" ? allocationPayload(draft) : categoryPayload(draft, draft.player)); return; }
        if (action === "submit") {
            const request = service.createRequest({ leagueId: draft.leagueId, seasonId: draft.seasonId, teamId: draft.teamId, coachUserId: draft.coachUserId, source: draft.source, type: draft.type, playerId: draft.playerId, category: draft.category, allocations: draft.allocations, specialType: draft.specialType, phase: repository.loadLeague(draft.leagueId, draft.seasonId).league.currentPhase, owners: repository.loadOwners(draft.leagueId) });
            try { await publishRequest(interaction.guild, request); }
            catch (error) { service.expireRequestById({ leagueId: request.leagueId, requestId: request.requestId, reason: "LEDGER_DELIVERY_FAILED" }); throw error; }
            drafts.delete(draftId);
            await interaction.update({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle("UPGRADE REQUEST SUBMITTED").setDescription("Your request is in the Player Upgrades ledger and is waiting for Staff review.")], components: [] });
            return;
        }
        throw new Error("Unknown player-upgrade action.");
    }

    async function eligibility(interaction, page = 0) {
        const current = eligibleTeam(interaction), roster = service.playerEligibility({ leagueId: current.context.league.leagueId, seasonId: current.context.seasonId, teamId: current.teamId });
        const pageSize = 15, items = roster.slice(page * pageSize, (page + 1) * pageSize);
        const description = items.map(player => `**${safe(player.name)}** · ${player.maxed ? "2/2 MAXED" : `${player.completedUpgradeCount}/2`}${player.usedCategories.length ? ` · Used: ${player.usedCategories.join(", ")}` : ""}${player.usedSpecials.length ? ` · Special: ${player.usedSpecials.join(", ")}` : ""}`).join("\n") || "No current roster players.";
        const navigation = [];
        if (page > 0) navigation.push(button(`upgrades:eligibility:${page - 1}`, "Previous players"));
        if ((page + 1) * pageSize < roster.length) navigation.push(button(`upgrades:eligibility:${page + 1}`, "More players"));
        const payload = { embeds: [new EmbedBuilder().setColor(COLOR).setTitle(`PLAYER ELIGIBILITY · ${current.team.teamName}`).setDescription(description)], components: navigation.length ? [row(...navigation)] : [] };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else if (interaction.isButton?.()) await interaction.update(payload);
        else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }

    async function historyView(interaction, page = 0) {
        const current = eligibleTeam(interaction), entries = service.history({ leagueId: current.context.league.leagueId, seasonId: current.context.seasonId, teamId: current.teamId, coachUserId: interaction.user.id }).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
        const pageSize = 8, items = entries.slice(page * pageSize, (page + 1) * pageSize);
        const description = items.map(entry => `**${safe(repository.loadPlayers(current.context.league.leagueId).find(player => player.playerId === entry.playerId)?.name || entry.playerId)}** · ${entry.type === "NORMAL" ? entry.category : entry.specialType} · ${entry.status.replaceAll("_", " ")} · ${entry.source.replaceAll("_", " ")} · ${new Date(entry.completedAt || entry.submittedAt).toLocaleDateString()}${entry.after ? ` · OVR ${entry.before.overall ?? "—"}→${entry.after.overall ?? "—"} · Build ${safe(entry.before.archetype)}→${safe(entry.after.archetype)}` : ""}`).join("\n") || "No upgrade history for this team and coach this season.";
        const navigation = [];
        if (page > 0) navigation.push(button(`upgrades:history:${page - 1}`, "Previous"));
        if ((page + 1) * pageSize < entries.length) navigation.push(button(`upgrades:history:${page + 1}`, "More"));
        const payload = { embeds: [new EmbedBuilder().setColor(COLOR).setTitle(`MY UPGRADE HISTORY · ${current.team.teamName}`).setDescription(description)], components: navigation.length ? [row(...navigation)] : [] };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else if (interaction.isButton?.()) await interaction.update(payload);
        else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }

    async function reviewButton(interaction, requestId, action) {
        if (!isStaff(interaction)) throw new Error("Only members with a configured Staff role can review upgrade requests.");
        const context = repository.loadLeagueContext({ guildId: interaction.guildId }), state = repository.loadPlayerUpgradeState(context.league.leagueId);
        const request = state?.requests.find(entry => entry.requestId === requestId);
        if (!request || request.status !== "PENDING_STAFF") throw new Error("This upgrade request is no longer pending.");
        if (action === "reject") {
            const rejected = service.rejectRequest({ leagueId: request.leagueId, requestId, staffUserId: interaction.user.id, staffAuthorized: true });
            await interaction.update({ ...ledgerPayload(rejected, repository.loadPlayers(request.leagueId).find(player => player.playerId === rejected.playerId), repository.loadLeague(request.leagueId, request.seasonId).teams.find(team => team.teamId === rejected.teamId)), content: "" });
            return;
        }
        await interaction.reply({ ...approvalPayload(request), flags: MessageFlags.Ephemeral });
    }

    async function approvalMode(interaction, requestId, mode) {
        if (!isStaff(interaction)) throw new Error("Only members with a configured Staff role can approve upgrade requests.");
        const state = repository.loadPlayerUpgradeState(repository.loadLeagueContext({ guildId: interaction.guildId }).league.leagueId), request = state?.requests.find(entry => entry.requestId === requestId);
        if (!request || request.status !== "PENDING_STAFF") throw new Error("This upgrade request is no longer pending.");
        if (mode === "NO_CHANGE" || mode === "BUILD_CHANGED") {
            if (mode === "NO_CHANGE") {
                await complete(interaction, request, mode);
                await interaction.reply({ content: "Upgrade completed and the ledger entry updated.", flags: MessageFlags.Ephemeral });
            } else await interaction.reply({ ...buildPicker(request, mode), flags: MessageFlags.Ephemeral });
            return;
        }
        if (!["OVR_CHANGED", "BOTH_CHANGED"].includes(mode)) throw new Error("Unknown approval mode.");
        const player = repository.loadPlayers(request.leagueId).find(entry => entry.playerId === request.playerId);
        const modal = new ModalBuilder().setCustomId(`upgrades:ovrmodal:${requestId}:${mode}`).setTitle("UPDATE PLAYER OVR");
        modal.addComponents(row(new TextInputBuilder().setCustomId("overall").setLabel("New OVR").setPlaceholder(`Current OVR: ${player?.overall ?? "—"}`).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2)));
        await interaction.showModal(modal);
    }

    async function handle(interaction) {
        try {
            const parts = interaction.customId.split(":"), action = parts[1];
            if (action === "request") { await beginRequest(interaction); return; }
            if (action === "eligibility") { await eligibility(interaction, Number(parts[2]) || 0); return; }
            if (action === "history") { await historyView(interaction, Number(parts[2]) || 0); return; }
            if (["source", "players", "player", "category", "special", "attribute", "points", "add", "remove", "review", "categories", "back", "submit"].includes(action)) { await handleBuilder(interaction, parts); return; }
            if (action === "approve" || action === "reject") { await reviewButton(interaction, parts[2], action); return; }
            if (action === "mode") { await approvalMode(interaction, parts[2], parts[3]); return; }
            if (action === "buildpage") {
                if (!isStaff(interaction)) throw new Error("Only configured league Staff can approve upgrades.");
                const request = repository.loadPlayerUpgradeState(repository.loadLeagueContext({ guildId: interaction.guildId }).league.leagueId).requests.find(entry => entry.requestId === parts[2]);
                if (!request || request.status !== "PENDING_STAFF") throw new Error("This upgrade request is no longer pending.");
                await interaction.update(buildPicker(request, parts[3], Number(parts[4]) || 0));
                return;
            }
            if (action === "buildselect") {
                if (!isStaff(interaction)) throw new Error("Only configured league Staff can approve upgrades.");
                const context = repository.loadLeagueContext({ guildId: interaction.guildId }), request = repository.loadPlayerUpgradeState(context.league.leagueId).requests.find(entry => entry.requestId === parts[2]);
                if (!request || request.status !== "PENDING_STAFF") throw new Error("This upgrade request is no longer pending.");
                const mode = parts[3], newBuild = interaction.values?.[0], requestId = parts[2], pendingApproval = approvals.get(`${requestId}:${interaction.user.id}`) || {};
                const completed = await complete(interaction, request, mode, { newBuild, ...(pendingApproval.newOverall == null ? {} : { newOverall: pendingApproval.newOverall }) });
                approvals.delete(`${requestId}:${interaction.user.id}`);
                await interaction.update({ content: "Upgrade completed and the ledger entry updated.", embeds: [], components: [] });
                return completed;
            }
            throw new Error("Unknown player-upgrade control.");
        } catch (error) {
            const payload = { content: error.message, embeds: [], components: [] };
            if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => { });
            else if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => { });
        }
    }

    async function handleModal(interaction) {
        const [, action, requestId, mode] = interaction.customId.split(":");
        if (action !== "ovrmodal" || !isStaff(interaction)) { await interaction.reply({ content: "Only configured league Staff can approve upgrades.", flags: MessageFlags.Ephemeral }); return; }
        try {
            const context = repository.loadLeagueContext({ guildId: interaction.guildId }), request = repository.loadPlayerUpgradeState(context.league.leagueId).requests.find(entry => entry.requestId === requestId);
            if (!request || request.status !== "PENDING_STAFF") throw new Error("This upgrade request is no longer pending.");
            const newOverall = Number(interaction.fields.getTextInputValue("overall"));
            if (mode === "OVR_CHANGED") {
                await complete(interaction, request, mode, { newOverall });
                await interaction.reply({ content: "Upgrade completed and the ledger entry updated.", flags: MessageFlags.Ephemeral });
            } else {
                approvals.set(`${requestId}:${interaction.user.id}`, { newOverall });
                await interaction.reply({ ...buildPicker(request, mode), flags: MessageFlags.Ephemeral });
            }
        } catch (error) { await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral }); }
    }

    async function restore(readyClient) {
        client = readyClient;
        for (const guild of readyClient.guilds.cache.values()) {
            try {
                const context = repository.loadLeagueContext({ guildId: guild.id });
                const before = repository.loadPlayerUpgradeState(context.league.leagueId);
                service.handlePhase({ leagueId: context.league.leagueId, seasonId: context.seasonId, phase: context.league.currentPhase, owners: repository.loadOwners(context.league.leagueId) });
                service.reconcilePendingRequests({ leagueId: context.league.leagueId });
                const state = repository.loadPlayerUpgradeState(context.league.leagueId);
                await refreshExpired(before, state);
                for (const request of state?.requests || []) {
                    if (request.status !== "PENDING_STAFF" || request.discordMessageId) continue;
                    try { await publishRequest(guild, request); }
                    catch (error) { console.error("Pending player upgrade ledger recovery failed:", error.message); }
                }
                service.reconcileFinalizedGames({ leagueId: context.league.leagueId, seasonId: context.seasonId });
            } catch (error) { if (!/No FantasyHQ league is configured/.test(error.message)) console.error("Player upgrade recovery:", error.message); }
        }
    }

    async function notifyCoach(notice) {
        if (!client) return;
        const user = await client.users.fetch(notice.coachUserId);
        const context = repository.loadLeague(notice.leagueId, notice.seasonId), team = context.teams.find(entry => entry.teamId === notice.teamId);
        const status = service.getStatus({ leagueId: notice.leagueId, seasonId: notice.seasonId, teamId: notice.teamId, coachUserId: notice.coachUserId, phase: context.league.currentPhase, owners: repository.loadOwners(notice.leagueId) });
        const channelId = repository.loadSettings(notice.leagueId)?.discordChannels?.playerUpgrades;
        await user.send({
            embeds: [new EmbedBuilder().setColor(COLOR).setTitle("PLAYER UPGRADE EARNED")
                .setDescription(`**${team?.teamName || notice.teamId}**\n\n${notice.kind === "NEW_USER" ? "New User Upgrade: **Available**" : `You completed your ${status.qualifyingGames}th qualifying game.`}\nGame-Earned Upgrades Available: **${status.gameEarnedAvailable}**\nNew User Upgrade: **${status.newUserStatus.replaceAll("_", " ")}**\nSpecial: **${status.special.status.replaceAll("_", " ")}**\n\n${channelId ? `Visit <#${channelId}> when you're ready.` : "Use /upgrades to view your status."}`)]
        });
    }

    return { command, ensurePin, handle, handleModal, invalidatePlayerRequests, notifyCoach, restore, syncOwnerChange };
}

module.exports = { createDiscordPlayerUpgrades };