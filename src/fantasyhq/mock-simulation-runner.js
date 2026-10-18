const { Worker } = require('worker_threads');
const path = require('path');
function simulateInWorker(input, options, { workerFactory = (filename, settings) => new Worker(filename, settings), timeoutMs = 600000 } = {}) {
    return new Promise((resolve, reject) => {
        let finished = false, timer;
        const worker = workerFactory(path.join(__dirname, 'mock-simulation-worker.js'), { workerData: { input, options } });
        function finish(error, value) {
            if (finished) return;
            finished = true; clearTimeout(timer);
            // This worker only computes. Canonical storage is updated by its owner.
            worker.terminate().catch(() => {});
            if (error) reject(error); else resolve(value);
        }
        worker.once('message', result => finish(result.error ? Error(result.error) : null, result.snapshot));
        worker.once('error', error => finish(error));
        worker.once('exit', code => { if (!finished) finish(Error(`Draft simulation worker exited before returning a snapshot (${code}).`)); });
        timer = setTimeout(() => finish(Error('Draft simulation refresh timed out; the last published board was preserved.')), timeoutMs);
        timer.unref?.();
    });
}
module.exports = { simulateInWorker };
