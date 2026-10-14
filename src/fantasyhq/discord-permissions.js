const { PermissionFlagsBits } = require("discord.js");
const STAFF_ROLES = new Set(["LEAGUEbuddy Commish", "LEAGUEbuddy Assistant Commish", "LEAGUEbuddy League Administrator"]);
function canManageLeague(interaction) {
  if (!interaction.guildId) return false;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const roles = interaction.member?.roles;
  if (roles?.cache) return roles.cache.some((role) => STAFF_ROLES.has(role.name));
  return Array.isArray(roles) && roles.some((id) => STAFF_ROLES.has(interaction.guild?.roles.cache.get(id)?.name));
}
function requireLeagueStaff(interaction) {
  if (!canManageLeague(interaction)) throw new Error("You need LEAGUEbuddy Commish, LEAGUEbuddy Assistant Commish, LEAGUEbuddy League Administrator, or Manage Server to manage this league.");
}
module.exports = { canManageLeague, requireLeagueStaff, STAFF_ROLES };
