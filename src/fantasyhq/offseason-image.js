const sharp=require('sharp'),path=require('node:path'),{Worker}=require('node:worker_threads');
const pending=[];let running=false;
async function metadata(bytes) {
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>24*1024*1024)throw Error('Upload a JPG, PNG, WebP or HEIC no larger than 24 MB.');
 const info=await sharp(bytes,{limitInputPixels:60000000}).metadata();
 if(!['jpeg','png','webp','heif'].includes(info.format)||!info.width||!info.height||info.width*info.height>60000000)throw Error('Use a JPG, PNG, WebP or HEIC photo within the supported pixel limit.');
 if(info.format==='heif'&&(info.compression!=='hevc'||!/heic|heix|hevc|hevx|mif1|msf1/.test(bytes.subarray(8,80).toString('ascii'))))throw Error('Use a supported HEIC photo.');
 return info;
}
function runNext() {
 if(running||!pending.length)return;running=true;
 const {bytes,resolve,reject}=pending.shift();
 const worker=new Worker(path.join(__dirname,'offseason-image-worker.js'),{workerData:{bytes},resourceLimits:{maxOldGenerationSizeMb:256}});
 let finished=false;
 const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);Promise.resolve(worker.terminate()).finally(()=>{running=false;if(error)reject(error);else resolve(result);runNext();});};
 const timer=setTimeout(()=>finish(Error('HEIC decoding timed out. Retry or upload a JPG export.')),45000);
 worker.once('message',message=>finish(message.error?Error(message.error):null,message.bytes&&Buffer.from(message.bytes)));
 worker.once('error',error=>finish(error));worker.once('exit',code=>{if(!finished)finish(Error('HEIC decoder stopped before completing the photo.'));});
}
async function normalize(bytes) {
 const info=await metadata(bytes);
 if(info.format!=='heif')return sharp(bytes,{limitInputPixels:60000000}).rotate().resize({width:2800,withoutEnlargement:true}).normalize().png().toBuffer();
 if(pending.length>=6)throw Error('The photo decoder is busy. Retry after the current uploads finish.');
 return new Promise((resolve,reject)=>{pending.push({bytes,resolve,reject});runNext();});
}
module.exports={metadata,normalize};
