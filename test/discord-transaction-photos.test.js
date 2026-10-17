const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path'), sharp = require('sharp');
const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { createRosterPhotoSync } = require('../src/fantasyhq/roster-photo-sync');
const { createDiscordTransactionPhotos } = require('../src/fantasyhq/discord-transaction-photos');
const teams = [{ teamId: 'hou', teamName: 'Houston Rockets', abbreviation: 'HOU', conference: 'West' }, { teamId: 'chi', teamName: 'Chicago Bulls', abbreviation: 'CHI', conference: 'East' }];
const pool = [{ playerId: 'r', name: 'Randall Pope', overall: 71, teamId: null }, { playerId: 't', name: 'Tre Jones', overall: 74, teamId: 'chi' }];
const rows = [{ type: 'SIGNING', date: '10/16/2026', news: 'Bulls sign C Randall Pope to 1yr/$1.36M deal' }, { type: 'WAIVE', date: '10/17/2026', news: 'Bulls waive C Tre Jones' }];

async function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'txn-photos-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const repository = createFantasyHQRepository({ dataRoot: root });
    repository.saveLeague('league', { commissionerUserId: 'owner', currentPhase: 'REGULAR_SEASON', currentSeasonId: '1', seasonNumber: 1 });
    repository.saveTeams('league', teams); repository.savePlayers('league', structuredClone(pool));
    repository.saveRosterMemberships('league', [{ playerId: 't', teamId: 'chi', seasonId: '1', active: true }]);
    repository.loadLeagueContext = () => ({ league: { leagueId: 'league' } });
    const service = createRosterPhotoSync({ repository, recognize: async () => ({ text: 'Transaction Report', rows }), backup: () => ({ id: 'backup' }) });
    const png = await sharp({ create: { width: 100, height: 60, channels: 3, background: '#123456' } }).png().toBuffer();
    const workflow = createDiscordTransactionPhotos({ repository, service, download: async file => file.bytes || png });
    return { repository, workflow, png };
}
function command(files, staff = true) {
    const result = { edits: [] };
    Object.assign(result, {
        guildId: 'guild', user: { id: 'staff' }, memberPermissions: { has: () => staff }, member: { roles: { cache: { some: () => false } } },
        options: { getAttachment: name => files[Number(name.slice(4)) - 1] || null },
        editReply: async payload => { result.edits.push(payload); }, deferUpdate: async () => { }, customId: '',
    });
    return result;
}
const file = (id, extra = {}) => ({ id, name: `report-${id}.png`, contentType: 'image/png', ...extra });

test('staff command reads pictures, shows a review, and only changes rosters after Confirm', async t => {
    const f = await fixture(t);
    const i = command([file('1')]);
    await f.workflow.handle(i);
    const review = i.edits.at(-1);
    assert.match(review.embeds[0].toJSON().description, /Randall Pope.*Free agency → Chicago Bulls/);
    assert.match(review.embeds[0].toJSON().description, /Tre Jones.*Chicago Bulls → Free agency/);
    assert.equal(f.repository.loadRosterMemberships('league').some(m => m.playerId === 'r'), false);
    const confirmId = review.components[0].toJSON().components[0].custom_id;
    const click = command([]); click.customId = confirmId;
    await f.workflow.button(click);
    assert.match(click.edits.at(-1).content, /Rosters updated/);
    assert.equal(f.repository.loadRosterMemberships('league').find(m => m.playerId === 'r' && m.active)?.teamId, 'chi');
});

test('cancel changes nothing and non-staff cannot use the command or buttons', async t => {
    const f = await fixture(t);
    await assert.rejects(f.workflow.handle(command([file('1')], false)), /need LEAGUEbuddy/);
    const i = command([file('1')]); await f.workflow.handle(i);
    const cancel = command([]); cancel.customId = i.edits.at(-1).components[0].toJSON().components[1].custom_id;
    await f.workflow.button(cancel);
    assert.match(cancel.edits.at(-1).content, /Cancelled/);
    const outsider = command([], false); outsider.customId = i.edits.at(-1).components[0].toJSON().components[0].custom_id;
    await f.workflow.button(outsider);
    assert.match(outsider.edits.at(-1).content, /need LEAGUEbuddy/);
    assert.equal(f.repository.loadRosterMemberships('league').some(m => m.playerId === 'r'), false);
});

test('non-picture and corrupt files are reported while readable pictures still work; several files dedupe', async t => {
    const f = await fixture(t);
    const i = command([file('1'), file('2', { name: 'notes.pdf', contentType: 'application/pdf' }), file('3', { name: 'broken.png', bytes: Buffer.from('not an image') }), file('1')]);
    await f.workflow.handle(i);
    const embed = i.edits.at(-1).embeds[0].toJSON();
    const problems = embed.fields.find(x => /could not be read/.test(x.name)).value;
    assert.match(problems, /notes\.pdf: Only pictures/);
    assert.match(problems, /broken\.png/);
    assert.equal(embed.fields.find(x => x.name === 'Roster changes').value, '2');
});

test('no files or no readable rows give a clear message and leave rosters alone', async t => {
    const f = await fixture(t);
    await assert.rejects(f.workflow.handle(command([])), /Attach at least one/);
    const i = command([file('2', { contentType: 'application/pdf' })]); await f.workflow.handle(i);
    assert.match(i.edits.at(-1).content, /No complete transaction rows/);
});
