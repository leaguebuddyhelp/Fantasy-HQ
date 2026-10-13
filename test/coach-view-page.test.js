const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
test('coach view focuses navigation and validates admin unlock, restore, invalid keys and relocking',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();const errors=[],adminCalls=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://coach.test/**',route=>{
  const u=new URL(route.request().url()),valid=route.request().headers()['x-leaguebuddy-admin-key']==='valid-key';
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync('web/index.html','utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g,'')});
  if(u.pathname==='/styles.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync('web/styles.css','utf8')});
  if(u.pathname==='/api/league/admin/session')return route.fulfill({status:valid?200:403,json:valid?{authenticated:true}:{error:'Invalid admin key. Coach view is still available.'}});
  if(u.pathname==='/api/draft-classes')return route.fulfill({json:{seasonNumber:1,canBrowseAll:valid,boards:[{id:'top-ten',classes:[{file:'2k27_CUS01 - Early Top Ten.json',label:'2k27_CUS01'}]}]}});
  if(u.pathname==='/api/prospects')return route.fulfill({json:{prospects:[]}});
  if(u.pathname.startsWith('/api/league/admin/')){adminCalls.push(u.pathname);return route.fulfill({status:valid?200:403,json:{}});}
  if(u.pathname==='/api/league/standings')return route.fulfill({json:{conferences:{East:[],West:[]}}});
  return route.fulfill({body:''});
 });
 await page.goto('http://coach.test/');
 await page.addScriptTag({content:fs.readFileSync('web/navigation.js','utf8')});
 await page.addScriptTag({content:fs.readFileSync('web/app.js','utf8').replace(/^initialize\(\);$/m,'').replace(/^refreshStandings\(\);$/m,'').replace(/^setInterval\(.*$/gm,'')});
 assert.equal(await page.locator('#league-home').isVisible(),true);
 assert.equal(await page.locator('#my-week').isVisible(),true);
 assert.equal(await page.locator('#players').isVisible(),false);
 assert.equal(await page.locator('#league-admin').isVisible(),false);
 assert.equal(await page.locator('[data-admin-navigation]').isVisible(),false);
 await page.evaluate(()=>{location.hash='standings';});
 await page.waitForFunction(()=>document.querySelector('#standings').dataset.workspaceActive==='true');
 assert.equal(await page.locator('#standings').isVisible(),true);
 assert.equal(await page.locator('#league-home').isVisible(),false);
 await page.evaluate(()=>{location.hash='news-review-panel';});
 await page.waitForFunction(()=>document.querySelector('#league-admin').dataset.workspaceActive==='true');
 assert.equal(await page.locator('#admin-key').isVisible(),true);
 assert.equal(await page.locator('#admin-workspace').isVisible(),false);
 await page.locator('#admin-key').fill('wrong');await page.locator('#admin-key-save').click();
 await page.waitForFunction(()=>document.querySelector('#admin-key-status').textContent.includes('Invalid admin key'));
 assert.equal(await page.evaluate(()=>hasAdminAccess()),false);assert.equal(adminCalls.length,0);
 assert.equal(await page.locator('#admin-workspace').isVisible(),false);
 await page.locator('#admin-key').fill('valid-key');await page.locator('#admin-key-save').click();
 await page.waitForFunction(()=>document.body.dataset.adminMode==='true');
 assert.equal(await page.locator('#admin-workspace').isVisible(),true);
 assert.equal(await page.locator('[data-admin-navigation]').isVisible(),true);
 await page.waitForFunction(()=>sessionStorage.getItem('leaguebuddyAdminKey')==='valid-key');
 // Restored keys begin locked and require server validation again.
 await page.evaluate(async()=>{state.adminAuthenticated=false;renderAdminMode();await validateAdminMode();});
 assert.equal(await page.evaluate(()=>hasAdminAccess()),true);
 await page.locator('#admin-mode-lock').click();
 await page.waitForFunction(()=>document.body.dataset.adminMode==='false');
 assert.equal(await page.locator('#admin-workspace').isVisible(),false);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('leaguebuddyAdminKey')),null);
 await page.evaluate(()=>{location.hash='league-home';});
 await page.waitForFunction(()=>document.querySelector('#league-home').dataset.workspaceActive==='true');
 for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:900});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});
  await page.screenshot({path:'/tmp/lb-coach-view-'+width+'.png',fullPage:true});
 }
 assert.deepEqual(errors,[]);
});
