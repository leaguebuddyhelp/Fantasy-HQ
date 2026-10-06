const { teamBrand, logoPath } = require("../shared/team-branding");
const { PermissionFlagsBits } = require("discord.js");
const { TEAM_METADATA } = require("./bootstrap");

const ROLE_NAMES = [
  "LEAGUEbuddy Coach",
  "LEAGUEbuddy GM",
  "LEAGUEbuddy Trade Committee",
  "LEAGUEbuddy Commish",
  "LEAGUEbuddy Assistant Commish",
  ...Object.keys(TEAM_METADATA).map((slug) => slug.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ")),
];
const pending = new Map();

async function createMissingRoles(guild) {
  const member = guild.members.me || await guild.members.fetchMe();
  if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("Give the bot Manage Roles permission, then run /league roles to create the league roles.");
  }
  const roles = await guild.roles.fetch();
  const existing = new Set([...roles.values()].filter((role) => !role.managed && role.id !== guild.id)
    .map((role) => role.name.trim().toLowerCase()));
  let created = 0;
  let iconsUpdated = 0;
  const iconsSupported = Boolean(guild.features?.includes("ROLE_ICONS"));
  const warnings = [];
  for (const name of ROLE_NAMES) {
    const brand = teamBrand(name);
    const icon = iconsSupported && brand ? logoPath(brand) : undefined;
    if (existing.has(name.toLowerCase())) {
      const role = [...roles.values()].find((entry) => !entry.managed && entry.name.trim().toLowerCase() === name.toLowerCase());
      if (icon) {
        if (!role.editable) warnings.push(`${name}: move the bot role above this role to set its icon.`);
        else {
          try { await role.setIcon(icon, "LEAGUEbuddy team logo"); iconsUpdated += 1; }
          catch { warnings.push(`${name}: icon update failed; retry /league roles.`); }
        }
      }
      continue;
    }
    try {
      await guild.roles.create({ name, ...(icon ? { icon } : {}), permissions: [], mentionable: false, reason: "LEAGUEbuddy league setup" });
      existing.add(name.toLowerCase());
      created += 1;
    } catch {
      throw new Error(`Created ${created} roles before role creation stopped at ${name}. Check the bot's Manage Roles permission and server role limit, then retry /league roles. Existing roles will be reused.`);
    }
  }
  return { created, reused: ROLE_NAMES.length - created, total: ROLE_NAMES.length, iconsSupported, iconsUpdated, warnings };
}

async function ensureLeagueRoles(guild) {
  if (!guild) throw new Error("Run this command inside your Discord server.");
  if (pending.has(guild.id)) return pending.get(guild.id);
  const task = createMissingRoles(guild);
  pending.set(guild.id, task);
  try { return await task; } finally { pending.delete(guild.id); }
}

module.exports = { ensureLeagueRoles, ROLE_NAMES };
