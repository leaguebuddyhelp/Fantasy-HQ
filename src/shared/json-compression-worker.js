const {parentPort}=require('node:worker_threads');
const {gzipSync}=require('node:zlib');
parentPort.on('message',({id,body})=>{
    try { const bytes=gzipSync(body,{level:1}); parentPort.postMessage({id,bytes}); }
    catch { parentPort.postMessage({id,error:true}); }
});
