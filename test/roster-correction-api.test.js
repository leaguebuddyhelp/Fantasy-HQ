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
});
