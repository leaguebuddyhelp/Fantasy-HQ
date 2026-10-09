const {fetchPinnedMessages}=require('./discord-pins');
const pending=new Map();
function ensureSingletonPanel({key,channel,botId,savedId,title,payload,save}) {
  if(pending.has(key))return pending.get(key);
  const task=(async()=>{
    const matches=message=>message?.author?.id===botId&&message.embeds?.some(e=>(e.title||e.data?.title)===title);
    const pins=await fetchPinnedMessages(channel);
    let saved;
    if(savedId)try{saved=await channel.messages.fetch(savedId);}catch(error){if(Number(error.code)!==10008)throw error;}
    if(saved&&!matches(saved))throw Error('Saved panel identity does not match the bot and purpose.');
    let message=saved||pins.find(matches);
    if(!message){const recent=await channel.messages.fetch({limit:100});message=[...recent.values()].find(matches);}
    if(message)await message.edit(payload);else message=await channel.send(payload);
    if(!message.pinned)await message.pin();
    await save(message.id);
    for(const duplicate of pins.filter(m=>matches(m)&&m.id!==message.id)){
      await duplicate.edit({components:[]});await duplicate.unpin();
    }
    return message;
  })().finally(()=>pending.delete(key));pending.set(key,task);return task;
}
module.exports={ensureSingletonPanel};
