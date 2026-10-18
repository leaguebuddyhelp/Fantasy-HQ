const dns = require('node:dns');
const { isIP } = require('node:net');
// Resolve public Discord names without occupying the filesystem/crypto threadpool.
// System lookup remains the fallback for private names, IPv6 and resolver failures.
function createDiscordLookup({ resolve4, systemLookup = dns.lookup, now = Date.now } = {}) {
    const resolver = new dns.Resolver({ timeout: 1200, tries: 1 });
    resolve4 ||= resolver.resolve4.bind(resolver);
    const cache = new Map(), pending = new Map();
    function lookup(host, options, callback) {
        if (typeof options === 'function') { callback = options; options = {}; }
        if (typeof options === 'number') options = { family: options };
        options ||= {};
        if (isIP(host) || !/^(?:discord\.com|(?:[a-z0-9-]+\.)*discord(?:app)?\.(?:com|net|gg))$/i.test(host) || options.family === 6) return systemLookup(host, options, callback);
        const answer = rows => options.all ? callback(null, rows.map(row => ({ address: row.address, family: 4 }))) : callback(null, rows[0].address, 4);
        const saved = cache.get(host);
        if (saved && saved.expiresAt > now()) { queueMicrotask(() => answer(saved.rows)); return; }
        const waiters = pending.get(host);
        if (waiters) { waiters.push({ options, callback, answer }); return; }
        pending.set(host, [{ options, callback, answer }]);
        resolve4(host, { ttl: true }, (error, rows) => {
            const tasks = pending.get(host) || []; pending.delete(host);
            const valid = Array.isArray(rows) && rows.length && rows.every(row => row && isIP(row.address) === 4 && Number.isFinite(row.ttl));
            if (!error && valid) {
                const ttl = Math.max(0, Math.min(60, ...rows.map(row => row.ttl)));
                if (ttl) cache.set(host, { rows, expiresAt: now() + ttl*1000 });
                for (const task of tasks) task.answer(rows);
            } else {
                cache.delete(host);
                for (const task of tasks) systemLookup(host, task.options, task.callback);
            }
        });
    }
    return lookup;
}
module.exports = { createDiscordLookup };
