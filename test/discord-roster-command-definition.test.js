const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('registered roster sync command accepts one required and three optional photos and is guild-only',async()=>{
 let body;const errors=[];class REST {setToken(){return this;}async put(route,args){body=args.body;}}
 const discord=require('discord.js');vm.runInNewContext(fs.readFileSync('deploy-commands.js','utf8'),{require:name=>name==='dotenv'?{config(){}}:name==='discord.js'?{...discord,REST}:name==='./src/config'?{requireEnv:()=> '123'}:(()=>{throw Error('Unexpected dependency');})(),console:{log(){},error:e=>errors.push(e)},process:{exitCode:0}});await new Promise(setImmediate);
 assert.deepEqual(errors,[]);const command=body.find(c=>c.name==='rostersync');assert.ok(command);assert.equal(command.dm_permission,false);assert.equal(command.options.length,4);assert.ok(command.options.every(o=>o.type===11));assert.equal(command.options[0].required,true);assert.ok(command.options.slice(1).every(o=>!o.required));assert.equal(body.filter(c=>c.name==='rostersync').length,1);assert.ok(body.some(c=>c.name==='tradeblock'));assert.ok(body.some(c=>c.name==='freeagents'));
});
