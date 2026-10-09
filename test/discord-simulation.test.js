const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/free-agency');
const {createDiscordSimulation,panelPayload}=require('../src/fantasyhq/discord-simulation');
test('simulation panel follows Discord limits and rejects noncommissioner controls',async t=>{const f=fixture(t);f.repository.saveLeague('league',{commissionerUserId:'c'});const manager=createDiscordSimulation({repository:f.repository});assert.ok(panelPayload().components.every(r=>r.components.length<=5));let reply;await manager.handle({guildId:'guild',user:{id:'staff'},customId:'sim:create',reply:async p=>reply=p});assert.match(reply.content,/commissioner/);assert.equal(f.repository.loadSettings('league').activeSimulationId,undefined);});
test('simulation cleanup deletes only tracked bot-authored test output and retains failures for retry',async t=>{const f=fixture(t),manager=createDiscordSimulation({repository:f.repository});let removed=0;const messages={test:{author:{id:'bot'},embeds:[{title:'TEST MODE · GAME'}],delete:async()=>removed++},live:{author:{id:'bot'},embeds:[{title:'OFFICIAL GAME'}],delete:async()=>removed++},other:{author:{id:'coach'},embeds:[{title:'TEST MODE'}],delete:async()=>removed++}};const guild={id:'guild',members:{me:{id:'bot'}},channels:{fetch:async()=>({messages:{fetch:async id=>messages[id]}})}};const failures=await manager.cleanup(guild,['test','live','other'].map(messageId=>({guildId:'guild',channelId:'staff',messageId})));assert.equal(removed,1);assert.equal(failures.length,2);assert.match(failures[0].error,/refused/);});

test('simple panel keeps advanced controls tucked away and option changes update the original panel',async t=>{
 const f=fixture(t);f.repository.saveLeague('league',{commissionerUserId:'c',guildId:'guild'});
 const manager=createDiscordSimulation({repository:f.repository});
 assert.equal(panelPayload().components.length,2);
 assert.equal(panelPayload().components.flatMap(r=>r.components).length,6);
 function interaction(customId,values=[]){return {guildId:'guild',user:{id:'c'},customId,values,message:{flags:{has:()=>true}},deferred:false,deferReply:async function(){this.deferred=true;this.replyCount=(this.replyCount||0)+1;},deferUpdate:async function(){this.deferred=true;this.updated=true;},editReply:async function(payload){this.payload=payload;},reply:async function(payload){this.payload=payload;}};}
 let i=interaction('sim:run:1');await manager.handle(i);
 assert.ok(f.repository.loadSettings('league').activeSimulationId,'first run automatically creates isolated workspace');
 assert.equal(i.payload.components.length,4);
 const optionId=i.payload.components[1].components[0].data.custom_id;
 i=interaction(optionId,['transactions:on']);await manager.handle(i);
 assert.equal(i.updated,true);assert.equal(i.replyCount,undefined);
 assert.equal(i.payload.components[1].components[0].options[1].data.default,true);
 i=interaction(optionId+':output',['output:FULL']);await manager.handle(i);
 assert.equal(i.payload.components[2].components[0].options[1].data.default,true);
 i=interaction(optionId+':duration',['duration:5']);await manager.handle(i);
 assert.equal(i.payload.components[0].components[0].options[2].data.default,true);
 const invalid={...interaction(optionId,['duration:99'])};await manager.handle(invalid);assert.match(invalid.payload.content,/Invalid/);
});

test('cleanup treats deleted test channels as already cleaned',async t=>{
 const manager=createDiscordSimulation({repository:fixture(t).repository});
 const failures=await manager.cleanup({id:'guild',channels:{fetch:async()=>{throw Object.assign(Error('Unknown Channel'),{code:10003});}}},[{guildId:'guild',channelId:'deleted',messageId:'test'}]);assert.deepEqual(failures,[]);
});

test('offseason stage delivery keys remain distinct across stages and seasons',()=>{
 const {simulationEventKey}=require('../src/fantasyhq/discord-simulation'),sim={seasonId:'1'};
 const first=simulationEventKey(sim,{type:'OFFSEASON',step:'RETIREMENTS'}),draft=simulationEventKey(sim,{type:'OFFSEASON',step:'DRAFT'});assert.notEqual(first,draft);assert.equal(first,simulationEventKey(sim,{type:'OFFSEASON',step:'RETIREMENTS'}));assert.notEqual(first,simulationEventKey({...sim,seasonId:'2'},{type:'OFFSEASON',step:'RETIREMENTS'}));
});
