const {parentPort,workerData}=require('node:worker_threads');
(async()=>{
 const bytes=Buffer.from(workerData.bytes),decode=require('heic-decode');
 const image=await decode({buffer:bytes});
 if(!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width*image.height>60000000)throw Error('Photo exceeds the supported pixel limit.');
 const png=await require('sharp')(Buffer.from(image.data),{raw:{width:image.width,height:image.height,channels:4},limitInputPixels:60000000})
  .resize({width:2800,height:2800,fit:'inside',withoutEnlargement:true}).normalize().png().toBuffer();
 parentPort.postMessage({bytes:png});
})().catch(error=>parentPort.postMessage({error:error.message}));
