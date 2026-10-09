const test=require('node:test'),assert=require('node:assert/strict');const {fixture}=require('./helpers/free-agency');
test('retired website betting and authentication endpoints return 410 without touching league storage',async t=>{
 const f=fixture(t),saved={};for(const key of ['FANTASYHQ_DATA_ROOT','GUILD_ID'])saved[key]=process.env[key];process.env.FANTASYHQ_DATA_ROOT=f.root;process.env.GUILD_ID='guild';t.after(()=>{for(const [k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const web=require('../src/web');web.setGameThreadRuntime({repository:f.repository});const before=f.repository.loadSportsbook('league');
 for(const url of ['/api/league/sportsbook','/api/league/sportsbook/mine','/api/league/sportsbook/bet','/api/league/admin/sportsbook','/api/league/coach-session','/sportsbook.js'])for(const method of ['GET','POST']){const result=await new Promise(resolve=>{web.requestHandler({url,method,headers:{}},{setHeader(){},writeHead(status){this.status=status;},end(body){resolve({status:this.status,body:JSON.parse(body)});}});});assert.equal(result.status,410);assert.match(result.body.error,/Discord/);}
 assert.deepEqual(f.repository.loadSportsbook('league'),before);
});
