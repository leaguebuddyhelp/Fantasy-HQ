const {parentPort}=require('worker_threads');
const https=require('https');
const agent=new https.Agent({keepAlive:true,maxSockets:8});
// Only initial callback traffic runs here. Bot data, permissions and mutations stay
// in the owning process; no bot token is needed for an interaction callback.
function sendAcknowledgment({id,token,queuedAt,type=6,choices=[],payload,query=''},send=result=>parentPort.postMessage(result),makeRequest=https.request){
 const started=Date.now();
 const request=makeRequest({hostname:'discord.com',path:`/api/v10/interactions/${id}/${encodeURIComponent(token)}/callback${query}`,method:'POST',agent,signal:AbortSignal.timeout(3500),headers:{'Content-Type':'application/json','User-Agent':'DiscordBot (https://github.com/leaguebuddyhelp/Fantasy-HQ, 0.1.0)'}},response=>{
  let text='';response.on('data',chunk=>{if(text.length + chunk.length > 1048576) request.destroy(Error('callback response too large')); else text+=chunk;});
  response.on('end',()=>{let code;try{code=JSON.parse(text).code;}catch{}send({id,ok:response.statusCode>=200&&response.statusCode<300,code,status:response.statusCode,body:text,headers:response.headers,workerDelayMs:started-queuedAt,elapsedMs:Date.now()-started});});
 });
 request.setTimeout(3000,()=>request.destroy(Error('timeout')));
 request.on('error',()=>send({id,ok:false,code:'ACK_NETWORK_ERROR',elapsedMs:Date.now()-started}));
 request.end(JSON.stringify(payload || (type===8?{type:8,data:{choices}}:type===5?{type:5,data:{flags:64}}:{type:6})));
}
if(parentPort)parentPort.on('message',message=>sendAcknowledgment(message));
module.exports={sendAcknowledgment};
