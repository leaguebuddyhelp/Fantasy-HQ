const test = require("node:test");
const assert = require("node:assert/strict");
const { replyInteractionError } = require("../src/shared/discord-interaction-error");

test("expired or already-acknowledged interactions cannot crash the client error handler", async () => {
    const logged = [], logger = { error: (...values) => logged.push(values) };
    for (const code of [10062, 40060]) {
        const interaction = { deferred: false, replied: false, reply: async () => { throw Object.assign(new Error("expired"), { code }); } };
        await assert.doesNotReject(replyInteractionError(interaction, new Error("handler failed"), logger));
    }
    assert.equal(logged.length, 2);
});

test("active interactions receive the original failure message", async () => {
    let payload;
    const interaction = { deferred: false, replied: false, reply: async value => { payload = value; } };
    await replyInteractionError(interaction, new Error("invalid action"), { error() { } });
    assert.equal(payload.content, "Error: invalid action");
});