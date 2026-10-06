require('dotenv').config();
const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { createMockSimulationService } = require('../src/fantasyhq/mock-simulations');
async function main() {
    const repository = createFantasyHQRepository(), service = createMockSimulationService({ repository });
    const index = process.argv.indexOf('--league');
    const leagueId = index >= 0 ? process.argv[index + 1] : repository.loadLeagueContext({ guildId: process.env.GUILD_ID }).league.leagueId;
    if (!leagueId) throw Error('Supply --league <configured league ID>.');
    service.reconcileRequests(leagueId);
    const result = await service.refresh(leagueId, { force: true });
    console.log(JSON.stringify({ leagueId: result.leagueId, seasonId: result.seasonId, draftClassId: result.draftClassId, simulationCount: result.simulationCount, snapshotId: result.id, generatedAt: result.generatedAt, warnings: result.metadata.warnings }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
