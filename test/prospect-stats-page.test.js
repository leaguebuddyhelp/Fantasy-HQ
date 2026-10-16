const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
test('prospect stats navigation, direct links and bio production follow offseason/draft access',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 const prospect={rank:1,name:'Test Prospect',team:'Duke',position_1:'PG',class:'FR',pts:22,rbs:6,ast:7,stls:2,blks:1};
 await page.route('http://prospects.test/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync('web/index.html','utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g,'')});
  if(url.pathname==='/api/prospects')return route.fulfill({json:{prospects:[prospect]}});
  return route.fulfill({status:404,body:''});
 });
 await page.goto('http://prospects.test/');await page.addStyleTag({content:fs.readFileSync('web/styles.css','utf8')});
 await page.addScriptTag({content:fs.readFileSync('web/app.js','utf8').replace(/^initialize\(\);$/m,'').replace(/^refreshStandings\(\);$/m,'').replace(/^setInterval\(.*$/gm,'')});
 for(const available of [false,true,false]){
  await page.evaluate(async available=>{
   state.boards=[{id:'big-board',classes:[{label:'2k27_CUS01',file:'2k27_CUS01 - Big Board.json'}]}];
   state.prospectStatsAvailable=available;history.replaceState({},'','#draft-stats');await loadDraftClass();openProfile(1,'big-board',false);
  },available);
  assert.equal(await page.locator('#draft-stats').evaluate(el=>el.hidden),!available);
  assert.equal(await page.locator('a[href="#draft-stats"]').evaluate(el=>el.hidden),!available);
  assert.equal(await page.locator('#dialog-content').textContent().then(text=>text.includes('Season production')),available);
  if(!available)assert.notEqual(await page.evaluate(()=>location.hash),'#draft-stats');
 }
});
