require("dotenv").config();
const { roleOwnership } = require("./fantasyhq/role-ownership");

const fs = require("fs");
const path = require("path");

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
} = require("discord.js");

const { handleAdminCommand } = require("./fantasyhq/discord-admin");
const { readConfig } = require("./config");
const {
  handleRatingsAutocomplete,
  handleRatingsCommand,
} = require("./2kratings/discord-ratings");
const {
  handleSetupFlowButton,
  handleLeagueCommand,
  handleRosterCommand,
  handleSetupAutocomplete,
  handleSetupCommand,
  handleTeamCommand,
} = require("./fantasyhq/discord-setup");
const {
  handleMyTeamCommand,
  handleFreeAgentsCommand,
  handlePlayerCommand,
  handlePreseasonAutocomplete,
  handleTeamsCommand,
} = require("./fantasyhq/discord-preseason");
const {
  handleScheduleAutocomplete,
  handleScheduleButton,
  handleScheduleCommand,
} = require("./fantasyhq/discord-schedule");
const { startWebsite } = require("./web");
const websiteRuntime = require("./web");

const { handleDeleteLeagueButton } = require("./fantasyhq/discord-delete-league");
const config = readConfig();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});
const tradeRepository = require("./fantasyhq/repository").createFantasyHQRepository();
const storageSafety = require('./fantasyhq/storage-safety');
const writerLease = storageSafety.acquireWriterLease(tradeRepository.dataRoot);
const startupBackup = storageSafety.createStorageBackup(tradeRepository.dataRoot, { label: 'startup' });
console.log(`League backup: ${startupBackup.id}`);
setInterval(() => { try { storageSafety.createStorageBackup(tradeRepository.dataRoot, { label: 'daily' }); } catch (error) { console.error('League backup failed:', error.message); } }, 86400000).unref();
const discordLeagueFeeds = require("./fantasyhq/discord-league-feeds").createDiscordLeagueFeeds({ repository: tradeRepository });
const gameRecordStore = require("./fantasyhq/game-submissions").createGameSubmissionService({ repository: tradeRepository });
const playerUpgradeService = require("./fantasyhq/player-upgrades-service").createPlayerUpgradeService({ repository: tradeRepository, submissions: gameRecordStore });
const discordPlayerUpgrades = require("./fantasyhq/discord-player-upgrades").createDiscordPlayerUpgrades({ repository: tradeRepository, service: playerUpgradeService, client });
playerUpgradeService.setNotificationHandler(notice => discordPlayerUpgrades.notifyCoach(notice));
roleOwnership.setOwnerChangeHandler(async change => {
  await discordPlayerUpgrades.syncOwnerChange({ leagueId: change.leagueId, seasonId: change.seasonId, phase: change.phase, owners: change.owners });
  freeAgencyService.tick(change.leagueId); tradeService.reconcileOwnership(change.leagueId);
  const guild = await client.guilds.fetch(tradeRepository.loadLeague(change.leagueId).league.guildId);
  await gameThreads.syncAccess(guild, change);
  if (change.phase === 'REGULAR_SEASON' && tradeRepository.loadLeague(change.leagueId).league.regularSeasonStatus !== 'COMPLETED') setImmediate(() => gameThreads.create(guild).catch(error => console.error('Owner-change thread repair:', error.message)));
});
const gameApprovals = require("./fantasyhq/discord-game-approvals").createDiscordGameApprovals({ submissions: gameRecordStore });
const discordPostseason = require('./fantasyhq/discord-postseason').createDiscordPostseason({submissions:gameRecordStore});
gameRecordStore.setFinalizationHandler(record => {
  if(record.game.seriesId) {
    discordPostseason.service.synchronize(record.game.leagueId);
    setImmediate(async()=>{try {const guild=await client.guilds.fetch(record.game.guildId);if(tradeRepository.loadLeague(record.game.leagueId).league.currentPhase==='PLAYOFFS')await discordPostseason.createThreads(guild);else await discordPostseason.refreshPin(guild);await require('./fantasyhq/discord-postseason-stats').createDiscordPostseasonStats({repository:tradeRepository}).ensurePin(guild,record.game.leagueId);}catch(error){console.error('Postseason follow-up:',error.message);}});
  }
  const awards = playerUpgradeService.reconcileFinalizedGames({ leagueId: record.game.leagueId, seasonId: record.game.seasonId });
  // The callback runs inside the record lock; delivery persists its receipt after that lock releases.
  (async () => {
    const guild = await client.guilds.fetch(record.game.guildId);
    const channel = await guild.channels.fetch(record.game.discordThreadId);
    await gameApprovals.publish(channel, record.game.gameId);
  })().catch(error => console.error("Game approval notice:", error.message));
  return awards;
});
websiteRuntime.setPlayerUpgradeRuntime({ service: playerUpgradeService, submissions: gameRecordStore, invalidatePlayerRequests: event => discordPlayerUpgrades.invalidatePlayerRequests(event) });
const tradeService = require("./fantasyhq/trade-service").createTradeService({ repository: tradeRepository, onPlayersMoved: event => discordPlayerUpgrades.invalidatePlayerRequests(event) });
const freeAgencyService = require('./fantasyhq/free-agency-service').createFreeAgencyService({ repository: tradeRepository, onPlayersMoved: event => discordPlayerUpgrades.invalidatePlayerRequests(event) });
const discordFreeAgency = require('./fantasyhq/discord-free-agency').createDiscordFreeAgency({ repository: tradeRepository, service: freeAgencyService, client });
const discordTrades = require("./fantasyhq/discord-trades").createDiscordTradeWorkflow({ repository: tradeRepository, tradeService });
const gameSubmissions = require("./fantasyhq/discord-game-submissions").createDiscordGameSubmissions(gameRecordStore);
const gameActivity = require("./fantasyhq/game-activity").createGameActivityService();
client.on(Events.MessageCreate, async message => {
  if (message.author?.bot) return;
  try {
    if (message.guild && (message.attachments?.size || message.channel?.isThread?.())) await roleOwnership.refreshActor(message.guild, message.member);
    await Promise.all([
      discordTrades.handleProofMessage(message),
      gameActivity.message(message),
      gameSubmissions.message(message),
    ]);
  } catch (error) { console.error("League message:", error.message); }
});

