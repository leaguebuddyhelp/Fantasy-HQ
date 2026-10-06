const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchPinnedMessages } = require('../src/shared/discord-pins');
test('current Discord pin responses paginate and deduplicate message IDs', async () => {
    const calls = [], a = { id: 'a' }, b = { id: 'b' };
    const channel = { messages: { fetchPins: async options => { calls.push(options); return calls.length === 1 ? { items: [{ message: a, pinnedTimestamp: 1000 }], hasMore: true } : { items: [{ message: a, pinnedTimestamp: 1000 }, { message: b, pinnedTimestamp: 500 }], hasMore: false }; } } };
    assert.deepEqual(await fetchPinnedMessages(channel), [a, b]); assert.deepEqual(calls, [{}, { before: 1000 }]);
});
test('legacy pin Collections and empty current responses remain supported', async () => {
    const message = { id: 'a' };
    assert.deepEqual(await fetchPinnedMessages({ messages: { fetchPins: async () => new Map([['a', message]]) } }), [message]);
    assert.deepEqual(await fetchPinnedMessages({ messages: { fetchPins: async () => ({ items: [], hasMore: false }) } }), []);
});
test('malformed pagination stops instead of endlessly fetching pins', async () => {
    await assert.rejects(fetchPinnedMessages({ messages: { fetchPins: async () => ({ items: [{ message: { id: 'a' }, pinnedTimestamp: 1000 }], hasMore: true }) } }), /invalid.*pagination/);
});
