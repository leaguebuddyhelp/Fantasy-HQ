const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { fixture } = require('./helpers/free-agency');

test('website correction preview binds commissioner credentials and exact mutation details', async t => {
 const f=fixture(t);f.repository.saveLeague('league',{commissionerUserId:'commish'});
 const prior={};
 for(const [key,value] of Object.entries({FANTASYHQ_DATA_ROOT:f.repository.dataRoot,GUILD_ID:'guild',FANTASYHQ_LEAGUE_ID:'league',FANTASYHQ_SEASON_ID:'1',WEBSITE_ADMIN_KEY:'isolated-key',WEBSITE_ADMIN_KEYS:''})) {
  prior[key]=process.env[key];process.env[key]=value;
 }
 t.after(()=>{for(const [key,value] of Object.entries(prior)) if(value===undefined)delete process.env[key];else process.env[key]=value;});
 const {requestHandler}=require('../src/web');
 function post(url,body,key='isolated-key') {
  return new Promise(resolve=>{
   const req=new PassThrough();req.url=url;req.method='POST';req.headers={'x-leaguebuddy-admin-key':key};
   let status;requestHandler(req,{writeHead(code){status=code;},end(data){resolve({status,body:JSON.parse(data)});}});
   req.end(JSON.stringify({operator:'Commissioner',...body}));
  });
 }
 const args={playerId:'a-0',fromTeamId:'a',toTeamId:'b'};
 assert.equal((await post('/api/league/admin/rosters/correction-preview',{action:'move',payload:args,reason:'Correct imported assignment'},'wrong')).status,403);
 assert.equal((await post('/api/league/admin/rosters/move-player',args)).status,400);
 const preview=await post('/api/league/admin/rosters/correction-preview',{action:'move',payload:args,reason:'Correct imported assignment'});
 assert.equal(preview.status,200);
 const moved=await post('/api/league/admin/rosters/move-player',{...args,correctionToken:preview.body.token});
 assert.equal(moved.status,200);assert.equal(moved.body.membership.teamId,'b');
 assert.equal(f.repository.loadAuditLog('league').at(-1).correction.confirmedBy,'commish');
 function getPool(key='isolated-key') {
  return new Promise(resolve=>{const req=new PassThrough();req.url='/api/league/admin/rosters/free-agents';req.method='GET';req.headers={'x-leaguebuddy-admin-key':key};let status;requestHandler(req,{writeHead(code){status=code;},end(data){resolve({status,body:JSON.parse(data)});}});req.end();});
 }
 assert.equal((await getPool('wrong')).status,403);
 const releaseArgs={playerId:'a-0',teamId:'b'};
 const releasePreview=await post('/api/league/admin/rosters/correction-preview',{action:'remove',payload:releaseArgs,reason:'Release player from imported roster'});
 assert.equal((await post('/api/league/admin/rosters/remove-player',{...releaseArgs,correctionToken:releasePreview.body.token})).status,200);
 assert.ok((await getPool()).body.players.some(p=>p.playerId==='a-0'));
 const assignArgs={playerId:'a-0',teamId:'c',contractDetails:{salary:'$7M',years:'2+1',structure:'FLAT',option:'Player'}};
 assert.equal((await post('/api/league/admin/rosters/assign-free-agent',assignArgs,'wrong')).status,403);
 assert.equal((await post('/api/league/admin/rosters/assign-free-agent',assignArgs)).status,400);
 const assignPreview=await post('/api/league/admin/rosters/correction-preview',{action:'assign',payload:assignArgs,reason:'Record the verified free-agent signing'});
 assert.equal(assignPreview.status,200);
 const assigned=await post('/api/league/admin/rosters/assign-free-agent',{...assignArgs,correctionToken:assignPreview.body.token});
 assert.equal(assigned.status,200);assert.equal(assigned.body.player.playerId,'a-0');assert.equal(assigned.body.player.teamId,'c');
 assert.equal(assigned.body.player.contractView.totalSalary,21000000);
 assert.ok(!(await getPool()).body.players.some(p=>p.playerId==='a-0'));

});
