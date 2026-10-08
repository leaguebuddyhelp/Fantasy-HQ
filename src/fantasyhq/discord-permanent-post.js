const {createHash}=require('crypto');
const pending=new Map();
async function findPost(channel,marker,since){
 if(!channel.messages?.fetch)throw Error('Cannot reconcile pending announcement; retry when channel history is available.');
 let before;
 while(true){const page=await channel.messages.fetch({limit:100,...(before?{before}:{})});if(!page||typeof page.values!=='function')throw Error('Announcement history is unavailable.');const rows=[...page.values()],found=rows.find(m=>m.embeds?.some(e=>(e.footer||e.data?.footer)?.text===marker));if(found)return found;if(rows.length<100||rows.at(-1).createdTimestamp<Date.parse(since))return null;const next=rows.at(-1).id;if(next===before)throw Error('Announcement history pagination stalled.');before=next;}
}
function publishPermanentPost({key,channel,marker,receipt,save,payload,now=Date.now}){
 if(pending.has(key))return pending.get(key);
 const task=(async()=>{
  if(receipt?.messageId)return receipt;
  let message=receipt?.status==='PENDING'?await findPost(channel,marker,receipt.at):null;
  if(!message){await save({status:'PENDING',at:new Date(now()).toISOString(),channelId:channel.id});const body=await payload();message=await channel.send({...body,nonce:createHash('sha256').update(marker).digest('hex').slice(0,24),enforceNonce:true,allowedMentions:body.allowedMentions||{parse:[]}});}
  const delivered={status:'DELIVERED',messageId:message.id,channelId:channel.id,at:new Date(now()).toISOString()};await save(delivered);return delivered;
 })().finally(()=>pending.delete(key));pending.set(key,task);return task;
}
module.exports={publishPermanentPost,findPost};
