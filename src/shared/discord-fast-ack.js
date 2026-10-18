const {Worker}=require('worker_threads');
const path=require('path');
function createFastTradeAcknowledgment({workerFactory=()=>new Worker(path.join(__dirname,'discord-ack-worker.js')),logger=console}={}){
 let worker=null;const pending=new Map();
 function failAll(){for(const {reject} of pending.values())reject(Object.assign(Error('Trade acknowledgement worker stopped. Try the button again.'),{code:'ACK_WORKER_STOPPED'}));pending.clear();worker=null;}
 function start(){if(worker)return worker;worker=workerFactory();const current=worker;worker.unref();worker.on('message',result=>{const task=pending.get(result.id);if(!task)return;pending.delete(result.id);if(!pending.size)worker.unref();if(result.ok){logger.info('Interaction acknowledgement:',{elapsedMs:result.elapsedMs,workerDelayMs:result.workerDelayMs});task.resolve();}else task.reject(Object.assign(Error('Discord could not acknowledge this click. Please try the request again.'),{code:result.code||result.status}));});worker.on('error',()=>{if(worker===current)failAll();});worker.on('exit',()=>{if(worker===current)failAll();});return worker;}
 // Start before startup recovery can block the main event loop.
 start();
 async function acknowledge(interaction){
  const privateUpload=interaction.isChatInputCommand?.()&&interaction.commandName==='rostersync';
  const tradeControl=(interaction.isButton?.()||interaction.isStringSelectMenu?.())&&String(interaction.customId||'').startsWith('trade:');
  if((!tradeControl&&!privateUpload)||interaction.deferred||interaction.replied)return;
  if(!/^\d+$/.test(interaction.id)||!interaction.token)throw Error('Invalid trade interaction.');
  if(pending.has(interaction.id))throw Object.assign(Error('This click is already being acknowledged.'),{code:40060});
  const current=start();await new Promise((resolve,reject)=>{pending.set(interaction.id,{resolve,reject});current.ref();current.postMessage({id:interaction.id,token:interaction.token,queuedAt:Date.now(),type:privateUpload?5:6});});
  interaction.deferred=true;interaction.ephemeral=Boolean(privateUpload);
 }
 return {acknowledge,close:async()=>{const current=worker;worker=null;if(current)await current.terminate();}};
}
module.exports={createFastTradeAcknowledgment};
