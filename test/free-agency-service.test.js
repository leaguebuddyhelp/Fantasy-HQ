const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFantasyHQRepository } = require('../src/fantasyhq/repository');
const { createFreeAgencyService, HOUR_MS } = require('../src/fantasyhq/free-agency-service');
const { activeMemberships } = require('../src/fantasyhq/service-helpers');
const { playerTransactionLock } = require('../src/fantasyhq/transaction-locks');
const { normalizeOffer, offerScore, rankOffers, parseContractText } = require('../src/fantasyhq/offer-score');
const { fixture } = require('./helpers/free-agency');
test('FA browser uses official pool, primary position only, descending OVR and private window status', t => {
  const f = fixture(t); assert.equal(f.service.browse('league','PG').length,9); assert.equal(f.service.browse('league','SG').length,1);
  assert.deepEqual(f.service.browse('league','PG').map(p=>p.overall),[85,84,83,82,81,80,79,78,77]);
  f.submit(); const p=f.service.browse('league','PG')[0]; assert.equal(p.status,'OPEN'); assert.ok(p.deadlineAt); assert.ok(!JSON.stringify(p).includes('coach-a'));
  assert.throws(()=>f.submit('a','a-0'),/Free Agent pool/);
});
test('parser extracts screenshot fields, ignores Promise and normalizes exact scraper contract shape', () => {
  const extracted=parseContractText('Salary\n$6.66M\nYears: 3+1\nContract Type: Front (-5%)\nOption: Player Option\nPromise: Starter');
  assert.deepEqual(extracted,{salary:'$6.66M',years:'3+1',structure:'Front (-5%)',option:'Player Option'});
  const n=normalizeOffer(extracted,{year:2026,screenshotUrl:'proof'});
  assert.deepEqual(Object.keys(n.contract),['source','sourceUrl','playerUrl','fetchedAt','currency','seasons','guaranteedTotal']);
  assert.deepEqual(n.contract.seasons.map(r=>r.salary),[6660000,6327000,5994000,5661000]);
  assert.equal(n.contract.seasons.at(-1).option,'PLAYER'); assert.ok(!JSON.stringify(n).includes('Promise'));
  for(const [label,canonical] of [['None',null],['TEAM OPTION','TEAM'],['Player','PLAYER']]) assert.equal(normalizeOffer({salary:1000000,years:'2',structure:'Flat',option:label},{year:2026}).contract.seasons.at(-1).option,canonical);
  assert.throws(()=>normalizeOffer({...extracted,option:'None'},{year:2026}),/requires/);
  assert.throws(()=>normalizeOffer({...extracted,salary:'??'},{year:2026}),/readable/);
});
test('Offer Score makes money dominant, security secondary, options meaningful and structure small', () => {
  const contract=(salary,years='3',option='None',structure='Flat')=>normalizeOffer({salary,years,option,structure},{year:2026}).contract;
  const base=contract(10000000);
  assert.ok(offerScore(contract(20000000,'2'))>offerScore(contract(10000000,'3','Player')));
  assert.ok(offerScore(contract(10000000,'4'))>offerScore(base));
  assert.ok(offerScore(contract(10000000,'3','Player'))>offerScore(base));
  assert.ok(offerScore(contract(10000000,'3','Team'))<offerScore(base));
  assert.equal(contract(10000000,'3+1','Team').guaranteedTotal,30000000);
  assert.equal(contract(10000000,'3+1','Player').guaranteedTotal,40000000);
  assert.ok(offerScore(base,'FRONT')>offerScore(base,'FLAT')); assert.ok(offerScore(base,'FLAT')>offerScore(base,'BACK'));
  assert.ok(offerScore(contract(15000000),'BACK')>offerScore(base,'FRONT'));
  assert.deepEqual(contract(10000000,'3','None','Back (+5%)').seasons.map(r=>r.salary),[10000000,10500000,11000000]);
});
test('first successful screenshot starts immutable hour; review/correction/competing offers cannot extend it', t => {
  const f=fixture(t);const a=f.submit();const w=f.state().windows[0]; assert.equal(Date.parse(w.deadlineAt)-Date.parse(w.startedAt),HOUR_MS);
  f.advance(300000);f.submit('b');f.review(a.id,'CORRECT',{correction:{salary:8000000,years:'3',structure:'Flat',option:'None'}});f.review(a.id);
  assert.equal(f.state().windows[0].deadlineAt,w.deadlineAt);assert.equal(f.state().offers[0].corrections.length,1);
  assert.equal(f.state().offers[0].ocrOriginal.salary,'$6.66M');
  const restarted=createFreeAgencyService({repository:createFantasyHQRepository({dataRoot:f.root}),now:f.time}); assert.equal(restarted.getStatus('league','a').activeTargets,1);
  f.advance(HOUR_MS);restarted.tick('league');assert.equal(f.state().windows[0].status,'CLOSED_AWAITING_REVIEW');
  assert.throws(()=>f.submit('c'),/closed/);assert.throws(()=>f.service.withdraw('league',{windowId:w.id,teamId:'a',actorUserId:'coach-a'}),/closed/);
  f.review(f.state().offers.find(o=>o.teamId==='b').id);assert.equal(f.state().windows[0].status,'COMPLETED');
});
test('on-time pending reviews count after deadline and Staff speed never decides winner', t => {
  const f=fixture(t);const a=f.submit();f.review(a.id);f.advance(HOUR_MS-1000);const b=f.submit('b','fa-0',{details:{salary:20000000,years:'3',structure:'Flat',option:'None'}});
  f.advance(1001);f.service.tick('league');assert.equal(f.state().windows[0].status,'CLOSED_AWAITING_REVIEW'); assert.equal(f.repository.loadPlayers('league').find(p=>p.playerId==='fa-0').teamId,null);
  f.advance(600000);f.review(b.id);assert.equal(f.repository.loadPlayers('league').find(p=>p.playerId==='fa-0').teamId,'b');
});
test('improvements keep old approved offer, reject equal/worse, and corrected failures preserve fallback', t => {
  const f=fixture(t);const a=f.submit();f.review(a.id);const deadline=f.state().windows[0].deadlineAt;
  assert.throws(()=>f.submit(),/strictly better/);assert.throws(()=>f.submit('a','fa-0',{details:{salary:1000000,years:'1',structure:'Flat',option:'None'}}),/strictly better/);
  f.advance(1000);const better=f.submit('a','fa-0',{details:{salary:9000000,years:'4',structure:'Flat',option:'None'}});
  assert.equal(f.state().offers.find(o=>o.id===a.id).status,'APPROVED'); assert.throws(()=>f.submit(),/awaiting Staff/);
  f.review(better.id,'REJECT');assert.equal(f.state().offers.find(o=>o.id===a.id).status,'APPROVED');
  const pending=f.submit('a','fa-0',{details:{salary:1e7,years:'4',structure:'Flat',option:'None'}});
  f.review(pending.id,'CORRECT',{correction:{salary:1e6,years:'1',structure:'Flat',option:'None'}});f.review(pending.id);
  assert.equal(f.state().offers.find(o=>o.id===pending.id).status,'REJECTED');assert.equal(f.state().offers.find(o=>o.id===a.id).status,'APPROVED');
  const latest=f.submit('a','fa-0',{details:{salary:2e7,years:'4',structure:'Flat',option:'None'}});f.review(latest.id);
  assert.equal(f.state().offers.find(o=>o.id===a.id).status,'SUPERSEDED');assert.equal(f.state().windows[0].deadlineAt,deadline);
});
test('exact ties use qualifying offer submission, improved timestamp rather than approval time', t => {
  const f=fixture(t);const a=f.submit();f.review(a.id);f.advance(1000);const b=f.submit('b','fa-0',{details:{salary:1e7,years:'4',structure:'Flat',option:'None'}});f.advance(1000);
  const improved=f.submit('a','fa-0',{details:{salary:1e7,years:'4',structure:'Flat',option:'None'}});f.review(improved.id);f.advance(HOUR_MS);f.review(b.id);
  assert.equal(f.state().offers.find(o=>o.status==='WON').teamId,'b');
});
test('rejection and withdrawal free targets and locks; only a new window gets a new deadline', t => {
  const f=fixture(t);const first=f.submit();const old=f.state().windows[0];f.review(first.id,'REJECT');assert.equal(f.service.getStatus('league','a').activeTargets,0);assert.equal(playerTransactionLock(f.repository,'league','1','a-0'),null);
  f.advance(5000);const second=f.submit();const current=f.state().windows.at(-1);assert.notEqual(current.id,old.id);assert.ok(current.deadlineAt>old.deadlineAt);
  f.submit('b');f.service.withdraw('league',{windowId:second.windowId,teamId:'a',actorUserId:'coach-a'});assert.equal(f.state().windows.at(-1).status,'OPEN');assert.equal(f.service.getStatus('league','a').activeTargets,0);
  f.service.withdraw('league',{windowId:second.windowId,teamId:'b',actorUserId:'coach-b'});assert.equal(f.state().windows.at(-1).status,'CANCELLED');
});
test('conditional release locks do not execute until win and block competing reservations, waivers and trades', t => {
  const f=fixture(t);const a=f.submit();assert.equal(f.roster('a').length,15);assert.equal(f.repository.loadPlayers('league').find(p=>p.playerId==='a-0').teamId,'a');
  assert.match(playerTransactionLock(f.repository,'league','1','a-0'),/conditional release/);
  assert.throws(()=>f.submit('a','fa-1'),/reserved/);
  assert.throws(()=>f.service.requestWaiver('league',{teamId:'a',playerId:'a-0',actorUserId:'coach-a'}),/reserved/);
  f.submit('a','fa-1',{conditionalReleasePlayerId:'a-1'});assert.equal(f.service.getStatus('league','a').activeTargets,2);
  assert.throws(()=>f.submit('a','fa-2',{conditionalReleasePlayerId:'a-2'}),/limit reached/);
  f.review(a.id);f.advance(HOUR_MS);f.service.tick('league');
  const released=f.repository.loadPlayers('league').find(p=>p.playerId==='a-0');assert.equal(released.teamId,null);assert.equal(released.contract,undefined);assert.equal(f.roster('a').length,15);
  assert.ok(f.service.browse('league','PG').some(p=>p.playerId==='a-0'));
  assert.ok(f.repository.loadAuditLog('league').some(a=>a.action==='player.waived'&&a.metadata.oldContract));
});
test('full roster must select release; open roster signs without one and repeated resolution is idempotent', t => {
  const f=fixture(t,{count:14});const a=f.submit();f.review(a.id);f.advance(HOUR_MS);f.service.tick('league');f.service.tick('league');f.review(a.id);
  assert.equal(f.roster('a').length,15);assert.equal(f.service.getStatus('league','a').completedSignings,1);
  assert.equal(f.repository.loadAuditLog('league').filter(a=>a.action==='fa.signing.completed').length,1);
  assert.throws(()=>f.submit('a','fa-1',{conditionalReleasePlayerId:null}),/roster is full/);
});
test('waiver needs Staff, preserves audit contract, clears active contract, never restores signing slots', t => {
  const f=fixture(t,{count:14});const a=f.submit();f.review(a.id);f.advance(HOUR_MS);f.service.tick('league');
  const request=f.service.requestWaiver('league',{teamId:'a',playerId:'fa-0',actorUserId:'coach-a'});
  assert.equal(f.repository.loadPlayers('league').find(p=>p.playerId==='fa-0').teamId,'a');
  assert.throws(()=>f.service.reviewWaiver('league',{waiverId:request.id,decision:'APPROVE',actorUserId:'coach',staffAuthorized:false}),/Staff/);
  f.service.reviewWaiver('league',{waiverId:request.id,decision:'APPROVE',actorUserId:'staff',staffAuthorized:true});f.service.reviewWaiver('league',{waiverId:request.id,decision:'REJECT',actorUserId:'staff',staffAuthorized:true});
  assert.equal(f.service.getStatus('league','a').completedSignings,1);assert.equal(f.roster('a').length,14);
  const again=f.submit();f.review(again.id);f.advance(HOUR_MS);f.service.tick('league');assert.equal(f.service.getStatus('league','a').completedSignings,2);
});
test('five-signing limit dynamically reduces active targets and rejected waivers change nothing', t => {
  const f=fixture(t);f.service.update('league',s=>s.teams={'1:a':{completedSignings:4}});
  f.submit();assert.throws(()=>f.submit('a','fa-1',{conditionalReleasePlayerId:'a-1'}),/limit reached/);
  const w=f.service.requestWaiver('league',{teamId:'a',playerId:'a-2',actorUserId:'coach-a'});f.service.reviewWaiver('league',{waiverId:w.id,decision:'REJECT',actorUserId:'staff',staffAuthorized:true});assert.equal(f.roster('a').length,15);
  f.service.update('league',s=>s.teams['1:a'].completedSignings=5);assert.throws(()=>f.submit('a','fa-2',{conditionalReleasePlayerId:'a-3'}),/limit reached/);
});
test('winner roster changes trigger persistent hour-long cut, then fallback bidders and their own cut windows', t => {
  const f=fixture(t,{count:14});const a=f.submit('a','fa-0',{details:{salary:2e7,years:'3',structure:'Flat',option:'None'}}),b=f.submit('b'),c=f.submit('c','fa-0',{details:{salary:3e6,years:'3',structure:'Flat',option:'None'}});
  for(const o of [a,b,c])f.review(o.id);
  const rows=f.repository.loadRosterMemberships('league');rows.push({playerId:'fa-8',teamId:'a',seasonId:'1',active:true},{playerId:'fa-9',teamId:'b',seasonId:'1',active:true});f.repository.saveRosterMemberships('league',rows);
  f.advance(HOUR_MS);f.service.tick('league');let w=f.state().windows[0];assert.equal(w.status,'AWAITING_WINNER_ROSTER_CUT');assert.equal(Date.parse(w.cutDeadlineAt)-f.time(),HOUR_MS);
  assert.throws(()=>f.submit('c'),/closed/);
  f.advance(HOUR_MS);const restarted=createFreeAgencyService({repository:f.repository,now:f.time});restarted.tick('league');w=f.state().windows[0];assert.equal(w.winnerOfferId,b.id);assert.equal(Date.parse(w.cutDeadlineAt)-f.time(),HOUR_MS);
  assert.throws(()=>restarted.chooseCut('league',{windowId:w.id,teamId:'a',actorUserId:'coach-a',playerId:'a-0'}),/another team/);
  restarted.chooseCut('league',{windowId:w.id,teamId:'b',actorUserId:'coach-b',playerId:'b-0'});assert.equal(f.state().windows[0].status,'COMPLETED');assert.equal(f.repository.loadPlayers('league').find(p=>p.playerId==='fa-0').teamId,'b');
});
test('no eligible fallback returns FA to availability and all release reservations unlock', t=>{
 const f=fixture(t,{count:14});const o=f.submit();f.review(o.id);f.repository.saveRosterMemberships('league',[...f.repository.loadRosterMemberships('league'),{playerId:'fa-8',teamId:'a',seasonId:'1',active:true}]);
 f.advance(HOUR_MS);f.service.tick('league');f.advance(HOUR_MS);f.service.tick('league');assert.equal(f.state().windows[0].status,'NO_VALID_OFFERS');assert.equal(f.service.getStatus('league','a').activeTargets,0);assert.equal(f.repository.loadPlayers('league').find(p=>p.playerId==='fa-0').teamId,null);
});
test('playoff transition blocks new workflows but pre-existing bidding, review, cuts and waivers finish', t => {
  const f=fixture(t);const a=f.submit();const waiver=f.service.requestWaiver('league',{teamId:'c',playerId:'c-0',actorUserId:'coach-c'});f.repository.saveLeague('league',{currentPhase:'PLAYOFFS'});
  assert.throws(()=>f.submit('b','fa-1'),/REGULAR_SEASON/);assert.throws(()=>f.service.requestWaiver('league',{teamId:'c',playerId:'c-1',actorUserId:'coach-c'}),/REGULAR_SEASON/);
  const b=f.submit('b');f.review(a.id);assert.throws(()=>f.submit('a','fa-0',{details:{salary:2e7,years:'3',structure:'Flat',option:'None'}}),/improvements are closed/);
  f.advance(HOUR_MS);f.review(b.id);assert.equal(f.state().windows[0].status,'COMPLETED');
  f.service.reviewWaiver('league',{waiverId:waiver.id,decision:'APPROVE',actorUserId:'staff',staffAuthorized:true});assert.equal(f.repository.loadPlayers('league').find(p=>p.playerId==='c-0').teamId,null);
});
test('external FA removal cancels process, invalidates offers and frees targets and release locks', t => {
  const f=fixture(t);f.submit();f.repository.savePlayers('league',f.repository.loadPlayers('league').map(p=>p.playerId==='fa-0'?{...p,teamId:'c'}:p));f.repository.saveRosterMemberships('league',[...f.repository.loadRosterMemberships('league'),{seasonId:'1',playerId:'fa-0',teamId:'c',active:true}]);f.service.tick('league');assert.equal(f.state().windows[0].status,'CANCELLED');assert.equal(f.state().offers[0].status,'INVALIDATED');assert.equal(f.service.getStatus('league','a').activeTargets,0);assert.equal(playerTransactionLock(f.repository,'league','1','a-0'),null);
});
test('Staff permissions, duplicate submissions and racing decisions are checked server-side', async t => {
  const f=fixture(t);const a=f.submit('a','fa-0',{requestId:'once'});assert.equal(f.submit('a','fa-0',{requestId:'once'}).id,a.id);assert.equal(f.state().windows.length,1);
  for(const decision of ['APPROVE','REJECT','CORRECT'])assert.throws(()=>f.review(a.id,decision,{staffAuthorized:false}),/Staff/);
  f.review(a.id);f.review(a.id,'REJECT');assert.equal(f.state().offers[0].status,'APPROVED');
  await Promise.all([Promise.resolve().then(()=>f.submit('b')),Promise.resolve().then(()=>f.submit('c'))]);assert.equal(f.state().windows.length,1);
});
test('active trade locks block waivers/releases and test mode cannot impersonate assigned online owners', t => {
 const f=fixture(t,{testMode:true});f.repository.saveTrades('league',[{tradeId:'t',seasonId:'1',status:'PENDING_PROOF_REVIEW',currentVersion:{transfers:[{assetType:'PLAYER',assetId:'a-0'}]}}]);
 assert.throws(()=>f.submit(),/active trade/);assert.throws(()=>f.service.requestWaiver('league',{teamId:'a',actorUserId:'coach-a',playerId:'a-0'}),/active trade/);
 assert.throws(()=>f.submit('b','fa-0',{actorUserId:'coach-a',staffAuthorized:true}),/assigned Coach/);
 f.repository.saveOwners('league',f.repository.loadOwners('league').filter(o=>o.teamId!=='b'));assert.ok(f.submit('b','fa-0',{actorUserId:'coach-a',staffAuthorized:true}));
});
test('interrupted common transaction journal restores roster, contract, state and audit together', t => {
 const f=fixture(t);const o=f.submit();f.review(o.id);f.service.update('league',s=>Object.assign(s.windows[0],{announcementMessageId:'announcement',announcementChannelId:'channel'}));
 const root=f.repository.buildLeaguePaths(f.root,'league').leagueRoot;
 const fa=f.state();fa.windows[0].status='COMPLETED';fa.teams={'1:a':{completedSignings:1}};
 const players=f.repository.loadPlayers('league').map(p=>p.playerId==='fa-0'?{...p,teamId:'a',contract:o.contract}:p);
 const tx={leagueId:'league',files:[{name:'players.json',value:players},{name:'free-agency.json',value:fa},{name:'audit-log.json',value:[{action:'fa.signing.completed'}]}]};
 fs.writeFileSync(path.join(root,'trade-transaction.json'),JSON.stringify(tx));
 const restarted=createFantasyHQRepository({dataRoot:f.root});assert.equal(restarted.loadPlayers('league').find(p=>p.playerId==='fa-0').contract.currency,'USD');assert.equal(restarted.loadFreeAgencyState('league').windows[0].announcementMessageId,'announcement');assert.equal(restarted.loadAuditLog('league')[0].action,'fa.signing.completed');assert.equal(fs.existsSync(path.join(root,'trade-transaction.json')),false);
});


