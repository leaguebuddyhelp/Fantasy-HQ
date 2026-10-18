const { Worker } = require('worker_threads');
const path = require('path');
const { commandReplyFlags } = require('./discord-privacy');

function createFastTradeAcknowledgment({ workerFactory = () => new Worker(path.join(__dirname, 'discord-ack-worker.js')), logger = console } = {}) {
    let worker = null;
    const pending = new Map();
    function failAll() {
        for (const { reject } of pending.values()) reject(Object.assign(Error('Discord response worker stopped. Try again.'), { code: 'ACK_WORKER_STOPPED' }));
        pending.clear(); worker = null;
    }
    function start() {
        if (worker) return worker;
        const current = worker = workerFactory();
        current.unref();
        current.on('message', result => {
            const task = pending.get(result.id);
            if (!task) return;
            pending.delete(result.id);
            if (!pending.size) current.unref();
            if (result.ok || (task.raw && result.status)) {
                logger.info('Interaction acknowledgement:', { elapsedMs: result.elapsedMs, workerDelayMs: result.workerDelayMs });
                task.resolve(result);
            } else task.reject(Object.assign(Error('Discord could not acknowledge this request. Please try again.'), { code: result.code || result.status }));
        });
        current.on('error', () => { if (worker === current) failAll(); });
        current.on('exit', () => { if (worker === current) failAll(); });
        return current;
    }
    function send(message, raw = false) {
        if (pending.has(message.id)) return Promise.reject(Object.assign(Error('Already responding to this request.'), { code: 40060 }));
        const current = start();
        return new Promise((resolve, reject) => {
            pending.set(message.id, { resolve, reject, raw });
            current.ref();
            try { current.postMessage({ ...message, queuedAt: Date.now() }); }
            catch (error) { pending.delete(message.id); if (!pending.size) current.unref(); reject(error); }
        });
    }
    // Start before recovery can block the main event loop.
    start();
    async function acknowledge(interaction) {
        const command = interaction.isChatInputCommand?.();
        const privateTradeFor = interaction.isButton?.() && interaction.customId === 'tradeblock:tradefor';
        const tradeControl = (interaction.isButton?.() || interaction.isStringSelectMenu?.()) && String(interaction.customId || '').startsWith('trade:');
        if ((!command && !tradeControl && !privateTradeFor) || interaction.deferred || interaction.replied) return;
        if (!/^\d+$/.test(interaction.id) || !interaction.token) throw Error('Invalid Discord interaction.');
        const flags = command ? commandReplyFlags(interaction) : 64;
        await send({ id: interaction.id, token: interaction.token, payload: command || privateTradeFor ? { type: 5, data: { flags } } : { type: 6 }, type: command || privateTradeFor ? 5 : 6 });
        interaction.deferred = true;
        interaction.ephemeral = (command || privateTradeFor) && Boolean(flags & 64);
    }
    async function respondAutocomplete(interaction, choices) {
        if (interaction.responded) return;
        if (!/^\d+$/.test(interaction.id) || !interaction.token) throw Error('Invalid autocomplete interaction.');
        await send({ id: interaction.id, token: interaction.token, type: 8, choices });
        interaction.responded = true;
    }
    // Keep SDK serialization and rate-limit handling. Move only JSON interaction
    // callbacks to the worker; files and ordinary REST traffic use the SDK transport.
    function install(rest) {
        const original = rest.options.makeRequest;
        const transport = async (url, init) => {
            const target = new URL(url);
            const match = target.pathname.match(/^\/api\/v\d+\/interactions\/(\d+)\/([^/]+)\/callback$/);
            if (target.origin !== 'https://discord.com' || !match || init.method !== 'POST' || typeof init.body !== 'string') return original(url, init);
            const result = await send({ id: match[1], token: decodeURIComponent(match[2]), payload: JSON.parse(init.body), query: target.search }, true);
            return new Response(result.status === 204 ? null : result.body, { status: result.status, headers: result.headers });
        };
        rest.options.makeRequest = transport;
        return () => { if (rest.options.makeRequest === transport) rest.options.makeRequest = original; };
    }
    return { acknowledge, respondAutocomplete, install, close: async () => { const current = worker; worker = null; if (current) await current.terminate(); failAll(); } };
}
module.exports = { createFastTradeAcknowledgment };
