const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {createTesseractProvider}=require('../src/fantasyhq/box-score/tesseract-provider');
const {sample}=require('./fixtures/cavaliers-bucks');
const {normalizeText}=require('../src/fantasyhq/service-helpers');

test('offline Tesseract reads both real Association screenshots without an API key', {timeout:180000}, async()=>{
  const provider=createTesseractProvider();
  const expected=sample();
  const images=['association-bucks.jpg','association-cavaliers.jpg'].map((file,i)=>({
    mediaId:expected.screenshots[i].mediaId,bytes:fs.readFileSync(path.join(__dirname,'fixtures',file)),
  }));
  const originals=images.map(image=>Buffer.from(image.bytes));
  const response=await provider.extract(images);
  assert.equal(response.error,undefined);
  const result=provider.parse(response);
  for(let i=0;i<2;i++) {
    const actual=result.screenshots[i],gold=expected.screenshots[i];
    assert.deepEqual(actual.scoreboard,gold.scoreboard);
    assert.deepEqual(actual.totals,gold.totals);
    assert.equal(actual.players.length,gold.players.length);
    for(let j=0;j<gold.players.length;j++) {
      assert.equal(normalizeText(actual.players[j].displayedName),normalizeText(gold.players[j].displayedName));
      assert.equal(actual.players[j].dnp,gold.players[j].dnp);
      assert.deepEqual(actual.players[j].stats,gold.players[j].stats);
    }
    assert.deepEqual(images[i].bytes,originals[i]);
  }
  // Accurate chosen values can still have uncertain alternatives: never hide them.
  assert.ok(result.screenshots[0].uncertainFields.some(f=>f.reason==='OCR readings disagree.'));
  assert.ok(JSON.parse(response.raw).screenshots[0].cells[0].readings);
});

test('4K Cavaliers/Heat uploads recognize table despite garbled red title and retain correct scores and totals', {timeout:180000}, async()=>{
 const provider=createTesseractProvider();
 const images=['association-cle-miami-cle.jpg','association-cle-miami-heat.jpg'].map((file,i)=>({mediaId:String(i),bytes:fs.readFileSync(path.join(__dirname,'fixtures',file))}));
 const result=await provider.extract(images);assert.equal(result.error,undefined);
 const screens=provider.parse(result).screenshots;
 const points=[[33,22,15,14,12,12,8,7,6,4,null,null,null,null],[26,26,17,16,15,15,10,3,2,0,0,0,null,null]];
 const totals=[['240','133','40','33','9','4','14','53-91','8-28','19-22','7','29'],['240','130','38','27','8','4','15','46-91','12-35','26-30','8','20']];
 for(const [i,s] of screens.entries()){
  assert.equal(s.tableTeamName,i?'Heat':'Cavaliers');assert.equal(s.players.length,14);
  assert.deepEqual(s.scoreboard.map(t=>t.finalScore),['133','130']);
  assert.deepEqual(s.scoreboard.map(t=>t.periods.map(p=>p.score)),[['32','31','35','35'],['34','36','27','33']]);
  assert.deepEqual(s.players.map(p=>p.dnp?null:Number(p.stats.PTS)),points[i]);
  assert.deepEqual(Object.values(s.totals),totals[i]);
  assert.equal(s.players.filter(p=>p.dnp).length,i?2:4);
 }
 assert.equal(screens[0].players[3].displayedName,'J. Harden');assert.equal(screens[0].players[3].stats.AST,'14');
 assert.equal(screens[1].players[0].displayedName,'G. Antetokounmpo');
 assert.ok(screens.some(s=>s.uncertainFields.length));
});

test('saved Wolves/Rockets images read quarter labels even when whole-image OCR misses them', {timeout:180000}, async()=>{
 const provider=createTesseractProvider();
 const result=await provider.extract(['association-wolves.jpg','association-rockets.jpg'].map((file,i)=>({mediaId:String(i),bytes:fs.readFileSync(path.join(__dirname,'fixtures',file))})));
 assert.equal(result.error,undefined);
 const screens=provider.parse(result).screenshots;
 assert.deepEqual(screens.map(s=>s.tableTeamName),['Timberwolves','Rockets']);
 for(const s of screens){assert.deepEqual(s.scoreboard.map(t=>t.finalScore),['93','121']);assert.equal(s.players.length,14);}
 assert.deepEqual(screens.map(s=>s.totals.PTS),['121','93']);
 assert.deepEqual(screens[0].scoreboard.map(t=>t.periods.map(p=>p.score)),[['26','33','11','23'],['32','31','33','25']]);
});

test('camera-style portrait framing and EXIF rotation preserve scores and original uploads', {timeout:180000}, async()=>{
 const sharp=require('sharp');
 const source=fs.readFileSync(path.join(__dirname,'fixtures','association-wolves.jpg'));
 const screen=await sharp(source).resize({width:1920}).png().toBuffer();
 const photo=await sharp({create:{width:2300,height:1800,channels:3,background:'#414141'}}).composite([{input:screen,left:170,top:280}]).jpeg({quality:95}).toBuffer();
 const rotated=await sharp(photo).rotate(-90).withMetadata({orientation:6}).jpeg({quality:95}).toBuffer();
 const original=Buffer.from(rotated), provider=createTesseractProvider();
 const tilted=await sharp(photo).rotate(3,{background:'#414141'}).jpeg({quality:95}).toBuffer();
 const result=await provider.extract([{mediaId:'photo',bytes:rotated},{mediaId:'tilted-photo',bytes:tilted}]);
 assert.equal(result.error,undefined);
 const actual=provider.parse(result).screenshots[0];
 assert.equal(actual.tableTeamName,'Timberwolves');
 assert.deepEqual(actual.scoreboard.map(t=>t.finalScore),['93','121']);
 assert.equal(actual.totals.PTS,'121'); assert.equal(actual.players.length,14);
 assert.deepEqual(rotated,original);
 const angled=provider.parse(result).screenshots[1];
 assert.deepEqual(angled.scoreboard.map(t=>t.finalScore),['93','121']);
 assert.equal(angled.totals.PTS,'121');
});

test('Heat/Pistons uploads locate the table when the highlighted Minutes heading is unreadable', {timeout:180000}, async()=>{
 const provider=createTesseractProvider();
 const result=await provider.extract(['association-pistons.jpg','association-heat-pistons-heat.jpg'].map((file,i)=>({mediaId:String(i),bytes:fs.readFileSync(path.join(__dirname,'fixtures',file))})));
 assert.equal(result.error,undefined);
 const screens=provider.parse(result).screenshots;
 assert.deepEqual(screens.map(s=>s.tableTeamName),['Pistons','Heat']);
 for(const s of screens){assert.deepEqual(s.scoreboard.map(t=>t.finalScore),['98','96']);assert.equal(s.players.length,14);}
 assert.deepEqual(screens.map(s=>s.totals.PTS),['98','96']);
 for(const s of screens)assert.deepEqual(s.scoreboard.map(t=>t.periods.map(p=>p.score)),[['26','19','27','26'],['13','26','26','31']]);
});
