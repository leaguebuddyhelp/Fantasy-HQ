const PROSPECT_STAT_FIELDS = ['pts', 'rbs', 'ast', 'stls', 'blks'];
function prospectStatsAvailable(phase) {
    return ['OFFSEASON', 'DRAFT'].includes(phase);
}
function visibleProspectStats(prospect, phase) {
    const visible = { ...prospect };
    if (!prospectStatsAvailable(phase)) for (const field of PROSPECT_STAT_FIELDS) delete visible[field];
    return visible;
}
module.exports = { PROSPECT_STAT_FIELDS, prospectStatsAvailable, visibleProspectStats };
