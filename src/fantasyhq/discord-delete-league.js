const { randomUUID } = require("crypto");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { requireLeagueStaff } = require("./discord-permissions");
const { createFantasyHQRepository } = require("./repository");
const { inspectDeletion, deleteBoundLeague } = require("./delete-league");
const { roleOwnership } = require("./role-ownership");
const repository = createFantasyHQRepository();
const confirmations = new Map();

async function handleDeleteLeague(interaction) {
  requireLeagueStaff(interaction);
  const league = inspectDeletion(repository, interaction.guildId);
  for (const [id, pending] of confirmations) if (pending.expires < Date.now()) confirmations.delete(id);
  const token = randomUUID();
  confirmations.set(token, { ...league, guildId: interaction.guildId, userId: interaction.user.id, expires: Date.now() + 120000 });
  await interaction.editReply({ content: `Delete **${league.name}** (\`${league.leagueId}\`)?\nThis permanently deletes its ${league.teams} teams, ${league.players} players, owners, settings, schedules, audit log, and all ${league.gameDirectories.length} saved game archives across every season (screenshots, box scores, stats, and submission history), and disconnects it from this server.\nDiscord channels, threads, roles and assignments, shared source ratings, logos, and draft classes are kept.\nConfirm within two minutes.`, components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`league-delete:confirm:${token}`).setLabel("Delete league permanently").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`league-delete:cancel:${token}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  )] });
}
async function handleDeleteLeagueButton(interaction) {
  requireLeagueStaff(interaction);
  const [, action, token] = interaction.customId.split(":");
  const pending = confirmations.get(token);
  if (!pending || pending.expires < Date.now()) throw new Error("Confirmation expired. Run /league delete again.");
  if (pending.guildId !== interaction.guildId || pending.userId !== interaction.user.id) throw new Error("Only the person who requested deletion can confirm it.");
  if (!["cancel", "confirm"].includes(action)) throw new Error("Invalid deletion action.");
  confirmations.delete(token);
  await interaction.deferUpdate();
  if (action === "cancel") return interaction.editReply({ content: "Deletion cancelled. Your league is unchanged.", components: [] });
  const result = await roleOwnership.runExclusive(interaction.guild, () => deleteBoundLeague(repository, interaction.guildId, pending));
  await interaction.editReply({ content: `${result.cleanupPending ? `Disconnected **${result.name}**; storage cleanup is incomplete.` : `Deleted **${result.name}**, including its league data and saved game archives, and disconnected this server.`} Start fresh with /league create, then /roster import. Existing team roles will still determine owners.${result.cleanupPending ? " Some detached files could not be removed; check server storage permissions." : ""}`, components: [] });
}
module.exports = { handleDeleteLeague, handleDeleteLeagueButton };
