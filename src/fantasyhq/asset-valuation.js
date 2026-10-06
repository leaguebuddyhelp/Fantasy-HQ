const POSITION_BASELINES = Object.freeze({
    PG: { height: 75, wingspan: 3.5 },
    SG: { height: 77, wingspan: 4 },
    SF: { height: 79, wingspan: 4.5 },
    PF: { height: 81, wingspan: 4.5 },
    C: { height: 83, wingspan: 5 },
});

const PICK_PROTECTIONS = Object.freeze({
    UNPROTECTED: { label: "Unprotected", multiplier: 1 },
    TOP_3: { label: "Top-3 Protected", multiplier: 0.88 },
    TOP_5: { label: "Top-5 Protected", multiplier: 0.78 },
    TOP_10: { label: "Top-10 Protected", multiplier: 0.66 },
    LOTTERY: { label: "Lottery Protected", multiplier: 0.7 },
});

function leagueSeasonStartYear(seasonNumber) {
    const value = Number(seasonNumber);
    if (!Number.isInteger(value) || value < 1) return 2026;
    return value >= 2026 ? value : 2026 + value - 1;
}

function leagueAge(birthdate, seasonNumber) {
    if (!birthdate) return null;
    const parsed = new Date(birthdate);
    if (!Number.isFinite(parsed.getTime())) return null;
    const referenceYear = leagueSeasonStartYear(seasonNumber);
    const reference = Date.UTC(referenceYear, 9, 20);
    const born = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
    if (born > reference) return null;
    let age = referenceYear - parsed.getUTCFullYear();
    if (parsed.getUTCMonth() > 9 || (parsed.getUTCMonth() === 9 && parsed.getUTCDate() > 20)) age -= 1;
    return age;
}

