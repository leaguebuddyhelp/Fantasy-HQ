// Player perspective: actual player-controlled money dominates bounded modifiers.
const WEIGHTS = Object.freeze({ securityPerYear: 0.01, securityMax: 0.06, playerOption: 0.02, teamOption: -0.02, front: 0.005, back: -0.005 });
function salaryAmount(value) {
  let text = String(value).trim().replace(/[$\s]/g, '').toUpperCase();
  if (/^\d+,\d{1,2}[MK]$/.test(text)) text = text.replace(',', '.');
  else text = text.replace(/,/g, '');
  const match = text.match(/^(\d+(?:\.\d+)?)([MK])?$/);
  if (!match) throw Error(/^MINIMUM$/i.test(text) ? 'This picture shows MINIMUM without a dollar amount. Enter the exact salary shown in NBA 2K before submitting.' : 'Enter a readable salary, such as $6.66M.');
  const amount = Math.round(Number(match[1]) * (match[2] === 'M' ? 1e6 : match[2] === 'K' ? 1e3 : 1));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw Error('Salary must be a positive, readable amount.');
  return amount;
}
function normalizeOffer(details, { year, screenshotUrl = null, timestamp = new Date().toISOString() } = {}) {
  const salary = salaryAmount(details.salary);
  const yearsText = String(details.years).replace(/\s/g, '');
  const yearsMatch = yearsText.match(/^(\d+)(?:\+(1))?$/);
  if (!yearsMatch || !Number.isSafeInteger(Number(yearsMatch[1])) || Number(yearsMatch[1]) < 1) throw Error('Years must be a positive count or a term such as 3+1.');
  if (details.option === undefined || details.option === '' || !String(details.structure || '').trim()) throw Error('Option and Contract Type must be readable. Correct the extracted details.');
  const optionText = String(details.option || 'None').toUpperCase().replace(/[^A-Z]/g, '').replace('OPTION', '');
  const option = ({ NONE: null, NO: null, PLAYER: 'PLAYER', TEAM: 'TEAM' })[optionText];
  if (option === undefined) throw Error('Option must be None, Team or Player.');
  if (yearsMatch[2] && !option) throw Error('A +1 year requires a Team or Player option.');
  const years = Number(yearsMatch[1]) + (yearsMatch[2] ? 1 : 0);
  const structureText = String(details.structure || 'Flat').toUpperCase();
  const structure = /^FLAT$/.test(structureText.trim()) ? 'FLAT' : /^FRONT(?:[- ]LOADED)?(?:\s*\(?-?5%\)?)?$/.test(structureText.trim()) ? 'FRONT' : /^BACK(?:[- ]LOADED)?(?:\s*\(?\+?5%\)?)?$/.test(structureText.trim()) ? 'BACK' : null;
  if (!structure) throw Error('Structure must be Flat, Front (-5%) or Back (+5%).');
  const rate = structure === 'FRONT' ? -0.05 : structure === 'BACK' ? 0.05 : 0;
  // Interpret the displayed +/-5% as an annual change based on starting salary.
  // Staff should compare the generated schedule with 2K during live verification.
  // Guard malformed/overflow schedules, without inventing league contract limits.
  if (!Number.isInteger(year) || year + years > 9999) throw Error('Contract schedule cannot be represented safely. Check the screenshot.');
  const seasons = Array.from({ length: years }, (_, index) => ({ season: `${year + index}-${String(year + index + 1).slice(-2)}`, salary: Math.round(salary * (1 + rate * index)), option: index === years - 1 ? option : null }));
  if (seasons.some(row => !Number.isSafeInteger(row.salary) || row.salary <= 0)) throw Error('The extracted salary schedule is invalid. Ask Staff to correct it.');
  const guaranteedTotal = seasons.filter(row => row.option !== 'TEAM').reduce((sum, row) => sum + row.salary, 0);
  if (!Number.isSafeInteger(guaranteedTotal)) throw Error('Contract total cannot be represented safely.');
  return { details: { salary, years: yearsText, structure, option }, contract: { source: 'nba2k', sourceUrl: screenshotUrl, playerUrl: null, fetchedAt: timestamp, currency: 'USD', seasons, guaranteedTotal } };
}
function offerScore(contract, structure = 'FLAT') {
  const controlled = contract.seasons.filter(row => row.option !== 'TEAM');
  const money = controlled.reduce((sum, row) => sum + row.salary, 0);
  const option = contract.seasons.at(-1)?.option;
  const multiplier = 1 + Math.min(WEIGHTS.securityMax, controlled.length * WEIGHTS.securityPerYear) + (option === 'PLAYER' ? WEIGHTS.playerOption : option === 'TEAM' ? WEIGHTS.teamOption : 0) + (structure === 'FRONT' ? WEIGHTS.front : structure === 'BACK' ? WEIGHTS.back : 0);
  return Math.round(money * multiplier * 100) / 100;
}
function rankOffers(offers) {
  return [...offers].sort((a, b) => offerScore(b.contract, b.details.structure) - offerScore(a.contract, a.details.structure) || Date.parse(a.submittedAt) - Date.parse(b.submittedAt) || (a.submissionSequence || 0) - (b.submissionSequence || 0) || a.id.localeCompare(b.id));
}
function parseContractText(text) {
  const clean = String(text).replace(/\r/g, '').replace(/[−–]/g, '-').split(/Offer\s+Details/i).at(-1);
  // Anchor labels so Pending Salary and Salary Cap cannot become offer money.
  const field = label => clean.match(new RegExp(`^\\s*${label}\\s*:?\\s*([^\\n]+)`, 'im'))?.[1]?.trim();
  const salaryField = field('Salary(?!\\s+Cap)');
  const salary = /\bMINIMUM\b/i.test(salaryField || '') ? 'MINIMUM' : salaryField?.match(/\$\s*\d[\d,]*(?:\.\d+)?\s*[MK]?|^\d[\d,]*(?:\.\d+)?\s*[MK]?/i)?.[0];
  const years = field('Years')?.replace(/\+\s*[Il]/g, '+1').match(/\d+\s*(?:\+\s*1)?/)?.[0]?.replace(/\s/g, '');
  const structure = field('(?:Contract\\s*(?:Type|Structure)|Type)')?.match(/Flat|Front(?:\s*\(-?5%\))?|Back(?:\s*\(\+?5%\))?/i)?.[0];
  const option = field('Option')?.match(/None|No(?:\s*Option)?|Team(?:\s*Option)?|Player(?:\s*Option)?/i)?.[0];
  // Promise is deliberately never parsed, normalized, stored or scored.
  return { salary: salary || '', years: years || '', structure: structure || '', option: option || '' };
}
module.exports = { WEIGHTS, salaryAmount, normalizeOffer, offerScore, rankOffers, parseContractText };
