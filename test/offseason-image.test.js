const test=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp');
const image=require('../src/fantasyhq/offseason-image');
test('offseason photo normalization preserves original bytes and rejects invalid formats and oversized input',async()=>{
 const bytes=await sharp({create:{width:100,height:60,channels:3,background:'#ffdc21'}}).jpeg().toBuffer(),before=Buffer.from(bytes);
 const metadata=await image.metadata(bytes);assert.equal(metadata.format,'jpeg');const normalized=await image.normalize(bytes);assert.equal((await sharp(normalized).metadata()).format,'png');assert.deepEqual(bytes,before);
 await assert.rejects(image.metadata(Buffer.alloc(24*1024*1024+1)),/24 MB/);
 await assert.rejects(image.metadata(Buffer.from('not an image')));const avif=await sharp(bytes).avif().toBuffer();await assert.rejects(image.metadata(avif),/supported HEIC/);
});

test('real phone HEIC decodes through bounded native normalization with original bytes intact',{timeout:60000},async()=>{
 const bytes=require('fs').readFileSync(require('path').join(__dirname,'fixtures','phone-offseason.heic')),before=Buffer.from(bytes),info=await image.metadata(bytes);assert.equal(info.format,'heif');assert.ok(info.width>3000&&info.height>3000);const normalized=await image.normalize(bytes),meta=await sharp(normalized).metadata();assert.equal(meta.format,'png');assert.ok(meta.width<=2800&&meta.height<=2800);assert.deepEqual(bytes,before);
});

test('protected HEIC review preview returns PNG while original endpoint retains exact evidence',{timeout:60000},async()=>{
 const {handleBoxScoreReview}=require('../src/fantasyhq/box-score/review-route'),bytes=require('fs').readFileSync(require('path').join(__dirname,'fixtures','phone-offseason.heic')),media={mediaId:'33333333-3333-3333-3333-333333333333',submissionId:'22222222-2222-2222-2222-222222222222',contentType:'image/heic'};
 const submissions={load:()=>({game:{leagueId:'league'},submissions:[{submissionId:'22222222-2222-2222-2222-222222222222'}],media:[media],extractions:[]}),readOriginal:()=>bytes};
 function request(query,authorized=true){return new Promise(resolve=>{const url=new URL('http://localhost/api/games/11111111-1111-1111-1111-111111111111/submissions/22222222-2222-2222-2222-222222222222/media/33333333-3333-3333-3333-333333333333'+query),response={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){resolve({status:this.status,headers:this.headers,body});}};assert.equal(handleBoxScoreReview({method:'GET'},response,url,{authorized,submissions}),true);});}
 assert.equal((await request('?preview=1',false)).status,403);const preview=await request('?preview=1');assert.equal(preview.status,200);assert.equal(preview.headers['Content-Type'],'image/png');assert.equal((await sharp(preview.body).metadata()).format,'png');assert.deepEqual((await request('')).body,bytes);
});
