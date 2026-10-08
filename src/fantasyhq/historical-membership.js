// Transfers keep one season membership and append ownershipHistory. Resolve the
// represented team at game time instead of comparing against today's owner.
function representedAt(membership, {playerId, teamId, seasonId, at}) {
 if (membership.playerId !== playerId || String(membership.seasonId) !== String(seasonId)) return false;
 const time = Date.parse(at);
 if (!Number.isFinite(time)) return false;
 const start = membership.startedAt || membership.importedAt;
 if (start && (!Number.isFinite(Date.parse(start)) || Date.parse(start) > time)) return false;
 if (membership.endedAt) {
  if (!Number.isFinite(Date.parse(membership.endedAt)) || Date.parse(membership.endedAt) < time) return false;
 } else if (membership.active === false) return false;
 const history = membership.ownershipHistory || [];
 if (!history.length) return membership.teamId === teamId;
 const ordered = history.map((entry, index) => ({...entry, index, time: entry.timestamp ? Date.parse(entry.timestamp) : -Infinity}))
  .sort((a, b) => a.time - b.time || a.index - b.index);
 if (ordered.some(entry => Number.isNaN(entry.time))) return false;
 const effective = ordered.filter(entry => entry.time <= time).at(-1);
 return !!effective && effective.teamId === teamId;
}
module.exports = {representedAt};
