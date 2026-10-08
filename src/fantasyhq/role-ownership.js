const { STAFF_ROLES } = require('./discord-permissions');
const fs = require("fs");
const path = require("path");
const { createFantasyHQRepository } = require("./repository");

const { createMemberSnapshots } = require("./member-snapshot");

function createRoleOwnershipService(repository = createFantasyHQRepository(), options = {}) {
  const memberSnapshots = options.memberSnapshots || createMemberSnapshots();
  const queues = new Map();
  let ownerChangeHandler = options.onOwnersChanged || null;
  function serial(guild, action) {
    const next = (queues.get(guild.id) || Promise.resolve()).catch(() => { }).then(action);
    queues.set(guild.id, next);
    return next.finally(() => { if (queues.get(guild.id) === next) queues.delete(guild.id); });
  }
  function stateFile(context) { return path.join(context.paths.leagueRoot, "role-ownership.json"); }
  function readState(context) {
    try { const state=JSON.parse(fs.readFileSync(stateFile(context), 'utf8')); if(!state || typeof state !== 'object' || Array.isArray(state))throw Error('Invalid role ownership schema.'); return state; } catch(error) { if(error.code==='ENOENT')return {roleIds:{},conflicts:[]}; throw Error('Role ownership storage is unreadable. Restore or repair it before syncing Discord roles.'); }
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
    const changed = JSON.stringify(previous.map(({ teamId, userId }) => ({ teamId, userId })).sort((a, b) => a.teamId.localeCompare(b.teamId))) !== JSON.stringify(owners.sort((a, b) => a.teamId.localeCompare(b.teamId)));
    repository.saveOwners(context.league.leagueId, records);
    repository.saveTeams(context.league.leagueId, context.teams.map((team) => ({ ...team, assignedUserId: owners.find((entry) => entry.teamId === team.teamId)?.userId || null })));
    if (changed) repository.appendAuditLog(context.league.leagueId, { action: "owners.roles.synced", userId: "discord-roles", timestamp: now, metadata: { owners, conflicts } });
    const staffRoleIds = new Set([...roles.values()].filter(role => STAFF_ROLES.has(role.name)).map(role => role.id));
    const staffUserIds = [...members.values()].filter(member => !member.user.bot && [...staffRoleIds].some(id => member.roles.cache.has(id))).map(member => member.id);
    const warnings = [];
    if (ownerChangeHandler) {
      const upgradeState = repository.loadPlayerUpgradeState(context.league.leagueId);
      if (changed || !upgradeState?.ownershipInitialized || state.ownerWorkflowSignature !== JSON.stringify(records.map(({teamId,userId})=>({teamId,userId})).sort((a,b)=>a.teamId.localeCompare(b.teamId)))) {
        try {
          await ownerChangeHandler({ leagueId: context.league.leagueId, seasonId: context.seasonId, phase: context.league.currentPhase, previousOwners: previous, owners: records, staffUserIds, staffRoleIds: [...staffRoleIds] });
          state.ownerWorkflowSignature = JSON.stringify(records.map(({teamId,userId})=>({teamId,userId})).sort((a,b)=>a.teamId.localeCompare(b.teamId)));
        } catch (error) {
          warnings.push(`Coach ownership workflows need attention: ${error.message}`);
        }
      }
    }
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
    repository.saveRoleOwnership(context.league.leagueId, { ...state, guildId: guild.id, conflicts, warnings, syncedAt: now });

    return { owners: records.length, conflicts, warnings, staffUserIds, staffRoleIds: [...staffRoleIds], teamRoleIds: { ...state.roleIds }, teamMemberIds: Object.fromEntries(context.teams.map(team => [team.teamId, [...members.values()].filter(member => !member.user.bot && member.roles.cache.has(state.roleIds[team.teamId])).map(member => member.id)])) };
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
  async function refreshActor(guild, member) {
    if (!guild || !member?.id || member.user?.bot || !repository.loadGuildLeagueBinding(guild.id)) return;
    memberSnapshots.update(guild.id, member);
    const context = repository.loadLeagueContext({ guildId: guild.id });
    const state = readState(context);
    const { memberTeamIds } = require('./coach-identity');
    const held = memberTeamIds(repository, context, member).sort();
    const assigned = repository.loadOwners(context.league.leagueId).filter(owner => owner.userId === member.id).map(owner => owner.teamId).sort();
    const mappingsMissing = context.teams.some(team => !Object.hasOwn(state.roleIds || {}, team.teamId));
    if (mappingsMissing || JSON.stringify(held) !== JSON.stringify(assigned)) await sync(guild);
  }
  function setOwnerChangeHandler(handler) { ownerChangeHandler = typeof handler === "function" ? handler : null; }
  return { sync, refreshActor, setOwner, setOwnerChangeHandler, runExclusive: serial, updateMember: memberSnapshots.update, invalidateMembers: memberSnapshots.invalidate };
}
const roleOwnership = createRoleOwnershipService();
module.exports = { createRoleOwnershipService, roleOwnership };
