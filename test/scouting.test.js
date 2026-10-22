const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { createScoutingService } = require('../src/fantasyhq/scouting-service');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-scouting-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dataRoot = path.join(root, 'data'), draftClassDir = path.join(root, 'draft_class');
    fs.mkdirSync(draftClassDir, { recursive: true });
    const prospect = boardNumber => ({ board_number: boardNumber, name: boardNumber === 1 ? 'Léandre Charbonneau' : `Prospect ${boardNumber}`, position_1: boardNumber === 1 ? 'PG' : boardNumber === 2 ? 'PF' : 'SF', position_2: boardNumber === 1 ? 'SG' : boardNumber === 2 ? 'C' : 'SG', overall: 80 + boardNumber, potential: 90 + boardNumber, 'draft score': 88 + boardNumber });
    for (const [season, value] of [[1, 10], [2, 20]]) {
        const board = Object.fromEntries(Array.from({ length: 25 }, (_, index) => {
            const boardNumber = index + 1;
            const player = prospect(boardNumber);
            return [String(boardNumber), boardNumber === 1 ? { ...player, overall: value, potential: value + 10, 'draft score': value + 20 } : player];
        }));
        fs.writeFileSync(path.join(draftClassDir, `2k27_CUS${String(season).padStart(2, '0')} - Big Board.json`), JSON.stringify(board));
        fs.writeFileSync(path.join(draftClassDir, `2k27_CUS${String(season).padStart(2, '0')} - Early Top Ten.json`), JSON.stringify(Object.fromEntries(Object.entries(board).slice(0, 10))));
    }
    const repository = createFantasyHQRepository({ dataRoot });
    const teams = ['East', 'West'].flatMap(conference => Array.from({ length: 15 }, (_, index) => ({ teamId: `${conference}-${index}`, teamName: `${conference} ${index}`, abbreviation: `${conference[0]}${index}`, conference })));
    repository.saveLeague('league', { currentPhase: 'REGULAR_SEASON', currentSeasonId: '1', seasonNumber: 1, currentWeek: 1 });
    repository.saveTeams('league', teams);
    repository.saveGuildLeagueBinding('guild', { leagueId: 'league', seasonId: '1' });
    repository.saveSettings('league', { discordChannels: { scouting: 'scouting-hub' } });
    const schedule = { leagueId: 'league', seasonId: '1', weeks: [1, 2].map(week => ({ week, weekId: `league:1:week:${week}`, status: week === 1 ? 'ACTIVE' : 'UPCOMING', games: [], byes: [] })) };
    repository.saveSchedule(schedule);
    return { repository, draftClassDir, schedule, service: createScoutingService({ repository, draftClassDir }) };
}

test('season number selects matching board and prospect autocomplete narrows by player name', t => {
    const f = fixture(t);
    assert.equal(f.service.inspect('guild', 'coach-a', 1).prospect['draft score'], 30);
    assert.equal(f.service.scoutingHubChannelId('guild'), 'scouting-hub');
    assert.deepEqual(f.service.prospects('guild', 'leandre'), [{ name: '#1 Léandre Charbonneau', value: '1' }]);
    assert.deepEqual(f.service.prospects('guild', '', 'PF'), [{ name: '#2 Prospect 2', value: '2' }]);
    assert.deepEqual(f.service.prospects('guild', 'leandre', 'PF'), []);
    f.repository.saveLeague('league', { seasonNumber: 2, currentSeasonId: '2', currentWeek: 1 });
    f.repository.saveGuildLeagueBinding('guild', { leagueId: 'league', seasonId: '2' });
    const seasonTwo = { ...f.schedule, seasonId: '2', weeks: f.schedule.weeks.map(week => ({ ...week, weekId: `league:2:week:${week.week}` })) };
    f.repository.saveSchedule(seasonTwo);
    assert.equal(f.service.inspect('guild', 'coach-a', 1).prospect['draft score'], 40);
    assert.equal(f.service.inspect('guild', 'coach-a', 1).prospect.overall, 20);
});

test('CUS04 portraits follow the explicit player image mapping rather than board rank', t => {
    const f = fixture(t);
    const service = createScoutingService({ repository: f.repository, draftClassDir: path.join(__dirname, '..', 'draft_class') });
    const board = service.boardForContext({ league: { seasonNumber: 4, currentPhase: 'REGULAR_SEASON' } });
    for (const name of ['Marteese Jefferson', 'Eliott Tissot']) {
        const prospect = board.prospects.find(player => player.name === name);
        assert.equal(prospect.imagePath, path.resolve(__dirname, '..', 'draft_class', prospect.image));
        assert.ok(fs.existsSync(prospect.imagePath));
    }
});

