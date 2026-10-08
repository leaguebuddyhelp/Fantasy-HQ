const test=require('node:test'),assert=require('node:assert/strict');
const {rookieScale,createRookieContract,BASE_CAP}=require('../src/fantasyhq/rookie-contracts');
test('NBA source-year scale reproduces the 30 pick rows with individual fourth-year raises',()=>{
 const scale=rookieScale({draftYear:2024,salaryCap:BASE_CAP});assert.equal(scale.rows.length,30);assert.equal(scale.derived,false);
 assert.deepEqual(scale.rows[0].salaries.slice(0,3),[10474200,10998100,11521700]);assert.equal(scale.rows[29].salaries[0],2078600);
 const c=createRookieContract({draftYear:2024,pick:1,salaryCap:BASE_CAP});assert.equal(c.seasons[0].salary,12569040);assert.deepEqual(c.seasons.map(s=>s.option),[null,null,'TEAM','TEAM']);assert.equal(c.guaranteedTotal,c.seasons[0].salary+c.seasons[1].salary);
});
test('later 2K salary caps produce explicitly derived tables; no unknown future cap is invented',()=>{
 assert.throws(()=>rookieScale({draftYear:2027}),/Confirm.*salary cap/);
 const scale=rookieScale({draftYear:2027,salaryCap:190960000});assert.equal(scale.derived,true);assert.ok(scale.rows[0].salaries[0]>10474200);
 const c=createRookieContract({draftYear:2027,pick:30,salaryCap:190960000,scalePercentage:100});assert.equal(c.seasons[0].season,'2027-28');assert.equal(c.provenance.derived,true);
 for(const percentage of [79,121,NaN])assert.throws(()=>createRookieContract({draftYear:2027,pick:1,salaryCap:190960000,scalePercentage:percentage}),/80–120/);
});
test('second round uses its exception bounds and last-year team option rather than first-round scale',()=>{
 const options={draftYear:2024,pick:31,salaryCap:BASE_CAP,secondRoundYears:3,firstYearSalary:1157153};const c=createRookieContract(options);assert.deepEqual(c.seasons.map(s=>s.salary),[1157153,1955377,2296271]);assert.deepEqual(c.seasons.map(s=>s.option),[null,null,'TEAM']);
 const four=createRookieContract({...options,pick:60,secondRoundYears:4,secondYearSalary:1955377});assert.deepEqual(four.seasons.map(s=>s.option),[null,null,null,'TEAM']);
 assert.throws(()=>createRookieContract({...options,firstYearSalary:2000000}),/limits/);assert.throws(()=>createRookieContract({...options,secondRoundYears:2}),/three- or four/);assert.throws(()=>createRookieContract({...options,pick:61}),/1 and 60/);
});
