// Published full-season player minimums, not team payroll floors or reimbursed cap charges.
// Source: https://basketball.realgm.com/nba/info/minimum_scale/2023
// Service-time rule: NBA-NBPA CBA, Article II Section 6. Checked 2026-10-16.
const SOURCE = 'https://basketball.realgm.com/nba/info/minimum_scale/2023';
const SCALES = Object.freeze({
    2026: Object.freeze([1357763, 2185116, 2449421, 2537526, 2625627, 2845883, 3066143, 3286399, 3506659, 3524115, 3876529]),
});
function nbaMinimumSalary(year, player) {
    const raw = player?.yearsInNBA;
    const service = raw == null || String(raw).trim() === '' ? NaN : Number(raw);
    if (!Number.isInteger(service) || service < 0) throw Error('NBA service time is unknown for this player. Ask Staff to set Years in NBA, or enter the exact NBA 2K salary.');
    const scale = SCALES[year];
    if (!scale) throw Error(`No verified NBA minimum salary is loaded for ${year}-${String(Number(year) + 1).slice(-2)}. Enter the exact NBA 2K salary.`);
    return { salary: scale[Math.min(10, service)], season: `${year}-${String(year + 1).slice(-2)}`, yearsOfService: service, serviceBand: Math.min(10, service), sourceUrl: SOURCE, verifiedAt: '2026-10-16' };
}
module.exports = { nbaMinimumSalary };
