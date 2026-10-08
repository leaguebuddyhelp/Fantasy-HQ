const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStreamUrl } = require('../src/fantasyhq/game-streamlink');
test('stream links accept HTTP/HTTPS and reject credentials, unsafe protocols and malformed input', () => {
  assert.equal(validateStreamUrl(' https://www.youtube.com/watch?v=abc '), 'https://www.youtube.com/watch?v=abc');
  assert.equal(validateStreamUrl('http://example.com/stream'), 'http://example.com/stream');
  for (const value of ['', 'not a URL', 'javascript:alert(1)', 'ftp://example.com', 'https://user:password@example.com', 'https://example.com/<bad>', 'https://example.com/a b']) {
    assert.throws(() => validateStreamUrl(value), /valid HTTP or HTTPS/);
  }
});
