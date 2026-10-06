const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { normalizeText } = require('../service-helpers');
function loadLearning(repository, leagueId) {
    const file = path.join(repository.buildLeaguePaths(repository.dataRoot, leagueId).leagueRoot, 'ocr-learning.json');
    if (!fs.existsSync(file)) return { version: 1, aliases: {}, approvedGames: [] };
    try {
        const learned = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!learned.aliases || typeof learned.aliases !== 'object' || Array.isArray(learned.aliases) || !Array.isArray(learned.approvedGames)) throw Error('Invalid OCR learning data.');
        return learned;
    } catch (error) { console.error('OCR learning read:', error.message); return { version: 1, aliases: {}, approvedGames: [] }; }
}
function learnApprovedReview(repository, record, source) {
    if (record.game.status !== 'FINAL' || !source.correctedInput || source.issues?.length) return;
    const learning = loadLearning(repository, record.game.leagueId);
    if (learning.approvedGames.includes(record.game.gameId)) return;
    for (const screen of source.normalized.screenshots) for (const player of screen.players) {
        if (!player.playerId || !(source.rosterSnapshot?.[screen.teamId] || []).some(p => p.playerId === player.playerId)) continue;
        const alias = normalizeText(player.displayedName);
        if (!alias || alias.length < 3) continue;
        const matches = Object.hasOwn(learning.aliases, alias) ? learning.aliases[alias] : (learning.aliases[alias] = {});
        matches[player.playerId] = (matches[player.playerId] || 0) + 1;
    }
    learning.approvedGames.push(record.game.gameId);
    const file = path.join(repository.buildLeaguePaths(repository.dataRoot, record.game.leagueId).leagueRoot, 'ocr-learning.json');
    const temp = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(learning, null, 2)); fs.renameSync(temp, file);
}
function learnApprovedHistory(submissions) {
    for (const record of submissions.records()) {
        const source = record.extractions?.find(e => e.extractionId === record.game.approval?.extractionId);
        if (record.game.status === 'FINAL' && source?.actor?.principal === 'website-commissioner-key') learnApprovedReview(submissions.repository, record, source);
    }
}
module.exports = { loadLearning, learnApprovedReview, learnApprovedHistory };
