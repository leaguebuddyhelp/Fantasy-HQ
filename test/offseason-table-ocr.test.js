const test=require('node:test'),assert=require('node:assert/strict');const {tableProposals}=require('../src/fantasyhq/offseason-table-ocr');
const line=(text,x,y,width=70)=>({text,confidence:95,bbox:{x0:x,y0:y,x1:x+width,y1:y+20}});
const players=[{playerId:'maxey',name:'Tyrese Maxey',teamId:'phi'},{playerId:'brown',name:'Jaylen Brown',teamId:'phi'}],teams=[{teamId:'phi',teamName:'Philadelphia 76ers',abbreviation:'PHI'},{teamId:'cle',teamName:'Cleveland Cavaliers',abbreviation:'CLE'}];
test('progression OCR uses the left selected franchise, deskews columns and flags unreadable changes instead of guessing',()=>{
 const lines=[line('Philadelphia 76ers',50,50,150),line('Cleveland Cavaliers',800,50,150),line('NAME',50,200),line('POS',250,205),line('AGE',350,207),line('WRATING',450,210),line('T. Maxey',50,250),line('PG',250,255),line('26',350,257),line('91',450,260),line('J. Brown',50,290),line('SG',250,295),line('30',350,297),line('907-1',450,300),line('Sort @ View Player C',50,350,200)];
 const report=tableProposals({step:'PROGRESSION',text:'Player Progression',lines,width:1000,players,teams});assert.equal(report.rows.length,2);assert.equal(report.tableTeamId,'phi');assert.equal(report.rows[0].overall,91);assert.equal(report.rows[0].change,null);assert.match(report.rows[0].flags.join(' '),/no signed change/);assert.equal(report.rows[1].change,-1);
});
test('official draft tables convert second-round local numbers and preserve ambiguous permanent-player matching',()=>{
 const lines=[line('PICK #',0,200),line('TEAM',120,200),line('NAME',250,200),line('POS',450,200),line('OVR',550,200),line('AGE',650,200),line('1',0,250),line('76ers',120,250),line('J. Brown',250,250),line('SG',450,250),line('75',550,250),line('19',650,250)];
 const report=tableProposals({step:'DRAFT',text:'Draft Summary Round 2/2',lines,width:1000,players:[...players,{playerId:'other-brown',name:'James Brown'}],teams});assert.equal(report.rows[0].pickNumber,31);assert.equal(report.rows[0].teamId,'phi');assert.equal(report.rows[0].playerId,null);assert.equal(report.rows[0].playerCandidates.length,2);
 assert.equal(tableProposals({step:'DRAFT',text:'Mock Draft',lines,width:1000,players,teams}).screenType,'PROJECTION');assert.equal(tableProposals({step:'LOTTERY',text:'Mock Draft',lines,width:1000,players,teams}).rows.length,0);
});
test('Transaction Report suggestions treat displayed deal value as total, without inventing annual salaries or options',()=>{
 const report=tableProposals({step:'FREE_AGENCY',text:'76ers sign PG Tyrese Maxey to 3yr/$45.00M deal',players,teams});assert.equal(report.rows[0].playerId,'maxey');assert.equal(report.rows[0].reportedTotal,45000000);assert.equal(report.rows[0].contractYears,3);assert.equal(report.rows[0].salary,undefined);assert.match(report.rows[0].flags[0],/total value/);
});
test('lottery owner labels never silently become original franchises or override ambiguous labels',()=>{
 const lines=[line('PICK #',0,200),line('TEAM',250,200),line('1',0,250),line('76ers',250,250)];
 const report=tableProposals({step:'LOTTERY',text:'Draft Lottery',lines,width:1000,players,teams});assert.equal(report.rows.length,1);assert.equal(report.rows[0].teamId,'phi');assert.equal(report.rows[0].originalTeamId,null);assert.match(report.rows[0].flags.join(' '),/owner label alone/);
 const explicit=tableProposals({step:'LOTTERY',text:'Draft Lottery',lines:[...lines,line('ORIGINAL',550,200),line('Cavaliers',550,250)],width:1000,players,teams});assert.equal(explicit.rows[0].originalTeamId,'cle');assert.equal(explicit.rows[0].teamId,'phi');
});
