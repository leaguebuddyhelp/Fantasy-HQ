const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {simulateInWorker}=require('../src/fantasyhq/mock-simulation-runner');
test('draft simulation runs in a worker and returns only computed data to the owning process',async()=>{
 const worker=new EventEmitter();let terminated=0,settings;worker.terminate=async()=>terminated++;
 const input={leagueId:'test'},options={seed:'test'};
 const p=simulateInWorker(input,options,{workerFactory:(filename,data)=>{assert.match(filename,/mock-simulation-worker.js$/);settings=data;return worker;}});
 assert.deepEqual(settings.workerData,{input,options});
 worker.emit('message',{snapshot:{id:'computed'}});assert.deepEqual(await p,{id:'computed'});assert.equal(terminated,1);
});
test('draft worker failures preserve the caller state and always terminate the worker',async()=>{
 for(const event of ['message','error','exit']){
  const worker=new EventEmitter();let terminated=0;worker.terminate=async()=>terminated++;
  const p=simulateInWorker({}, {}, {workerFactory:()=>worker});
  worker.emit(event,event==='message'?{error:'computation failed'}:event==='error'?Error('computation failed'):1);
  await assert.rejects(p,/failed|exited/);assert.equal(terminated,1);
 }
});
test('real draft worker reports invalid input without blocking the main event loop',async()=>{
 await assert.rejects(simulateInWorker({prospects:[]},{seed:'test'}),/at least 60/);
});