const discordActivityCheck = require("./fantasyhq/discord-activity-check").createDiscordActivityCheck({ repository: tradeRepository });
const gameThreads = require("./fantasyhq/game-threads").createGameThreadService();
let mockSimulations;
let discordWeeklyDashboard;
const weekAdvancement = require("./fantasyhq/week-advancement").createWeekAdvancementService({
  threads: gameThreads,
  onAdvanced: async ({ guild, leagueId }) => {
    try { await discordLeagueFeeds.ensurePins(guild, leagueId); }
    catch (error) { console.error("League feeds after week advancement:", error.message); }
    if (discordWeeklyDashboard) await discordWeeklyDashboard.ensureReport(guild);
    if (mockSimulations) mockSimulations.refresh(leagueId).catch(error => console.error("Mock simulations:", error.message));
  },
});
discordWeeklyDashboard = require('./fantasyhq/discord-weekly-dashboard').createDiscordWeeklyDashboard({ repository: tradeRepository, weekService: weekAdvancement });
const gameCleanup = require("./fantasyhq/game-thread-cleanup").createGameThreadCleanupService();
require("./web").setGameThreadRuntime({ client, service: gameThreads, repository: gameThreads.repository, weekService: weekAdvancement, cleanupService: gameCleanup });
const scoutingService = require("./fantasyhq/scouting-service").createScoutingService({ repository: require("./fantasyhq/repository").createFantasyHQRepository() });
const scoutingCommands = require("./fantasyhq/discord-scouting");
mockSimulations = require('./fantasyhq/mock-simulations').createMockSimulationService({ repository: tradeRepository, scoutingService });
const liveMocks = require('./fantasyhq/live-mock-service').createLiveMockService({ repository: tradeRepository, simulations: mockSimulations });
const discordMocks = require('./fantasyhq/discord-mock-draft').createDiscordMockDraft({ repository: tradeRepository, simulations: mockSimulations, live: liveMocks, client });

const discordStatsRepository = require("./fantasyhq/repository").createFantasyHQRepository();
const discordPlayerStats = require("./fantasyhq/discord-player-stats").createDiscordPlayerStatsHandlers({
  repository: discordStatsRepository,
  playerService: require("./fantasyhq/player-service").createPlayerService({ repository: discordStatsRepository }),
  statsService: require("./fantasyhq/player-stats-service").createPlayerStatsService({ repository: discordStatsRepository, publishedOnly: true }),
});
const discordTradeBlock = require("./fantasyhq/discord-trade-block").createDiscordTradeBlock({ repository: discordStatsRepository, playerService: require("./fantasyhq/player-service").createPlayerService({ repository: discordStatsRepository }) });
const discordTeamStatsRepository = require("./fantasyhq/repository").createFantasyHQRepository();
const discordTeamStats = require("./fantasyhq/discord-team-stats").createDiscordTeamStatsHandlers({
  repository: discordTeamStatsRepository,
  teamStatsService: require("./fantasyhq/team-stats-service").createTeamStatsService({ repository: discordTeamStatsRepository, publishedOnly: true }),
});
const draftEmojiCache = new Map();
const DRAFT_CLASS_DIR = path.join(process.cwd(), "draft_class");
const DRAFT_IMAGE_DIR = path.join(DRAFT_CLASS_DIR, "images");

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function fixedNumber(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toFixed(digits);
}

function optionalStringOption(interaction, name) {
  try {
    return interaction.options.getString(name);
  } catch {
    return null;
  }
}

