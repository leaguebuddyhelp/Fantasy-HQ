const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {fixture}=require('./helpers/free-agency');
test('public weekly awards API filters history and enriches permanent player profiles without exposing test awards',async t=>{
 const f=fixture(t),saved={};for(const key of ['FANTASYHQ_DATA_ROOT','GUILD_ID'])saved[key]=process.env[key];process.env.FANTASYHQ_DATA_ROOT=f.root;process.env.GUILD_ID='guild';t.after(()=>{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 const w={awardId:'league:1:W1:EAST',playerId:'a-0',playerName:'a-0',teamId:'a',teamName:'Team a',conference:'East',gameId:'game',score:50,stats:{PTS:30},explanation:'Verified box score.'};
 f.repository.commitAwards({leagueId:'league',awards:{version:1,seasons:{'1':{PLAYER_OF_WEEK:{weeks:{'1':{leagueId:'league',seasonId:'1',week:1,createdAt:'2026-10-08',winners:[w],publication:{messageId:'post'}},'2':{leagueId:'league',seasonId:'1',week:2,createdAt:'2026-10-09',testMode:true,winners:[{...w,awardId:'test'}]}}}}}},auditEntry:{action:'fixture'}});
 const {requestHandler}=require('../src/web');function get(url){return new Promise(resolve=>{let status;requestHandler(Object.assign(new EventEmitter(),{url,method:'GET',headers:{}}),{writeHead:code=>status=code,end:data=>resolve({status,data:JSON.parse(data)})});});}
 const response=await get('/api/league/player-of-the-week?conference=East');assert.equal(response.status,200);assert.equal(response.data.history.length,1);assert.equal(response.data.current.length,1);assert.equal(response.data.current[0].player.playerId,'a-0');assert.equal(response.data.history[0].discordMessageId,'post');
 assert.equal((await get('/api/league/player-of-the-week?conference=West')).data.history.length,0);
 const profile=await get('/api/league/players/a-0');assert.equal(profile.data.player.playerOfWeek.length,1);assert.equal(profile.data.player.playerOfWeek[0].teamId,'a');
});
