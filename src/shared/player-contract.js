const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const seasonLabel = year => `${year}-${String(year + 1).slice(-2)}`;
const compactDollars = amount => amount == null ? 'Salary unavailable' : Math.abs(amount) >= 1000000 ? `$${Number((amount / 1000000).toFixed(2))}M` : Math.abs(amount) >= 1000 ? `$${Number((amount / 1000).toFixed(1))}K` : `$${amount}`;
const dollars = amount => amount == null ? 'Unknown' : `$${Number(amount).toLocaleString('en-US')}`;
function contractView(player, year) {
    const contract = player.contract;
    const rows = (contract?.seasons || []).filter(row => /^\d{4}-\d{2}$/.test(row.season));
    const referenceYear = year ?? (rows.length ? Number(rows[0].season.slice(0, 4)) : 2026);
    const current = rows.find(row => row.season === seasonLabel(referenceYear));
    const future = rows.filter(row => Number(row.season.slice(0,4)) >= referenceYear && Number.isFinite(row.salary) && row.salary >= 0);
    const next = rows.find(row => row.season === seasonLabel(referenceYear + 1));
    const known = current?.salary != null && Number.isFinite(current.salary);
    const yearsRemaining = future.length;
    const playerOptionIndex = future.findIndex(row => row.option === 'PLAYER');
    const controlledYears = playerOptionIndex < 0 ? yearsRemaining : playerOptionIndex;
    const expiring = known && (!next || next.salary == null);
    const nextPlayerOption = known && next?.option === 'PLAYER';
    const option = current?.option === 'PLAYER' ? 'Player option' : current?.option === 'TEAM' ? 'Team option' : null;
    const lastSeason = future.map(row => row.season).sort().at(-1);
    const finalOption = future.find(row => row.season === lastSeason)?.option;
    const termLabel = expiring ? 'expires this season' : `through ${lastSeason}${finalOption === 'PLAYER' ? ' (player option)' : finalOption === 'TEAM' ? ' (team option)' : ''}`;
    const status = `${termLabel}${option ? ` · ${option} this season` : ''}${nextPlayerOption && future.length > 2 ? ' · Player option next season' : ''}`;
    const compact = known ? `${compactDollars(current.salary)} · ${status}` : 'Salary unavailable';
    const short = known ? `${compactDollars(current.salary)} this season · ${status}` : `Salary unavailable for ${seasonLabel(referenceYear)}`;
    return { known, currentSeason: seasonLabel(referenceYear), salary: known ? current.salary : null, yearsRemaining, controlledYears,
        expiring, nextPlayerOption, option, sourceUrl: contract?.sourceUrl || null, fetchedAt: contract?.fetchedAt || null,
        guaranteedTotal: contract?.guaranteedTotal ?? null, seasons: rows, short, compact };
}
function contractValue(player, year) {
    const view = contractView(player, year);
    if (!view.known) return { modifier: 1, reason: 'No known current salary; contract adjustment is neutral.' };
    const overall = Number(player.overall) || 70;
    const expectedSalary = Math.max(2000000, 2000000 + Math.max(0, overall - 65) ** 2 * 60000);
    const term = Math.min(4, view.yearsRemaining);
    const averageSalary = view.seasons.filter(row => Number(row.season.slice(0,4)) >= year && row.salary != null).reduce((sum,row)=>sum+row.salary,0) / Math.max(1, view.yearsRemaining);
    const surplus = clamp((expectedSalary - (view.salary * 0.6 + averageSalary * 0.4)) / expectedSalary, -1, 1);
    const cost = surplus >= 0 ? surplus * (view.expiring || view.nextPlayerOption ? 0.07 : 0.12) : surplus * (0.08 + Math.max(0, term - 1) * 0.04);
    const control = overall >= 80 && view.controlledYears >= 3 && !view.nextPlayerOption && !view.expiring ? 0.04 : 0;
    const risk = view.nextPlayerOption && overall >= 80 ? 0.03 : 0;
    const modifier = clamp(1 + cost + control - risk, 0.75, 1.18);
    return { modifier, expectedSalary, reason: `${view.short}. ${surplus >= 0 ? 'Salary value adds trade value' : 'Salary burden reduces trade value'}${control ? '; multi-year control adds value' : ''}${risk ? '; player-option uncertainty reduces control' : ''}. Contract adjustment ${Math.round((modifier - 1) * 100)}%.` };
}
function teamPayroll(players, year) {
    const views = players.filter(Boolean).map(p => contractView(p, year));
    return { season: seasonLabel(year), knownPlayers: views.filter(v => v.known).length, totalPlayers: views.length,
        salary: views.reduce((sum, v) => sum + (v.salary ?? 0), 0), expiringPlayers: views.filter(v => v.expiring).length,
        short: `${dollars(views.reduce((sum, v) => sum + (v.salary ?? 0), 0))} known salary · ${views.filter(v => v.known).length}/${views.length} contracts · ${seasonLabel(year)}` };
}
module.exports = { contractView, contractValue, teamPayroll, dollars, compactDollars, seasonLabel };