function draftClassFiles() {
  try {
    return fs.readdirSync(DRAFT_CLASS_DIR)
      .filter((file) => file.toLowerCase().endsWith(".json"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

function topTenDraftClassFiles() {
  return draftClassFiles().filter((file) => /early top ten/i.test(file));
}

function recruitingClassFiles() {
  return draftClassFiles().filter((file) => /recruiting/i.test(file));
}

function transferPortalClassFiles() {
  return draftClassFiles().filter((file) => /transfer portal/i.test(file));
}

function draftClassLabel(fileName) {
  return String(fileName || "").replace(/\.json$/i, "");
}

function resolveClassFile(files, selection = null) {
  if (!files.length) return null;
  if (!selection) return files[0];
  const normalized = String(selection).trim().toLowerCase();
  return files.find((file) => file.toLowerCase() === normalized)
    || files.find((file) => draftClassLabel(file).toLowerCase() === normalized)
    || files[0];
}

function resolveDraftClassFile(selection = null) {
  return resolveClassFile(topTenDraftClassFiles(), selection);
}

function resolveRecruitingClassFile(selection = null) {
  return resolveClassFile(recruitingClassFiles(), selection);
}

function resolveTransferPortalClassFile(selection = null) {
  return resolveClassFile(transferPortalClassFiles(), selection);
}

function classImageDirectoryId(fileName) {
  return String(fileName || "")
    .replace(/\.json$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function recursiveImageFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const nextPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return recursiveImageFiles(nextPath);
    return entry.isFile() ? [nextPath] : [];
  });
}

function imagePreferenceScore(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return 3;
  if (extension === ".webp") return 2;
  if (extension === ".jpg" || extension === ".jpeg") return 1;
  return 0;
}

function bundledImageMap(fileName) {
  const classDirectory = path.join(DRAFT_IMAGE_DIR, classImageDirectoryId(fileName));
  const images = new Map();

  for (const filePath of recursiveImageFiles(classDirectory)) {
    const fileNameOnly = path.basename(filePath);
    const match = fileNameOnly.match(/^(\d{3})-/);
    if (!match) continue;

    const rank = Number(match[1]);
    const relativePath = path.relative(DRAFT_CLASS_DIR, filePath).replaceAll(path.sep, "/");
    const existing = images.get(rank);
    if (!existing || imagePreferenceScore(relativePath) > imagePreferenceScore(existing)) {
      images.set(rank, relativePath);
    }
  }

  return images;
}

function withBundledImages(fileName, prospects, rankKey) {
  const bundledImages = bundledImageMap(fileName);
  return prospects.map((prospect) => {
    const rank = Number(prospect[rankKey] || 0);
    return {
      ...prospect,
      image: prospect.image || bundledImages.get(rank) || null,
    };
  });
}

function topTenPreviewProspects(draftClassFile = null) {
  const fileName = resolveDraftClassFile(draftClassFile);
  const raw = readJson(fileName ? path.join(DRAFT_CLASS_DIR, fileName) : "", {});
  const prospects = Object.values(raw || {})
    .sort((a, b) => Number(a.id_number || 0) - Number(b.id_number || 0));
  return withBundledImages(fileName, prospects, "id_number");
}

function recruitingProspects(draftClassFile = null) {
  const fileName = resolveRecruitingClassFile(draftClassFile);
  const raw = readJson(fileName ? path.join(DRAFT_CLASS_DIR, fileName) : "", {});
  return Object.values(raw || {})
    .sort((a, b) => Number(a.national_rank || 0) - Number(b.national_rank || 0));
}

function transferPortalProspects(draftClassFile = null) {
  const fileName = resolveTransferPortalClassFile(draftClassFile);
  const raw = readJson(fileName ? path.join(DRAFT_CLASS_DIR, fileName) : "", {});
  return Object.values(raw || {})
    .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
}

function topTenPreviewEmojiName(prospect = {}) {
  const team = String(prospect.team || "").trim().toLowerCase();
  const nationality = String(prospect.nationality || "").trim().toLowerCase();
  const mapping = {
    "alabama": "alabama",
    "arkansas": "arkansas",
    "asvel villeurbanne": "france",
    "cedevita olimpija": "slovenia",
    "duke": "duke",
    "france": "france",
    "georgia": "georgia",
    "kansas": "kansas",
    "louisville": "louisville",
    "north carolina": "northcarolina",
    "slovenia": "slovenia",
    "usc": "usc",
  };
  return mapping[team] || mapping[nationality] || null;
}

function normalizeEmojiLookup(value = "") {
  return String(value || "").trim().toLowerCase().replaceAll(/[\s_-]+/g, "");
}

async function topTenPreviewEmojiMap(interaction) {
  if (!interaction.guild?.emojis) return new Map();

  const cached = draftEmojiCache.get(interaction.guildId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.map;
  }

  const collection = await interaction.guild.emojis.fetch();
  const map = new Map();
  for (const emoji of collection.values()) {
    map.set(normalizeEmojiLookup(emoji.name), `${emoji}`);
  }

  draftEmojiCache.set(interaction.guildId, {
    map,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  return map;
}

function guildEmojiByName(emojiMap, emojiName) {
  if (!emojiName) return "";
  return emojiMap.get(normalizeEmojiLookup(emojiName)) || "";
}

function topTenPreviewHeader(emojiMap, prospect) {
  const directEmoji = String(prospect["emoji_#"] || "").trim();
  const emoji = directEmoji || guildEmojiByName(emojiMap, topTenPreviewEmojiName(prospect));
  const team = prospect.team || prospect.nationality || "Unknown";
  return [emoji, team].filter(Boolean).join(" ");
}

function topTenPreviewProfileLine(prospect = {}) {
  const positions = [prospect.position_1, prospect.position_2]
    .filter((value) => value && value !== "N/A")
    .join("/");

  return [
    positions || "N/A",
    prospect.age ? `${prospect.age} yrs` : null,
    prospect.class || null,
  ].filter(Boolean).join(" • ");
}

function topTenPreviewHand(prospect = {}) {
  return String(prospect.handle || "").trim().toLowerCase() === "left" ? "Left" : "Right";
}

function topTenPreviewList(prospect, prefix) {
  const values = [prospect[`${prefix}_1`], prospect[`${prefix}_2`], prospect[`${prefix}_3`]]
    .filter(Boolean);
  return values.join(", ") || "N/A";
}

function topTenPreviewImage(prospect = {}) {
  const image = String(prospect.image || "").trim();
  if (!image) return { attachment: null, url: null };
  if (/^https?:\/\//i.test(image)) return { attachment: null, url: image };

  const draftRoot = path.resolve(DRAFT_CLASS_DIR);
  const imagePath = path.resolve(draftRoot, image);
  if (!imagePath.startsWith(`${draftRoot}${path.sep}`) || !fs.existsSync(imagePath)) {
    console.warn(`Top ten preview image not found: ${image}`);
    return { attachment: null, url: null };
  }

  const extension = path.extname(imagePath).toLowerCase() || ".png";
  const name = `toptenpreview-${prospect.id_number || "prospect"}${extension}`;
  return {
    attachment: new AttachmentBuilder(imagePath, { name }),
    url: `attachment://${name}`,
  };
}

function topTenPreviewProfileUrl(draftClassFile, prospect = {}) {
  const configuredUrl = process.env.WEBSITE_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "");
  const baseUrl = String(configuredUrl).trim().replace(/\/+$/, "");
  if (!baseUrl) return null;

  const params = new URLSearchParams({
    class: draftClassFile || "",
    prospect: String(prospect.id_number || ""),
  });

  return `${baseUrl}/?${params}`;
}

function topTenPreviewEmbed(emojiMap, prospect, index, total, draftClassFile, imageUrl = null) {
  const details = (items) => items.filter((item) => item != null && item !== "").join(" • ");
  const embed = new EmbedBuilder()
    .setTitle(`#${prospect.id_number || index + 1} ${prospect.name || "Prospect"}`)
    .setColor(0xffdc21)
    .setDescription([
      topTenPreviewHeader(emojiMap, prospect),
      details([prospect.position_1, prospect.class, prospect.age ? `${prospect.age} yrs` : null]),
      prospect.build,
    ].filter(Boolean).join("\n"));
  const size = details([prospect.height, prospect.weight ? `${prospect.weight} lbs` : null,
  (prospect.wingspan || prospect.wingspain) ? `${prospect.wingspan || prospect.wingspain} wingspan` : null]);
  if (size) embed.addFields({ name: "Size", value: size });
  const strengths = [prospect.strength_1, prospect.strength_2].filter(Boolean).join(" • ");
  const weaknesses = [prospect.weakness_1, prospect.weakness_2].filter(Boolean).join(" • ");
  if (strengths) embed.addFields({ name: "Strengths", value: strengths, inline: true });
  if (weaknesses) embed.addFields({ name: "To improve", value: weaknesses, inline: true });
  if (prospect.pro_comp) embed.addFields({ name: "Comparison", value: prospect.pro_comp });
  embed.setFooter({ text: `${draftClassLabel(draftClassFile || "")} • ${index + 1}/${total} • Grade ${fixedNumber(prospect["draft score"], 2)}` });
  if (imageUrl) embed.setThumbnail(imageUrl);
  const profileUrl = topTenPreviewProfileUrl(draftClassFile, prospect);
  if (profileUrl) embed.setURL(profileUrl);
  return embed;
}

function topTenPreviewActionRow(index, total, draftClassFile, prospect = {}) {
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`toptenpreview:first:${draftClassFile}`)
      .setLabel("First")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index === 0),
    new ButtonBuilder()
      .setCustomId(`toptenpreview:prev:${index}:${draftClassFile}`)
      .setLabel("Prev")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(index === 0),
    new ButtonBuilder()
      .setCustomId(`toptenpreview:next:${index}:${draftClassFile}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(index >= total - 1),
    new ButtonBuilder()
      .setCustomId(`toptenpreview:last:${draftClassFile}`)
      .setLabel("Last")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index >= total - 1),
  ];

  const profileUrl = topTenPreviewProfileUrl(draftClassFile, prospect);
  if (profileUrl) {
    buttons.push(
      new ButtonBuilder()
        .setLabel("Full Profile")
        .setStyle(ButtonStyle.Link)
        .setURL(profileUrl),
    );
  }

  return new ActionRowBuilder().addComponents(buttons);
}

async function handleTopTenPreview(interaction, index = 0, draftClassSelection = null) {
  const draftClassFile = resolveDraftClassFile(draftClassSelection || optionalStringOption(interaction, "draft_class"));
  const prospects = topTenPreviewProspects(draftClassFile);
  if (!prospects.length) {
    await interaction.editReply("No top ten prospects found.");
    return;
  }

  const currentIndex = Math.max(0, Math.min(prospects.length - 1, Number(index) || 0));
  const prospect = prospects[currentIndex];
  const emojiMap = await topTenPreviewEmojiMap(interaction);
  const image = topTenPreviewImage(prospect);
  const embed = topTenPreviewEmbed(emojiMap, prospect, currentIndex, prospects.length, draftClassFile, image.url);
  const components = [topTenPreviewActionRow(currentIndex, prospects.length, draftClassFile, prospect)];
  const payload = {
    embeds: [embed],
    components,
    files: image.attachment ? [image.attachment] : [],
    attachments: [],
  };

  if (interaction.isButton()) {
    await interaction.editReply(payload);
    return;
  }

  await interaction.editReply(payload);
}

async function handleTopTenPreviewCommand(interaction) {
  await handleTopTenPreview(interaction, 0);
}

async function handleTopTenPreviewButton(interaction) {
  const [, action, value, draftClassFile] = interaction.customId.split(":");
  await interaction.deferUpdate();

  const prospects = topTenPreviewProspects(draftClassFile);
  if (!prospects.length) {
    await interaction.editReply({ content: "No top ten prospects found.", embeds: [], components: [] });
    return;
  }

  let index = 0;
  if (action === "first") index = 0;
  else if (action === "last") index = prospects.length - 1;
  else if (action === "prev") index = Math.max(0, Number(value || 0) - 1);
  else if (action === "next") index = Math.min(prospects.length - 1, Number(value || 0) + 1);

  await handleTopTenPreview(interaction, index, draftClassFile);
}

function recruitingStars(player = {}) {
  const count = Math.max(0, Math.min(5, Number(player["star rating"] || 0)));
  return "⭐".repeat(count) || "N/A";
}

function recruitingBurger(player = {}) {
  return String(player.all_american || "").trim().toUpperCase() === "YES" ? " • 🍔" : "";
}

function recruitingSchoolEmoji(player = {}) {
  return String(player.emoji || "").trim();
}

function recruitingEntry(player = {}) {
  const rank = Number(player.national_rank || 0);
  const position = String(player.position || "N/A").trim();
  const posRank = Number(player.positional_rank || 0);
  const schoolEmoji = recruitingSchoolEmoji(player);
  const header = [`#${rank}`, player.name || "Prospect", schoolEmoji].filter(Boolean).join(" ");
  const detail = [
    position,
    posRank ? `Pos #${posRank}` : null,
    player.height || null,
    player.weight ? `${player.weight} lbs` : null,
    player.hometown || null,
    player.grade ? `${player.grade} grade` : null,
    recruitingStars(player),
  ].filter(Boolean).join(" • ");
  return `${header}\n${detail}${recruitingBurger(player)}`;
}

function recruitingEmbed(players, page, totalPages, draftClassFile) {
  const start = page * 10;
  const end = Math.min(start + 10, players.length);
  const rows = players.slice(start, end).map(recruitingEntry);

  return new EmbedBuilder()
    .setTitle(draftClassLabel(draftClassFile || "Recruiting"))
    .setColor(0x00ceb8)
    .setDescription(rows.join("\n\n") || "No recruiting prospects found.")
    .setFooter({ text: `Page ${page + 1}/${totalPages} • Players ${start + 1}-${end} of ${players.length}` });
}

function recruitingActionRow(page, totalPages, draftClassFile) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`recruiting:first:${draftClassFile}`)
      .setLabel("First")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`recruiting:prev:${page}:${draftClassFile}`)
      .setLabel("Prev")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`recruiting:next:${page}:${draftClassFile}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId(`recruiting:last:${draftClassFile}`)
      .setLabel("Last")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
}

async function handleRecruiting(interaction, page = 0, draftClassSelection = null) {
  const draftClassFile = resolveRecruitingClassFile(draftClassSelection || optionalStringOption(interaction, "draft_class"));
  const players = recruitingProspects(draftClassFile);
  if (!players.length) {
    const payload = { content: "No recruiting prospects found.", flags: MessageFlags.Ephemeral };
    if (interaction.isButton()) await interaction.reply(payload);
    else await interaction.editReply(payload);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(players.length / 10));
  const currentPage = Math.max(0, Math.min(totalPages - 1, Number(page) || 0));
  const payload = {
    embeds: [recruitingEmbed(players, currentPage, totalPages, draftClassFile)],
    components: [recruitingActionRow(currentPage, totalPages, draftClassFile)],
  };

  await interaction.editReply(payload);
}

async function handleRecruitingCommand(interaction) {
  await handleRecruiting(interaction, 0);
}

async function handleRecruitingButton(interaction) {
  const [, action, value, draftClassFile] = interaction.customId.split(":");
  await interaction.deferUpdate();

  const players = recruitingProspects(draftClassFile);
  if (!players.length) {
    await interaction.editReply({ content: "No recruiting prospects found.", embeds: [], components: [] });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(players.length / 10));
  let page = 0;
  if (action === "first") page = 0;
  else if (action === "last") page = totalPages - 1;
  else if (action === "prev") page = Math.max(0, Number(value || 0) - 1);
  else if (action === "next") page = Math.min(totalPages - 1, Number(value || 0) + 1);

  await handleRecruiting(interaction, page, draftClassFile);
}

function transferPortalEntry(player = {}) {
  const rank = Number(player.rank || 0);
  const position = String(player.position || "N/A").trim();
  const posRank = Number(player.pos_rank || 0);
  const header = [`#${rank}`, player.name || "Player"].filter(Boolean).join(" ");
  const detail = [
    position,
    posRank ? `Pos #${posRank}` : null,
    player.class || null,
    player.height || null,
    player.weight ? `${player.weight} lbs` : null,
  ].filter(Boolean).join(" • ");
  const move = [String(player.transfer_from || "").trim(), "→", String(player.transfer_to || "").trim()]
    .filter(Boolean)
    .join(" ");
  return `${header}\n${detail}\n${move}`;
}

function transferPortalEmbed(players, page, totalPages, draftClassFile) {
  const start = page * 10;
  const end = Math.min(start + 10, players.length);
  const rows = players.slice(start, end).map(transferPortalEntry);

  return new EmbedBuilder()
    .setTitle(draftClassLabel(draftClassFile || "Transfer Portal"))
    .setColor(0x00ceb8)
    .setDescription(rows.join("\n\n") || "No transfer portal players found.")
    .setFooter({ text: `Page ${page + 1}/${totalPages} • Players ${start + 1}-${end} of ${players.length}` });
}

function transferPortalActionRow(page, totalPages, draftClassFile) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`transferportal:first:${draftClassFile}`)
      .setLabel("First")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`transferportal:prev:${page}:${draftClassFile}`)
      .setLabel("Prev")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`transferportal:next:${page}:${draftClassFile}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId(`transferportal:last:${draftClassFile}`)
      .setLabel("Last")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
}

async function handleTransferPortal(interaction, page = 0, draftClassSelection = null) {
  const draftClassFile = resolveTransferPortalClassFile(draftClassSelection || optionalStringOption(interaction, "draft_class"));
  const players = transferPortalProspects(draftClassFile);
  if (!players.length) {
    const payload = { content: "No transfer portal players found.", flags: MessageFlags.Ephemeral };
    if (interaction.isButton()) await interaction.reply(payload);
    else await interaction.editReply(payload);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(players.length / 10));
  const currentPage = Math.max(0, Math.min(totalPages - 1, Number(page) || 0));
  const payload = {
    embeds: [transferPortalEmbed(players, currentPage, totalPages, draftClassFile)],
    components: [transferPortalActionRow(currentPage, totalPages, draftClassFile)],
  };

  await interaction.editReply(payload);
}

async function handleTransferPortalCommand(interaction) {
  await handleTransferPortal(interaction, 0);
}

async function handleTransferPortalButton(interaction) {
  const [, action, value, draftClassFile] = interaction.customId.split(":");
  await interaction.deferUpdate();

  const players = transferPortalProspects(draftClassFile);
  if (!players.length) {
    await interaction.editReply({ content: "No transfer portal players found.", embeds: [], components: [] });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(players.length / 10));
  let page = 0;
  if (action === "first") page = 0;
  else if (action === "last") page = totalPages - 1;
  else if (action === "prev") page = Math.max(0, Number(value || 0) - 1);
  else if (action === "next") page = Math.min(totalPages - 1, Number(value || 0) + 1);

  await handleTransferPortal(interaction, page, draftClassFile);
}

async function respondClassChoices(interaction, files) {
  try {
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = files
      .map((file) => ({
        name: draftClassLabel(file).slice(0, 100),
        value: file,
      }))
      .filter((choice) => !focused || choice.name.toLowerCase().includes(focused) || choice.value.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(choices);
  } catch (error) {
    console.error(error);
    await interaction.respond([]);
  }
}

async function handleDraftClassAutocomplete(interaction) {
  await respondClassChoices(interaction, topTenDraftClassFiles());
}

async function handleRecruitingClassAutocomplete(interaction) {
  await respondClassChoices(interaction, recruitingClassFiles());
}

async function handleTransferPortalClassAutocomplete(interaction) {
  await respondClassChoices(interaction, transferPortalClassFiles());
}

const handlers = {
  mockdraft: interaction => discordMocks.projection(interaction),
  bigboard: interaction => scoutingCommands.handleBigBoardCommand(interaction, scoutingService),
  tradeblock: interaction => discordTradeBlock.handleTradeBlockCommand(interaction),
  activitycheck: interaction => discordActivityCheck.start(interaction),
  week: interaction => require("./fantasyhq/discord-week").handleWeekCommand(interaction, weekAdvancement),
  standings: interaction => require("./fantasyhq/discord-standings").handleStandings(interaction),
  games: interaction => interaction.options.getSubcommand() === "cleanup" ? require("./fantasyhq/discord-game-cleanup").handleCleanupCommand(interaction, gameCleanup) : require("./fantasyhq/discord-game-threads").handleGameThreads(interaction, gameThreads, gameCleanup),
  game: gameSubmissions.setup,
  myteam: handleMyTeamCommand,
  freeagents: handleFreeAgentsCommand,
  admin: handleAdminCommand,
  league: handleLeagueCommand,
  player: handlePlayerCommand,
  ratings: handleRatingsCommand,
  recruiting: handleRecruitingCommand,
  roster: handleRosterCommand,
  schedule: handleScheduleCommand,
  scout: interaction => scoutingCommands.handleScoutCommand(interaction, scoutingService),
  stats: interaction => discordPlayerStats.handleStatsCommand(interaction),
  teamstats: interaction => discordTeamStats.handleTeamStatsCommand(interaction),
  upgrades: interaction => discordPlayerUpgrades.command(interaction),
  setup: handleSetupCommand,
  team: handleTeamCommand,
  teams: handleTeamsCommand,
  toptenpreview: handleTopTenPreviewCommand,
  transferportal: handleTransferPortalCommand,
};

const ownershipTimers = new Map();
function queueOwnershipSync(guild) {
  if (!guild) return;
  clearTimeout(ownershipTimers.get(guild.id));
  ownershipTimers.set(guild.id, setTimeout(async () => {
    ownershipTimers.delete(guild.id);
    const { createFantasyHQRepository } = require("./fantasyhq/repository");
    if (!createFantasyHQRepository().loadGuildLeagueBinding(guild.id)) return;
    try { await roleOwnership.sync(guild); }
    catch (error) { console.error(`Owner sync failed for ${guild.id}: ${error.message}. Check Server Members Intent; automatic sync will retry.`); }
  }, 1000));
}
client.on(Events.GuildMemberUpdate, (oldMember, member) => {
  roleOwnership.updateMember(member.guild.id, member);
  if (oldMember.displayName !== member.displayName || oldMember.roles.cache.size !== member.roles.cache.size || oldMember.roles.cache.some((role) => !member.roles.cache.has(role.id))) queueOwnershipSync(member.guild);
});
client.on(Events.UserUpdate, (_, user) => {
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(user.id);
    if (member) { roleOwnership.updateMember(guild.id, member); queueOwnershipSync(guild); }
  }
});
client.on(Events.GuildMemberAdd, (member) => { roleOwnership.updateMember(member.guild.id, member); queueOwnershipSync(member.guild); });
client.on(Events.GuildMemberRemove, (member) => { roleOwnership.updateMember(member.guild.id, member, true); queueOwnershipSync(member.guild); });
client.on(Events.GuildRoleDelete, (role) => queueOwnershipSync(role.guild));
client.on(Events.GuildRoleCreate, (role) => queueOwnershipSync(role.guild));
client.on(Events.GuildRoleUpdate, (_, role) => queueOwnershipSync(role.guild));
client.on(Events.ShardResume, (shardId) => {
  for (const guild of client.guilds.cache.values()) {
    if (guild.shardId !== shardId) continue;
    roleOwnership.invalidateMembers(guild.id);
    queueOwnershipSync(guild);
  }
});
client.on(Events.ShardDisconnect, (_, shardId) => {
  for (const guild of client.guilds.cache.values()) if (guild.shardId === shardId) roleOwnership.invalidateMembers(guild.id);
});
client.once(Events.ClientReady, async (readyClient) => {
  await require("./shared/team-emojis").loadTeamEmojis(readyClient);
  discordMocks.restore(readyClient).catch(error => console.error('Mock recovery:', error.message));
  let mockTickRunning = false;
  setInterval(async () => { if (mockTickRunning) return; mockTickRunning = true; try { await discordMocks.tick(readyClient); } catch (error) { console.error('Mock tick:', error.message); } finally { mockTickRunning = false; } }, 1000).unref();
  discordFreeAgency.tick().catch(error => console.error('Free Agency recovery:', error.message));
  setInterval(() => discordFreeAgency.tick().catch(error => console.error('Free Agency tick:', error.message)), 15000).unref();
  discordTrades.restore(readyClient).catch(error => console.error("Trade recovery:", error.message));
  try { require("./fantasyhq/box-score/learning").learnApprovedHistory(require("./fantasyhq/game-submissions").createGameSubmissionService()); }
  catch (error) { console.error("OCR learning recovery:", error.message); }
  const publicationSubmissions = require("./fantasyhq/game-submissions").createGameSubmissionService();
  const publicationRecords = publicationSubmissions.records();
  for (const guild of readyClient.guilds.cache.values()) {
    try { require("./fantasyhq/official-game").initializeStatsPublication(publicationSubmissions.repository, publicationRecords, guild.id); }
    catch (error) { console.error("Stats publication recovery:", error.message); }
  }
  const feedTick = () => discordLeagueFeeds.tick(readyClient).catch(error => console.error("League feeds:", error.message));
  feedTick(); setInterval(feedTick, 60000).unref();
  const tradeBlockTick = () => discordTradeBlock.tick(client).catch(error => console.error("Trade block:", error.message));
  tradeBlockTick(); setInterval(tradeBlockTick, 60000).unref();
  const activityCheckTick = () => discordActivityCheck.tick(client).catch(error => console.error("Activity check:", error.message));
  activityCheckTick(); setInterval(activityCheckTick, 60000).unref();
  const weeklyTick = () => discordWeeklyDashboard.tick(client).catch(error => console.error('Weekly dashboard:', error.message));
  weeklyTick(); setInterval(weeklyTick, 60000).unref();
  const activityTick = () => gameActivity.tick(client).catch(error => console.error("Game activity:", error.message));
  activityTick(); setInterval(activityTick, 60000).unref();
  for (const guild of readyClient.guilds.cache.values()) queueOwnershipSync(guild);
  setInterval(() => { for (const guild of client.guilds.cache.values()) queueOwnershipSync(guild); }, 300000).unref();
  let upgradeSweepRunning = false;
  const upgradeSweep = async () => {
    if (upgradeSweepRunning) return;
    upgradeSweepRunning = true;
    try { await discordPlayerUpgrades.restore(readyClient); }
    catch (error) { console.error("Player upgrade recovery:", error.message); }
    finally { upgradeSweepRunning = false; }
  };
  upgradeSweep();
  setInterval(upgradeSweep, 60000).unref();
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Gateway role events can arrive after a button click. Reconcile that actor
  // before any team workflow reads owners; unchanged assignments do no API work.
  if (interaction.guild && !interaction.isAutocomplete()) {
    try { await roleOwnership.refreshActor(interaction.guild, interaction.member); }
    catch (error) {
      await interaction.reply({ content: `Could not verify your current team roles. ${error.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
  }

  if (interaction.isButton() && interaction.customId.startsWith('freeagents:page:')) {
    try { await require('./fantasyhq/discord-preseason').handleFreeAgentsButton(interaction); }
    catch (error) { await interaction.followUp({ content: error.message, flags: MessageFlags.Ephemeral }).catch(() => {}); }
    return;
  }
  if((interaction.isButton()||interaction.isStringSelectMenu()||interaction.isModalSubmit())&&interaction.customId.startsWith('reset:')){await require('./fantasyhq/discord-league-resets').createDiscordLeagueResets({repository:tradeRepository}).handle(interaction);return;}
  if((interaction.isButton()||interaction.isStringSelectMenu()||interaction.isModalSubmit())&&interaction.customId.startsWith('sim:')){await require('./fantasyhq/discord-simulation').createDiscordSimulation({repository:tradeRepository}).handle(interaction);return;}
  if((interaction.isButton()||interaction.isStringSelectMenu()||interaction.isModalSubmit())&&interaction.customId.startsWith('awards:')){await require('./fantasyhq/discord-awards').createDiscordAwards({repository:tradeRepository,submissions:gameRecordStore}).handle(interaction);return;}
  if(interaction.isButton()&&interaction.customId.startsWith('poststats:')){await require('./fantasyhq/discord-postseason-stats').createDiscordPostseasonStats({repository:tradeRepository}).handle(interaction);return;}
  if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith('post:')) {await discordPostseason.handle(interaction);return;}
  if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith('fa:')) { await discordFreeAgency.handle(interaction); return; }
  if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith("upgrades:")) {
    if (interaction.isModalSubmit()) await discordPlayerUpgrades.handleModal(interaction);
    else await discordPlayerUpgrades.handle(interaction);
    return;
  }
  if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith('mock:')) { await discordMocks.handle(interaction); return; }
  if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith("trade:")) { await discordTrades.handleTradeInteraction(interaction); return; }
  if (interaction.isButton() && /^(cleanupconfirm|cleanupcancel):/.test(interaction.customId)) { await require("./fantasyhq/discord-game-cleanup").handleCleanupButton(interaction, gameCleanup); return; }
  if (interaction.isButton() && interaction.customId.startsWith("gamerecreate:")) { await require("./fantasyhq/discord-game-threads").handleGameThreadsButton(interaction, gameThreads, gameCleanup); return; }
  if (interaction.isButton() && interaction.customId.startsWith("bigboard:")) { await scoutingCommands.handleBigBoardButton(interaction, scoutingService); return; }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("bigboard:select:")) { await scoutingCommands.handleBigBoardSelect(interaction, scoutingService); return; }
  if (interaction.isButton() && /^(myweek|weeklystaff):/.test(interaction.customId)) { await discordWeeklyDashboard.button(interaction); return; }
  if ((interaction.isButton() || interaction.isModalSubmit()) && /^(weekconfirm|weekcancel|playoffconfirm|playoffcancel|playoffedit|playoffsave):/.test(interaction.customId)) { await require("./fantasyhq/discord-week").handleWeekButton(interaction, weekAdvancement, null, discordPostseason); return; }
  if ((interaction.isButton() || interaction.isModalSubmit()) && /^(gamedate|gamedatesave):/.test(interaction.customId)) { await require("./fantasyhq/game-date").createGameDateHandler(require("./fantasyhq/game-submissions").createGameSubmissionService())(interaction); return; }
  if (interaction.isButton() && interaction.customId.startsWith('gamedecision:')) { await require('./fantasyhq/game-decisions').createGameDecisionService(require('./fantasyhq/game-submissions').createGameSubmissionService()).handle(interaction); return; }
  if (interaction.isButton() && /^(gamesubmit|gametest|gamestaff|gametools|gamecancel|gameextract):/.test(interaction.customId)) {
    try { await gameSubmissions.button(interaction); await gameActivity.button(interaction); }
    catch (error) { console.error("Game submission interaction:", error.message); }
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith("league-delete:")) {
    try { await handleDeleteLeagueButton(interaction); }
    catch (error) {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content: error.message, components: [] });
      else await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
    }
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith("setupflow:")) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (interaction.customId.startsWith('setupflow:week:')) {
        const context = tradeRepository.loadLeagueContext({ guildId: interaction.guildId });
        if (interaction.customId !== `setupflow:week:${context.league.leagueId}`) throw Error('The active league changed. Open /league setup again.');
        await require('./fantasyhq/discord-week').handleWeekPreview(interaction, weekAdvancement);
      } else await handleSetupFlowButton(interaction);
    } catch (error) {
      if (interaction.deferred || interaction.replied) await interaction.editReply(error.message);
      else await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
    }
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith("schedule:preview:")) {
    try {
      await handleScheduleButton(interaction);
    } catch (error) {
      console.error(error);
      const message = `Error: ${error.message}`;
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
      else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("toptenpreview:")) {
    try {
      await handleTopTenPreviewButton(interaction);
    } catch (error) {
      console.error(error);
      const message = `Error: ${error.message}`;
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
      else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("recruiting:")) {
    try {
      await handleRecruitingButton(interaction);
    } catch (error) {
      console.error(error);
      const message = `Error: ${error.message}`;
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
      else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("transferportal:")) {
    try {
      await handleTransferPortalButton(interaction);
    } catch (error) {
      console.error(error);
      const message = `Error: ${error.message}`;
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
      else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (interaction.isAutocomplete()) {
    if (interaction.commandName === "tradeblock") await discordTradeBlock.handleTradeBlockAutocomplete(interaction);
    else if (interaction.commandName === "scout") await scoutingCommands.handleScoutingAutocomplete(interaction, scoutingService);
    else if (interaction.commandName === "stats") await discordPlayerStats.handleStatsAutocomplete(interaction);
    else if (interaction.commandName === "teamstats") await discordTeamStats.handleTeamStatsAutocomplete(interaction);
    else if (interaction.commandName === "toptenpreview") await handleDraftClassAutocomplete(interaction);
    else if (interaction.commandName === "player") await handlePreseasonAutocomplete(interaction);
    else if (interaction.commandName === "recruiting") await handleRecruitingClassAutocomplete(interaction);
    else if (interaction.commandName === "ratings") await handleRatingsAutocomplete(interaction);
    else if (interaction.commandName === "schedule") await handleScheduleAutocomplete(interaction);
    else if (interaction.commandName === "team") await handleSetupAutocomplete(interaction);
    else if (interaction.commandName === "transferportal") await handleTransferPortalClassAutocomplete(interaction);
    else await interaction.respond([]);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const handler = handlers[interaction.commandName];
  if (!handler) return;

  try {
    const privateReply = interaction.commandName === "mockdraft" || interaction.commandName === "bigboard" || interaction.commandName === "scout" || interaction.commandName === "upgrades" || (interaction.commandName === "league" && interaction.options.getSubcommand() === "delete") || (interaction.commandName === "games" && interaction.options.getSubcommand() === "create");
    await interaction.deferReply({ flags: privateReply ? MessageFlags.Ephemeral : 0 });
    await handler(interaction);
  } catch (error) {
    await require("./shared/discord-interaction-error").replyInteractionError(interaction, error);
  }
});

startWebsite();
client.login(config.discordToken);
