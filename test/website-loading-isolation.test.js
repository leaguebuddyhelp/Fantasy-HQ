const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
test('league home and draft load independently; owner polling uses the compact endpoint',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 let failDraft=true,failLeague=false;const requested=[];
 const league={league:{leagueId:'test',seasonNumber:1,currentPhase:'REGULAR_SEASON',currentWeek:1},summary:{teams:0,players:0,weeks:15,games:210,ownersAssigned:0,rostersImported:0},teams:[],players:[],schedulePreview:[],admin:{rosterIssues:0,dataWarnings:0,unassignedTeams:[]},preseason:{ready:true}};
 await page.route('http://audit.test/**',route=>{
  const url=new URL(route.request().url());requested.push(url.pathname);
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync('web/index.html','utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g,'')});
  if(url.pathname==='/api/league-site')return route.fulfill({status:failLeague?503:200,json:failLeague?{error:'League temporarily unavailable'}:league});
  if(url.pathname==='/api/draft-classes')return route.fulfill({status:failDraft?503:200,json:failDraft?{error:'Draft temporarily unavailable'}:{boards:[],seasonNumber:1,prospectStatsAvailable:false}});
  if(url.pathname==='/api/league/owners')return route.fulfill({json:{league:league.league,summary:league.summary,teams:[]}});
  return route.fulfill({status:404,json:{error:'Not found'}});
 });
 await page.goto('http://audit.test/');
 await page.addScriptTag({content:fs.readFileSync('web/app.js','utf8').replace(/^initialize\(\);$/m,'').replace(/^refreshStandings\(\);$/m,'').replace(/^setInterval\(.*$/gm,'')});
 await page.evaluate(()=>initialize());
 assert.match(await page.locator('#league-status-pill').textContent(),/Season 1/);
 assert.match(await page.locator('#result-count').textContent(),/could not be loaded/);
 await page.evaluate(()=>refreshOwnerLabels());assert.ok(requested.includes('/api/league/owners'));
 failLeague=true;failDraft=false;
 await page.evaluate(()=>initialize());
 assert.match(await page.locator('#league-status-pill').textContent(),/League unavailable/);
 assert.doesNotMatch(await page.locator('#result-count').textContent(),/Loading/);
});
