// NBA CBA 101, November 2024, Exhibits A/B. Monetary base values are US dollars.
// Later tables are derived from the explicitly supplied league salary cap, not labelled official NBA publications.
const SOURCE_URL = 'https://cms.nba.com/wp-content/uploads/sites/4/2024/11/2024-25-CBA-101.pdf';
const BASE_CAP = 140588000;
const BASE_FIRST_ROUND = [
 [10474200,10998100,11521700,26.1],[9371400,9840200,10308900,26.2],[8415800,8836300,9257400,26.4],
 [7587600,7967100,8346600,26.5],[6871100,7214400,7558000,26.7],[6240600,6552700,6864900,26.8],
 [5697000,5982000,6266600,27],[5219100,5480100,5741100,27.2],[4797400,5037500,5277300,27.4],
 [4557600,4785400,5013000,27.5],[4329600,4546300,4762800,32.7],[4113300,4319100,4524800,37.8],
 [3907500,4103100,4298400,42.9],[3712400,3898000,4083800,48.1],[3526500,3702800,3879100,53.3],
 [3350300,3517800,3685500,53.4],[3182600,3341800,3500900,53.6],[3023700,3174600,3326000,53.8],
 [2887500,3031800,3176500,54],[2771800,2910400,3048800,54.2],[2661000,2794200,2927300,59.3],
 [2554700,2682300,2810100,64.5],[2452600,2575400,2697600,69.7],[2354600,2472300,2590000,74.9],
 [2260100,2373000,2486400,80.1],[2185300,2294400,2403700,80.3],[2122200,2228400,2334700,80.4],
 [2109000,2214800,2320200,80.5],[2093900,2198500,2303300,80.5],[2078600,2182500,2286700,80.5]
];
const seasonLabel = year => `${year}-${String(year + 1).slice(-2)}`;
function rookieScale({ draftYear, salaryCap }) {
  if (!Number.isInteger(draftYear) || draftYear < 2024 || draftYear > 9995) throw Error('Choose a valid rookie signing year.');
  if (!Number.isSafeInteger(salaryCap) || salaryCap <= 0) throw Error('Confirm the NBA 2K salary cap for the rookie signing season.');
  const factor = salaryCap / BASE_CAP;
  const rows = BASE_FIRST_ROUND.map(([first, second, third, fourthIncrease], index) => {
    const salaries = [first, second, third].map(value => Math.round(value * factor / 100) * 100);
    salaries.push(Math.round(salaries[2] * (1 + fourthIncrease / 100)));
    return { pick: index + 1, salaries, fourthIncrease };
  });
  const secondRound = { minimumFirstYear: Math.round(1157153 * factor), threeYears: [Math.round(1862265 * factor), Math.round(1955377 * factor), Math.round(2296271 * factor)],
    fourYears: [Math.round(2087519 * factor), Math.round(2191897 * factor), Math.round(2296271 * factor), Math.round(2486995 * factor)], minimumSecondYearFourYears: Math.round(1955377 * factor) };
  return { draftYear, salaryCap, baseSeason: '2024-25', sourceUrl: SOURCE_URL, derived: draftYear !== 2024 || salaryCap !== BASE_CAP, rows, secondRound };
}
function createRookieContract({ draftYear, pick, salaryCap, scalePercentage = 120, secondRoundYears, firstYearSalary, secondYearSalary }) {
  if (!Number.isInteger(pick) || pick < 1 || pick > 60) throw Error('Draft pick must be between 1 and 60.');
  const scale = rookieScale({ draftYear, salaryCap });
  let salaries, guaranteedYears, contractType;
  if (pick <= 30) {
    if (!Number.isFinite(scalePercentage) || scalePercentage < 80 || scalePercentage > 120) throw Error('First-round contracts must use 80–120% of the rookie scale.');
    salaries = scale.rows[pick - 1].salaries.map(value => Math.round(value * scalePercentage / 100));
    guaranteedYears = 2; contractType = 'ROOKIE_SCALE';
  } else {
    if (![3,4].includes(secondRoundYears)) throw Error('Select a three- or four-year Second Round Pick Exception contract.');
    const bounds = scale.secondRound;
    salaries = (secondRoundYears === 3 ? bounds.threeYears : bounds.fourYears).slice();
    if (!Number.isSafeInteger(firstYearSalary) || firstYearSalary < bounds.minimumFirstYear || firstYearSalary > salaries[0]) throw Error('Second-round first-year salary must fall within the NBA-derived exception limits.');
    salaries[0] = firstYearSalary;
    if (secondRoundYears === 4) {
      if (!Number.isSafeInteger(secondYearSalary) || secondYearSalary < bounds.minimumSecondYearFourYears || secondYearSalary > salaries[1]) throw Error('Second-round second-year salary must fall within the NBA-derived exception limits.');
      salaries[1] = secondYearSalary;
    }
    guaranteedYears = secondRoundYears - 1; contractType = 'SECOND_ROUND_PICK_EXCEPTION';
  }
  if (salaries.some(s => !Number.isSafeInteger(s) || s <= 0)) throw Error('Rookie salary exceeds supported monetary limits.');
  return { source: 'NBA_CBA_DERIVED_LEAGUE_SCALE', sourceUrl: SOURCE_URL, currency: 'USD', contractType,
    provenance: { baseSeason: scale.baseSeason, salaryCap, draftYear, pick, derived: scale.derived, ...(pick <= 30 ? { scalePercentage } : { secondRoundYears }) },
    seasons: salaries.map((salary,index) => ({ season: seasonLabel(draftYear + index), salary, option: index >= guaranteedYears ? 'TEAM' : null })),
    guaranteedTotal: salaries.slice(0,guaranteedYears).reduce((sum,salary) => sum + salary,0) };
}
module.exports = { rookieScale, createRookieContract, BASE_CAP, SOURCE_URL };