test('trade preview and submission revalidate FA reservations through the shared lock helper', t=>{
 const f=fixture(t);const trades=require('../src/fantasyhq/trade-service').createTradeService({repository:f.repository,now:f.time});
 const draft=trades.createDraft({leagueId:'league',seasonId:'1',initiatingUserId:'coach-a',initiatingTeamId:'a',secondTeamId:'b'});
 trades.updateDraft({leagueId:'league',tradeId:draft.tradeId,actorUserId:'coach-a',transfers:[{assetType:'PLAYER',assetId:'a-0',fromTeamId:'a',toTeamId:'b'},{assetType:'PLAYER',assetId:'b-0',fromTeamId:'b',toTeamId:'a'}]});
 assert.equal(trades.previewDraft('league',draft.tradeId).valid,true);f.submit();const result=trades.previewDraft('league',draft.tradeId);assert.equal(result.valid,false);assert.ok(result.errors.some(e=>e.includes('conditional release')));
 assert.throws(()=>trades.submitTrade({leagueId:'league',tradeId:draft.tradeId,actorUserId:'coach-a'}),/conditional release/);
});
test('only explicit Test Mode uses accelerated timing; production cannot be shortened by stale test settings', t=>{
 const f=fixture(t,{testMode:true});f.repository.saveSettings('league',{testMode:true,freeAgencyTestWindowSeconds:60});f.submit();assert.equal(Date.parse(f.state().windows[0].deadlineAt)-f.time(),60000);
 f.repository.saveSettings('league',{testMode:false,freeAgencyTestWindowSeconds:60});f.submit('b','fa-1');assert.equal(Date.parse(f.state().windows[1].deadlineAt)-f.time(),3600000);
});
test('FA pool follows current active memberships exactly as the existing player service does',t=>{
 const f=fixture(t);f.repository.savePlayers('league',f.repository.loadPlayers('league').map(p=>p.playerId==='fa-0'?{...p,teamId:'previous-season-team'}:p));
 const players=require('../src/fantasyhq/player-service').createPlayerService({repository:f.repository}).listPlayers('league','1');
 assert.equal(players.find(p=>p.playerId==='fa-0').teamId,null);assert.ok(f.service.browse('league','PG').some(p=>p.playerId==='fa-0'));
});

