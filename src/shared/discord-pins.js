// discord.js 14.26 fetchPins returns paginated { items, hasMore } rather than a Collection.
async function fetchPinnedMessages(channel) {
    const messages = [], seen = new Set();
    let before;
    while (true) {
        const page = await channel.messages.fetchPins(before == null ? {} : { before });
        if (!Array.isArray(page.items)) return [...page.values()];
        for (const { message } of page.items) {
            if (!seen.has(message.id)) { messages.push(message); seen.add(message.id); }
        }
        if (!page.hasMore) return messages;
        const last = page.items.at(-1), next = last?.pinnedTimestamp ?? last?.pinnedAt?.getTime();
        if (!Number.isFinite(next) || before != null && next >= before) throw Error('Discord returned an invalid pinned-message pagination cursor.');
        before = next;
    }
}
module.exports = { fetchPinnedMessages };
