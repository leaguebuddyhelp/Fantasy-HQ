// Team roles identify the team; the shared Coach/GM roles only grant access.
function memberHasRole(member, roleId) {
  if (!roleId) return false;
  const roles = member?.roles;
  return roles?.cache ? roles.cache.has(roleId) : Array.isArray(roles) && roles.includes(roleId);
}
function memberTeamIds(repository, context, member) {
  const ownership = repository.loadRoleOwnership(context.league.leagueId);
  return context.teams.filter(team => memberHasRole(member, ownership.roleIds?.[team.teamId])).map(team => team.teamId);
}
function requireCoachIdentity(repository, context, member, userId) {
  if (member?.user?.bot) throw Error('Only a human coach can manage a team.');
  const held = memberTeamIds(repository, context, member);
  if (held.length !== 1) throw Error(held.length ? 'You hold multiple team roles. Ask Staff to resolve the ownership conflict.' : 'Your team Coach role is not configured. Ask Staff to repair league roles.');
  const owners = repository.loadOwners(context.league.leagueId);
  const own = owners.filter(owner => owner.userId === String(userId));
  const teamOwners = owners.filter(owner => owner.teamId === held[0]);
  if (own.length !== 1 || own[0].teamId !== held[0] || teamOwners.length !== 1 || teamOwners[0].userId !== String(userId)) throw Error('Your team Coach role and current owner assignment must match. Ask Staff to sync league roles.');
  return { teamId: held[0], coachUserId: String(userId), team: context.teams.find(team => team.teamId === held[0]) };
}
module.exports = { memberHasRole, memberTeamIds, requireCoachIdentity };
