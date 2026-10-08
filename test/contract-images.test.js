const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { recognizeContractText } = require('../src/fantasyhq/box-score/tesseract-provider');
const { parseContractText, normalizeOffer } = require('../src/fantasyhq/offer-score');

test('real 4K contract pictures read offer rows, selected highlights, options and MINIMUM', { timeout: 180000 }, async () => {
  const cases = [
    ['contract-payne-team-option.jpg', { salary: '$3.90M', years: '1+1', structure: 'Flat', option: 'Team' }],
    ['contract-yabusele-minimum.jpg', { salary: 'MINIMUM', years: '1', structure: 'Back (+5%)', option: 'None' }],
    ['contract-thomas-player-option.jpg', { salary: '$6.66M', years: '3+1', structure: 'Front (-5%)', option: 'Player' }],
  ];
  for (const [file, expected] of cases) {
    const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', file));
    const original = Buffer.from(bytes);
    const details = parseContractText(await recognizeContractText(bytes));
    assert.deepEqual(details, expected, file);
    assert.deepEqual(bytes, original);
    if (details.salary === 'MINIMUM') {
      assert.throws(() => normalizeOffer(details, { year: 2026 }), /MINIMUM without a dollar amount/);
    } else {
      const offer = normalizeOffer(details, { year: 2026 });
      assert.equal(offer.contract.seasons.length, file.includes('payne') ? 2 : 4);
      assert.equal(offer.contract.seasons.at(-1).option, file.includes('payne') ? 'TEAM' : 'PLAYER');
    }
  }
});

test('finance salaries and Promise cannot supply missing offer fields', () => {
  assert.deepEqual(parseContractText('Salary Cap: $190.96M\nPending Salary: $0\nOffer Details\nSalary: MINIMUM\nYears: 1\nType: Back (+5%)\nOption: None\nPromise 1: Starter'), { salary: 'MINIMUM', years: '1', structure: 'Back (+5%)', option: 'None' });
  assert.equal(parseContractText('Salary Cap: $190.96M\nPending Salary: $0\nYears: 1\nType: Flat\nPromise: None').salary, '');
  assert.equal(parseContractText('Salary: $1M\nYears: 1\nType: Flat\nPromise: None').option, '');
});
