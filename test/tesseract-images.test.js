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
