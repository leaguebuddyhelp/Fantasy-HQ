const { createHash } = require('crypto');
const tieKey = (year, id) => createHash('sha256').update(`${year}:${id}`).digest('hex');
function rulesForYear(year) {
    if (!Number.isInteger(year) || year < 2019) throw Error('Supported draft years begin in 2019.');
    return year >= 2027 ? { id: 'NBA_321', lotterySize: 16, drawn: 16, provisional: year >= 2030 }
        : { id: 'NBA_2019', lotterySize: 14, drawn: 4, provisional: false };
}
function weighted(pool, rng) {
    let draw = rng() * pool.reduce((sum, item) => sum + item.weight, 0);
    return pool.find(item => (draw -= item.weight) < 0) || pool.at(-1);
}
function draftField({ teams, standings, draftYear, settings = {} }) {
    if (teams.length !== 30 || new Set(teams.map(t => t.teamId)).size !== 30) throw Error('Mock drafts require the configured 30 teams.');
    const rules = rulesForYear(draftYear), rows = Object.values(standings.conferences).flat();
    const compare = (a, b) => a.PCT - b.PCT || tieKey(draftYear, a.teamId).localeCompare(tieKey(draftYear, b.teamId));
    const conferences = ['East', 'West'].map(c => teams.filter(t => t.conference === c).map(t => ({ ...t, ...(rows.find(r => r.teamId === t.teamId) || { PCT: 0, W: 0, L: 0 }) })).sort((a, b) => Number.isInteger(a.rank) && Number.isInteger(b.rank) ? a.rank - b.rank : compare(b, a)).map((t, i) => ({ ...t, seed: i + 1 })));
    if (conferences.some(c => c.length !== 15)) throw Error('Expected 15 teams per conference.');
    const all = conferences.flat(), config = settings.mockDraft || {}, explicitLosers = config.playInLoserTeamIds;
    const losers = explicitLosers || conferences.map(c => c[7].teamId);
    if (rules.id === 'NBA_321' && (losers.length !== 2 || conferences.some(c => !losers.some(id => c.slice(6, 8).some(t => t.teamId === id))))) throw Error('Configure one 7/8 play-in loser per conference.');
    let lottery = all.filter(t => rules.id === 'NBA_321' ? t.seed >= 9 || losers.includes(t.teamId) : t.seed >= 9);
    if (rules.id === 'NBA_2019' && config.playoffTeamIds) lottery = all.filter(t => !config.playoffTeamIds.includes(t.teamId));
    lottery.sort(compare);
    if (lottery.length !== rules.lotterySize) throw Error('Invalid lottery eligibility.');
    const bottom = new Set(lottery.filter(t => t.seed > 10).sort(compare).slice(0, 3).map(t => t.teamId));
    const legacyWeights = [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5];
    lottery = lottery.map((t, i) => ({ ...t, relegated: rules.id === 'NBA_321' && bottom.has(t.teamId), weight: rules.id === 'NBA_321' ? losers.includes(t.teamId) ? 1 : t.seed <= 10 || bottom.has(t.teamId) ? 2 : 3 : legacyWeights[i] }));
    // Share lottery odds across tied records within each eligibility tier.
    for (const t of lottery) {
        const peers = lottery.filter(p => p.PCT === t.PCT && (rules.id === 'NBA_2019' || p.seed > 10 && t.seed > 10));
        if (peers.length > 1) t.tiedWeight = peers.reduce((sum, p) => sum + p.weight, 0) / peers.length;
    }
    lottery = lottery.map(t => ({ ...t, weight: t.tiedWeight || t.weight }));
    return { rules, lottery, playoff: all.filter(t => !lottery.some(l => l.teamId === t.teamId)).sort(compare), warnings: [!explicitLosers ? 'Play-in eligibility is projected from current conference seeds.' : null, !config.priorOriginalPicks ? 'Prior real draft results are unavailable; repeat-pick restrictions require league settings.' : null, rules.provisional ? '2030+ provisionally continues 3-2-1 pending NBA rules.' : null].filter(Boolean) };
}
function generateDraftOrder(input, { rng = Math.random, lottery = true } = {}) {
    const field = draftField(input), { rules } = field;
    let selected = [];
    if (lottery) {
        // Conditional redraw: restrictions depend on the ORIGINAL team, never the owner.
        const history = input.settings?.mockDraft?.priorOriginalPicks || {};
        const pool = field.lottery.slice();
        for (let slot = 1; slot <= rules.drawn; slot++) {
            let eligible = pool;
            if (rules.id === 'NBA_321') {
                const relegated = pool.filter(t => t.relegated);
                if (slot <= 12 && relegated.length === 13 - slot) eligible = relegated;
                eligible = eligible.filter(t => {
                    const previous = history[String(input.draftYear - 1)]?.[t.teamId], earlier = history[String(input.draftYear - 2)]?.[t.teamId];
                    return !(slot === 1 && previous === 1) && !(slot <= 5 && previous <= 5 && earlier <= 5);
                });
            }
            if (!eligible.length) throw Error('Lottery restrictions conflict with configured prior draft results.');
            const t = weighted(eligible, rng); selected.push(t); pool.splice(pool.indexOf(t), 1);
        }
        selected.push(...pool);
        if (!selected.length) throw Error('Lottery restrictions could not produce a valid order. Check prior draft settings.');
    } else selected = field.lottery;
    const picks = input.picks.filter(p => Number(p.draftYear) === input.draftYear && Number(p.round) === 1);
    if (picks.length !== 30 || new Set(picks.map(p => p.originalTeamId)).size !== 30) throw Error('Initialize all 30 current first-round pick assets through league channel setup.');
    const order = [...selected, ...field.playoff].map((team, i) => {
        const asset = picks.find(p => p.originalTeamId === team.teamId);
        if (!asset || !input.teams.some(t => t.teamId === asset.currentOwnerTeamId)) throw Error('Invalid first-round pick ownership.');
        return { pickNumber: i + 1, originalTeamId: team.teamId, currentOwnerTeamId: asset.currentOwnerTeamId, originalPickAssetId: asset.pickId };
    });
    return { order, rules, warnings: field.warnings };
}
module.exports = { rulesForYear, draftField, generateDraftOrder };
