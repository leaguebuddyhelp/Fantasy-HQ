const test=require('node:test'),assert=require('node:assert/strict'),{gunzipSync}=require('node:zlib'),{EventEmitter}=require('node:events');
const {createJsonCompression}=require('../src/shared/json-compression');
test('compression worker preserves JSON bytes for concurrent responses and keeps no work alive when idle',async t=>{
 const c=createJsonCompression();t.after(()=>c.close());const bodies=Array.from({length:4},(_,i)=>Buffer.from(JSON.stringify({i,data:'Repeated data '.repeat(10000)})));
 const results=await Promise.all(bodies.map(body=>c.compress(body)));for(let i=0;i<results.length;i++){assert.deepEqual(gunzipSync(results[i]),bodies[i]);assert.ok(results[i].length<bodies[i].length/4);}
});
test('compression failures reject pending work so the HTTP layer can return the original JSON',async t=>{
 const worker=new EventEmitter();worker.ref=()=>{};worker.unref=()=>{};worker.postMessage=()=>{};worker.terminate=async()=>{};
 const c=createJsonCompression({workerFactory:()=>worker});t.after(()=>c.close());const pending=c.compress(Buffer.from('test'));worker.emit('error',Error('stopped'));await assert.rejects(pending,/unavailable/);
});
