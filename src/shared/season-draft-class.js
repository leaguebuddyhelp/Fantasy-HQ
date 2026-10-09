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
module.exports = { seasonDraftClass };
