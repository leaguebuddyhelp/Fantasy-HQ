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
function normalizeContractDetails(details, { year, screenshotUrl = null, timestamp = new Date().toISOString(), player = null } = {}) {
  const minimumSalary = /^MINIMUM$/i.test(String(details.salary).trim()) && player ? require('./nba-minimum-salary').nbaMinimumSalary(year, player) : null;
  const salary = minimumSalary?.salary ?? salaryAmount(details.salary);
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
  return { details: { salary, years: yearsText, structure, option }, contract: { source: 'nba2k', sourceUrl: screenshotUrl, playerUrl: null, fetchedAt: timestamp, currency: 'USD', seasons, guaranteedTotal, ...(minimumSalary ? { minimumSalary } : {}) } };
}
module.exports = { salaryAmount, normalizeContractDetails };
