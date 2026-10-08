const test=require('node:test'),assert=require('node:assert/strict');
const {representedAt}=require('../src/fantasyhq/historical-membership');
test('trade history resolves the original game team after transfers and rollover closes memberships',()=>{
 const membership={playerId:'p',teamId:'b',seasonId:'1',active:false,endedAt:'2027-07-01T00:00:00Z',ownershipHistory:[{teamId:'a',action:'ROSTERED',timestamp:null},{teamId:'b',action:'TRADED',timestamp:'2026-11-01T00:00:00Z'}]};
 const represented=(teamId,at)=>representedAt(membership,{playerId:'p',teamId,seasonId:'1',at});
 assert.equal(represented('a','2026-10-08T00:00:00Z'),true);assert.equal(represented('b','2026-10-08T00:00:00Z'),false);
 assert.equal(represented('a','2026-11-02T00:00:00Z'),false);assert.equal(represented('b','2026-11-02T00:00:00Z'),true);
 assert.equal(represented('b','2027-07-02T00:00:00Z'),false);assert.equal(represented('b','invalid'),false);
});
