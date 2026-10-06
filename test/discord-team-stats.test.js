const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordTeamStatsHandlers } = require('../src/fantasyhq/discord-team-stats');

function fixture(stats) {
    const repository = {
        loadLeagueContext: () => ({
            league: { leagueId: 'league', leagueName: 'Test League', seasonNumber: 1 }, seasonId: 'season-1', teams: [
                { teamId: 'atl', teamName: 'Atlanta Hawks', abbreviation: 'ATL' },
            ]
        }),
    };
    const teamStatsService = { getTeamSeasonStats: () => stats };
    return createDiscordTeamStatsHandlers({ repository, teamStatsService });
}

test('/teamstats returns compact official team record, averages and shooting rates', async () => {
    const service = fixture({ teamId: 'atl', teamName: 'Atlanta Hawks', GP: 8, W: 5, L: 3, PCT: 0.625, PPG: 118.4, OPP_PPG: 112.1, AVG_DIFF: 6.3, RPG: 46.8, APG: 27.4, SPG: 7.9, BPG: 5.3, TOV: 12.1, FGPercent: 48.7, threePPercent: 38.2, FTPercent: 81.4 });
    let payload;
    await service.handleTeamStatsCommand({ guildId: 'guild', options: { getString: () => 'atl' }, editReply: async value => { payload = value; } });
    const embed = payload.embeds[0].toJSON();
    assert.match(embed.title, /Atlanta Hawks/);
    assert.match(JSON.stringify(embed.fields), /5-3/);
    assert.match(JSON.stringify(embed.fields), /118\.4/);
    assert.match(JSON.stringify(embed.fields), /112\.1/);
    assert.match(JSON.stringify(embed.fields), /\+6\.3/);
    assert.match(JSON.stringify(embed.fields), /48\.7%/);
    assert.equal(payload.allowedMentions.parse.length, 0);
});

test('/teamstats gives a clean message when no official games exist', async () => {
    const service = fixture({ teamId: 'atl', teamName: 'Atlanta Hawks', GP: 0 });
    let reply;
    await service.handleTeamStatsCommand({ guildId: 'guild', options: { getString: () => 'atl' }, editReply: async value => { reply = value; } });
    assert.equal(reply, 'No official regular-season team statistics yet for Atlanta Hawks.');
});

test('/teamstats autocomplete resolves league teams by name, abbreviation or id', async () => {
    const service = fixture({ GP: 0 });
    let choices;
    await service.handleTeamStatsAutocomplete({ guildId: 'guild', options: { getFocused: () => 'hawks' }, respond: async value => { choices = value; } });
    assert.deepEqual(choices, [{ name: 'ATL · Atlanta Hawks', value: 'atl' }]);
});