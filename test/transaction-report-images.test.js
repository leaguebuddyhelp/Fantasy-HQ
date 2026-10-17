const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {recognizeTransactionReport,parseReportRow}=require('../src/fantasyhq/transaction-report-ocr');
const teams=['Houston Rockets','Chicago Bulls','Portland Trail Blazers','Brooklyn Nets','Los Angeles Clippers','Orlando Magic','Golden State Warriors'].map((teamName,i)=>({teamId:String(i),teamName,abbreviation:'T'+i}));
const names=['Moussa Cisse','Randall Pope','Adin Durmanenko','Ben Saraf','Baba Miller','Malaki Branham','Oscar Tshiebwe','Tre Jones','Brandon Williams','Yang Hansen'];
const players=names.map(name=>({playerId:name,name}));
test('real signing and waiver report photos identify dated transactions and preserve all input evidence',{timeout:180000},async()=>{
 for(const [file,count]of [['transaction-signings-photo.jpg',3],['transaction-waivers-photo.jpg',10]]){
  const bytes=fs.readFileSync(path.join(__dirname,'fixtures',file)),before=Buffer.from(bytes),result=await recognizeTransactionReport(bytes),parsed=result.rows.map(row=>parseReportRow(row,players,teams));
  assert.equal(parsed.length,count);assert.ok(parsed.every(r=>r.date));assert.ok(parsed.every(r=>r.playerId),JSON.stringify(parsed));
  assert.ok(parsed.every(r=>r.teamId!==null),JSON.stringify(parsed));assert.deepEqual(bytes,before);
  if(count===3){assert.deepEqual(parsed.map(r=>r.reportedTotal),[9290000,1360000,2000000]);assert.deepEqual(parsed.map(r=>r.reportedYears),[3,1,1]);}
  else assert.deepEqual(parsed.map(r=>r.playerId),['Ben Saraf','Baba Miller','Malaki Branham','Moussa Cisse','Oscar Tshiebwe','Randall Pope','Tre Jones','Brandon Williams','Adin Durmanenko','Yang Hansen']);
 }
});
