const test=require('node:test'),assert=require('node:assert/strict'),{gunzipSync}=require('node:zlib');
const {fixture}=require('./helpers/free-agency');
const {createTeamService}=require('../src/fantasyhq/team-service');
test('team summaries read current roster sizes and ownership without rebuilding stats, valuations or picks',t=>{
 const f=fixture(t);const service=createTeamService({repository:f.repository,playerStatsService:{getSeasonPlayerStats(){throw Error('stats must not be computed');}},tradeService:{getLiveSnapshot(){throw Error('picks must not be computed');}}});
 f.repository.loadPlayers=()=>{throw Error('full player data must not be loaded');};
 const teams=service.listTeamSummaries('league','1');assert.equal(teams.length,3);assert.equal(teams[0].rosterSize,15);assert.equal(teams[0].ownerUserId,'coach-a');assert.equal(teams[0].roster,undefined);
});
test('schedule and ownership responses stay compact; JSON compression preserves data and cache privacy',async t=>{
 const f=fixture(t),saved={};for(const key of ['FANTASYHQ_DATA_ROOT','GUILD_ID']){saved[key]=process.env[key];}Object.assign(process.env,{FANTASYHQ_DATA_ROOT:f.root,GUILD_ID:'guild'});
 t.after(()=>{for(const [k,v]of Object.entries(saved))v===undefined?delete process.env[k]:process.env[k]=v;});
 const {requestHandler}=require('../src/web');
 async function get(url,encoding){return new Promise(resolve=>{const request={url,method:'GET',headers:{'accept-encoding':encoding||''}},response={req:request,writeHead(status,headers){this.status=status;this.headers=headers;},end(body){resolve({status:this.status,headers:this.headers,body:Buffer.from(body)});}};requestHandler(request,response);});}
 const schedule=await get('/api/league/schedule');assert.equal(schedule.status,200);const teams=JSON.parse(schedule.body).teams;assert.equal(teams.length,3);assert.equal(teams[0].roster,undefined);assert.ok(schedule.body.length<2000);
 const owners=await get('/api/league/owners');assert.equal(owners.status,200);const ownerData=JSON.parse(owners.body);assert.equal(ownerData.summary.ownersAssigned,3);assert.equal(ownerData.players,undefined);assert.equal(ownerData.teams[0].ownerUserId,'coach-a');
 const plain=await get('/api/league/players'),compressed=await get('/api/league/players','gzip');
 assert.equal(compressed.headers['Content-Encoding'],'gzip');assert.equal(compressed.headers['Cache-Control'],'no-store');assert.equal(compressed.headers.Vary,'Accept-Encoding');assert.deepEqual(gunzipSync(compressed.body),plain.body);assert.ok(compressed.body.length<plain.body.length/4);
 const refused=await get('/api/league/players','gzip;q=0');assert.equal(refused.headers['Content-Encoding'],undefined);assert.deepEqual(refused.body,plain.body);
});

test('maintenance API requires commissioner credentials and exposes only reviewed cleanup actions',async t=>{
 const {EventEmitter}=require('node:events'),f=fixture(t),keys=['FANTASYHQ_DATA_ROOT','GUILD_ID','WEBSITE_ADMIN_KEY','WEBSITE_ADMIN_KEYS'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{FANTASYHQ_DATA_ROOT:f.root,GUILD_ID:'guild',WEBSITE_ADMIN_KEY:'key'});delete process.env.WEBSITE_ADMIN_KEYS;
 t.after(()=>{for(const [k,v]of Object.entries(saved))v===undefined?delete process.env[k]:process.env[k]=v;});
 f.repository.saveLeague('league',{commissionerUserId:'c'});delete require.cache[require.resolve('../src/web')];const {requestHandler}=require('../src/web');
 function request(headers={},body){return new Promise(resolve=>{const req=new EventEmitter();Object.assign(req,{url:'/api/league/admin/maintenance',method:body?'POST':'GET',headers});let status;requestHandler(req,{writeHead(s){status=s;},end(data){resolve({status,payload:JSON.parse(data)});}});if(body){req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');}});}
 assert.equal((await request()).status,403);const header={'x-leaguebuddy-admin-key':'key'};
 const view=await request(header);assert.equal(view.status,200,JSON.stringify(view.payload));assert.ok(view.payload.storage.groups['players.json']);
 const p=await request(header,{action:'prepare'});assert.equal(p.status,200);
 assert.equal((await request(header,{action:'confirm',token:p.payload.token})).status,200);
 process.env.WEBSITE_ADMIN_KEYS=JSON.stringify({assistant:'staff-key'});assert.equal((await request({'x-leaguebuddy-admin-key':'staff-key'})).status,400);
});
