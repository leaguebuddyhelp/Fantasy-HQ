const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {fixture}=require('./helpers/free-agency');
test('roster report API requires commissioner credentials and isolates batch ownership and originals',async t=>{
 const f=fixture(t),saved={};for(const key of ['FANTASYHQ_DATA_ROOT','GUILD_ID','WEBSITE_ADMIN_KEY','WEBSITE_ADMIN_KEYS'])saved[key]=process.env[key];
 Object.assign(process.env,{FANTASYHQ_DATA_ROOT:f.root,GUILD_ID:'guild',WEBSITE_ADMIN_KEY:'key'});delete process.env.WEBSITE_ADMIN_KEYS;
 t.after(()=>{for(const [k,v]of Object.entries(saved))v===undefined?delete process.env[k]:process.env[k]=v;});f.repository.saveLeague('league',{commissionerUserId:'c',currentPhase:'REGULAR_SEASON'});
 const {requestHandler}=require('../src/web');function request(headers={},body={action:'start'},suffix=''){return new Promise(resolve=>{const req=new EventEmitter();Object.assign(req,{url:'/api/league/admin/rosters/photo-sync'+suffix,method:'POST',headers});let status;requestHandler(req,{writeHead(code){status=code;},end(data){resolve({status,payload:JSON.parse(data)});}});req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');});}
 assert.equal((await request()).status,403);const headers={'x-leaguebuddy-admin-key':'key'},start=await request(headers);assert.equal(start.status,200);assert.ok(start.payload.id);assert.deepEqual(start.payload.images,[]);
 assert.equal((await request(headers,{action:'upload',batchId:start.payload.id,base64:'not a valid image',filename:'bad'})).status,400);
 assert.equal((await request(headers,{action:'confirm',batchId:start.payload.id,token:'bad'})).status,400);
 process.env.WEBSITE_ADMIN_KEYS=JSON.stringify({assistant:'assistant'});assert.equal((await request({'x-leaguebuddy-admin-key':'assistant'})).status,400);
});
