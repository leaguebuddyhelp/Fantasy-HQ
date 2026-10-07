const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');
const TEAM_CODES = Object.fromEntries([
    ['atlanta-hawks','ATL'],['boston-celtics','BOS'],['brooklyn-nets','BRK'],['charlotte-hornets','CHO'],
    ['chicago-bulls','CHI'],['cleveland-cavaliers','CLE'],['dallas-mavericks','DAL'],['denver-nuggets','DEN'],
    ['detroit-pistons','DET'],['golden-state-warriors','GSW'],['houston-rockets','HOU'],['indiana-pacers','IND'],
    ['los-angeles-clippers','LAC'],['los-angeles-lakers','LAL'],['memphis-grizzlies','MEM'],['miami-heat','MIA'],
    ['milwaukee-bucks','MIL'],['minnesota-timberwolves','MIN'],['new-orleans-pelicans','NOP'],['new-york-knicks','NYK'],
    ['oklahoma-city-thunder','OKC'],['orlando-magic','ORL'],['philadelphia-76ers','PHI'],['phoenix-suns','PHO'],
    ['portland-trail-blazers','POR'],['sacramento-kings','SAC'],['san-antonio-spurs','SAS'],['toronto-raptors','TOR'],
    ['utah-jazz','UTA'],['washington-wizards','WAS'],
]);
function nameKey(name) { return String(name || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function teamCode(team) {
    const slug = String(team.slug || team.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return TEAM_CODES[slug] || (slug === 'la-clippers' ? 'LAC' : null);
}
function money(text) {
    const value = String(text || '').trim();
    if (!/^\$?[\d,]+(?:\.\d{1,2})?$/.test(value)) return null;
    const amount = Number(value.replace(/[$,]/g, ''));
    return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}
function parsePayroll(html, { sourceUrl, fetchedAt = new Date().toISOString() } = {}) {
    // Basketball Reference sometimes puts tables inside HTML comments.
    const $ = load(String(html).replace(/<!--([\s\S]*?)-->/g, (_, body) => body.includes('<table') ? body : ''));
    const table = $('table#contracts');
    if (table.length !== 1) throw Error('Payroll table is missing or ambiguous.');
    const headers = table.find('thead tr').last().find('[data-stat]').toArray()
        .map(cell => ({ key: $(cell).attr('data-stat'), season: $(cell).text().trim() }))
        .filter(header => /^\d{4}-\d{2}$/.test(header.season));
    if (!headers.length) throw Error('Payroll season columns are missing.');
    const seasonsFor = row => headers.map(header => {
        const cell = row.find(`[data-stat="${header.key}"]`).first();
        const salary = cell.text().trim();
        const amount = money(salary);
        if (salary && amount == null) throw Error(`Unreadable payroll salary: ${salary}`);
        return { season: header.season, salary: amount, option: cell.hasClass('salary-pl') ? 'PLAYER' : cell.hasClass('salary-tm') ? 'TEAM' : null };
    });
    const players = [];
    table.find('tbody tr').each((_, element) => {
        const row = $(element), link = row.find('[data-stat="player"] a[href^="/players/"]').first();
        if (!link.length) return;
        const name = link.text().trim();
        if (!name) return;
        players.push({ name, contract: { source: 'basketball-reference', sourceUrl,
            playerUrl: new URL(link.attr('href'), 'https://www.basketball-reference.com').href,
            fetchedAt, currency: 'USD', seasons: seasonsFor(row), guaranteedTotal: money(row.find('[data-stat="remain_gtd"]').text()) } });
    });
    if (!players.length) throw Error('Payroll table contains no player contracts.');
    const totals = table.find('tfoot tr').first();
    return { sourceUrl, fetchedAt, seasons: headers.map(h => h.season), players,
        teamTotals: totals.length ? seasonsFor(totals) : [], status: 'CURRENT' };
}
function matchContract(name, payroll) {
    const matches = payroll.players.filter(entry => nameKey(entry.name) === nameKey(name));
    return matches.length === 1 ? matches[0].contract : null;
}
async function loadPayroll(team, { cacheDir = 'data/2kratings/contracts', fetcher = fetch, now = () => new Date().toISOString() } = {}) {
    const code = teamCode(team);
    if (!code) return null;
    const sourceUrl = `https://www.basketball-reference.com/contracts/${code}.html`;
    const cacheFile = path.join(cacheDir, `${code}.json`);
    try {
        const response = await fetcher(sourceUrl, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw Error(`Payroll request returned HTTP ${response.status}.`);
        const payroll = parsePayroll(await response.text(), { sourceUrl, fetchedAt: now() });
        fs.mkdirSync(cacheDir, { recursive: true });
        const temporary = `${cacheFile}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(payroll, null, 2) + '\n');
        fs.renameSync(temporary, cacheFile);
        return payroll;
    } catch (error) {
        let cached = null;
        try { cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* No successful prior snapshot. */ }
        if (cached?.sourceUrl === sourceUrl && Array.isArray(cached.players) && cached.players.length) return { ...cached, status: 'STALE', error: error.message };
        throw error;
    }
}
module.exports = { TEAM_CODES, teamCode, parsePayroll, matchContract, loadPayroll };
