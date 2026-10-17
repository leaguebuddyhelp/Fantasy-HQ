const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sharp=require('sharp');
const {createTesseractProvider}=require('../src/fantasyhq/box-score/tesseract-provider');

test('cropped box-score tables retain players and totals without inventing the removed scoreboard',{timeout:180000},async()=>{
 const source=fs.readFileSync(path.join(__dirname,'fixtures','association-pistons.jpg'));
 const meta=await sharp(source).metadata();
 const left=Math.round(meta.width*.33),top=Math.round(meta.height*.09);
 const crop=await sharp(source).extract({left,top,width:Math.round(meta.width*.63),height:Math.round(meta.height*.84)}).jpeg({quality:95}).toBuffer();
 const original=Buffer.from(crop),provider=createTesseractProvider();
 const tilted=await sharp(crop).rotate(3,{background:'#202329'}).jpeg({quality:95}).toBuffer();
 const response=await provider.extract([{mediaId:'cropped-table',bytes:crop},{mediaId:'tilted-crop',bytes:tilted}]);
 assert.equal(response.error,undefined);
 for (const screen of provider.parse(response).screenshots) {
 assert.equal(screen.tableTeamName,'Pistons');
 assert.equal(screen.players.length,14);
 assert.equal(screen.totals.PTS,'98');
 assert.ok(screen.players.some(p=>p.dnp));
 assert.ok(screen.scoreboard.every(b=>b.teamName===null&&b.finalScore===null&&b.periods.every(p=>p.score===null)));
 assert.ok(screen.uncertainFields.some(f=>f.path==='scoreboard'));
 }
 assert.deepEqual(crop,original);
});
