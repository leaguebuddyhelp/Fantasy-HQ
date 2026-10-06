const fs = require("fs");
const path = require("path");
const { createFantasyHQRepository } = require("./repository");

const { createMemberSnapshots } = require("./member-snapshot");

function createRoleOwnershipService(repository = createFantasyHQRepository(), options = {}) {
  const memberSnapshots = options.memberSnapshots || createMemberSnapshots();
  const queues = new Map();
  function serial(guild, action) {
    const next = (queues.get(guild.id) || Promise.resolve()).catch(() => {}).then(action);
    queues.set(guild.id, next);
    return next.finally(() => { if (queues.get(guild.id) === next) queues.delete(guild.id); });
  }
  function stateFile(context) { return path.join(context.paths.leagueRoot, "role-ownership.json"); }
  function readState(context) {
    try { return JSON.parse(fs.readFileSync(stateFile(context), "utf8")); } catch { return { roleIds: {}, conflicts: [] }; }
  }
  async function snapshot(guild) {
    const context = repository.loadLeagueContext({ guildId: guild.id });
    const roles = await guild.roles.fetch();
    // Never infer missing owners from a partial member cache.
    const members = await memberSnapshots.get(guild);
    const state = readState(context);
    if (state.guildId && state.guildId !== guild.id) throw new Error("This league's team roles belong to another Discord server.");
    state.roleIds ||= {};
    const conflicts = [];
    for (const team of context.teams) {
      if (state.roleIds[team.teamId] && roles.has(state.roleIds[team.teamId])) continue;
      const matches = [...roles.values()].filter((role) => !role.managed && role.name.toLowerCase() === team.teamName.toLowerCase());
      if (matches.length > 1) conflicts.push(`${team.teamName} has duplicate Discord roles. Keep one team role, then sync again.`);
      state.roleIds[team.teamId] = matches.length === 1 ? matches[0].id : null;
    }
    return { context, roles, members, state, conflicts };
  }
  async function reconcile(guild) {
    const { context, roles, members, state, conflicts } = await snapshot(guild);
    if (!context.teams.length) return { owners: 0, conflicts: [], warnings: ["Import team rosters before syncing owners."] };
    const candidates = [];
    const coachIds = new Set();
    const counts = new Map();
    for (const team of context.teams) {
      const holders = [...members.values()].filter((member) => !member.user.bot && member.roles.cache.has(state.roleIds[team.teamId]));
      holders.forEach((member) => { coachIds.add(member.id); counts.set(member.id, (counts.get(member.id) || 0) + 1); });
      if (holders.length > 1) conflicts.push(`${team.teamName} has ${holders.length} members with its team role. Choose one owner.`);
      if (holders.length === 1) candidates.push({ teamId: team.teamId, userId: holders[0].id });
    }
    const owners = candidates.filter((entry) => {
      if (counts.get(entry.userId) === 1) return true;
      conflicts.push(`${entry.teamId}: owner ${entry.userId} holds multiple team roles. Choose one team per owner.`);
      return false;
    });
    const previous = repository.loadOwners(context.league.leagueId);
    const now = new Date().toISOString();
    const records = owners.map((entry) => {
      const existing = previous.find((old) => old.teamId === entry.teamId && old.userId === entry.userId);
      const member = members.get(entry.userId);
      return {
        ...(existing || { ...entry, leagueId: context.league.leagueId, assignedAt: now, assignedByUserId: "discord-roles", updatedAt: now }),
        displayName: member?.displayName || member?.user.globalName || member?.user.username || existing?.displayName || null,
        username: member?.user.username || existing?.username || null,
      };
    });
    const changed = JSON.stringify(previous.map(({teamId,userId}) => ({teamId,userId})).sort((a,b)=>a.teamId.localeCompare(b.teamId))) !== JSON.stringify(owners.sort((a,b)=>a.teamId.localeCompare(b.teamId)));
    repository.saveOwners(context.league.leagueId, records);
    repository.saveTeams(context.league.leagueId, context.teams.map((team) => ({ ...team, assignedUserId: owners.find((entry) => entry.teamId === team.teamId)?.userId || null })));
    if (changed) repository.appendAuditLog(context.league.leagueId, { action: "owners.roles.synced", userId: "discord-roles", timestamp: now, metadata: { owners, conflicts } });
    const warnings = [];
    const coach = [...roles.values()].find((role) => role.name === "LEAGUEbuddy Coach" && !role.managed);
    if (!coach) warnings.push("Run /league roles to create the Coach role.");
    else {
      for (const member of members.values()) {
        if (member.user.bot) continue;
        const wanted = coachIds.has(member.id);
        if (wanted === member.roles.cache.has(coach.id)) continue;
        try {
          const updated = wanted ? await member.roles.add(coach.id, "Team role ownership") : await member.roles.remove(coach.id, "No team role held");
          if (updated?.id) memberSnapshots.update(guild.id, updated);
        } catch { warnings.push(`Could not update Coach role for ${member.id}. Check Manage Roles and role hierarchy.`); }
      }
    }
    fs.writeFileSync(stateFile(context), JSON.stringify({ ...state, guildId: guild.id, conflicts, warnings, syncedAt: now }, null, 2));
    const { STAFF_ROLES } = require('./discord-permissions');
    const staffRoleIds = new Set([...roles.values()].filter(role => STAFF_ROLES.has(role.name)).map(role => role.id));
    const staffUserIds = [...members.values()].filter(member => !member.user.bot && [...staffRoleIds].some(id => member.roles.cache.has(id))).map(member => member.id);
    return { owners: records.length, conflicts, warnings, staffUserIds, teamRoleIds: {...state.roleIds}, teamMemberIds: Object.fromEntries(context.teams.map(team => [team.teamId, [...members.values()].filter(member => !member.user.bot && member.roles.cache.has(state.roleIds[team.teamId])).map(member => member.id)])) };
  }
  function sync(guild) { return serial(guild, () => reconcile(guild)); }
  function setOwner(guild, teamId, userId) {
    return serial(guild, async () => {
      const { context, members, roles, state } = await snapshot(guild);
      const team = context.teams.find((entry) => entry.teamId === teamId);
      if (!team) throw new Error("Unknown team.");
      const role = roles.get(state.roleIds[teamId]);
      if (!role) throw new Error("Team role missing or ambiguous. Run /league roles and resolve duplicate roles first.");
      if (!role.editable) throw new Error("Give the bot Manage Roles and place its role above the team role.");
      const target = userId ? members.get(userId) : null;
      if (userId && (!target || target.user.bot)) throw new Error("Choose a human member of this server.");
      if (target && context.teams.some((entry) => entry.teamId !== teamId && target.roles.cache.has(state.roleIds[entry.teamId]))) throw new Error("That member already has another team role. Unassign that team first.");
      // Add before removing the old owner, so an add failure leaves the old assignment intact.
      try {
        if (target && !target.roles.cache.has(role.id)) {
          const updated = await target.roles.add(role.id, "League team assignment");
          if (updated?.id) memberSnapshots.update(guild.id, updated);
        }
        for (const member of members.values()) {
          if (member.id !== userId && !member.user.bot && member.roles.cache.has(role.id)) {
            const updated = await member.roles.remove(role.id, "League team reassignment");
            if (updated?.id) memberSnapshots.update(guild.id, updated);
          }
        }
      } catch (error) {
        await reconcile(guild);
        throw new Error(`Role update did not finish. Ownership was refreshed from Discord; resolve any role conflicts and retry. ${error.message}`);
      }
      return reconcile(guild);
    });
  }
  return { sync, setOwner, runExclusive: serial, updateMember: memberSnapshots.update, invalidateMembers: memberSnapshots.invalidate };
}
const roleOwnership = createRoleOwnershipService();
module.exports = { createRoleOwnershipService, roleOwnership };
