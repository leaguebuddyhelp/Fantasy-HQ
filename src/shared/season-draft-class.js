// All league draft views share the same season-to-class mapping.
function seasonDraftClass(files, seasonNumber, board = 'Big Board') {
    const season = Number(seasonNumber);
    if (!Number.isInteger(season) || season < 1) throw Error('The league season number is invalid.');
    const matches = files.filter(file => {
        const match = file.match(/CUS(\d+)\s*-\s*(Big Board|Early Top Ten)\.json$/i);
        return match && Number(match[1]) === season && match[2].toLowerCase() === board.toLowerCase();
    });
    if (matches.length !== 1) throw Error(`Season ${season} requires one CUS${String(season).padStart(2, '0')} ${board} file.`);
    return matches[0];
}
// A season keeps its full board through postseason/offseason; rollover opens
// the next season's early preview. Unknown phases fail closed.
function seasonDraftBoard(phase) {
    if (['SETUP', 'PRESEASON'].includes(phase)) return 'Early Top Ten';
    if (['REGULAR_SEASON', 'PLAYOFFS', 'OFFSEASON', 'DRAFT', 'FREE_AGENCY'].includes(phase)) return 'Big Board';
    throw Error('The league season phase is invalid.');
}
module.exports = { seasonDraftClass, seasonDraftBoard };
