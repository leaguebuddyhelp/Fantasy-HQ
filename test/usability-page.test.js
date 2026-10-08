const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

test('standings reload prevents duplicate requests and preserves the published table on failure', async t => {
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();let calls=0,fail=false;const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://usability.test/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync('web/index.html','utf8').replace('<script src="/app.js" defer></script>','')});
  if(url.pathname.startsWith('/assets/nba/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'});
  if(url.pathname==='/styles.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync('web/styles.css','utf8')});
  if(url.pathname==='/api/league/standings'){
   calls++;await new Promise(resolve=>setTimeout(resolve,30));
   if(fail)return route.fulfill({status:503,json:{error:'Temporary outage'}});
   return route.fulfill({json:{publishedThroughWeek:1,countedGames:1,conferences:{East:[{teamId:'bos',teamName:'Boston Celtics',rank:1,GP:1,W:1,L:0,PCT:1,PF:100,PA:90,DIFF:10}],West:[]}}});
  }
  return route.fulfill({body:''});
 });
 await page.goto('http://usability.test/');
 const code=fs.readFileSync('web/app.js','utf8').replace(/^initialize\(\);$/m,'').replace(/^refreshStandings\(\);$/m,'').replace(/^setInterval\(.*$/gm,'');
 await page.addScriptTag({content:code});
 await page.evaluate(()=>Promise.all([refreshStandings(),refreshStandings()]));
 assert.equal(calls,1);
 const original=await page.locator('#standings-tables').innerHTML();assert.match(original,/Boston Celtics/);
 fail=true;await page.evaluate(()=>refreshStandings());
 assert.equal(await page.locator('#standings-tables').innerHTML(),original);
 assert.match(await page.locator('#standings-week').textContent(),/Showing previously loaded standings/);
 assert.equal(await page.locator('#standings-refresh').isDisabled(),false);
 assert.deepEqual(errors,[]);
});

test('season start keeps one confirmation and blocks competing actions until completion', async t => {
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();
 await page.route('http://season.test/**',route=>route.fulfill({contentType:'text/html',body:route.request().url()==='http://season.test/'?fs.readFileSync('web/index.html','utf8').replace('<script src="/app.js" defer></script>',''):''}));
 await page.goto('http://season.test/');
 await page.addScriptTag({content:fs.readFileSync('web/app.js','utf8').replace(/^initialize\(\);$/m,'').replace(/^refreshStandings\(\);$/m,'').replace(/^setInterval\(.*$/gm,'')});
 await page.evaluate(()=>{
  window.starts=0;window.validations=0;
  startRegularSeason=async()=>{window.starts++;await new Promise(resolve=>window.finishStart=resolve);throw Error('Readiness changed; try again.');};
  runPreseasonValidation=async()=>{window.validations++;};
  elements.startSeasonButton.click();
  window.confirmation=elements.preseasonValidationOutput.firstElementChild;
  elements.startSeasonButton.dispatchEvent(new Event('click'));
  elements.validatePreseasonButton.dispatchEvent(new Event('click'));
 });
 assert.equal(await page.evaluate(()=>window.confirmation===elements.preseasonValidationOutput.firstElementChild),true);
 assert.equal(await page.evaluate(()=>window.validations),0);
 await page.evaluate(()=>elements.preseasonValidationOutput.querySelector('[data-cancel-start-season]').click());
 assert.equal(await page.evaluate(()=>elements.startSeasonButton.disabled),false);
 await page.evaluate(()=>{
  elements.startSeasonButton.click();
  const confirm=elements.preseasonValidationOutput.querySelector('[data-confirm-start-season]');
  confirm.click();confirm.dispatchEvent(new Event('click',{bubbles:true}));
  elements.startSeasonButton.dispatchEvent(new Event('click'));
  elements.validatePreseasonButton.dispatchEvent(new Event('click'));
 });
 assert.equal(await page.evaluate(()=>window.starts),1);
 assert.equal(await page.evaluate(()=>elements.startSeasonButton.disabled && elements.validatePreseasonButton.disabled),true);
 await page.evaluate(()=>window.finishStart());
 await page.waitForFunction(()=>!elements.startSeasonButton.disabled);
 assert.match(await page.evaluate(()=>elements.preseasonValidationOutput.textContent),/Readiness changed/);
 assert.equal(await page.evaluate(()=>elements.validatePreseasonButton.disabled),false);
});