test('each coach gets 60 weekly points and each prospect reveals draft grade, OVR, potential for 10 points each', t => {
    const f = fixture(t);
    assert.equal(f.service.inspect('guild', 'coach-a', 1).remaining, 60);
    const draftGrade = f.service.scout('guild', 'coach-a', 1);
    assert.equal(draftGrade.remaining, 50);
    assert.deepEqual(draftGrade.reveals.map(reveal => reveal.unlocked), [true, false, false]);
    const overall = f.service.scout('guild', 'coach-a', 1);
    assert.equal(overall.remaining, 40);
    assert.deepEqual(overall.reveals.map(reveal => reveal.unlocked), [true, true, false]);
    const potential = f.service.scout('guild', 'coach-a', 1);
    assert.equal(potential.remaining, 30);
    assert.deepEqual(potential.reveals.map(reveal => reveal.unlocked), [true, true, true]);
    assert.throws(() => f.service.scout('guild', 'coach-a', 1), /already unlocked/);
    assert.throws(() => f.service.scout('guild', 'coach-b', 1, 'PF'), /does not match/);
    assert.equal(f.service.inspect('guild', 'coach-b', 1).remaining, 60);
    assert.deepEqual(f.service.inspect('guild', 'coach-b', 1).reveals.map(reveal => reveal.unlocked), [false, false, false]);
    const restored = createScoutingService({ repository: f.repository, draftClassDir: f.draftClassDir });
    assert.equal(restored.inspect('guild', 'coach-a', 1).remaining, 30);
});

test('Big Board returns ten prospects per page with coach-private unlocks', t => {
    const f = fixture(t);
    f.service.scout('guild', 'coach-a', 1);
    const first = f.service.boardPage('guild', 'coach-a');
    assert.equal(first.total, 25);
    assert.equal(first.totalPages, 3);
    assert.equal(first.prospects.length, 10);
    assert.equal(first.prospects[0].prospect.board_number, 1);
    assert.deepEqual(first.prospects[0].reveals.map(reveal => reveal.unlocked), [true, false, false]);
    assert.deepEqual(f.service.boardPage('guild', 'coach-b').prospects[0].reveals.map(reveal => reveal.unlocked), [false, false, false]);
    const last = f.service.boardPage('guild', 'coach-a', 2);
    assert.equal(last.prospects.length, 5);
    assert.equal(last.prospects[0].prospect.board_number, 21);
    assert.equal(f.service.boardPage('guild', 'coach-a', 99).page, 2);
});

test('scouting budget resets on league week advancement and refuses inactive leagues', t => {
    const f = fixture(t);
    f.service.scout('guild', 'coach-a', 1);
    f.repository.saveLeague('league', { currentWeek: 2 });
    f.repository.saveSchedule({ ...f.schedule, weeks: f.schedule.weeks.map(week => ({ ...week, status: week.week === 2 ? 'ACTIVE' : 'COMPLETED' })) });
    assert.equal(f.service.inspect('guild', 'coach-a', 1).remaining, 60);
    f.repository.saveLeague('league', { currentPhase: 'PRESEASON' });
    assert.throws(() => f.service.scout('guild', 'coach-a', 1), /Scouting opens when the regular season starts/);
});


test('scouting closes before season start and after rollover, with no offseason scouting spend', t => {
    const f = fixture(t);
    for (const season of [1, 2]) {
        for (const phase of ['SETUP', 'PRESEASON', 'REGULAR_SEASON', 'PLAYOFFS', 'OFFSEASON', 'DRAFT', 'FREE_AGENCY']) {
            f.repository.saveLeague('league', { seasonNumber: season, currentPhase: phase, regularSeasonStatus: null });
            const early = ['SETUP', 'PRESEASON'].includes(phase);
            if (early) {
                for (const action of [() => f.service.boardPage('guild', 'coach-a'), () => f.service.inspect('guild', 'coach-a', 1), () => f.service.prospects('guild', '', 'SG'), () => f.service.scout('guild', 'coach-a', 1)]) {
                    assert.throws(action, /Scouting opens when the regular season starts/);
                }
                continue;
            }
            const page = f.service.boardPage('guild', 'coach-a', 99);
            assert.equal(page.total, early ? 10 : 25);
            assert.equal(page.boardLabel, early ? 'Early Top Ten' : 'Big Board');
            assert.match(page.boardFile, new RegExp(`CUS0${season}`));
            assert.equal(f.service.inspect('guild', 'coach-a', 1).scoutingAvailable, phase === 'REGULAR_SEASON');
            if (phase !== 'REGULAR_SEASON') assert.throws(() => f.service.scout('guild', 'coach-a', 1), /active regular-season week/);
        }
    }
    f.repository.saveLeague('league', { currentPhase: 'PRESEASON' });
    assert.throws(() => f.service.boardPage('guild', 'coach-a'), /Scouting opens when the regular season starts/);
    f.repository.saveLeague('league', { currentPhase: 'REGULAR_SEASON', regularSeasonStatus: 'COMPLETED' });
    assert.equal(f.service.inspect('guild', 'coach-a', 1).scoutingAvailable, false);
    assert.throws(() => f.service.scout('guild', 'coach-a', 1), /active regular-season week/);
});


