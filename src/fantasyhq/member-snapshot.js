// Only a successful full fetch establishes a complete member list. Gateway
// events and role API responses then keep that list current between refreshes.
function createMemberSnapshots({ now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), ttl = 300000 } = {}) {
  const states = new Map();
  function stateFor(id) {
    if (!states.has(id)) states.set(id, { members: null, fetchedAt: 0, retryAt: 0, pending: null, changes: new Map() });
    return states.get(id);
  }
  function update(guildId, member, removed = false) {
    const state = stateFor(guildId);
    if (state.pending) state.changes.set(member.id, removed ? null : member);
    if (state.members) {
      if (removed) state.members.delete(member.id);
      else state.members.set(member.id, member);
    }
  }
  async function waitUntil(time) {
    while (now() < time) await sleep(Math.min(60000, time - now()));
  }
  async function get(guild) {
    const state = stateFor(guild.id);
    if (state.pending) return state.pending;
    if (state.members && now() - state.fetchedAt < ttl) return state.members;
    state.pending = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await waitUntil(state.retryAt);
        try {
          const fetched = await guild.members.fetch();
          const members = new Map(fetched);
          for (const [id, member] of state.changes) {
            if (member) members.set(id, member);
            else members.delete(id);
          }
          state.members = members;
          state.fetchedAt = now();
          state.retryAt = 0;
          return members;
        } catch (error) {
          const seconds = Number(error.data?.retry_after);
          if (error.data?.opcode !== 8 || !Number.isFinite(seconds) || seconds < 0) throw error;
          state.retryAt = now() + Math.ceil(seconds * 1000) + 1000;
          if (attempt === 2) throw new Error("Discord is temporarily limiting member refreshes. Ownership has not been changed; automatic sync will retry shortly.");
        }
      }
    })();
    try { return await state.pending; }
    finally { state.pending = null; state.changes.clear(); }
  }
  function invalidate(guildId) { stateFor(guildId).fetchedAt = -Infinity; }
  return { get, update, invalidate };
}
module.exports = { createMemberSnapshots };
