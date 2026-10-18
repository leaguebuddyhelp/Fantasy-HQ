const test=require('node:test'),assert=require('node:assert/strict');
const {createDiscordLookup}=require('../src/shared/discord-dns');
function resolve(lookup,host='discord.com',options={}){return new Promise((yes,no)=>lookup(host,options,(error,...result)=>error?no(error):yes(result)));}
test('Discord lookups coalesce concurrent requests, honor DNS TTL and support single/all-address callbacks',async()=>{
 let at=0,calls=0,done;const lookup=createDiscordLookup({now:()=>at,resolve4:(host,options,callback)=>{calls++;assert.equal(options.ttl,true);done=callback;},systemLookup:()=>{throw Error('should use async resolver');}});
 const one=resolve(lookup),all=resolve(lookup,'discord.com',{all:true});assert.equal(calls,1);
 done(null,[{address:'192.0.2.1',ttl:2},{address:'192.0.2.2',ttl:5}]);
 assert.deepEqual(await one,['192.0.2.1',4]);assert.deepEqual(await all,[[{address:'192.0.2.1',family:4},{address:'192.0.2.2',family:4}]]);
 at=1000;assert.deepEqual(await resolve(lookup),['192.0.2.1',4]);assert.equal(calls,1);
 at=2100;const next=resolve(lookup);assert.equal(calls,2);done(null,[{address:'192.0.2.3',ttl:2}]);assert.deepEqual(await next,['192.0.2.3',4]);
});
test('resolver failure, private names, IP literals and explicit IPv6 retain system DNS behavior',async()=>{
 let fallback=0,queries=0;const lookup=createDiscordLookup({resolve4:(_,options,callback)=>{queries++;callback(Error('unavailable'));},systemLookup:(host,options,callback)=>{fallback++;callback(null,'127.0.0.1',4);}});
 for(const [host,options] of [['discord.com',{}],['localhost',{}],['discord.com',{family:6}],['127.0.0.1',{}]])assert.deepEqual(await resolve(lookup,host,options),['127.0.0.1',4]);
 assert.equal(fallback,4);assert.equal(queries,1);
});
test('zero TTL is not cached and invalid responses use the system fallback',async()=>{
 let calls=0;const lookup=createDiscordLookup({resolve4:(_,options,callback)=>{calls++;callback(null,[{address:'192.0.2.1',ttl:0}]);}});
 await resolve(lookup);await resolve(lookup);assert.equal(calls,2);
 const invalid=createDiscordLookup({resolve4:(_,options,callback)=>callback(null,[]),systemLookup:(_,options,callback)=>callback(Object.assign(Error('not found'),{code:'ENOTFOUND'}))});await assert.rejects(resolve(invalid),e=>e.code==='ENOTFOUND');
});
