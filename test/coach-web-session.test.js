const test=require('node:test'),assert=require('node:assert/strict');const {fixture}=require('./helpers/free-agency');
function setup(t) {
 const f=fixture(t),previous=process.env.WEBSITE_URL;process.env.WEBSITE_URL='https://league.test';t.after(()=>{if(previous===undefined)delete process.env.WEBSITE_URL;else process.env.WEBSITE_URL=previous;});
 f.repository.saveRoleOwnership('league',{roleIds:{a:'ra',b:'rb',c:'rc'}});let clock=Date.now(),role='ra';const member=()=>({roles:{cache:new Map([[role,{}]])}});
 const service=require('../src/fantasyhq/coach-web-session').createCoachWebSessions({repository:f.repository,now:()=>clock,fetchMember:async(guildId,userId)=>{assert.equal(guildId,'guild');assert.equal(userId,'coach-a');return member();}});
 const issue=()=>service.issue('league',{id:'coach-a',member:member(),guildId:'guild'});
 return {...f,service,issue,advance:ms=>clock+=ms,setRole:value=>role=value};
}
test('coach links are one-use, hashed, origin-protected and produce private HTTPS cookies',async t=>{
 const f=setup(t),link=f.issue(),secret=new URL(link.url).hash.slice('#coach-login='.length);
 assert.equal(new URL(link.url).search,'');assert.equal(f.repository.loadCoachWebSessions('league').links[0].hash.includes(secret),false);
 await assert.rejects(f.service.exchange('league',secret,{headers:{origin:'https://evil.test'}}),/configured league website/);
 const result=await f.service.exchange('league',secret,{headers:{origin:'https://league.test'}});assert.match(result.cookie,/HttpOnly; SameSite=Strict.*Secure/);
 assert.equal(result.actor.teamId,'a');await assert.rejects(f.service.exchange('league',secret,{headers:{origin:'https://league.test'}}),/already used/);
 const request={headers:{cookie:result.cookie.split(';')[0]}};assert.equal((await f.service.authenticate('league',request)).id,'coach-a');
 await assert.rejects(f.service.authenticate('league',{headers:{...request.headers,origin:'https://evil.test'}},{mutation:true}),/configured league website/);
 f.service.logout('league',{headers:{...request.headers,origin:'https://league.test'}});await assert.rejects(f.service.authenticate('league',request),/expired/);
});
test('sign-in and every private request recheck live roles and current ownership',async t=>{
 const f=setup(t),secret=new URL(f.issue().url).hash.slice('#coach-login='.length);f.setRole('rb');await assert.rejects(f.service.exchange('league',secret,{headers:{origin:'https://league.test'}}),/assignment must match/);f.setRole('ra');
 const result=await f.service.exchange('league',secret,{headers:{origin:'https://league.test'}}),request={headers:{cookie:result.cookie.split(';')[0]}};
 f.repository.saveOwners('league',[{teamId:'a',userId:'new-coach'}]);await assert.rejects(f.service.authenticate('league',request),/assignment must match/);
});
test('a newer link invalidates the older link and concurrent exchange cannot reuse a sign-in token',async t=>{
 const f=setup(t),old=new URL(f.issue().url).hash.slice('#coach-login='.length),newest=new URL(f.issue().url).hash.slice('#coach-login='.length);
 await assert.rejects(f.service.exchange('league',old,{headers:{origin:'https://league.test'}}),/expired/);
 const results=await Promise.allSettled([f.service.exchange('league',newest,{headers:{origin:'https://league.test'}}),f.service.exchange('league',newest,{headers:{origin:'https://league.test'}})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.repository.loadCoachWebSessions('league').sessions.length,1);
});
