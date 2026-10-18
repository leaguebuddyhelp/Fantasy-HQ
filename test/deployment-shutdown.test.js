const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { acquireWriterLease } = require('../src/fantasyhq/storage-safety');

for (const [signal, expectedCode] of [['SIGTERM', 143], ['SIGINT', 130]]) {
  test(`${signal} releases the writer lock so a replacement starts without stale-lock retries`, { timeout: 10000 }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-shutdown-'));
    const child = spawn(process.execPath, ['-e', `
      const { acquireWriterLease } = require(process.argv[1]);
      acquireWriterLease(process.argv[2]);
      process.send('ready');
      setInterval(() => {}, 1000);
    `, require.resolve('../src/fantasyhq/storage-safety'), root], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      fs.rmSync(root, { recursive: true, force: true });
    });
    const [message] = await once(child, 'message');
    assert.equal(message, 'ready');
    assert.ok(fs.existsSync(path.join(root, '.writer-lock', 'owner.json')));
    const exited = once(child, 'exit');
    child.kill(signal);
    const [code, exitSignal] = await exited;
    assert.equal(code, expectedCode);
    assert.equal(exitSignal, null);
    assert.equal(fs.existsSync(path.join(root, '.writer-lock')), false);
    const replacement = acquireWriterLease(root);
    replacement.release();
  });
}

test('production container starts Node directly so stop signals reach the writer-lease handler', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '../Dockerfile'), 'utf8');
  const command = dockerfile.split('\n').find(line => line.startsWith('CMD '));
  assert.deepEqual(JSON.parse(command.slice(4)), ['node', 'src/index.js']);
});

test('Railway config overrides any dashboard npm wrapper with direct Node startup', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../railway.json'), 'utf8'));
  assert.equal(config.deploy.startCommand, 'node src/index.js');
});
