const test=require('node:test'),assert=require('node:assert/strict');
const {nbaMinimumSalary}=require('../src/fantasyhq/nba-minimum-salary');
const {normalizeContractDetails}=require('../src/fantasyhq/contract-details');
const {fixture}=require('./helpers/free-agency');
test('published 2026-27 player minimums use service time including the 10+ band',()=>{
 assert.equal(nbaMinimumSalary(2026,{yearsInNBA:0}).salary,1357763);
 assert.equal(nbaMinimumSalary(2026,{yearsInNBA:1}).salary,2185116);
 assert.equal(nbaMinimumSalary(2026,{yearsInNBA:6}).salary,3066143);
 assert.equal(nbaMinimumSalary(2026,{yearsInNBA:10}).salary,3876529);
 assert.equal(nbaMinimumSalary(2026,{yearsInNBA:22}).salary,3876529);
 for(const raw of [undefined,null,'',-1,2.5,'unknown'])assert.throws(()=>nbaMinimumSalary(2026,{yearsInNBA:raw}),/service time is unknown/);
 assert.throws(()=>nbaMinimumSalary(2027,{yearsInNBA:6}),/No verified NBA minimum/);
});
test('MINIMUM resolves before scoring and retains its source without changing explicit salary offers',()=>{
 const details={salary:'MINIMUM',years:'1',structure:'Back (+5%)',option:'None'};
 const resolved=normalizeContractDetails(details,{year:2026,player:{yearsInNBA:6}});
 assert.equal(resolved.details.salary,3066143);assert.equal(resolved.contract.guaranteedTotal,3066143);
 assert.equal(resolved.contract.minimumSalary.yearsOfService,6);assert.match(resolved.contract.minimumSalary.sourceUrl,/realgm/);
 assert.equal(details.salary,'MINIMUM');
 const explicit=normalizeContractDetails({...details,salary:'$4.32M'},{year:2026,player:{yearsInNBA:6}});
 assert.equal(explicit.details.salary,4320000);assert.equal(explicit.contract.minimumSalary,undefined);
});
