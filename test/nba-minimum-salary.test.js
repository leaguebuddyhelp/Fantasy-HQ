const test=require('node:test'),assert=require('node:assert/strict');
const {nbaMinimumSalary}=require('../src/fantasyhq/nba-minimum-salary');
const {normalizeOffer}=require('../src/fantasyhq/offer-score');
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
 const resolved=normalizeOffer(details,{year:2026,player:{yearsInNBA:6}});
 assert.equal(resolved.details.salary,3066143);assert.equal(resolved.contract.guaranteedTotal,3066143);
 assert.equal(resolved.contract.minimumSalary.yearsOfService,6);assert.match(resolved.contract.minimumSalary.sourceUrl,/realgm/);
 assert.equal(details.salary,'MINIMUM');
 const explicit=normalizeOffer({...details,salary:'$4.32M'},{year:2026,player:{yearsInNBA:6}});
 assert.equal(explicit.details.salary,4320000);assert.equal(explicit.contract.minimumSalary,undefined);
});
test('confirmed minimum offer stores exact salary, original MINIMUM evidence and completes at that amount',t=>{
 const f=fixture(t,{count:14});f.repository.savePlayers('league',f.repository.loadPlayers('league').map(p=>p.playerId==='fa-0'?{...p,yearsInNBA:6}:p));
 const offer=f.submit('a','fa-0',{details:{salary:'MINIMUM',years:'1',structure:'Back (+5%)',option:'None'}});
 assert.equal(offer.details.salary,3066143);assert.equal(offer.ocrOriginal.salary,'MINIMUM');assert.equal(offer.contract.minimumSalary.season,'2026-27');
 f.review(offer.id);f.advance(3600001);f.service.tick('league');
 const player=f.repository.loadPlayers('league').find(p=>p.playerId==='fa-0');assert.equal(player.teamId,'a');assert.equal(player.contract.seasons[0].salary,3066143);assert.equal(player.contract.minimumSalary.yearsOfService,6);
});