test('Discord scouting exposes production only during offseason and draft without changing internal board data',t=>{
 const f=fixture(t),file=path.join(f.draftClassDir,'2k27_CUS01 - Big Board.json');
 const board=JSON.parse(fs.readFileSync(file,'utf8'));Object.assign(board['1'],{pts:22,rbs:6,ast:7,stls:2,blks:1});fs.writeFileSync(file,JSON.stringify(board));
 for(const phase of ['REGULAR_SEASON','PLAYOFFS','OFFSEASON','DRAFT','FREE_AGENCY']){
  f.repository.saveLeague('league',{currentPhase:phase});const available=['OFFSEASON','DRAFT'].includes(phase);
  const info=f.service.inspect('guild','coach',1),page=f.service.boardPage('guild','coach',0);
  assert.equal(info.prospectStatsAvailable,available);assert.equal(page.prospects[0].prospectStatsAvailable,available);
  for(const field of ['pts','rbs','ast','stls','blks']){
   assert.equal(info.prospect[field],available?board['1'][field]:undefined);
   assert.equal(page.prospects[0].prospect[field],available?board['1'][field]:undefined);
  }
  assert.equal(f.service.boardForContext(f.service.contextFor('guild')).prospects[0].pts,22);
  const fields=require('../src/fantasyhq/discord-scouting').scoutingCard(info).embeds[0].data.fields;
  assert.equal(fields.some(field=>field.name==='Production'),available);
 }
});

test('fallback portraits follow names across reordered ranks and never fill another player’s missing photo', t => {
    const f = fixture(t);
    const file = '2k27_CUS01 - Big Board.json';
    const boardPath = path.join(f.draftClassDir, file);
    const board = JSON.parse(fs.readFileSync(boardPath));
    board['1'].name = 'New Player';
    board['2'].name = 'Léandre Charbonneau';
    fs.writeFileSync(boardPath, JSON.stringify(board));
    const directory = path.join(f.draftClassDir, 'images', '2k27-cus01-big-board', 'PF');
    fs.mkdirSync(directory, { recursive: true });
    const portrait = path.join(directory, '001-leandre-charbonneau.png');
    fs.writeFileSync(portrait, 'portrait fixture');
    const loaded = f.service.boardForContext({ league: { seasonNumber: 1, currentPhase: 'OFFSEASON' } });
    assert.equal(loaded.prospects.find(p => p.name === 'New Player').imagePath, null);
    assert.equal(loaded.prospects.find(p => p.name === 'Léandre Charbonneau').imagePath, portrait);
    const { prospectImageMap, prospectImageKey } = require('../src/shared/prospect-images');
    const images = prospectImageMap(f.draftClassDir, file);
    assert.equal(images.get(prospectImageKey('Léandre Charbonneau')), portrait);
    assert.equal(images.get(prospectImageKey('New Player')), undefined);
    assert.equal(prospectImageKey('Aaron Jimenez'), prospectImageKey('Aron Jimenez'));
});

test('Live Mock class choices include installed full boards and exclude early previews', t => {
    const f=fixture(t);
    const scouting=createScoutingService({repository:f.repository,draftClassDir:path.resolve('draft_class')});
    const choices=scouting.availableDraftClasses();
    assert(choices.some(c=>c.classNumber===6));
    assert.equal(new Set(choices.map(c=>c.classNumber)).size,choices.length);
    for(const c of choices){
        assert.match(c.label,/Big Board$/);
        const board=JSON.parse(fs.readFileSync(path.join('draft_class',c.label+'.json')));
        assert(Object.values(board).length>=60);
    }
});
