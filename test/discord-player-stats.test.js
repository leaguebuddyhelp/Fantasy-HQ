const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordPlayerStatsHandlers } = require('../src/fantasyhq/discord-player-stats');

function handlers(stats, games = []) {
    const repository = { loadLeagueContext: () => ({ league: { leagueId: 'league', leagueName: 'Test League', seasonNumber: 1 }, seasonId: 'season-1' }) };
    const playerService = {
        getPlayer: (leagueId, seasonId, playerId) => ({ playerId, name: 'Donovan Mitchell', teamName: 'Cleveland Cavaliers' }),
        listPlayers: () => [{ playerId: 'player-1', name: 'Donovan Mitchell', teamName: 'Cleveland Cavaliers' }],
    };
    const statsService = { getPlayerStatsAndGameLog: () => ({ stats, games }) };
    return createDiscordPlayerStatsHandlers({ repository, playerService, statsService });
}

test('/stats player returns official season averages and last-game summary', async () => {
    const service = handlers({ GP: 8, MPG: 36.2, PPG: 26.4, RPG: 4.8, APG: 5.9, SPG: 1.4, BPG: 0.5, TOV: 2.1, FGPercent: 48.2, threePPercent: 39.1, FTPercent: 86.4 }, [
        { week: 8, DNP: false, PTS: 28, REB: 5, AST: 7, result: 'W', opponent: 'Boston Celtics', score: '112-108' },
    ]);
    let payload;
    await service.handleStatsCommand({ guildId: 'guild', user: { id: 'coach' }, options: { getString: () => 'player-1' }, editReply: async value => { payload = value; } });
    const embed = payload.embeds[0].toJSON();
    assert.equal(embed.title, 'Donovan Mitchell');
    assert.match(embed.description, /Cleveland Cavaliers/);
    assert.match(JSON.stringify(embed.fields), /26\.4/);
    assert.match(JSON.stringify(embed.fields), /48\.2%/);
    assert.match(embed.fields.find(field => field.name === 'Last Game').value, /28 PTS · 5 REB · 7 AST · W vs Boston Celtics/);
});

test('/stats player returns a clean no-official-games message', async () => {
    const service = handlers({ GP: 0 });
    let reply;
    await service.handleStatsCommand({ guildId: 'guild', user: { id: 'coach' }, options: { getString: () => 'player-1' }, editReply: async value => { reply = value; } });
    assert.equal(reply, 'No official regular-season statistics yet for Donovan Mitchell. Age — · Trade Value 1.');
});

test('/stats autocomplete suggests league players by name and team', async () => {
    const service = handlers({ GP: 0 });
    let choices;
    await service.handleStatsAutocomplete({ guildId: 'guild', options: { getFocused: () => 'donovan' }, respond: async value => { choices = value; } });
    assert.deepEqual(choices, [{ name: 'Donovan Mitchell · Cleveland Cavaliers · Age — · TV 1', value: 'player-1' }]);
});