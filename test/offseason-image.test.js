const test=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp');
const image=require('../src/fantasyhq/offseason-image');
test('offseason photo normalization preserves original bytes and rejects invalid formats and oversized input',async()=>{
 const bytes=await sharp({create:{width:100,height:60,channels:3,background:'#ffdc21'}}).jpeg().toBuffer(),before=Buffer.from(bytes);
 const metadata=await image.metadata(bytes);assert.equal(metadata.format,'jpeg');const normalized=await image.normalize(bytes);assert.equal((await sharp(normalized).metadata()).format,'png');assert.deepEqual(bytes,before);
 await assert.rejects(image.metadata(Buffer.alloc(24*1024*1024+1)),/24 MB/);
 await assert.rejects(image.metadata(Buffer.from('not an image')));const avif=await sharp(bytes).avif().toBuffer();await assert.rejects(image.metadata(avif),/supported HEIC/);
});
