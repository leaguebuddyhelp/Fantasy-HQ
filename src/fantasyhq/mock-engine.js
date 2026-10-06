const { createHash } = require('crypto');
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
function seededRandom(seed) {
    let state = createHash('sha256').update(String(seed)).digest().readUInt32LE(0);
    return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const ENGINE_VERSION = 3;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
function numeric(value) { if (value == null || value === '' || typeof value === 'boolean') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function traitsFor(p) { return [p.archetype, p.build, p.strength_1, p.strength_2, p.strength_3].filter(Boolean).join(' ').toLowerCase(); }
function shootingFor(p) {
    const rating = numeric(p.three_pt ?? p.threePointShot ?? p.threePointRating);
    if (rating != null) return clamp((rating - 70) / 25, -1, 1);
    return /shoot|spot.?up|3.?level|shot hunter|stretch/.test(traitsFor(p)) ? 0.5 : 0;
}
function playerAge(p, draftYear) {
    const age = numeric(p.age); if (age != null && age >= 15 && age <= 50) return age;
    const birth = Date.parse(p.birthdate || '');
    if (!Number.isFinite(birth) || !Number.isFinite(Number(draftYear))) return null;
    const date = new Date(birth), reference = new Date(Date.UTC(Number(draftYear), 5, 30));
    return reference.getUTCFullYear() - date.getUTCFullYear() - (date.getUTCMonth() > 5 || date.getUTCMonth() === 5 && date.getUTCDate() > 30 ? 1 : 0);
}
function teamRoster(input, teamId, selections = []) {
    return [...(input.rosters[teamId] || []), ...selections.filter(s => s.currentOwnerTeamId === teamId).map(s => s.prospect || input.prospects.find(p => p.prospectId === s.prospectId)).filter(Boolean).map(p => ({ ...p, position1: p.position_1, position2: p.position_2 }))];
}
function teamProfile(input, teamId, selections = []) {
    const roster = teamRoster(input, teamId, selections), rotation = roster.slice().sort((a, b) => (numeric(b.overall) ?? 70) - (numeric(a.overall) ?? 70)).slice(0, 8);
    const average = rotation.length ? rotation.reduce((n, p) => n + (numeric(p.overall) ?? 75), 0) / rotation.length : 75;
    const spacing = rotation.length ? rotation.reduce((n, p) => n + shootingFor(p), 0) / rotation.length : 0;
    return { roster, contender: clamp((average - 77) / 10), shootingNeed: clamp(0.65 - spacing), traits: rotation.map(traitsFor).join(' ') };
}
function positionalNeed(input, prospect, profile) {
    const positions = [...new Set([prospect.position_1, prospect.position_2].filter(p => POSITIONS.includes(p)))];
    if (!positions.length) return 0.5;
    return Math.max(...positions.map(pos => {
        const matches = profile.roster.filter(p => p.position1 === pos || p.position2 === pos);
        const depth = matches.reduce((sum, p) => sum + (p.position1 === pos ? 1 : 0.5), 0);
        const starter = matches.slice().sort((a, b) => (numeric(b.overall) ?? 70) - (numeric(a.overall) ?? 70))[0];
        const strength = starter ? (numeric(starter.overall) ?? 70) - (starter.position1 === pos ? 0 : 4) : 60;
        const age = starter && playerAge(starter, input.draftYear);
        const succession = age != null ? clamp((age - 29) / 10) * 0.2 : 0;
        return clamp(0.55 * clamp((2.5 - depth) / 2.5) + 0.45 * clamp((86 - strength) / 26) + succession);
    }));
}
function needFor(input, teamId, prospect, selections = []) { return positionalNeed(input, prospect, teamProfile(input, teamId, selections)); }
function fitWith(prospect, profile) {
    const traits = traitsFor(prospect);
    return ['shoot|stretch|shot hunter', 'playmak|point|pass', 'defen|2-way|two-way', 'rim|paint|shot.block'].reduce((score, trait) => score + (new RegExp(trait).test(traits) && !new RegExp(trait).test(profile.traits) ? 0.2 : 0), 0);
}
function fitFor(input, teamId, prospect, selections = []) { return fitWith(prospect, teamProfile(input, teamId, selections)); }
function selectionFactors(input, teamId, prospect, selections = [], profile = teamProfile(input, teamId, selections)) {
    const age = playerAge(prospect, input.draftYear);
    const youth = age == null ? 0.5 : clamp((25 - age) / 7);
    return { need: positionalNeed(input, prospect, profile), fit: fitWith(prospect, profile), shooting: shootingFor(prospect) * (0.25 + profile.shootingNeed * 0.75), age: youth * (1 - profile.contender * 0.55), readiness: clamp(((numeric(prospect.overall) ?? 70) - 65) / 20) * profile.contender, upside: clamp(((numeric(prospect.potential) ?? 80) - (numeric(prospect.overall) ?? 70)) / 25) * (1 - profile.contender * 0.5) };
}
function candidateWeight(input, slot, prospect, best, selections = [], snapshot = null, profile = teamProfile(input, slot.currentOwnerTeamId, selections)) {
    const scale = 1.8 + slot.pickNumber * 0.15, market = snapshot?.prospectAggregates[prospect.prospectId], f = selectionFactors(input, slot.currentOwnerTeamId, prospect, selections, profile);
    const quality = clamp((numeric(prospect['draft score']) ?? 70) / 100);
    const distribution = market && snapshot.simulationCount > 0 ? (market.frequencyByPick[slot.pickNumber - 1] || 0) / snapshot.simulationCount : 0;
    const avpFit = market?.avp != null ? Math.exp(-Math.abs(market.avp - slot.pickNumber) / (scale + 2)) : 0.5;
    // Board talent anchors the pick; bounded team factors break close evaluations.
    return Math.exp(-(prospect.board_number - best) / scale) * Math.exp(f.need * 0.9 + f.fit * 0.5 + f.shooting * 0.55 + f.age * 0.35 + f.readiness * 0.3 + f.upside * 0.25 + quality * 0.4) * (0.7 + avpFit * 0.45 + distribution * 2);
}
function chooseProspect(input, slot, selections = [], snapshot = null, rng = Math.random) {
    const drafted = new Set(selections.map(s => s.prospectId)), remaining = input.prospects.filter(p => !drafted.has(p.prospectId));
    if (!remaining.length) throw Error('No undrafted prospects remain.');
    const best = Math.min(...remaining.map(p => p.board_number)), profile = teamProfile(input, slot.currentOwnerTeamId, selections);
    const margin = slot.pickNumber <= 5 ? 2 : slot.pickNumber <= 14 ? 3 : 5;
    const ceiling = Math.max(best, Math.min(best + margin, slot.pickNumber + margin));
    const eligible = remaining.filter(p => p.board_number <= ceiling);
    const choices = eligible.map(p => ({ prospect: p, weight: candidateWeight(input, slot, p, best, selections, snapshot, profile) }));
    let draw = rng() * choices.reduce((sum, p) => sum + p.weight, 0);
    return (choices.find(p => (draw -= p.weight) < 0) || choices.at(-1)).prospect;
}
function project(input, order, snapshot = null, rng = Math.random) {
    const selections = [];
    for (const slot of order) { const p = chooseProspect(input, slot, selections, snapshot, rng); selections.push({ ...slot, prospectId: p.prospectId }); }
    return selections;
}
const GRADES = ['F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];
function evaluate(input, slot, p, selections, market) {
    const expected = market?.avp ?? p.board_number, need = needFor(input, slot.currentOwnerTeamId, p, selections), fit = fitFor(input, slot.currentOwnerTeamId, p, selections);
    const value = (slot.pickNumber - (expected * 0.65 + p.board_number * 0.35)) / Math.max(4, slot.pickNumber * 0.4);
    const upside = Number(p.potential || 80) - Number(p.overall || 70);
    const alternatives = input.prospects.filter(a => !selections.some(s => s.prospectId === a.prospectId) && a.prospectId !== p.prospectId).sort((a,b) => a.board_number - b.board_number);
    const opportunity = alternatives[0] ? Math.max(0, p.board_number - alternatives[0].board_number) / 30 : 0;
    const roster = input.rosters[slot.currentOwnerTeamId] || [], averageOverall = roster.length ? roster.reduce((sum, r) => sum + (Number(r.overall) || 70), 0) / roster.length : 75;
    const quality = ((Number(p['draft score']) || 75) - 75) / 35;
    const production = Math.min(0.4, ((Number(p.pts) || 0) / 20 + (Number(p.ast) || 0) / 8 + (Number(p.rbs) || 0) / 12) / 10);
    const factors = selectionFactors(input, slot.currentOwnerTeamId, p, selections);
    const development = p.age ? Math.max(-0.15, Math.min(0.2, (22 - Number(p.age)) / 20)) : 0;
    const direction = averageOverall >= 83 ? (Number(p.overall || 70) - 70) / 40 : upside / 40;
    const score = Math.round(clamp(6 + clamp(value * 3.2, -4, 4) + need * 1.8 + fit * 1.1 + quality * 2 + production + development + direction + factors.shooting * 0.8 + factors.age * 0.3 - opportunity * 2, 0, 12));
    const prior = selections.filter(s => s.currentOwnerTeamId === slot.currentOwnerTeamId).length;
    const candidates = [{ label: 'Value pick', weight: 0.35 + Math.max(0, value) * 0.4 }];
    if (need > 0.35) candidates.push({ label: need > 0.75 ? 'Perfect fit' : 'Rotation upgrade', weight: need + fit * 0.3 });
    if (upside >= 10) candidates.push({ label: 'Upside swing', weight: upside / 25 + factors.age * 0.2 });
    if (factors.shooting > 0.15) candidates.push({ label: 'Shooting boost', weight: factors.shooting + 0.25 });
    if (fit > 0.15 || POSITIONS.includes(p.position_2)) candidates.push({ label: 'Versatility pick', weight: fit + 0.3 });
    if (Number(p.overall) >= 74) candidates.push({ label: 'Ready to contribute', weight: clamp((Number(p.overall) - 70) / 20) + factors.readiness * 0.4 });
    if (/defen|2-way|two-way|rim protect/.test(traitsFor(p))) candidates.push({ label: 'Defensive reinforcement', weight: 0.45 + fit * 0.5 });
    if (prior) candidates.push({ label: 'Building the haul', weight: 0.65 + need * 0.2 });
    // A crowded position alone does not make a pick a luxury: it may add spacing or upside.
    if (need < 0.15 && fit < 0.15 && factors.shooting < 0.15 && upside < 10) candidates.push({ label: 'Luxury pick', weight: 0.5 });
    for (const c of candidates) c.weight -= Math.min(0.6, selections.filter(s => s.storyline === c.label).length * 0.12);
    const storyline = value > 1 ? 'Steal' : value > 0.5 ? 'The slide ends' : value < -0.7 ? 'Developmental swing' : candidates.sort((a, b) => b.weight - a.weight)[0].label;
    return { grade: GRADES[score], score, value, need, fit, upside, prior, storyline, quality, production, development, direction, opportunity, shooting: factors.shooting, ageFit: factors.age };
}
function reaction(input, slot, p, selections, market) {
    const metrics = evaluate(input, slot, p, selections, market), team = input.teams.find(t => t.teamId === slot.currentOwnerTeamId).teamName, name = p.name, pick = slot.pickNumber;
    const openings = [
        `${team} finds a new building block in ${name}`, `${name} is the next bet for ${team}`, `The board breaks toward ${team}, with ${name} coming off at pick ${pick}`, `At pick ${pick}, ${team} puts its chips on ${name}`, `${team} adds a different dimension with ${name}`, `The next chapter for ${name} starts with ${team}`, `${name} gives ${team} another piece to develop`, `${team} turns this slot into a shot at ${name}`, `There is a clear basketball idea behind ${team}'s selection of ${name}`, `${team} takes the long view with ${name}`,
        `pick ${pick} belongs to ${name}, and ${team} gets to shape what comes next`, `${team} has made its call: ${name} joins the mix`, `A fresh option arrives for ${team} in ${name}`, `${name} lands with ${team} at a meaningful point in this first round`, `${team}'s attention turns to ${name} and the possibilities ahead`, `This part of the board brings ${name} to ${team}`, `${team} walks away from pick ${pick} with ${name}`, `For ${team}, ${name} is the investment at this stage`, `${name} becomes the latest addition to ${team}'s mock class`, `${team} sees a place for ${name} in its next wave`,
        `${name} gets the nod as ${team} reaches its turn`, `${team}'s scouting vision comes into focus with ${name}`, `The call at pick ${pick} sends ${name} to ${team}`, `${team} adds another layer to its roster plan through ${name}`, `${name} is off the board, with ${team} taking the chance`, `This selection gives ${team} a new route through ${name}`, `${team} closes in on its future with a selection of ${name}`, `A spot in ${team}'s rotation is the challenge ahead for ${name}`, `${team} makes room in its mock haul for ${name}`, `${name} rounds out this moment on the board for ${team}`,
    ];
    const expected = market?.avp != null ? `an average selection of ${market.avp.toFixed(1)}` : `Board #${p.board_number}`;
    const value = metrics.value > 0.5 ? [`Landing him here beats ${expected} and leaves room for real surplus value`, `His market baseline of ${expected} makes this a welcome slide for the front office`, `This is attractive territory relative to ${expected}, even before evaluating the fit`]
        : metrics.value < -0.7 ? [`The price runs ahead of ${expected}, so his development needs to justify the investment`, `Compared with ${expected}, this is an assertive bet on the team's evaluation`, `There is less margin for error at this slot than ${expected} would suggest`]
            : [`The price sits close to ${expected}, keeping the focus on what he brings to the floor`, `With ${expected} as the baseline, the value case rests on fit and execution`, `His range around ${expected} makes this a defensible place to invest`];
    const skill = String(p.strength_1 || p.build || 'positional flexibility').replace(/[.!?]/g, '').toLowerCase();
    const fit = metrics.prior ? `After ${metrics.prior} earlier selection${metrics.prior > 1 ? 's' : ''}, ${team} gets ${metrics.need > 0.6 ? 'complementary depth' : 'another option in an increasingly competitive rotation'} through his ${skill}` : metrics.need > 0.65 ? `His ${skill} gives the ${p.position_1 || 'rotation'} group a needed lift${p.height ? `, with a ${p.height} frame adding to the appeal` : ''}` : `The appeal is his ${skill}, although rotation minutes will need to be earned rather than assumed`;
    const risk = String(p.weakness_1 || 'consistency').replace(/[.!?]/g, '').toLowerCase();
    const endings = [`Improvement in ${risk} will determine how far this pick can outperform its slot`, `The next step is turning that promise into reliable minutes while addressing ${risk}`, `His ceiling stays compelling, but ${risk} remains the development priority`, `A patient plan for ${risk} gives this bet its best chance to pay off`, `The payoff depends on whether ${risk} becomes a manageable concern rather than a limiting factor`];
    return { ...metrics, analysis: [openings[(pick - 1) % openings.length], value[pick % value.length], fit, endings[(pick + p.board_number) % endings.length]].map(s => `${s}.`).join(' ') };
}
module.exports = { ENGINE_VERSION, candidateWeight, selectionFactors, shootingFor, playerAge, seededRandom, needFor, fitFor, chooseProspect, project, evaluate, reaction, GRADES };
