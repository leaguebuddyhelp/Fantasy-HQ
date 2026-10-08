const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { loadAllPlayers } = require('../src/2kratings/repository');
function syncLeagueContracts(repository, leagueId, sources = loadAllPlayers({ includeFreeAgency: false })) {
    const key = name => String(name || '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const players = repository.loadPlayers(leagueId);
    let updated = 0;
    for (const player of players) {
        let matches = sources.filter(source => source.profileUrl && source.profileUrl === player.profileUrl);
        if (!matches.length) matches = sources.filter(source => key(source.name) === key(player.name));
        if (matches.length !== 1 || !matches[0].contract) continue;
        if (JSON.stringify(player.contract) === JSON.stringify(matches[0].contract)) continue;
        player.contract = structuredClone(matches[0].contract);
        updated++;
    }
    if (updated) repository.savePlayers(leagueId, players);
    return { leagueId, players: players.length, updated, withContracts: players.filter(p => p.contract).length };
}
if (require.main === module) {
    require('dotenv').config({quiet:true});
    const repository = createFantasyHQRepository();
    const lease = require('../src/fantasyhq/storage-safety').acquireWriterLease(repository.dataRoot);
    try {
    const index = process.argv.indexOf('--league');
    const leagueId = index >= 0 ? process.argv[index + 1] : repository.loadLeagueContext({guildId:process.env.GUILD_ID}).league.leagueId;
    console.log(JSON.stringify(syncLeagueContracts(repository, leagueId)));
    } finally { lease.release(); }
}
module.exports = { syncLeagueContracts };
