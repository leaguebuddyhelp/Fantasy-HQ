const { performance } = require('node:perf_hooks');
const starts = new WeakMap(), recent = [];
function begin(request, response) { starts.set(response, { at: performance.now(), path: String(request.url || '').split('?')[0] }); }
function headers(response, { buildAt, encodeAt, bytes = 0, status = 200 } = {}) {
    const started = starts.get(response);
    if (!started) return {};
    const end = performance.now(), appMs = Math.max(0, (buildAt ?? end) - started.at), encodeMs = encodeAt == null ? 0 : end - encodeAt;
    recent.push({ path: started.path, status, appMs: +appMs.toFixed(1), encodeMs: +encodeMs.toFixed(1), totalMs: +(end - started.at).toFixed(1), bytes, at: new Date().toISOString() });
    if (recent.length > 100) recent.shift();
    return { 'Server-Timing': `app;dur=${appMs.toFixed(1)}, encode;dur=${encodeMs.toFixed(1)}` };
}
function snapshot() { return structuredClone(recent); }
module.exports = { begin, headers, snapshot };
