const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');

test('directory cards omit contracts, keep readable badges, and open the full player bio',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 const players=['Nikola Jokic','Shai Gilgeous-Alexander','Victor Wembanyama'].map((name,i)=>({playerId:String(i),name,teamName:'Oklahoma City Thunder',nationality:'Canada',archetype:'2-Way Mid-Post Playmaker',position1:'PG',position2:'SG',overall:97,age:28,tradeValue:3005,contractView:{short:'5 years · $314.11M total',seasons:[]}}));
 await page.route('http://cards.test/**',route=>{const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync('web/index.html','utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g,'')});
  if(url.pathname.startsWith('/api/league/players/'))return route.fulfill({json:{player:players[Number(url.pathname.split('/').at(-1))]}});
  return route.fulfill({status:404,body:''});
 });
 await page.goto('http://cards.test/');await page.addStyleTag({content:fs.readFileSync('web/styles.css','utf8')});
 await page.addScriptTag({content:fs.readFileSync('web/app.js','utf8').replace(/^initialize\(\);$/m,'').replace(/^refreshStandings\(\);$/m,'').replace(/^setInterval\(.*$/gm,'')});
 await page.evaluate(players=>{document.querySelector('#players').hidden=false;elements.playerDirectory.innerHTML=players.map((p,i)=>playerCardMarkup(p,i+1)).join('');},players);
 for(const width of [1280,820,390]){
  await page.setViewportSize({width,height:950});
  for(const card of await page.locator('.league-player-card').all()){
   assert.doesNotMatch(await card.textContent(),/contract|years|\$/i);
   assert.equal(await card.locator('.grade-chip').count(),3);
   assert.equal(await card.locator('.player-build').textContent(),'2-Way Mid-Post Playmaker');
   assert.ok(await card.locator('.card-copy').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   assert.ok(await card.locator('.player-build').evaluate(el=>el.scrollHeight<=el.clientHeight+1&&el.scrollWidth<=el.clientWidth+1));
  }
 }
 await page.locator('.league-player-card').first().click();
 await page.locator('#league-dialog[open]').waitFor();
 assert.match(await page.locator('#league-dialog').textContent(),/5 years · \$314.11M total/);
});
