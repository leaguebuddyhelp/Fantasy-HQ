const test=require('node:test'),assert=require('node:assert/strict');
const {createPlayerService}=require('../src/fantasyhq/player-service');
test('team player lookup uses current membership and skips other teams before expensive valuation',()=>{
 const own={playerId:'p1',name:'Own',overall:80,position1:'PG',teamId:'old'},other={playerId:'p2',name:'Other',overall:85,position1:'SF'},free={playerId:'p3',name:'Free',overall:70};
 const repository={loadLeague:()=>({teams:[{teamId:'bos',teamName:'Boston'},{teamId:'nyk',teamName:'New York'}],seasonId:'1'}),loadRosterMemberships:()=>[{playerId:'p1',teamId:'bos',seasonId:'1'},{playerId:'p2',teamId:'nyk',seasonId:'1'}],loadPlayers:()=>[own,other,free]};
 const service=createPlayerService({repository});
 const all=service.listPlayers('l','1');
 Object.defineProperty(other,'contract',{enumerable:true,get(){throw Error('Other roster should not be valued');}});
 assert.deepEqual(service.listPlayers('l','1',{teamId:'bos'}),all.filter(p=>p.teamId==='bos'));
 assert.deepEqual(service.listPlayers('l','1',{teamId:null}),all.filter(p=>p.teamId===null));
 assert.deepEqual(service.listPlayers('l','1',{teamId:'missing'}),[]);
});
