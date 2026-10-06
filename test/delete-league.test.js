const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');const os=require('os');const path=require('path');
const {createFantasyHQRepository}=require('../src/fantasyhq/repository');
const {inspectDeletion,deleteBoundLeague}=require('../src/fantasyhq/delete-league');
function fixture(t){const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'delete-league-'));t.after(()=>fs.rmSync(dataRoot,{recursive:true,force:true}));const r=createFantasyHQRepository({dataRoot});for(const id of ['test','keep']){r.saveLeague(id,{name:id});r.saveTeams(id,[]);r.savePlayers(id,[]);}r.saveGuildLeagueBinding('g',{leagueId:'test'});return r;}
test('deletes only the confirmed bound league and its binding',t=>{const r=fixture(t);const preview=inspectDeletion(r,'g');deleteBoundLeague(r,'g',preview);assert.equal(r.leagueExists('test'),false);assert.equal(r.loadGuildLeagueBinding('g'),null);assert.equal(r.leagueExists('keep'),true);});
test('changed binding and cross-server bindings block deletion',t=>{const r=fixture(t);const preview=inspectDeletion(r,'g');r.saveGuildLeagueBinding('g',{leagueId:'keep'});assert.throws(()=>deleteBoundLeague(r,'g',preview),/changed/);r.saveGuildLeagueBinding('g',{leagueId:'test'});r.saveGuildLeagueBinding('other',{leagueId:'test'});assert.throws(()=>deleteBoundLeague(r,'g',preview),/another server/);assert.equal(r.leagueExists('test'),true);});
test('unsafe IDs are rejected and failed unbinding restores league files',t=>{const r=fixture(t);r.saveGuildLeagueBinding('g',{leagueId:'../escape'});assert.throws(()=>inspectDeletion(r,'g'),/cannot be deleted/);r.saveGuildLeagueBinding('g',{leagueId:'test'});const preview=inspectDeletion(r,'g');r.clearGuildLeagueBinding=()=>{throw Error('disk failure')};assert.throws(()=>deleteBoundLeague(r,'g',preview),/disk failure/);assert.equal(r.leagueExists('test'),true);});
function archive(r,leagueId,seasonId='1'){
 const id=require('crypto').randomUUID(),dir=path.join(r.dataRoot,'game-history',id);
 fs.mkdirSync(path.join(dir,'originals'),{recursive:true});
 fs.writeFileSync(path.join(dir,'record.json'),JSON.stringify({game:{gameId:id,leagueId,seasonId},submissions:[{}],extractions:[{}],playerGameStats:[{PTS:30}]}));
 fs.writeFileSync(path.join(dir,'originals','screenshot.jpg'),'original bytes');return dir;
}
test('deletion purges all seasons of this league, including archives added after preview, and preserves other leagues and shared assets',t=>{
 const r=fixture(t),old=archive(r,'test','1'),other=archive(r,'keep');
 const shared=path.join(r.dataRoot,'shared-ratings.json');fs.writeFileSync(shared,'shared');
 const preview=inspectDeletion(r,'g');assert.equal(preview.gameDirectories.length,1);
 const recent=archive(r,'test','2');const result=deleteBoundLeague(r,'g',preview);
 assert.equal(result.cleanupPending,false);assert.equal(fs.existsSync(old),false);assert.equal(fs.existsSync(recent),false);
 assert.equal(fs.readFileSync(path.join(other,'originals','screenshot.jpg'),'utf8'),'original bytes');assert.equal(fs.readFileSync(shared,'utf8'),'shared');
 assert.ok(!fs.readdirSync(r.dataRoot).some(n=>n.startsWith('.deleting-')));
});
test('failed unbinding restores game archives as well as the league',t=>{
 const r=fixture(t),game=archive(r,'test'),preview=inspectDeletion(r,'g');r.clearGuildLeagueBinding=()=>{throw Error('disk failure');};
 assert.throws(()=>deleteBoundLeague(r,'g',preview),/disk failure/);
 assert.equal(fs.readFileSync(path.join(game,'originals','screenshot.jpg'),'utf8'),'original bytes');assert.equal(r.leagueExists('test'),true);
});
test('unreadable or linked game records stop deletion before removing any data',t=>{
 const r=fixture(t),game=archive(r,'test'),record=path.join(game,'record.json');fs.writeFileSync(record,'broken');
 assert.throws(()=>inspectDeletion(r,'g'),/Cannot read game archive/);assert.equal(r.leagueExists('test'),true);
 fs.unlinkSync(record);const other=archive(r,'keep');fs.symlinkSync(path.join(other,'record.json'),record);
 assert.throws(()=>inspectDeletion(r,'g'),/Unsafe game record/);assert.equal(r.loadGuildLeagueBinding('g').leagueId,'test');
});
