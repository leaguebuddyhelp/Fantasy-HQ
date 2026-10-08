const test=require('node:test');const assert=require('node:assert/strict');
const {contractView,contractValue,teamPayroll}=require('../src/shared/player-contract');
const {evaluatePlayerTradeValue}=require('../src/fantasyhq/asset-valuation');
const {needFor,teamPositionNeeds,chooseProspect}=require('../src/fantasyhq/mock-engine');
const {nbaPlayerCard}=require('../src/shared/discord-player-card');
const contract=(salary,years=3,option=null)=>({sourceUrl:'https://www.basketball-reference.com/contracts/ATL.html',fetchedAt:'2026-10-07T00:00:00Z',guaranteedTotal:salary*years,seasons:Array.from({length:years},(_,i)=>({season:`${2026+i}-${String(2027+i).slice(-2)}`,salary,option:i===1?option:null}))});
test('contract values reward affordability and team control without treating unknown salaries as zero',()=>{
 const p={name:'Test',overall:85,birthdate:'2000-01-01',position1:'PG'};
 const neutral=evaluatePlayerTradeValue(p,1);
 const cheap=evaluatePlayerTradeValue({...p,contract:contract(5000000)},1);
 const expensive=evaluatePlayerTradeValue({...p,contract:contract(60000000)},1);
 assert.ok(cheap.value>neutral.value);assert.ok(expensive.value<neutral.value);
 assert.equal(contractValue({...p,contract:contract(null)},2026).modifier,1);
 assert.equal(contractView({...p,contract:contract(null)},2026).known,false);
 assert.ok(contractValue({...p,contract:contract(5000000,3,'PLAYER')},2026).modifier<cheap.components.contractModifier);
 assert.equal(contractView({...p,contract:contract(10000000)},2027).salary,10000000);
 assert.equal(contractView({...p,contract:contract(10000000,1)},2026).expiring,true);
 assert.equal(contractView({...p,contract:contract(10000000,1)},2028).known,false);
 assert.ok(expensive.components.contractModifier>=.75&&cheap.components.contractModifier<=1.18);
});
test('need signals distinguish expiring and player-option starters from controlled contracts',()=>{
 const p={position1:'PG',overall:90,age:25,contract:contract(20000000)};
 const input={draftYear:2027,rosters:{t:[p,{position1:'PG',overall:80,age:24}]}};
 const prospect={position_1:'PG'};const controlled=needFor(input,'t',prospect);
 p.contract=contract(20000000,1);const expiring=needFor(input,'t',prospect);
 assert.ok(expiring>controlled);assert.match(teamPositionNeeds(input,'t').positions[0].contractReason,/expires/);
 p.contract=contract(20000000,3,'PLAYER');assert.ok(needFor(input,'t',prospect)>controlled);
 p.contract=contract(20000000,3,'TEAM');assert.equal(needFor(input,'t',prospect),controlled);
 delete p.contract;assert.equal(needFor(input,'t',prospect),controlled);
});
test('payroll marks coverage, Discord cards show salary seasons and options, and elite guards survive contract signals',()=>{
 const player={name:'Test',overall:85,contract:contract(12000000,3,'PLAYER')};
 assert.equal(teamPayroll([player,{name:'Unknown'}],2026).knownPlayers,1);
 const embed=nbaPlayerCard({...player,contractView:contractView(player,2026)},'test').embeds[0].toJSON();
 assert.match(JSON.stringify(embed),/12,000,000/);assert.match(JSON.stringify(embed),/2027-28/);assert.match(JSON.stringify(embed),/PO/);
 const prospects=[{prospectId:'elite',board_number:1,'draft score':96,position_1:'PG'},{prospectId:'other',board_number:2,'draft score':90,position_1:'C'}];
 assert.equal(chooseProspect({draftYear:2027,rosters:{t:[{...player,position1:'PG'}]},prospects},{pickNumber:1,currentOwnerTeamId:'t'},[],null,()=>.999999).prospectId,'elite');
});
