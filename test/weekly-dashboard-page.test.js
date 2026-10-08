const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
test('weekly website dashboards preserve privacy, guard reloads, escape text and fit mobile',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:390,height:900}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));let publicCalls=0,staffCalls=0,rejectStaff=false;
 const team={teamId:'a',teamName:'Team A'};
 const game={team1Id:'a',team2Id:'b',team1Name:'Team A',team2Name:'<img src=x onerror=alert(1)>',final:false,status:'REVIEW_REQUIRED',screenshots:2,reviewPending:true,threadUrl:'https://discord.com/channels/g/thread',reviewUrl:'/games/game/submissions/submission/review',inGameDate:'Nov 18',recordCount:1};
 const report={available:true,week:2,total:14,final:3,closed:false,readyToAdvance:false,deadlineAt:'2026-10-09T12:00:00Z',groups:[{label:'CPU vs CPU',total:12,final:3},{label:'User vs CPU',total:1,final:0},{label:'User vs user',total:1,final:0}],blockers:{unresolved:11,missingThreads:0,missingDates:10,missingBoxScores:10,pendingReviews:1,extractionFailures:0,processing:0,duplicateRecords:0},games:[game],byes:[team],transactions:{trades:[{teams:['Team A','Team B'],status:'PENDING_COMMITTEE',url:'https://discord.com/channels/g/committee'}],offers:[{teamId:'a',player:'Private Player',status:'PENDING_REVIEW',url:'https://discord.com/channels/g/staff/proof'}],waivers:[],waitingCuts:0},channels:{staff:'https://discord.com/channels/g/staff'},staffReportUrl:'https://discord.com/channels/g/staff/message'};
 await page.route('http://weekly.test/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync('web/index.html','utf8').replace('<script src="/app.js" defer></script>','')});
  if(url.pathname==='/styles.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync('web/styles.css','utf8')});
  if(url.pathname==='/api/league/weekly/a'){publicCalls++;await new Promise(resolve=>setTimeout(resolve,30));return route.fulfill({json:{available:true,teamName:'Team A',week:2,bye:false,closed:false,deadlineAt:report.deadlineAt,nextAction:'Waiting for Staff review.',game:{opponent:game.team2Name,final:false,screenshots:2,threadUrl:game.threadUrl,inGameDate:'Nov 18'},channels:{freeAgency:'https://discord.com/channels/g/fa',submitTrade:'https://discord.com/channels/g/trade'}}});}
  if(url.pathname==='/api/league/admin/weekly'){staffCalls++;await new Promise(resolve=>setTimeout(resolve,30));return rejectStaff?route.fulfill({status:403,json:{error:'Admin authorization required.'}}):route.fulfill({json:report});}
  return route.fulfill({body:''});
 });
 await page.goto('http://weekly.test/');await page.addScriptTag({content:fs.readFileSync('web/app.js','utf8').replace(/^initialize\(\);$/m,'').replace(/^refreshStandings\(\);$/m,'').replace(/^setInterval\(.*$/gm,'')});
 await page.evaluate(team=>{state.leagueSite={teams:[team],league:{currentPhase:'REGULAR_SEASON'}};renderCoachWeekPicker([team]);},team);
 await page.selectOption('#coach-week-team','a');await page.waitForFunction(()=>!state.coachWeekLoading);
 assert.equal(publicCalls,1);assert.match(await page.locator('#coach-week-output').textContent(),/Waiting for Staff review/);assert.equal(await page.locator('#coach-week-output img').count(),0);assert.doesNotMatch(await page.locator('#coach-week-output').textContent(),/Private Player/);
 await page.evaluate(()=>Promise.all([loadCoachWeek(),loadCoachWeek()]));assert.equal(publicCalls,2);
 assert.equal(await page.evaluate(()=>localStorage.getItem('leaguebuddyWeeklyTeam')),'a');
 await page.evaluate(()=>loadStaffWeek());assert.equal(staffCalls,0);
 await page.evaluate(()=>{state.adminKey='weekly-key';document.querySelector('#staff-weekly').hidden=false;});
 await page.evaluate(()=>Promise.all([loadStaffWeek(),loadStaffWeek()]));assert.equal(staffCalls,1);
 assert.match(await page.locator('#staff-week-output').textContent(),/CPU vs CPU/);assert.match(await page.locator('#staff-week-output').textContent(),/Private Player/);
 assert.equal(await page.locator('#staff-week-output img').count(),0);assert.equal(await page.locator('#staff-week-output a[href="/games/game/submissions/submission/review"]').count(),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 rejectStaff=true;await page.evaluate(()=>loadStaffWeek());assert.equal(await page.locator('#staff-week-output').textContent(),'');assert.match(await page.locator('#staff-week-status').textContent(),/authorization required/);
 assert.equal(await page.locator('#staff-week-refresh').isDisabled(),false);assert.deepEqual(errors,[]);
});
