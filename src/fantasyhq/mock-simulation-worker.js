const { parentPort, workerData } = require('worker_threads');
const { simulate } = require('./mock-simulations');
simulate(workerData.input, workerData.options).then(
    snapshot => parentPort.postMessage({ snapshot }),
    error => parentPort.postMessage({ error: error.message }),
);
