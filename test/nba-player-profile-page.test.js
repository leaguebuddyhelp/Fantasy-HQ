const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const {contractView}=require('../src/shared/player-contract');

test('NBA bio shares prospect styling and shows known contract years on desktop and mobile',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();
 await page.route('http://bio.test/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync('web/index.html','utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g,'')});
  if(url.pathname.startsWith('/ratings-assets/'))return route.fulfill({contentType:'image/png',body:fs.readFileSync(fs.existsSync('data/2kratings/images/shai-gilgeous-alexander.png') ? 'data/2kratings/images/shai-gilgeous-alexander.png' : 'draft_class/images/2k27-cus01-big-board/pf/001-leandre-charbonneau.png')});
  return route.fulfill({status:404,body:''});
 });
 await page.goto('http://bio.test/');
 await page.addStyleTag({content:fs.readFileSync('web/styles.css','utf8')});
 await page.addScriptTag({content:fs.readFileSync('web/app.js','utf8').replace(/^initialize\(\);$/m,'').replace(/^refreshStandings\(\);$/m,'').replace(/^setInterval\(.*$/gm,'')});
 const player={playerId:'sga',name:'Shai Gilgeous-Alexander',overall:97,teamName:'Oklahoma City Thunder',position1:'PG',position2:'SG',nationality:'Canada',archetype:'2-Way Mid-Post Playmaker',height:'6\'6"',age:28,imageUrl:'/ratings-assets/shai-gilgeous-alexander',contract:{seasons:[{season:'2026-27',salary:10000000},{season:'2027-28',salary:11000000},{season:'2028-29',salary:12000000,option:'PLAYER'},{season:'2029-30',salary:null}]}};
 player.contractView=contractView(player,2026);
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:950});
  await page.evaluate(p=>openLeagueDialog(playerDialogMarkup(p)),player);
  const hero=page.locator('.nba-player-hero');
  assert.equal(await hero.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 220, 33)');
  assert.equal(await hero.locator('h2').evaluate(el=>getComputedStyle(el).color),'rgb(5, 5, 5)');
  assert.equal(await hero.locator('h2').textContent(),player.name);
  assert.equal(await page.locator('.nba-player-reports tbody tr').count(),3);
  assert.match(await page.locator('.nba-player-reports').textContent(),/3 years · \$33M total/);
  assert.doesNotMatch(await page.locator('.nba-player-reports').textContent(),/2029-30|Unknown/);
  assert.equal(await page.locator('#player-admin-form').count(),0);
  assert.ok(await page.locator('#league-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  if(width===1280)await page.screenshot({path:'/tmp/lb-nba-player-profile-desktop.png'});
  else await page.screenshot({path:'/tmp/lb-nba-player-profile-mobile.png'});
 }
 await page.evaluate(p=>{state.adminAuthenticated=true;state.adminKey='test';openLeagueDialog(playerDialogMarkup(p));},player);
 assert.equal(await page.locator('#player-admin-form').count(),1);
});
