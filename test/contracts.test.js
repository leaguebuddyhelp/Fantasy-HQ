const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TEAM_CODES, parsePayroll, matchContract, loadPayroll } = require('../src/scrapers/2kratings/contracts');
const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { createRosterService } = require('../src/fantasyhq/roster-service');
const html = `<table id="contracts"><thead><tr><th data-stat="player">Player</th><th data-stat="y1">2026-27</th><th data-stat="y2">2027-28</th><th data-stat="y3">2028-29</th></tr></thead><tbody>
<tr><th data-stat="player"><a href="/players/j/johnsja05.html">Jálén Johnson</a></th><td data-stat="y1">$30,000,000</td><td data-stat="y2" class="salary-pl">$31,000,000</td><td data-stat="y3" class="salary-tm">$32,000,000</td><td data-stat="remain_gtd">$61,000,000</td></tr>
<tr><th data-stat="player"><a href="/players/d/dennira01.html">RayJ Dennis</a></th><td data-stat="y1"></td><td data-stat="y2"></td><td data-stat="y3"></td></tr>
</tbody><tfoot><tr><th data-stat="player">Team Totals</th><td data-stat="y1">$40,000,000</td><td data-stat="y2">$31,000,000</td><td data-stat="y3"></td></tr></tfoot></table>`;
const options = { sourceUrl: 'https://www.basketball-reference.com/contracts/ATL.html', fetchedAt: '2026-10-07T12:00:00Z' };

test('payroll parses season labels, precise salaries, options, guarantees and totals including commented tables', () => {
    for (const source of [html, `<!--${html}-->`]) {
        const p = parsePayroll(source, options);
        assert.equal(p.players.length, 2);
        assert.deepEqual(p.seasons, ['2026-27', '2027-28', '2028-29']);
        assert.equal(p.players[0].contract.guaranteedTotal, 61000000);
        assert.deepEqual(p.players[0].contract.seasons, [
            { season: '2026-27', salary: 30000000, option: null },
            { season: '2027-28', salary: 31000000, option: 'PLAYER' },
            { season: '2028-29', salary: 32000000, option: 'TEAM' },
        ]);
        assert.equal(p.players[1].contract.seasons[0].salary, null);
        assert.equal(p.players[1].contract.guaranteedTotal, null);
        assert.equal(p.teamTotals[0].salary, 40000000);
        assert.equal(p.players[0].contract.fetchedAt, options.fetchedAt);
    }
    assert.equal(Object.keys(TEAM_CODES).length, 30);
    assert.throws(() => parsePayroll('<h1>Access denied</h1>', options), /table/);
    assert.throws(() => parsePayroll(html.replace('$30,000,000','unknown'), options), /Unreadable/);
});

test('contracts match punctuation and accents but never guess similar or duplicate identities', () => {
    const p = parsePayroll(html, options);
    assert.equal(matchContract('Jalen Johnson', p).guaranteedTotal, 61000000);
    assert.equal(matchContract('Jalen Johns', p), null);
    p.players.push(p.players[0]);
    assert.equal(matchContract('Jalen Johnson', p), null);
});

test('payroll failures retain last successful snapshot with a stale status and original source date', async t => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(),'lb-payroll-'));
    t.after(() => fs.rmSync(cacheDir,{recursive:true,force:true}));
    const team = { slug:'atlanta-hawks', name:'Atlanta Hawks' };
    const first = await loadPayroll(team,{cacheDir,fetcher:async()=>({ok:true,text:async()=>html}),now:()=>options.fetchedAt});
    const fallback = await loadPayroll(team,{cacheDir,fetcher:async()=>({ok:false,status:403})});
    assert.equal(first.status,'CURRENT');
    assert.equal(fallback.status,'STALE');
    assert.equal(fallback.fetchedAt,options.fetchedAt);
    assert.match(fallback.error,/403/);
    assert.deepEqual(fallback.players,first.players);
    assert.equal(JSON.parse(fs.readFileSync(path.join(cacheDir,'ATL.json'))).status,'CURRENT');
    await assert.rejects(loadPayroll({slug:'boston-celtics'},{cacheDir,fetcher:async()=>({ok:false,status:403})}),/403/);
    assert.equal(await loadPayroll({slug:'free-agency'},{cacheDir,fetcher:async()=>{throw Error('Should not request');}}),null);
});

test('roster import updates structured contracts and preserves them when payroll is absent', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'lb-contract-import-'));
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const repository = createFantasyHQRepository({dataRoot:root});
    repository.saveLeague('l',{currentSeasonId:'1',seasonNumber:1});
    repository.saveTeams('l',[{teamId:'atl',teamName:'Atlanta Hawks',abbreviation:'ATL',conference:'East'}]);
    const player = {playerId:'jalen',name:'Jalen Johnson',overall:85,position1:'PF',profileUrl:'https://example.com/jalen'};
    repository.savePlayers('l',[player]);
    repository.saveRosterMemberships('l',[{playerId:'jalen',teamId:'atl',seasonId:'1',position1:'PF',active:true}]);
    const imported = {...player,contract:parsePayroll(html,options).players[0].contract};
    const service = createRosterService({repository,sourceRosterLoader:()=>({players:[imported]})});
    assert.equal(service.diffRosterImport({leagueId:'l',seasonId:'1',teamId:'atl'}).changes[0].changes.find(c=>c.field==='contract').after.guaranteedTotal,61000000);
    service.applyRosterImport({leagueId:'l',seasonId:'1',teamId:'atl'});
    assert.deepEqual(repository.loadPlayers('l')[0].contract,imported.contract);
    imported.contract = structuredClone(imported.contract);
    imported.contract.seasons[0].salary = 35000000;
    assert.ok(service.diffRosterImport({leagueId:'l',seasonId:'1',teamId:'atl'}).changes[0].changes.some(c=>c.field==='contract'));
    delete imported.contract;
    assert.equal(service.diffRosterImport({leagueId:'l',seasonId:'1',teamId:'atl'}).changes.length,0);
    assert.equal(repository.loadPlayers('l')[0].contract.seasons[0].salary,30000000);
});