test('rejecting the first offer with another bidder keeps the original deadline and exact cutoff blocks improvements',t=>{
 const f=fixture(t);const a=f.submit();const b=f.submit('b');const deadline=f.state().windows[0].deadlineAt;f.review(a.id,'REJECT');assert.equal(f.state().windows[0].status,'OPEN');assert.equal(f.state().windows[0].deadlineAt,deadline);
 f.review(b.id);f.advance(HOUR_MS);assert.throws(()=>f.submit('b','fa-0',{details:{salary:2e7,years:'4',structure:'Flat',option:'None'}}),/closed/);f.service.tick('league');assert.equal(f.state().offers.find(o=>o.status==='WON').teamId,'b');
});
test('fallback resolution continues through three ranked bidders, including after playoff transition',t=>{
 const f=fixture(t,{count:14});const a=f.submit('a','fa-0',{details:{salary:3e7,years:'3',structure:'Flat',option:'None'}}),b=f.submit('b','fa-0',{details:{salary:2e7,years:'3',structure:'Flat',option:'None'}}),c=f.submit('c');for(const o of [a,b,c])f.review(o.id);
 f.repository.saveRosterMemberships('league',[...f.repository.loadRosterMemberships('league'),{playerId:'fa-8',teamId:'a',seasonId:'1',active:true},{playerId:'fa-9',teamId:'b',seasonId:'1',active:true}]);
 f.advance(HOUR_MS);f.service.tick('league');f.repository.saveLeague('league',{currentPhase:'PLAYOFFS'});f.advance(HOUR_MS);f.service.tick('league');assert.equal(f.state().windows[0].winnerOfferId,b.id);f.advance(HOUR_MS);f.service.tick('league');assert.equal(f.state().offers.find(o=>o.status==='WON').teamId,'c');assert.equal(f.service.getStatus('league','a').completedSignings,0);assert.equal(f.service.getStatus('league','b').completedSignings,0);assert.equal(f.service.getStatus('league','c').completedSignings,1);
});
test('real interrupted signing commit recovers every roster, contract, counter and transaction exactly once',t=>{
 const f=fixture(t);const a=f.submit();f.review(a.id);f.advance(HOUR_MS);const originalRename=fs.renameSync;
 try { fs.renameSync=function(from,to){if(to.endsWith('roster-memberships.json'))throw Error('Injected disk interruption');return originalRename(from,to);};assert.throws(()=>f.service.tick('league'),/Injected disk/); }
 finally {fs.renameSync=originalRename;}
 const root=f.repository.buildLeaguePaths(f.root,'league').leagueRoot;assert.equal(fs.existsSync(path.join(root,'trade-transaction.json')),true);
 const restarted=createFantasyHQRepository({dataRoot:f.root}),service=createFreeAgencyService({repository:restarted,now:f.time});
 assert.equal(restarted.loadPlayers('league').find(p=>p.playerId==='fa-0').teamId,'a');assert.equal(restarted.loadPlayers('league').find(p=>p.playerId==='a-0').contract,undefined);
 assert.equal(activeMemberships(restarted.loadRosterMemberships('league'),'1').filter(m=>m.teamId==='a').length,15);assert.equal(service.getStatus('league','a').completedSignings,1);service.tick('league');assert.equal(restarted.loadAuditLog('league').filter(a=>a.action==='fa.signing.completed').length,1);assert.equal(restarted.loadAuditLog('league').filter(a=>a.action==='player.waived').length,1);
});
test('normalization handles decimal-comma millions, OCR +l option years and No Option without guessing unread fields',()=>{
 const details=parseContractText('Salary: $6,66M\nYears: 3+l\nContract Type: Flat\nOption: Player');assert.equal(details.years,'3+1');const n=normalizeOffer(details,{year:2026});assert.equal(n.details.salary,6660000);assert.equal(n.contract.seasons.length,4);
 const none=parseContractText('Salary: $1M\nYears: 1\nContract Type: Flat\nOption: No Option');assert.equal(normalizeOffer(none,{year:2026}).contract.seasons[0].option,null);
 assert.throws(()=>normalizeOffer({...none,structure:''},{year:2026}),/readable/);assert.throws(()=>normalizeOffer({...none,option:''},{year:2026}),/readable/);
});
