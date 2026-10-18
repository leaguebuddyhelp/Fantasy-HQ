const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./helpers/free-agency');
const {createStorageMaintenance}=require('../src/fantasyhq/storage-maintenance');
const clock=Date.UTC(2026,9,18),day=86400000;
function setup(t){const f=fixture(t);f.repository.saveLeague('league',{commissionerUserId:'c'});return {...f,actor:{id:'c',authorized:true},root:path.join(f.root,'leagues','league')};}
function save(root,name,value,age=5*day){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));const at=new Date(clock-age);fs.utimesSync(file,at,at);return file;}
test('cleanup removes only old unreferenced snapshots and expired sessions after a backup, preserving canonical data and newest caches',async t=>{
 const f=setup(t),root=f.root;const ids=Array.from({length:6},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
 for(const [i,id]of ids.entries())save(root,`mock-draft/snapshots/${id}.json`,{id},(i+3)*day);
 save(root,'mock-draft/active.json',{id:ids[5]});
 save(root,'mock-draft/live.json',{mocks:{m:{simulationSnapshotId:ids[4]}}});
 save(root,'orphan.tmp',{temporary:true});
 const sessions={version:1,links:[{hash:'a'.repeat(64),userId:'u',guildId:'guild',expiresAt:clock-1}],sessions:[{hash:'b'.repeat(64),userId:'u',guildId:'guild',expiresAt:clock+day}]};
 f.repository.commitLeagueFiles({leagueId:'league',files:[{name:'coach-web-sessions.json',value:sessions}]});
 const before=f.repository.loadPlayers('league'),service=createStorageMaintenance({repository:f.repository,now:()=>clock});
 const p=await service.prepare('league',f.actor);assert.equal(p.expiredSessions,1);assert.deepEqual(p.candidates.map(x=>x.kind).sort(),['stale-temporary','unreferenced-draft-cache']);
 const receipt=service.confirm('league',f.actor,p.token);assert.ok(receipt.backupId);assert.equal(receipt.expiredSessions,1);assert.equal(receipt.removed.length,2);
 assert.ok(fs.existsSync(path.join(root,`mock-draft/snapshots/${ids[5]}.json`)));assert.ok(fs.existsSync(path.join(root,`mock-draft/snapshots/${ids[4]}.json`)));
 assert.equal(fs.existsSync(path.join(root,`mock-draft/snapshots/${ids[3]}.json`)),false);
 assert.ok(fs.existsSync(path.join(f.repository.dataRoot,'backups',receipt.backupId,'leagues','league','mock-draft','snapshots',ids[3]+'.json')));
 assert.ok(fs.existsSync(path.join(root,'maintenance',p.token,'orphan.tmp.saved')));
 assert.equal(f.repository.loadCoachWebSessions('league').sessions.length,1);assert.equal(f.repository.loadCoachWebSessions('league').links.length,0);assert.deepEqual(f.repository.loadPlayers('league'),before);
});
test('cleanup refuses unauthorized actors, changed files, newly referenced snapshots and failed backups',async t=>{
 const f=setup(t),ids=Array.from({length:5},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
 for(const [i,id]of ids.entries())save(f.root,`mock-draft/snapshots/${id}.json`,{id},(i+3)*day);
 const service=createStorageMaintenance({repository:f.repository,now:()=>clock,backup:()=>{throw Error('backup failed');}});
 await assert.rejects(service.prepare('league',{id:'other',authorized:true}),/commissioner/);
 const p=await service.prepare('league',f.actor);assert.equal(p.candidates.length,2);
 assert.throws(()=>service.confirm('league',f.actor,p.token),/backup failed/);assert.ok(fs.existsSync(path.join(f.root,p.candidates[0].name)));
 save(f.root,'mock-draft/weekly-projection.json',{simulationSnapshotId:ids[3]});save(f.root,p.candidates.find(x=>x.id===ids[4]).name,{changed:true},0);
 assert.deepEqual(service.confirm('league',f.actor,p.token).removed,[]);
});
test('cleanup refuses symlinks and unreadable reference files',async t=>{
 const f=setup(t),service=createStorageMaintenance({repository:f.repository,now:()=>clock});
 const bad=path.join(f.root,'mock-draft','active.json');fs.mkdirSync(path.dirname(bad),{recursive:true});fs.writeFileSync(bad,'bad-json');
 await assert.rejects(service.prepare('league',f.actor));fs.unlinkSync(bad);
 fs.symlinkSync('/tmp',path.join(f.root,'outside'));await assert.rejects(service.prepare('league',f.actor),/symbolic/);
});

test('signed macOS sidecars across storage are backed up and archived while real league JSON is retained',async t=>{
 const f=setup(t),sourceRoot=f.repository.dataRoot,magic=Buffer.alloc(16);magic.writeUInt32BE(0x00051607,0);
 const names=['._guild-leagues.json','leagues/2kratings-current/._league.json','leagues/2kratings-current/._teams.json'];
 for(const name of names){const file=path.join(sourceRoot,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,magic);}
 save(f.root,'player-upgrades.json',{retired:true});
 const service=createStorageMaintenance({repository:f.repository,now:()=>clock}),p=await service.prepare('league',f.actor);assert.equal(p.candidates.filter(row=>row.kind==='macos-metadata').length,3);
 const receipt=service.confirm('league',f.actor,p.token);assert.equal(receipt.removed.length,4);assert.ok(receipt.backupId);
 for(const name of names){assert.equal(fs.existsSync(path.join(sourceRoot,name)),false);assert.deepEqual(fs.readFileSync(path.join(sourceRoot,'backups',receipt.backupId,name)),magic);assert.ok(fs.existsSync(path.join(f.root,'maintenance',p.token,'data-root',name+'.saved')));}
 assert.equal(fs.existsSync(path.join(f.root,'player-upgrades.json')),false);assert.ok(f.repository.loadLeague('league').league);
});
test('real malformed JSON still blocks cleanup and never masquerades as macOS metadata',async t=>{
 const f=setup(t);fs.writeFileSync(path.join(f.root,'._not-a-sidecar.json'),'invalid-json');save(f.root,'player-upgrades.json',{retired:true});
 const service=createStorageMaintenance({repository:f.repository,now:()=>clock}),p=await service.prepare('league',f.actor);assert.equal(p.candidates.some(row=>row.name==='._not-a-sidecar.json'),false);
 assert.throws(()=>service.confirm('league',f.actor,p.token),/valid storage backup/);assert.ok(fs.existsSync(path.join(f.root,'player-upgrades.json')));
});
