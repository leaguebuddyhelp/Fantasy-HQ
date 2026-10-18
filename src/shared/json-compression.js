const {Worker}=require('node:worker_threads'),path=require('node:path');
function createJsonCompression({workerFactory=()=>new Worker(path.join(__dirname,'json-compression-worker.js'))}={}) {
    let worker,sequence=0;const pending=new Map();
    function start(){
        if(worker)return worker;
        const current=worker=workerFactory();current.unref();
        function failed(){if(worker!==current)return;worker=null;for(const task of pending.values())task.reject(Error('Compression unavailable.'));pending.clear();}
        current.on('message',result=>{const task=pending.get(result.id);if(!task)return;pending.delete(result.id);if(!pending.size)current.unref();if(result.error)task.reject(Error('Compression failed.'));else task.resolve(Buffer.from(result.bytes));});
        current.on('error',failed);current.on('exit',failed);return current;
    }
    function compress(body){
        if(pending.size>=32)return Promise.reject(Error('Compression queue full.'));
        const id=++sequence,current=start();
        return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});current.ref();try{current.postMessage({id,body});}catch(error){pending.delete(id);if(!pending.size)current.unref();reject(error);}});
    }
    async function close(){const current=worker;worker=null;if(current)await current.terminate();for(const task of pending.values())task.reject(Error('Compression stopped.'));pending.clear();}
    return {compress,close};
}
const compression=createJsonCompression();
module.exports={createJsonCompression,compress:compression.compress};