function parseHeightInches(value, centimeters = null) {
    const cm = Number(centimeters);
    if (Number.isFinite(cm) && cm > 0) return cm / 2.54;
    if (Number.isFinite(Number(value)) && Number(value) > 100) return Number(value) / 2.54;
    const match = String(value || "").match(/(\d+)\s*['′-]\s*(\d+(?:\.\d+)?)/);
    if (match) return Number(match[1]) * 12 + Number(match[2]);
    const inches = String(value || "").match(/^(\d+(?:\.\d+)?)\s*(?:in|inches|\")$/i);
    return inches ? Number(inches[1]) : null;
}

function primaryPosition(player) {
    const value = String(player.position1 || player.primaryPosition || "").toUpperCase();
    if (POSITION_BASELINES[value]) return value;
    const second = String(player.position2 || player.secondaryPosition || "").toUpperCase();
    return POSITION_BASELINES[second] ? second : "SF";
}

function ageMultiplier(age) {
    if (age == null) return 0.94;
    if (age <= 21) return 1.15;
    if (age <= 24) return 1.15 - (age - 21) * 0.03;
    if (age <= 27) return 1.06 - (age - 24) * 0.02;
    if (age <= 33) return 1 - (age - 27) * 0.035;
    return Math.max(0.68, 0.79 - (age - 33) * 0.025);
}

function evaluatePlayerTradeValue(player = {}, seasonNumber = 1) {
    const overall = Number(player.overall);
    const safeOverall = Number.isFinite(overall) ? Math.max(0, Math.min(99, overall)) : 0;
    const age = leagueAge(player.birthdate, seasonNumber);
    const position = primaryPosition(player);
    const baseline = POSITION_BASELINES[position];
    const height = parseHeightInches(player.height, player.heightCm);
    const wingspan = parseHeightInches(player.wingspan);
    const heightModifier = height == null ? 1 : 1 + Math.max(-3, Math.min(3, height - baseline.height)) * 0.01;
    const wingspanDelta = height == null || wingspan == null ? null : (wingspan - height) - baseline.wingspan;
    const wingspanModifier = wingspanDelta == null ? 1 : 1 + Math.max(-4, Math.min(4, wingspanDelta)) * 0.0075;
    const positions = new Set([player.position1, player.position2].filter(Boolean).map(value => String(value).toUpperCase()));
    const versatilityModifier = positions.size > 1 ? 1.025 : 1;
    const years = Math.max(0, Math.min(12, Number(player.yearsInNBA) || 0));
    const experienceModifier = 1 + Math.min(0.03, years * 0.004);
    const archetype = String(player.archetype || "").toLowerCase();
    const archetypeModifier = /rim protector|defensive anchor|two-way/.test(archetype) && ["PF", "C"].includes(position) ? 1.01 : 1;
    const contractModifier = 1;
    const overallBase = 1 + 1100 * (safeOverall / 99) ** 4.5;
    const unrounded = overallBase * ageMultiplier(age) * heightModifier * wingspanModifier * versatilityModifier * experienceModifier * archetypeModifier * contractModifier;
    return {
        value: Math.max(1, Math.round(unrounded)),
        age,
        components: { overallBase, ageMultiplier: ageMultiplier(age), heightModifier, wingspanModifier, versatilityModifier, experienceModifier, archetypeModifier, contractModifier },
    };
}

function playerTradeValue(player, seasonNumber) {
    return evaluatePlayerTradeValue(player, seasonNumber).value;
}

function rosterStrength(teamPlayers = [], seasonNumber = 1) {
    const values = teamPlayers.map(player => playerTradeValue(player, seasonNumber)).sort((a, b) => b - a);
    const weights = [1, 0.84, 0.7, 0.59, 0.49, 0.4, 0.33, 0.27, 0.22, 0.18, 0.15, 0.12, 0.1, 0.08, 0.06];
    const used = values.slice(0, weights.length);
    const weightTotal = used.reduce((sum, _, index) => sum + weights[index], 0);
    return weightTotal ? used.reduce((sum, value, index) => sum + value * weights[index], 0) / weightTotal : 0;
}

function teamOutlooks(teams, rostersByTeam, standingsByTeam, currentWeek, seasonNumber) {
    const rosterScores = new Map(teams.map(team => [team.teamId, rosterStrength(rostersByTeam.get(team.teamId) || [], seasonNumber)]));
    const records = new Map(teams.map(team => {
        const row = standingsByTeam.get(team.teamId) || {};
        const games = Number(row.GP) || 0;
        return [team.teamId, games ? (Number(row.W) || 0) / games : 0.5];
    }));
    const rankScore = (map, teamId) => {
        const ordered = [...teams].sort((a, b) => map.get(a.teamId) - map.get(b.teamId));
        const value = map.get(teamId);
        const lower = ordered.filter(team => map.get(team.teamId) < value).length;
        const tied = ordered.filter(team => map.get(team.teamId) === value).length;
        const averageIndex = lower + (tied - 1) / 2;
        return teams.length <= 1 ? 0.5 : averageIndex / (teams.length - 1);
    };
    const recordWeight = Math.max(0.05, Math.min(0.65, ((Number(currentWeek) || 1) - 1) / 10 * 0.65));
    return new Map(teams.map(team => {
        const rosterRank = rankScore(rosterScores, team.teamId);
        const recordRank = rankScore(records, team.teamId);
        const strength = rosterRank * (1 - recordWeight) + recordRank * recordWeight;
        return [team.teamId, { strength, projectedPick: 1 + Math.round(strength * Math.max(0, teams.length - 1)), recordWeight }];
    }));
}

function pickTradeValue({ round, draftYear, currentYear, originalTeamId, outlooks, protection = "UNPROTECTED" }) {
    const pickRound = Number(round);
    if (![1, 2].includes(pickRound)) throw new Error("Draft pick round must be 1 or 2.");
    const pickYear = Number(draftYear);
    const year = Number(currentYear);
    const protections = PICK_PROTECTIONS[protection] ? protection : "UNPROTECTED";
    const outlook = outlooks.get(originalTeamId) || { strength: 0.5, projectedPick: 15.5 };
    const yearsOut = Math.max(0, pickYear - year);
    const baseValue = pickRound === 1 ? 380 : 100;
    const originalTeamMultiplier = pickRound === 1 ? 1.45 - outlook.strength * 0.9 : 1.22 - outlook.strength * 0.42;
    const futureMultiplier = 0.9 ** Math.max(0, yearsOut - 1);
    const value = Math.max(1, Math.round(baseValue * originalTeamMultiplier * futureMultiplier * PICK_PROTECTIONS[protections].multiplier));
    return { value, yearsOut, projectedPick: outlook.projectedPick, protection: protections };
}

module.exports = {
    PICK_PROTECTIONS,
    ageMultiplier,
    evaluatePlayerTradeValue,
    leagueAge,
    leagueSeasonStartYear,
    parseHeightInches,
    pickTradeValue,
    playerTradeValue,
    rosterStrength,
    teamOutlooks,
};