const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
    MessageFlags, StringSelectMenuBuilder,
} = require("discord.js");
const { canManageLeague } = require("./discord-permissions");
const { PICK_PROTECTIONS } = require("./asset-valuation");
const { createFantasyHQRepository } = require("./repository");
const { createTradeService } = require("./trade-service");
const { downloadDiscordImage, imageType } = require("./game-submissions");
const { teamEmoji } = require("../shared/team-emojis");

const PROOF_IMAGE_LIMIT = 25 * 1024 * 1024;

function createDiscordTradeWorkflow(options = {}) {
    const repository = options.repository || createFantasyHQRepository();
    const tradeService = options.tradeService || createTradeService({ repository });
    const logger = options.logger || console;
    const live = new Map();
    const notificationLocks = new Map();

    function serializeDiscordAction(key, work) {
        const previous = notificationLocks.get(key) || Promise.resolve();
        const pending = previous.catch(() => { }).then(work);
        notificationLocks.set(key, pending);
        return pending.finally(() => { if (notificationLocks.get(key) === pending) notificationLocks.delete(key); });
    }

    function league(guildId, leagueId = null) {
        return guildId ? repository.loadLeagueContext({ guildId }) : repository.loadLeague(leagueId);
    }
    function settingsFor(leagueId) { return repository.loadSettings(leagueId) || {}; }
    function teamName(context, teamId) { return context.teams.find(team => team.teamId === teamId)?.teamName || teamId; }
    function roleByName(guild, name) { return guild.roles.cache.find(role => !role.managed && role.name.toLowerCase() === name.toLowerCase()) || null; }
    function memberRoleIds(interaction) { return interaction.member?.roles?.cache || new Map(); }
    function canBuild(interaction, settings) {
        const roles = memberRoleIds(interaction);
        const coach = roleByName(interaction.guild, "LEAGUEbuddy Coach");
        const gm = roleByName(interaction.guild, "LEAGUEbuddy GM");
        return Boolean((coach && roles.has(coach.id)) || (gm && roles.has(gm.id)) || (settings.testMode && canManageLeague(interaction)));
    }
    function memberTeamIds(interaction, context) {
        const ownership = repository.loadRoleOwnership(context.league.leagueId);
        const roles = memberRoleIds(interaction);
        return context.teams.filter(team => ownership.roleIds?.[team.teamId] && roles.has(ownership.roleIds[team.teamId])).map(team => team.teamId);
    }
    function currentTradeContext(interaction, tradeId) {
        if (interaction.guildId) {
            const context = repository.loadLeagueContext({ guildId: interaction.guildId });
            const trade = tradeService.getTrade(context.league.leagueId, tradeId);
            if (!trade) throw new Error("This trade draft is no longer available.");
            return { context, trade };
        }
        const root = path.join(repository.dataRoot, "leagues");
        const leagueIds = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name) : [];
        for (const leagueId of leagueIds) {
            const trade = tradeService.getTrade(leagueId, tradeId);
            if (trade) return { context: repository.loadLeague(leagueId, trade.seasonId), trade };
        }
        throw new Error("This trade draft is no longer available.");
    }
    function ephemeral(interaction, payload) { return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }); }
    function edit(interaction, payload) { return interaction.update(payload); }
    function backRow(tradeId) {
        return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`trade:back:${tradeId}`).setLabel("Back to Trade").setStyle(ButtonStyle.Secondary));
    }
    function teamOptions(context, exclude = []) {
        return context.teams.filter(team => !exclude.includes(team.teamId)).map(team => ({ label: team.teamName.slice(0, 100), description: `${team.abbreviation} · ${team.conference}`.slice(0, 100), value: team.teamId }));
    }
    function teamPicker(context, page, mode, initiatorId = "") {
        const options = teamOptions(context, mode === "other" ? [initiatorId] : []);
        const pageSize = 15, pages = Math.max(1, Math.ceil(options.length / pageSize));
        const visible = options.slice(page * pageSize, (page + 1) * pageSize);
        const id = mode === "initial" ? `trade:select-initial:${page}` : `trade:select-other:${initiatorId}:${page}`;
        const rows = [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(mode === "initial" ? "Choose your team" : "Choose the other team").addOptions(visible))];
        const navigation = new ActionRowBuilder();
        if (page > 0) navigation.addComponents(new ButtonBuilder().setCustomId(`trade:teams:${mode}:${initiatorId}:${page - 1}`).setLabel("Previous teams").setStyle(ButtonStyle.Secondary));
        if (page + 1 < pages) navigation.addComponents(new ButtonBuilder().setCustomId(`trade:teams:${mode}:${initiatorId}:${page + 1}`).setLabel("More teams").setStyle(ButtonStyle.Secondary));
        navigation.addComponents(new ButtonBuilder().setCustomId("trade:close").setLabel("Back").setStyle(ButtonStyle.Secondary));
        rows.push(navigation);
        return { content: `${mode === "initial" ? "Choose the team you are building for." : `Choose a team to trade with ${teamName(context, initiatorId)}.`} · Page ${page + 1}/${pages}`, components: rows };
    }

    function transferName(transfer, liveSnapshot, context) {
        if (transfer.assetType === "PLAYER") {
            const player = liveSnapshot.players.find(candidate => candidate.playerId === transfer.assetId);
            return `${player?.name || transfer.playerName || transfer.assetId} · Age ${player?.age ?? "—"} · TV ${Number(player?.tradeValue || transfer.snapshotTradeValue || 0).toLocaleString("en-US")}`;
        }
        const pick = liveSnapshot.picks.find(candidate => candidate.pickId === transfer.assetId);
        const owner = context.teams.find(team => team.teamId === (pick?.originalTeamId || transfer.originalTeamId));
        return `${transfer.draftYear || pick?.draftYear} ${owner?.abbreviation || transfer.originalTeamId || pick?.originalTeamId} ${transfer.round === 1 || pick?.round === 1 ? "1st" : "2nd"} · ${PICK_PROTECTIONS[transfer.protection || pick?.protection || "UNPROTECTED"]?.label || "Unprotected"} · TV ${Number(pick?.tradeValue || transfer.snapshotTradeValue || 0).toLocaleString("en-US")}`;
    }

    function builderPayload(trade) {
        const context = repository.loadLeague(trade.leagueId, trade.seasonId);
        const preview = tradeService.previewDraft(trade.leagueId, trade.tradeId);
        const liveSnapshot = tradeService.getLiveSnapshot(trade.leagueId, trade.seasonId);
        const embed = new EmbedBuilder().setColor(0xffdc21).setTitle("Build a Trade")
            .setDescription("Choose assets and where they go. Values update live; every team must finish at 15 players and within 50 points.");
        for (const team of preview.teams) {
            const outgoing = preview.transfers.filter(transfer => transfer.fromTeamId === team.teamId).map(transfer => `• ${transferName(transfer, liveSnapshot, context)} → ${teamName(context, transfer.toTeamId)}`);
            const incoming = preview.transfers.filter(transfer => transfer.toTeamId === team.teamId).map(transfer => `• ${transferName(transfer, liveSnapshot, context)} ← ${teamName(context, transfer.fromTeamId)}`);
            const content = [
                `Sends **${team.sent.toLocaleString("en-US")}** · Receives **${team.received.toLocaleString("en-US")}** · Difference **${team.difference > 0 ? "+" : ""}${team.difference}** ${Math.abs(team.difference) <= 50 ? "✅" : "❌"}`,
                `Roster **${team.rosterCount} → ${team.projectedRosterCount}/15** ${team.projectedRosterCount === 15 ? "✅" : "❌"} · Trades **${team.tradeCount}/5** ${team.tradeCount < 5 ? "✅" : "🔒"}`,
                ...(outgoing.length ? ["**Sends**", ...outgoing.slice(0, 8)] : []),
                ...(incoming.length ? ["**Receives**", ...incoming.slice(0, 8)] : []),
            ].join("\n");
            embed.addFields({ name: team.teamName, value: content.slice(0, 1024) });
        }
        if (preview.errors.length) embed.addFields({ name: "What needs fixing", value: preview.errors.slice(0, 8).map(error => `• ${error}`).join("\n").slice(0, 1024) });
        else embed.addFields({ name: "Ready to submit", value: "All trade checks pass. Submitting freezes asset values and starts the 24-hour coach response window." });
        const firstRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`trade:add:PLAYER:${trade.tradeId}`).setLabel("Add Player").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`trade:add:PICK:${trade.tradeId}`).setLabel("Add Pick").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`trade:remove:${trade.tradeId}:0`).setLabel("Remove Asset").setStyle(ButtonStyle.Secondary).setDisabled(!trade.transfers.length),
            new ButtonBuilder().setCustomId(`trade:protection:${trade.tradeId}`).setLabel("Edit Protection").setStyle(ButtonStyle.Secondary).setDisabled(!trade.transfers.some(item => item.assetType === "PICK")),
            new ButtonBuilder().setCustomId(`trade:team:${trade.tradeId}`).setLabel(trade.participatingTeams.length === 2 ? "Add Third Team" : "Remove Third Team").setStyle(ButtonStyle.Secondary),
        );
        const secondRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`trade:package:${trade.tradeId}:0:0`).setLabel("Review Packages").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`trade:submit:${trade.tradeId}`).setLabel("Submit Proposal").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`trade:back:${trade.tradeId}`).setLabel("Refresh Review").setStyle(ButtonStyle.Secondary),
        );
        return { embeds: [embed], components: [firstRow, secondRow], allowedMentions: { parse: [] } };
    }

    function reviewPackagePayload(trade, teamIndex = 0, page = 0) {
        const context = repository.loadLeague(trade.leagueId, trade.seasonId);
        const liveSnapshot = tradeService.getLiveSnapshot(trade.leagueId, trade.seasonId);
        const preview = tradeService.previewDraft(trade.leagueId, trade.tradeId);
        const teamId = trade.participatingTeams[teamIndex] || trade.participatingTeams[0];
        const summary = preview.teams.find(team => team.teamId === teamId);
        const assets = trade.transfers.filter(transfer => transfer.fromTeamId === teamId || transfer.toTeamId === teamId);
        const pageSize = 8, pages = Math.max(1, Math.ceil(assets.length / pageSize));
        const lines = assets.slice(page * pageSize, (page + 1) * pageSize).map(transfer => {
            const direction = transfer.fromTeamId === teamId ? `Sends to ${teamName(context, transfer.toTeamId)}` : `Receives from ${teamName(context, transfer.fromTeamId)}`;
            return `• ${direction}: ${transferName(transfer, liveSnapshot, context)}`;
        });
        const embed = new EmbedBuilder().setColor(0xffdc21).setTitle(`${teamName(context, teamId)} Package`)
            .setDescription(`Sends **${summary.sent.toLocaleString("en-US")}** · Receives **${summary.received.toLocaleString("en-US")}** · Difference **${summary.difference > 0 ? "+" : ""}${summary.difference}**\nRoster **${summary.rosterCount} → ${summary.projectedRosterCount}/15** · Trades **${summary.tradeCount}/5**\n\n${lines.join("\n") || "No assets assigned."}`);
        const teamNavigation = new ActionRowBuilder();
        if (teamIndex > 0) teamNavigation.addComponents(new ButtonBuilder().setCustomId(`trade:package:${trade.tradeId}:${teamIndex - 1}:0`).setLabel("Previous Team").setStyle(ButtonStyle.Secondary));
        if (teamIndex + 1 < trade.participatingTeams.length) teamNavigation.addComponents(new ButtonBuilder().setCustomId(`trade:package:${trade.tradeId}:${teamIndex + 1}:0`).setLabel("Next Team").setStyle(ButtonStyle.Secondary));
        teamNavigation.addComponents(new ButtonBuilder().setCustomId(`trade:back:${trade.tradeId}`).setLabel("Back to Trade").setStyle(ButtonStyle.Secondary));
        const rows = [teamNavigation];
        if (pages > 1) {
            const assetNavigation = new ActionRowBuilder();
            if (page > 0) assetNavigation.addComponents(new ButtonBuilder().setCustomId(`trade:package:${trade.tradeId}:${teamIndex}:${page - 1}`).setLabel("Previous Assets").setStyle(ButtonStyle.Secondary));
            if (page + 1 < pages) assetNavigation.addComponents(new ButtonBuilder().setCustomId(`trade:package:${trade.tradeId}:${teamIndex}:${page + 1}`).setLabel("More Assets").setStyle(ButtonStyle.Secondary));
            rows.push(assetNavigation);
        }
        return { embeds: [embed], components: rows };
    }

    async function ensurePin(channel, savedId, embed, components = []) {
        const pinned = await require('../shared/discord-pins').fetchPinnedMessages(channel);
        const matching = pinned.filter(message => message.embeds.some(item => item.title === embed.data.title));
        let message = savedId ? await channel.messages.fetch(savedId).catch(() => null) : null;
        if (!message) message = matching.shift() || null;
        if (!message) {
            message = await channel.send({ embeds: [embed], components, allowedMentions: { parse: [] } });
            await message.pin("LEAGUEbuddy trade setup");
        } else {
            await message.edit({ embeds: [embed], components, allowedMentions: { parse: [] } });
            if (!message.pinned) await message.pin("LEAGUEbuddy trade setup repair");
        }
        for (const duplicate of matching.filter(item => item.id !== message.id)) await duplicate.unpin("Remove duplicate LEAGUEbuddy trade pin").catch(() => { });
        return message;
    }

    function tradeCountEmbed(leagueId, seasonId) {
        const context = repository.loadLeague(leagueId, seasonId);
        const owners = new Map(repository.loadOwners(leagueId).map(owner => [owner.teamId, owner]));
        const counts = tradeService.tradeCounts(leagueId, context.seasonId);
        const embed = new EmbedBuilder().setColor(0xffdc21).setTitle("Regular-Season Trade Counts")
            .setDescription(`Season ${context.league.seasonNumber} · Up to five completed trades per team · New proposals close after Week 9`);
        for (const conference of ["East", "West"]) {
            const lines = context.teams.filter(team => team.conference === conference).sort((a, b) => a.teamName.localeCompare(b.teamName)).map(team => {
                const count = counts.get(team.teamId) || 0;
                const emoji = teamEmoji(team.teamName);
                const coach = owners.get(team.teamId)?.userId ? `<@${owners.get(team.teamId).userId}>` : "Unassigned";
                return `${emoji ? `${emoji} ` : ""}**${team.teamName}** — ${coach} — ${count}/5${count >= 5 ? " 🔒" : ""}`;
            });
            embed.addFields({ name: conference === "East" ? "🏀 Eastern Conference" : "🏀 Western Conference", value: lines.join("\n").slice(0, 1024) || "No teams" });
        }
        return embed;
    }

    async function ensurePins(guild, leagueId = null) {
        const context = league(guild.id, leagueId), settings = settingsFor(context.league.leagueId), ids = settings.discordChannels || {};
        const submit = ids.submitTrade ? await guild.channels.fetch(ids.submitTrade).catch(() => null) : null;
        const counts = ids.tradeCounts ? await guild.channels.fetch(ids.tradeCounts).catch(() => null) : null;
        if (!submit || !counts) throw new Error("Submit Trade and Trade Counts channels must be configured before pin repair.");
        const pins = { ...(settings.discordPins || {}) };
        const builder = await ensurePin(submit, pins.tradeBuilderMessageId, new EmbedBuilder().setColor(0xffdc21).setTitle("Submit a Trade")
            .setDescription("Build the complete offer for two or three teams. Player and pick values update automatically. Every team must remain at 15 players and within 50 value points."),
            [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("trade:build").setLabel("Build a Trade").setStyle(ButtonStyle.Success))]);
        const counter = await ensurePin(counts, pins.tradeCountsMessageId, tradeCountEmbed(context.league.leagueId, context.seasonId));
        pins.tradeBuilderMessageId = builder.id; pins.tradeCountsMessageId = counter.id;
        repository.saveSettings(context.league.leagueId, { ...settings, discordPins: pins });
        return pins;
    }

    async function refreshTradeCounts(guild) {
        const context = repository.loadLeagueContext({ guildId: guild.id });
        const settings = settingsFor(context.league.leagueId), channelId = settings.discordChannels?.tradeCounts;
        if (!channelId) return false;
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) return false;
        const pins = settings.discordPins || {};
        const message = await ensurePin(channel, pins.tradeCountsMessageId, tradeCountEmbed(context.league.leagueId, context.seasonId));
        if (message.id !== pins.tradeCountsMessageId) repository.saveSettings(context.league.leagueId, { ...settings, discordPins: { ...pins, tradeCountsMessageId: message.id } });
        return true;
    }

    function privateTeamId(interaction, context, settings, explicit = null) {
        if (explicit) return explicit;
        const owned = memberTeamIds(interaction, context);
        if (owned.length === 1) return owned[0];
        if (settings.testMode && canManageLeague(interaction)) return null;
        throw new Error(owned.length ? "Your account has multiple team roles. Ask staff to resolve the team-role conflict." : "Your team role is not linked. Ask staff to run /league roles and repair channel setup.");
    }

    async function startBuilder(interaction) {
        const context = repository.loadLeagueContext({ guildId: interaction.guildId });
        const settings = settingsFor(context.league.leagueId);
        if (!canBuild(interaction, settings)) throw new Error("The Build a Trade button is for league Coaches and GMs.");
        const initiatorId = privateTeamId(interaction, context, settings);
        const payload = initiatorId ? teamPicker(context, 0, "other", initiatorId) : teamPicker(context, 0, "initial");
        await ephemeral(interaction, payload);
    }

    function sourcePayload(trade, kind) {
        const context = repository.loadLeague(trade.leagueId, trade.seasonId);
        const options = trade.participatingTeams.map(teamId => new ButtonBuilder()
            .setCustomId(`trade:source:${kind}:${trade.tradeId}:${teamId}`)
            .setLabel(teamName(context, teamId).slice(0, 80)).setStyle(ButtonStyle.Primary));
        return { content: `Choose the team sending a ${kind === "PLAYER" ? "player" : "draft pick"}.`, components: [new ActionRowBuilder().addComponents(...options), backRow(trade.tradeId)] };
    }

    function assetMenuPayload(trade, kind, teamId, page = 0) {
        const snapshot = tradeService.getLiveSnapshot(trade.leagueId, trade.seasonId);
        const transfers = trade.transfers || [];
        const values = kind === "PLAYER"
            ? snapshot.players.filter(player => player.teamId === teamId && !transfers.some(item => item.assetType === "PLAYER" && item.assetId === player.playerId))
                .map(player => ({ label: `${player.name} · ${player.overall ?? "—"} OVR`.slice(0, 100), description: `Age ${player.age ?? "—"} · Trade Value ${Number(player.tradeValue || 1).toLocaleString("en-US")}`.slice(0, 100), value: encodeURIComponent(player.playerId) }))
            : snapshot.picks.filter(pick => pick.currentOwnerTeamId === teamId && !transfers.some(item => item.assetType === "PICK" && item.assetId === pick.pickId))
                .map(pick => ({ label: `${pick.draftYear} ${teamName(repository.loadLeague(trade.leagueId, trade.seasonId), pick.originalTeamId)} ${pick.round === 1 ? "1st" : "2nd"}`.slice(0, 100), description: `${PICK_PROTECTIONS[pick.protection]?.label || "Unprotected"} · Trade Value ${Number(pick.tradeValue).toLocaleString("en-US")}`.slice(0, 100), value: encodeURIComponent(pick.pickId) }));
        const typeName = kind === "PLAYER" ? "player" : "pick";
        if (!values.length) return { content: `No eligible ${typeName}s are available for ${teamName(repository.loadLeague(trade.leagueId, trade.seasonId), teamId)}.`, components: [backRow(trade.tradeId)] };
        const pages = Math.max(1, Math.ceil(values.length / 25));
        const rows = [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`trade:asset:${kind}:${trade.tradeId}:${teamId}`).setPlaceholder(`Choose a ${typeName}`).addOptions(values.slice(page * 25, (page + 1) * 25)))];
        if (pages > 1) {
            const navigation = new ActionRowBuilder();
            if (page > 0) navigation.addComponents(new ButtonBuilder().setCustomId(`trade:asset-page:${kind}:${trade.tradeId}:${teamId}:${page - 1}`).setLabel(`Previous ${typeName}s`).setStyle(ButtonStyle.Secondary));
            if (page + 1 < pages) navigation.addComponents(new ButtonBuilder().setCustomId(`trade:asset-page:${kind}:${trade.tradeId}:${teamId}:${page + 1}`).setLabel(`More ${typeName}s`).setStyle(ButtonStyle.Secondary));
            navigation.addComponents(new ButtonBuilder().setCustomId(`trade:back:${trade.tradeId}`).setLabel("Back to Trade").setStyle(ButtonStyle.Secondary));
            rows.push(navigation);
        } else rows.push(backRow(trade.tradeId));
        return { content: `Choose one ${typeName} from ${teamName(repository.loadLeague(trade.leagueId, trade.seasonId), teamId)}${pages > 1 ? ` · Page ${page + 1}/${pages}` : ""}.`, components: rows };
    }

    function destinationPayload(trade, kind, fromTeamId, assetId) {
        const context = repository.loadLeague(trade.leagueId, trade.seasonId);
        const pick = kind === "PICK" ? tradeService.getLiveSnapshot(trade.leagueId, trade.seasonId).picks.find(item => item.pickId === assetId) : null;
        const editable = pick?.round === 1 && pick.currentOwnerTeamId === pick.originalTeamId && (pick.ownershipHistory || []).length <= 1;
        const protections = editable ? Object.keys(PICK_PROTECTIONS) : [pick?.protection || "UNPROTECTED"];
        const choices = trade.participatingTeams.filter(teamId => teamId !== fromTeamId).flatMap(teamId => protections.map(protection => ({
            label: `${teamName(context, teamId)}${kind === "PICK" && editable ? ` · ${PICK_PROTECTIONS[protection].label}` : ""}`.slice(0, 100),
            value: `${teamId}|${protection}`,
        })));
        return {
            content: kind === "PICK" && editable ? "Choose where the pick goes and set its protection. Protection attaches to the pick when traded." : `Choose who receives this ${kind === "PLAYER" ? "player" : "pick"}.`, components: [
                new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`trade:destination:${trade.tradeId}:${kind}:${fromTeamId}:${encodeURIComponent(assetId)}`).setPlaceholder("Choose recipient").addOptions(choices.slice(0, 25))),
                backRow(trade.tradeId),
            ]
        };
    }

    function removePayload(trade, page = 0) {
        const transfers = trade.transfers || [], pageSize = 25, pages = Math.max(1, Math.ceil(transfers.length / pageSize));
        const context = repository.loadLeague(trade.leagueId, trade.seasonId);
        const snapshot = tradeService.getLiveSnapshot(trade.leagueId, trade.seasonId);
        const visible = transfers.slice(page * pageSize, (page + 1) * pageSize).map(transfer => ({
            label: `${transfer.assetType === "PLAYER" ? "Player" : "Pick"}: ${transferName(transfer, snapshot, context)}`.slice(0, 100),
            value: `${transfer.assetType}|${encodeURIComponent(transfer.assetId)}`,
        }));
        if (!visible.length) return { content: "There are no assets to remove.", components: [backRow(trade.tradeId)] };
        const rows = [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`trade:remove-select:${trade.tradeId}:${page}`).setPlaceholder("Choose an asset to remove").addOptions(visible))];
        const navigation = new ActionRowBuilder();
        if (page > 0) navigation.addComponents(new ButtonBuilder().setCustomId(`trade:remove:${trade.tradeId}:${page - 1}`).setLabel("Previous assets").setStyle(ButtonStyle.Secondary));
        if (page + 1 < pages) navigation.addComponents(new ButtonBuilder().setCustomId(`trade:remove:${trade.tradeId}:${page + 1}`).setLabel("More assets").setStyle(ButtonStyle.Secondary));
        navigation.addComponents(new ButtonBuilder().setCustomId(`trade:back:${trade.tradeId}`).setLabel("Back to Trade").setStyle(ButtonStyle.Secondary));
        rows.push(navigation);
        return { content: `Choose an asset to remove · Page ${page + 1}/${pages}`, components: rows };
    }

    function protectionPayload(trade, page = 0) {
        const context = repository.loadLeague(trade.leagueId, trade.seasonId);
        const livePicks = new Map(tradeService.getLiveSnapshot(trade.leagueId, trade.seasonId).picks.map(pick => [pick.pickId, pick]));
        const choices = trade.transfers.filter(transfer => transfer.assetType === "PICK").map(transfer => ({ transfer, pick: livePicks.get(transfer.assetId) }))
            .filter(({ transfer, pick }) => pick?.round === 1 && pick.currentOwnerTeamId === pick.originalTeamId && (pick.ownershipHistory || []).length <= 1)
            .map(({ transfer, pick }) => ({ label: `${pick.draftYear} ${teamName(context, pick.originalTeamId)} 1st · ${PICK_PROTECTIONS[transfer.protection || pick.protection]?.label || "Unprotected"}`.slice(0, 100), value: encodeURIComponent(pick.pickId) }));
        if (!choices.length) return { content: "Protection is only editable on an original first-round pick before its first trade. Remove and re-add an eligible pick to select protection.", components: [backRow(trade.tradeId)] };
        const pages = Math.max(1, Math.ceil(choices.length / 25));
        const rows = [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`trade:protection-pick:${trade.tradeId}`).setPlaceholder("Choose a pick").addOptions(choices.slice(page * 25, (page + 1) * 25)))];
        if (pages > 1) {
            const navigation = new ActionRowBuilder();
            if (page > 0) navigation.addComponents(new ButtonBuilder().setCustomId(`trade:protection-page:${trade.tradeId}:${page - 1}`).setLabel("Previous picks").setStyle(ButtonStyle.Secondary));
            if (page + 1 < pages) navigation.addComponents(new ButtonBuilder().setCustomId(`trade:protection-page:${trade.tradeId}:${page + 1}`).setLabel("More picks").setStyle(ButtonStyle.Secondary));
            navigation.addComponents(new ButtonBuilder().setCustomId(`trade:back:${trade.tradeId}`).setLabel("Back to Trade").setStyle(ButtonStyle.Secondary));
            rows.push(navigation);
        } else rows.push(backRow(trade.tradeId));
        return { content: `Choose an original first-round pick to change its protection${pages > 1 ? ` · Page ${page + 1}/${pages}` : ""}.`, components: rows };
    }

    function protectionOptionsPayload(trade, pickId) {
        const pick = tradeService.getLiveSnapshot(trade.leagueId, trade.seasonId).picks.find(item => item.pickId === pickId);
        if (!pick) throw new Error("That draft pick is no longer available.");
        return {
            content: `${pick.draftYear} ${pick.originalTeamId} first-round pick · choose protection.`, components: [
                new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`trade:protection-set:${trade.tradeId}:${encodeURIComponent(pickId)}`).setPlaceholder("Choose protection").addOptions(Object.entries(PICK_PROTECTIONS).map(([value, item]) => ({ label: item.label, value })))),
                backRow(trade.tradeId),
            ]
        };
    }

    async function refreshBuilder(interaction, tradeId) {
        const { trade } = currentTradeContext(interaction, tradeId);
        if (!trade || trade.status !== "DRAFT") throw new Error("This trade draft is no longer active.");
        await edit(interaction, builderPayload(trade));
    }

    function offerEmbed(trade) {
        const context = repository.loadLeague(trade.leagueId, trade.seasonId);
        const version = trade.currentVersion;
        const embed = new EmbedBuilder().setColor(0xffdc21).setTitle(`Trade Proposal · Version ${trade.version}`)
            .setDescription(`Respond within 24 hours. Deadline ${new Date(trade.expiresAt).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC.`);
        for (const team of version.teams) {
            const outgoing = version.transfers.filter(item => item.fromTeamId === team.teamId).map(item => `• ${item.assetType === "PLAYER" ? item.playerName : `${item.draftYear} ${teamName(context, item.originalTeamId)} ${item.round === 1 ? "1st" : "2nd"} · ${PICK_PROTECTIONS[item.protection]?.label || "Unprotected"}`}`);
            const incoming = version.transfers.filter(item => item.toTeamId === team.teamId).map(item => `• ${item.assetType === "PLAYER" ? item.playerName : `${item.draftYear} ${teamName(context, item.originalTeamId)} ${item.round === 1 ? "1st" : "2nd"} · ${PICK_PROTECTIONS[item.protection]?.label || "Unprotected"}`}`);
            const summary = version.teams.find(row => row.teamId === team.teamId);
            embed.addFields({
                name: teamName(context, team.teamId), value: [
                    `Sends **${summary.snapshotSentValue.toLocaleString("en-US")}** · Receives **${summary.snapshotReceivedValue.toLocaleString("en-US")}** · Difference **${summary.snapshotDifference > 0 ? "+" : ""}${summary.snapshotDifference}**`,
                    `Roster **${summary.projectedRosterCount}/15** · Trades **${summary.tradeCountAtSubmission}/5**`,
                    `Sends\n${outgoing.join("\n") || "—"}\nReceives\n${incoming.join("\n") || "—"}`,
                ].join("\n").slice(0, 1024)
            });
        }
        embed.setFooter({ text: `Trade ${trade.tradeId.slice(0, 8)} · Values frozen for this version` });
        return embed;
    }

    function gmButtons(trade, teamId) {
        const version = trade.version;
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`trade:gm:APPROVE:${trade.tradeId}:${version}:${teamId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`trade:gm:DENY:${trade.tradeId}:${version}:${teamId}`).setLabel("Deny").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`trade:gm:COUNTER:${trade.tradeId}:${version}:${teamId}`).setLabel("Counter").setStyle(ButtonStyle.Primary),
        );
    }

    async function saveTradeReference(leagueId, tradeId, version, key, value) {
        const trades = repository.loadTrades(leagueId), trade = trades.find(entry => entry.tradeId === tradeId);
        if (!trade || trade.version !== Number(version)) return;
        trade.currentVersion[key] = value;
        repository.saveTrades(leagueId, trades);
    }

    async function notifyGMsOnce(client, guild, trade) {
        trade = tradeService.getTrade(trade.leagueId, trade.tradeId) || trade;
        if (trade.status !== "PENDING_GM_APPROVAL" || !trade.currentVersion) return;
        const context = repository.loadLeague(trade.leagueId, trade.seasonId), settings = settingsFor(trade.leagueId);
        const sent = trade.currentVersion.gmMessages || [];
        for (const team of trade.currentVersion.teams.filter(entry => entry.teamId !== trade.initiatingTeamId)) {
            if (sent.some(entry => entry.teamId === team.teamId)) continue;
            const userId = team.coachUserId || (settings.testMode ? trade.currentVersion.initiatingUserId : null);
            if (!userId) continue;
            try {
                const user = await client.users.fetch(userId);
                const message = await user.send({ embeds: [offerEmbed(trade)], components: [gmButtons(trade, team.teamId)], allowedMentions: { parse: [] } });
                sent.push({ teamId: team.teamId, userId, channelId: message.channelId, messageId: message.id });
                await saveTradeReference(trade.leagueId, trade.tradeId, trade.version, "gmMessages", sent);
            } catch (error) { console.error(`Trade ${trade.tradeId}: could not DM ${team.teamId}: ${error.message}`); }
        }
        const channelId = settings.discordChannels?.submitTrade;
        const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
        if (channel && !trade.currentVersion.proposalMessageId) {
            const userIds = trade.currentVersion.teams.map(team => team.coachUserId).filter(Boolean);
            const message = await channel.send({ content: userIds.map(id => `<@${id}>`).join(" "), embeds: [offerEmbed(trade)], components: trade.currentVersion.teams.filter(team => team.teamId !== trade.initiatingTeamId).map(team => gmButtons(trade, team.teamId)), allowedMentions: { users: userIds } });
            await saveTradeReference(trade.leagueId, trade.tradeId, trade.version, "proposalMessageId", message.id);
        }
    }

    function notifyGMs(client, guild, trade) {
        return serializeDiscordAction(`${trade.tradeId}:gm:v${trade.version}`, () => notifyGMsOnce(client, guild, trade));
    }

    async function committeeVoters(guild, trade) {
        await guild.roles.fetch();
        const role = roleByName(guild, "LEAGUEbuddy Trade Committee");
        const members = await guild.members.fetch();
        const voters = role ? [...members.values()].filter(member => !member.user.bot && member.roles.cache.has(role.id)).map(member => member.id) : [];
        if (settingsFor(trade.leagueId).testMode && voters.length === 0) {
            return Array.from({ length: 5 }, (_, index) => `test-committee:${trade.currentVersion.initiatingUserId}:${index + 1}`);
        }
        return voters;
    }

    function committeeVoteComponents(trade) {
        const committee = trade.currentVersion.committee;
        const approve = committee.votes.filter(vote => vote.decision === "APPROVE").length;
        const deny = committee.votes.filter(vote => vote.decision === "DENY").length;
        if (committee.eligibleVoterIds.some(id => id.startsWith("test-committee:"))) {
            return Array.from({ length: 5 }, (_, index) => {
                const voterId = `test-committee:${trade.currentVersion.initiatingUserId}:${index + 1}`;
                const voted = committee.votes.some(vote => vote.userId === voterId);
                return new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`trade:test-vote:APPROVE:${trade.tradeId}:${trade.version}:${index + 1}`).setLabel(`Reviewer ${index + 1} Approve`).setStyle(ButtonStyle.Success).setDisabled(voted),
                    new ButtonBuilder().setCustomId(`trade:test-vote:DENY:${trade.tradeId}:${trade.version}:${index + 1}`).setLabel(`Reviewer ${index + 1} Deny`).setStyle(ButtonStyle.Danger).setDisabled(voted),
                );
            });
        }
        return [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`trade:vote:APPROVE:${trade.tradeId}:${trade.version}`).setLabel(`Approve · ${approve}/${committee.requiredVotes}`).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`trade:vote:DENY:${trade.tradeId}:${trade.version}`).setLabel(`Deny · ${deny}/${committee.requiredVotes}`).setStyle(ButtonStyle.Danger),
        )];
    }

    async function postCommittee(client, guild, trade) {
        if (trade.status !== "PENDING_COMMITTEE" || !trade.currentVersion?.committee) return;
        const settings = settingsFor(trade.leagueId), channelId = settings.discordChannels?.tradeCommittee;
        const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
        if (!channel) throw new Error("Trade Committee channel is not configured or available.");
        if (trade.currentVersion.committee.messageId && await channel.messages.fetch(trade.currentVersion.committee.messageId).catch(() => null)) return;
        const committeeRole = roleByName(guild, "LEAGUEbuddy Trade Committee");
        const committee = trade.currentVersion.committee;
        const embed = offerEmbed(trade).setTitle(`Trade Committee Review · ${trade.tradeId.slice(0, 8)}`)
            .addFields({ name: "Approval threshold", value: `${committee.requiredVotes} of ${committee.eligibleVoterIds.length} eligible committee members` });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`trade:vote:APPROVE:${trade.tradeId}:${trade.version}`).setLabel(`Approve · 0/${committee.requiredVotes}`).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`trade:vote:DENY:${trade.tradeId}:${trade.version}`).setLabel(`Deny · 0/${committee.requiredVotes}`).setStyle(ButtonStyle.Danger),
        );
        const components = committeeVoteComponents(trade);
        const message = await channel.send({ content: `${committeeRole ? `<@&${committeeRole.id}> ` : ""}Trade vote · ${trade.participatingTeams.map(id => teamName(repository.loadLeague(trade.leagueId, trade.seasonId), id)).join(" / ")}`, embeds: [embed], components, allowedMentions: committeeRole ? { roles: [committeeRole.id] } : { parse: [] } });
        tradeService.recordDiscordReference({ leagueId: trade.leagueId, tradeId: trade.tradeId, version: trade.version, kind: "committee", channelId: channel.id, messageId: message.id });
    }

    async function postProofThread(client, guild, trade) {
        if (trade.status !== "AWAITING_PROOF") return;
        const settings = settingsFor(trade.leagueId), channelId = settings.discordChannels?.tradeProof;
        const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
        if (!channel) throw new Error("Trade Proof channel is not configured or available.");
        if (trade.currentVersion?.proof?.threadId && await guild.channels.fetch(trade.currentVersion.proof.threadId).catch(() => null)) return;
        const users = trade.currentVersion.teams.map(team => team.coachUserId).filter(Boolean);
        const message = await channel.send({ content: `${users.map(id => `<@${id}>`).join(" ")} · Complete this approved trade in NBA 2K and upload one screenshot in this thread. Deadline: 24 hours.`, embeds: [offerEmbed(trade)], allowedMentions: { users } });
        const thread = await message.startThread({ name: `Trade ${trade.tradeId.slice(0, 8)} proof`, autoArchiveDuration: 10080, reason: "LEAGUEbuddy approved trade proof" });
        tradeService.recordDiscordReference({ leagueId: trade.leagueId, tradeId: trade.tradeId, version: trade.version, kind: "proof", channelId: channel.id, messageId: message.id, threadId: thread.id });
    }

    async function announceDeniedOnce(client, guild, trade, reason) {
        trade = tradeService.getTrade(trade.leagueId, trade.tradeId) || trade;
        const settings = settingsFor(trade.leagueId), channelId = settings.discordChannels?.deniedTrades;
        const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
        const users = [...new Set(trade.coachUserIds || trade.currentVersion?.teams?.map(team => team.coachUserId).filter(Boolean) || [])];
        const reference = `deniedAnnouncement_${trade.status}`;
        if (channel && !trade.currentVersion?.[reference]) {
            const footer = `Trade ${trade.tradeId} · ${trade.status}`;
            const recent = channel.messages?.fetch ? await channel.messages.fetch({ limit: 50 }).catch(() => null) : null;
            const existing = recent && [...recent.values()].find(message => message.embeds.some(embed => embed.footer?.text === footer));
            const message = existing || await channel.send({ content: users.map(id => `<@${id}>`).join(" "), embeds: [new EmbedBuilder().setColor(0xc0392b).setTitle("Trade Proposal Closed").setDescription(`${trade.participatingTeams.map(id => teamName(repository.loadLeague(trade.leagueId, trade.seasonId), id)).join(" · ")}\n${reason || trade.status.replaceAll("_", " ")}`).setFooter({ text: footer })], allowedMentions: { users } });
            await saveTradeReference(trade.leagueId, trade.tradeId, trade.version, reference, message.id);
        }
        const notified = trade.currentVersion?.denialNotifiedUserIds || [];
        for (const userId of users) {
            if (notified.includes(userId)) continue;
            try { const user = await client.users.fetch(userId); await user.send(`Trade ${trade.tradeId.slice(0, 8)} closed: ${reason || trade.status.replaceAll("_", " ")}.`); notified.push(userId); await saveTradeReference(trade.leagueId, trade.tradeId, trade.version, "denialNotifiedUserIds", notified); }
            catch { /* Notification is retried during workflow recovery. */ }
        }
    }

    function announceDenied(client, guild, trade, reason) {
        return serializeDiscordAction(`${trade.tradeId}:denied:${trade.status}`, () => announceDeniedOnce(client, guild, trade, reason));
    }

    async function announceCompletedOnce(guild, trade) {
        trade = tradeService.getTrade(trade.leagueId, trade.tradeId) || trade;
        if (trade.currentVersion?.approvedAnnouncementMessageId) return false;
        const context = repository.loadLeague(trade.leagueId, trade.seasonId), settings = settingsFor(trade.leagueId);
        const channelId = settings.discordChannels?.approvedTrades, channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
        if (!channel) return;
        const coachRole = roleByName(guild, "LEAGUEbuddy Coach");
        const lines = trade.participatingTeams.map(teamId => {
            const assets = trade.currentVersion.transfers.filter(item => item.toTeamId === teamId).map(item => item.assetType === "PLAYER"
                ? item.playerName
                : `${item.draftYear} ${teamName(context, item.originalTeamId)} ${item.round === 1 ? "1st" : "2nd"}${item.protection && item.protection !== "UNPROTECTED" ? ` — ${PICK_PROTECTIONS[item.protection]?.label}` : ""}`);
            return `**${teamName(context, teamId).toUpperCase()} RECEIVE**\n${assets.map(asset => `• ${asset}`).join("\n") || "• No assets"}`;
        });
        const content = coachRole ? `<@&${coachRole.id}>` : "";
        const footer = `Trade ${trade.tradeId}`;
        const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle("TRADE OFFICIAL").setDescription(`${lines.join("\n\n")}\n\n✅ Trade completed and rosters updated.`).setFooter({ text: footer });
        const proof = trade.currentVersion.proof.latestSubmission?.attachment?.storagePath;
        let files = [];
        if (proof) {
            const resolved = path.resolve(repository.dataRoot, proof);
            if (resolved.startsWith(`${path.resolve(repository.dataRoot)}${path.sep}`) && fs.existsSync(resolved)) files = [new AttachmentBuilder(resolved)];
        }
        const recent = channel.messages?.fetch ? await channel.messages.fetch({ limit: 50 }).catch(() => null) : null;
        const existing = recent && [...recent.values()].find(message => message.embeds.some(item => item.footer?.text === footer));
        const message = existing || await channel.send({ content, embeds: [embed], files, allowedMentions: coachRole ? { roles: [coachRole.id] } : { parse: [] } });
        await saveTradeReference(trade.leagueId, trade.tradeId, trade.version, "approvedAnnouncementMessageId", message.id);
        return true;
    }

    function announceCompleted(guild, trade) {
        return serializeDiscordAction(`${trade.tradeId}:completed`, () => announceCompletedOnce(guild, trade));
    }

    async function notifyCompletedOnce(client, trade) {
        trade = tradeService.getTrade(trade.leagueId, trade.tradeId) || trade;
        const users = [...new Set(trade.coachUserIds || [])], notified = trade.currentVersion?.completionNotifiedUserIds || [];
        for (const userId of users) {
            if (notified.includes(userId)) continue;
            try { const user = await client.users.fetch(userId); await user.send(`Trade ${trade.tradeId.slice(0, 8)} is official. Rosters and picks have been updated.`); notified.push(userId); await saveTradeReference(trade.leagueId, trade.tradeId, trade.version, "completionNotifiedUserIds", notified); }
            catch { /* Notification is retried during workflow recovery. */ }
        }
    }

    function notifyCompleted(client, trade) {
        return serializeDiscordAction(`${trade.tradeId}:completion-notice`, () => notifyCompletedOnce(client, trade));
    }

    async function closeInvalidated(client, guild, entries) {
        for (const entry of entries || []) {
            const trade = tradeService.getTrade(repository.loadLeagueContext({ guildId: guild.id }).league.leagueId, entry.tradeId);
            if (trade) await announceDenied(client, guild, trade, "A player or pick moved in another completed trade. This proposal was invalidated.");
        }
    }

    function thirdTeamPicker(trade, page = 0) {
        const context = repository.loadLeague(trade.leagueId, trade.seasonId);
        const options = teamOptions(context, trade.participatingTeams);
        const size = 15, pages = Math.max(1, Math.ceil(options.length / size));
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(`trade:select-third:${trade.tradeId}:${page}`).setPlaceholder("Choose a third team")
            .addOptions(options.slice(page * size, (page + 1) * size)));
        const nav = new ActionRowBuilder();
        if (page > 0) nav.addComponents(new ButtonBuilder().setCustomId(`trade:third-page:${trade.tradeId}:${page - 1}`).setLabel("Previous teams").setStyle(ButtonStyle.Secondary));
        if (page + 1 < pages) nav.addComponents(new ButtonBuilder().setCustomId(`trade:third-page:${trade.tradeId}:${page + 1}`).setLabel("More teams").setStyle(ButtonStyle.Secondary));
        nav.addComponents(new ButtonBuilder().setCustomId(`trade:back:${trade.tradeId}`).setLabel("Back to Trade").setStyle(ButtonStyle.Secondary));
        return { content: `Choose the third team · Page ${page + 1}/${pages}`, components: [row, nav] };
    }

    function actorTeamForTrade(leagueId, trade, userId, explicitTeamId) {
        if (explicitTeamId) return explicitTeamId;
        const team = repository.loadOwners(leagueId).find(owner => owner.userId === String(userId) && trade.participatingTeams.includes(owner.teamId));
        return team?.teamId || null;
    }

    async function handleGMResponse(interaction, action, tradeId, version, explicitTeamId) {
        const initial = interaction.guildId ? repository.loadTrades(repository.loadLeagueContext({ guildId: interaction.guildId }).league.leagueId) : [];
        let trade = initial.find(entry => entry.tradeId === tradeId);
        if (!trade && interaction.guildId) throw new Error("This trade could not be found.");
        if (!trade) {
            const dataRoot = repository.dataRoot;
            const files = fs.existsSync(path.join(dataRoot, "leagues")) ? fs.readdirSync(path.join(dataRoot, "leagues")) : [];
            for (const leagueId of files) {
                const candidate = repository.loadTrades(leagueId).find(entry => entry.tradeId === tradeId);
                if (candidate) { trade = candidate; break; }
            }
        }
        if (!trade) throw new Error("This trade could not be found.");
        const context = repository.loadLeague(trade.leagueId, trade.seasonId), settings = settingsFor(trade.leagueId);
        const guild = interaction.guild || await interaction.client.guilds.fetch(context.league.guildId);
        const actorTeamId = actorTeamForTrade(trade.leagueId, trade, interaction.user.id, explicitTeamId);
        if (!actorTeamId) throw new Error("This response is not for one of your teams.");
        if (action === "COUNTER") {
            const counter = tradeService.counterTrade({ leagueId: trade.leagueId, tradeId, version, actorUserId: interaction.user.id, actorTeamId });
            await ephemeral(interaction, builderPayload(counter));
            return;
        }
        const voterIds = action === "APPROVE" ? await committeeVoters(guild, trade) : [];
        const result = tradeService.decideGM({ leagueId: trade.leagueId, tradeId, version, actorUserId: interaction.user.id, actorTeamId, decision: action, eligibleVoterIds: voterIds });
        trade = tradeService.getTrade(trade.leagueId, tradeId);
        if (result.status === "DENIED_BY_GM") await announceDenied(interaction.client, guild, trade, `Denied by ${teamName(context, actorTeamId)}.`);
        if (result.committeeReady) await postCommittee(interaction.client, guild, trade);
        await ephemeral(interaction, { content: result.committeeReady ? "All team coaches approved. The trade is with the Committee." : result.status === "DENIED_BY_GM" ? "The proposal was denied. The coaches have been notified." : "Your approval is recorded." });
    }

    async function handleCommitteeVote(interaction, decision, tradeId, version, simulatedIndex = null) {
        const context = repository.loadLeagueContext({ guildId: interaction.guildId }), trade = tradeService.getTrade(context.league.leagueId, tradeId);
        if (!trade || trade.version !== Number(version)) throw new Error("This committee vote is no longer active.");
        const settings = settingsFor(trade.leagueId);
        let voterId = interaction.user.id;
        if (simulatedIndex != null) {
            if (!settings.testMode || !canManageLeague(interaction)) throw new Error("Simulated committee votes are available only to league staff in Test Mode.");
            voterId = `test-committee:${trade.currentVersion.initiatingUserId}:${simulatedIndex}`;
        } else {
            await interaction.guild.roles.fetch();
            const role = roleByName(interaction.guild, "LEAGUEbuddy Trade Committee");
            if (!role || !memberRoleIds(interaction).has(role.id)) throw new Error("Only Trade Committee role members can vote.");
        }
        const result = tradeService.voteCommittee({ leagueId: trade.leagueId, tradeId, version, actorUserId: voterId, decision });
        const updated = tradeService.getTrade(trade.leagueId, tradeId);
        if (result.status === "AWAITING_PROOF") {
            await postProofThread(interaction.client, interaction.guild, updated);
            const users = updated.currentVersion.teams.map(team => team.coachUserId).filter(Boolean);
            for (const userId of users) interaction.client.users.fetch(userId).then(user => user.send(`Trade ${tradeId.slice(0, 8)} passed the Committee and is awaiting one screenshot of the completed NBA 2K trade.`)).catch(() => { });
        } else if (result.status === "DENIED_BY_COMMITTEE") await announceDenied(interaction.client, interaction.guild, updated, "The Trade Committee denied the proposal.");
        else if (interaction.message) {
            const committee = updated.currentVersion.committee;
            const approve = committee.votes.filter(vote => vote.decision === "APPROVE").length;
            const deny = committee.votes.filter(vote => vote.decision === "DENY").length;
            await interaction.message.edit({ embeds: [offerEmbed(updated).addFields({ name: "Vote", value: `Approve **${approve}** · Deny **${deny}** · Required **${committee.requiredVotes}** of ${committee.eligibleVoterIds.length}` })], components: committeeVoteComponents(updated) }).catch(() => { });
        }
        await ephemeral(interaction, { content: result.status === "AWAITING_PROOF" ? "Committee approved the trade. A proof thread is ready." : result.status === "DENIED_BY_COMMITTEE" ? "Committee denial recorded." : `Vote recorded · Approve ${result.approve} · Deny ${result.deny} · ${result.requiredVotes} required.` });
    }

    async function handleStaffProof(interaction, decision, tradeId, version) {
        if (!canManageLeague(interaction)) throw new Error("Only league Staff/Commissioners may review trade proof.");
        const context = repository.loadLeagueContext({ guildId: interaction.guildId });
        const result = tradeService.reviewProof({ leagueId: context.league.leagueId, tradeId, version, actorUserId: interaction.user.id, approve: decision === "APPROVE" });
        const trade = tradeService.getTrade(context.league.leagueId, tradeId);
        if (result.status === "COMPLETED") {
            await refreshTradeCounts(interaction.guild);
            await announceCompleted(interaction.guild, trade);
            await notifyCompleted(interaction.client, tradeService.getTrade(context.league.leagueId, tradeId));
            await closeInvalidated(interaction.client, interaction.guild, result.invalidatedTrades);
        } else if (result.status === "AWAITING_PROOF") {
            const thread = trade.currentVersion.proof.threadId ? await interaction.guild.channels.fetch(trade.currentVersion.proof.threadId).catch(() => null) : null;
            if (thread) await thread.send(`${trade.currentVersion.teams.map(team => team.coachUserId ? `<@${team.coachUserId}>` : "").filter(Boolean).join(" ")} Staff rejected this screenshot. Upload a corrected single screenshot before the original deadline.`, { allowedMentions: { users: trade.currentVersion.teams.map(team => team.coachUserId).filter(Boolean) } });
        } else if (result.invalidated) await announceDenied(interaction.client, interaction.guild, trade, result.errors.join(" "));
        await ephemeral(interaction, { content: result.status === "COMPLETED" ? result.alreadyProcessed ? "This trade was already processed." : "Proof approved. Players, picks, and counts were committed." : result.invalidated ? "Trade invalidated because its current assets or eligibility changed." : "Proof rejected. The trade remains open for corrected proof until its existing deadline." });
    }

    async function handleTradeInteraction(interaction) {
        try {
            const parts = interaction.customId.split(":");
            const [root, action] = parts;
            if (root !== "trade") return false;
            if (interaction.isButton() && action === "build") { await startBuilder(interaction); return true; }
            if (interaction.isButton() && action === "close") { await edit(interaction, { content: "Trade builder closed. Any saved draft remains available from its current interaction.", embeds: [], components: [] }); return true; }
            if (interaction.isButton() && action === "teams") {
                const mode = parts[2], initiatorId = parts[3] || "", page = Number(parts[4]) || 0;
                const context = repository.loadLeagueContext({ guildId: interaction.guildId });
                await edit(interaction, teamPicker(context, page, mode, initiatorId)); return true;
            }
            if (interaction.isStringSelectMenu() && action === "select-initial") {
                const context = repository.loadLeagueContext({ guildId: interaction.guildId });
                await edit(interaction, teamPicker(context, 0, "other", interaction.values[0])); return true;
            }
            if (interaction.isStringSelectMenu() && action === "select-other") {
                const initiatorId = parts[2], teamId = interaction.values[0], context = repository.loadLeagueContext({ guildId: interaction.guildId });
                const trade = tradeService.createDraft({ leagueId: context.league.leagueId, seasonId: context.seasonId, initiatingUserId: interaction.user.id, initiatingTeamId: initiatorId, secondTeamId: teamId });
                await edit(interaction, builderPayload(trade)); return true;
            }
            if (interaction.isButton() && action === "team") {
                const { trade } = currentTradeContext(interaction, parts[2]);
                if (!trade || trade.status !== "DRAFT" || trade.initiatingUserId !== interaction.user.id) throw new Error("This trade draft is no longer editable.");
                if (trade.participatingTeams.length === 2) await edit(interaction, thirdTeamPicker(trade));
                else if (trade.transfers.some(item => trade.participatingTeams[2] === item.fromTeamId || trade.participatingTeams[2] === item.toTeamId)) await ephemeral(interaction, { content: "Remove the third team's assets before removing that team." });
                else {
                    trade.participatingTeams = trade.participatingTeams.slice(0, 2);
                    await tradeService.updateDraft({ leagueId: trade.leagueId, tradeId: trade.tradeId, actorUserId: interaction.user.id, participatingTeams: trade.participatingTeams });
                    await refreshBuilder(interaction, trade.tradeId);
                }
                return true;
            }
            if (interaction.isButton() && action === "third-page") {
                const { trade } = currentTradeContext(interaction, parts[2]);
                await edit(interaction, thirdTeamPicker(trade, Number(parts[3]) || 0)); return true;
            }
            if (interaction.isStringSelectMenu() && action === "select-third") {
                const { trade } = currentTradeContext(interaction, parts[2]);
                await tradeService.updateDraft({ leagueId: trade.leagueId, tradeId: trade.tradeId, actorUserId: interaction.user.id, participatingTeams: [...trade.participatingTeams, interaction.values[0]] });
                await refreshBuilder(interaction, trade.tradeId); return true;
            }
            if (interaction.isButton() && action === "add") {
                const { trade } = currentTradeContext(interaction, parts[3]);
                if (!trade || trade.status !== "DRAFT" || trade.initiatingUserId !== interaction.user.id) throw new Error("This trade draft is no longer editable.");
                await edit(interaction, sourcePayload(trade, parts[2])); return true;
            }
            if (interaction.isButton() && action === "source") {
                const { trade } = currentTradeContext(interaction, parts[3]);
                await edit(interaction, assetMenuPayload(trade, parts[2], parts[4])); return true;
            }
            if (interaction.isButton() && ["asset-page", "pick-page"].includes(action)) {
                const legacyPickPage = action === "pick-page";
                const { trade } = currentTradeContext(interaction, parts[legacyPickPage ? 2 : 3]);
                await edit(interaction, assetMenuPayload(trade, legacyPickPage ? "PICK" : parts[2], parts[legacyPickPage ? 3 : 4], Number(parts[legacyPickPage ? 4 : 5]) || 0)); return true;
            }
            if (interaction.isStringSelectMenu() && action === "asset") {
                const { trade } = currentTradeContext(interaction, parts[3]);
                await edit(interaction, destinationPayload(trade, parts[2], parts[4], decodeURIComponent(interaction.values[0]))); return true;
            }
            if (interaction.isStringSelectMenu() && action === "destination") {
                const { trade } = currentTradeContext(interaction, parts[2]);
                const [toTeamId, protection] = interaction.values[0].split("|");
                const transfer = { assetType: parts[3], assetId: decodeURIComponent(parts[5]), fromTeamId: parts[4], toTeamId, ...(parts[3] === "PICK" ? { protection } : {}) };
                await tradeService.updateDraft({ leagueId: trade.leagueId, tradeId: trade.tradeId, actorUserId: interaction.user.id, transfers: [...trade.transfers, transfer] });
                await refreshBuilder(interaction, trade.tradeId); return true;
            }
            if (interaction.isButton() && action === "remove") {
                const { trade } = currentTradeContext(interaction, parts[2]);
                await edit(interaction, removePayload(trade, Number(parts[3]) || 0)); return true;
            }
            if (interaction.isStringSelectMenu() && action === "remove-select") {
                const { trade } = currentTradeContext(interaction, parts[2]);
                const [type, id] = interaction.values[0].split("|");
                await tradeService.updateDraft({ leagueId: trade.leagueId, tradeId: trade.tradeId, actorUserId: interaction.user.id, transfers: trade.transfers.filter(item => !(item.assetType === type && item.assetId === decodeURIComponent(id))) });
                await refreshBuilder(interaction, trade.tradeId); return true;
            }
            if (interaction.isButton() && action === "protection") {
                const { trade } = currentTradeContext(interaction, parts[2]);
                await edit(interaction, protectionPayload(trade)); return true;
            }
            if (interaction.isButton() && action === "protection-page") {
                const { trade } = currentTradeContext(interaction, parts[2]);
                await edit(interaction, protectionPayload(trade, Number(parts[3]) || 0)); return true;
            }
            if (interaction.isStringSelectMenu() && action === "protection-pick") {
                const { trade } = currentTradeContext(interaction, parts[2]);
                await edit(interaction, protectionOptionsPayload(trade, decodeURIComponent(interaction.values[0]))); return true;
            }
            if (interaction.isStringSelectMenu() && action === "protection-set") {
                const { trade } = currentTradeContext(interaction, parts[2]);
                const pickId = decodeURIComponent(parts[3]), protection = interaction.values[0];
                await tradeService.updateDraft({ leagueId: trade.leagueId, tradeId: trade.tradeId, actorUserId: interaction.user.id, transfers: trade.transfers.map(item => item.assetId === pickId ? { ...item, protection } : item) });
                await refreshBuilder(interaction, trade.tradeId); return true;
            }
            if (interaction.isButton() && action === "back") { await refreshBuilder(interaction, parts[2]); return true; }
            if (interaction.isButton() && action === "package") {
                const { trade } = currentTradeContext(interaction, parts[2]);
                await edit(interaction, reviewPackagePayload(trade, Number(parts[3]) || 0, Number(parts[4]) || 0)); return true;
            }
            if (interaction.isButton() && action === "submit") {
                const { context } = currentTradeContext(interaction, parts[2]);
                const result = tradeService.submitTrade({ leagueId: context.league.leagueId, tradeId: parts[2], actorUserId: interaction.user.id });
                await interaction.update({ content: "Proposal submitted. The other coaches have 24 hours to respond. Your values are frozen for this version.", embeds: [], components: [] });
                const guild = interaction.guild || await interaction.client.guilds.fetch(context.league.guildId);
                await notifyGMs(interaction.client, guild, result.trade);
                return true;
            }
            if (interaction.isButton() && action === "gm") { await handleGMResponse(interaction, parts[2], parts[3], Number(parts[4]), parts[5]); return true; }
            if (interaction.isButton() && action === "vote") { await handleCommitteeVote(interaction, parts[2], parts[3], Number(parts[4])); return true; }
            if (interaction.isButton() && action === "test-vote") { await handleCommitteeVote(interaction, parts[2], parts[3], Number(parts[4]), Number(parts[5])); return true; }
            if (interaction.isButton() && action === "proof") { await handleStaffProof(interaction, parts[2], parts[3], Number(parts[4])); return true; }
            return false;
        } catch (error) {
            logger.error(`[LEAGUEbuddy trade] ${interaction.customId} failed for user ${interaction.user?.id || "unknown"} in guild ${interaction.guildId || "DM"}:`, error);
            if (interaction.deferred || interaction.replied) await interaction.followUp({ content: error.message, flags: MessageFlags.Ephemeral }).catch(() => { });
            else await ephemeral(interaction, { content: error.message }).catch(() => { });
            return true;
        }
    }

    async function handleProofMessage(message) {
        if (message.author?.bot || !message.guild) return false;
        const guildBinding = repository.loadGuildLeagueBinding(message.guild.id);
        if (!guildBinding?.leagueId) return false;
        const trade = tradeService.getTradeByProofThread(guildBinding.leagueId, message.channel.id);
        if (!trade || trade.status !== "AWAITING_PROOF") return false;
        if (message.attachments.size === 0) return false;
        if (message.attachments.size !== 1) { await message.reply("Submit exactly one screenshot for the entire trade."); return true; }
        const attachment = message.attachments.first();
        if (!attachment?.contentType?.startsWith("image/") || attachment.size > PROOF_IMAGE_LIMIT) {
            await message.reply("Upload one JPG, PNG, or WebP screenshot no larger than 25 MB."); return true;
        }
        const settings = settingsFor(trade.leagueId);
        const owner = repository.loadOwners(trade.leagueId).find(entry => entry.userId === message.author.id && trade.participatingTeams.includes(entry.teamId));
        const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
        const coachRole = roleByName(message.guild, "LEAGUEbuddy Coach"), gmRole = roleByName(message.guild, "LEAGUEbuddy GM");
        const staff = canManageLeague({ guildId: message.guild.id, memberPermissions: member?.permissions, member: { roles: member?.roles } });
        if (!settings.testMode && !owner) { await message.reply("Only an involved coach may submit proof in this trade thread."); return true; }
        if (settings.testMode && !owner && !(staff || member?.roles?.cache?.has(coachRole?.id) || member?.roles?.cache?.has(gmRole?.id))) { await message.reply("A league Coach, GM, or Staff member must submit proof in Test Mode."); return true; }
        const actorTeamId = owner?.teamId || trade.participatingTeams.find(teamId => teamId !== trade.initiatingTeamId) || trade.participatingTeams[0];
        const buffer = await downloadDiscordImage(attachment);
        if (buffer.length > PROOF_IMAGE_LIMIT) throw new Error("Screenshot exceeds the 25 MB limit.");
        const extension = imageType(buffer) === "image/jpeg" ? "jpg" : imageType(buffer).slice(6);
        const directory = path.join(repository.dataRoot, "trade-proof", trade.tradeId);
        fs.mkdirSync(directory, { recursive: true });
        const fileName = `v${trade.version}-${randomUUID()}.${extension}`;
        const target = path.join(directory, fileName), temporary = `${target}.tmp`;
        fs.writeFileSync(temporary, buffer, { flag: "wx" }); fs.renameSync(temporary, target);
        const storagePath = path.relative(repository.dataRoot, target).split(path.sep).join("/");
        try {
            tradeService.submitProof({ leagueId: trade.leagueId, tradeId: trade.tradeId, actorUserId: message.author.id, actorTeamId, attachment: { name: attachment.name, url: attachment.url, contentType: attachment.contentType, size: buffer.length, storagePath } });
        } catch (error) { fs.unlinkSync(target); throw error; }
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`trade:proof:APPROVE:${trade.tradeId}:${trade.version}`).setLabel("Approve Proof").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`trade:proof:REJECT:${trade.tradeId}:${trade.version}`).setLabel("Reject Proof").setStyle(ButtonStyle.Danger),
        );
        await message.reply({ content: `Screenshot received from <@${message.author.id}>. Staff review is required; deadline remains ${trade.expiresAt}.`, components: [row], allowedMentions: { users: [message.author.id] } });
        return true;
    }

    async function reconcile(client) {
        for (const guild of client.guilds.cache.values()) {
            const binding = repository.loadGuildLeagueBinding(guild.id);
            if (!binding?.leagueId) continue;
            let context;
            try { context = repository.loadLeagueContext({ guildId: guild.id }); } catch { continue; }
            const expired = tradeService.expireDue(context.league.leagueId, context.seasonId);
            for (const entry of expired) {
                const trade = tradeService.getTrade(context.league.leagueId, entry.tradeId);
                await announceDenied(client, guild, trade, entry.status.replaceAll("_", " "));
            }
            for (const trade of repository.loadTrades(context.league.leagueId)) {
                try {
                    if (trade.status === "PENDING_GM_APPROVAL") await notifyGMs(client, guild, trade);
                    else if (trade.status === "PENDING_COMMITTEE") await postCommittee(client, guild, trade);
                    else if (trade.status === "AWAITING_PROOF") await postProofThread(client, guild, trade);
                    else if (trade.status === "COMPLETED") {
                        if (!trade.currentVersion?.countsPinRefreshed) {
                            if (await refreshTradeCounts(guild)) await saveTradeReference(trade.leagueId, trade.tradeId, trade.version, "countsPinRefreshed", true);
                        }
                        await announceCompleted(guild, trade);
                        await notifyCompleted(client, tradeService.getTrade(trade.leagueId, trade.tradeId));
                    } else if (["DENIED_BY_GM", "EXPIRED_GM_RESPONSE", "DENIED_BY_COMMITTEE", "EXPIRED_COMMITTEE", "EXPIRED_PROOF", "INVALIDATED"].includes(trade.status)) {
                        await announceDenied(client, guild, trade, trade.invalidReason || trade.status.replaceAll("_", " "));
                    }
                } catch (error) { console.error(`Trade ${trade.tradeId} recovery: ${error.message}`); }
            }
        }
    }

    async function restore(client) {
        await reconcile(client);
        if (live.has(client)) return;
        const timer = setInterval(() => reconcile(client).catch(error => console.error("Trade recovery:", error.message)), 60000);
        timer.unref();
        live.set(client, timer);
    }

    return { ensurePins, handleProofMessage, handleTradeInteraction, reconcile, refreshTradeCounts, restore, tradeService };
}

module.exports = { createDiscordTradeWorkflow };
