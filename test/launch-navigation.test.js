const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
test('desktop tablet and phone navigation stays inside viewport and website has no betting controls',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.setContent(fs.readFileSync('web/index.html','utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));await page.addStyleTag({content:fs.readFileSync('web/styles.css','utf8')});
 for(const width of [1440,1101,768,390]){await page.setViewportSize({width,height:900});const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,links:[...document.querySelectorAll('#primary-nav > a, #primary-nav details[open] a')].map(a=>({left:a.getBoundingClientRect().left,right:a.getBoundingClientRect().right}))}));assert.ok(metrics.scroll<=width+1,JSON.stringify(metrics));assert.ok(metrics.links.every(a=>a.left>=0&&a.right<=width+1),JSON.stringify(metrics));}
 assert.equal(await page.locator('#sportsbook').count(),0);
});
test('grouped navigation supports keyboard, mobile, deep links and existing section destinations',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 await page.setContent(fs.readFileSync('web/index.html','utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));await page.addStyleTag({content:fs.readFileSync('web/styles.css','utf8')});await page.addScriptTag({content:fs.readFileSync('web/navigation.js','utf8')});
 assert.equal(await page.locator('#primary-nav .nav-group').count(),5);
 assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#primary-nav a')].filter(a=>!document.getElementById(a.hash.slice(1))).map(a=>a.hash)),[]);
 for(const width of [1440,1101,1100,1024,768,390,320]){
  await page.setViewportSize({width,height:900});
  if(width<=1100)await page.locator('#mobile-nav-toggle').click();
  for(const group of ['League','Stats','News & Live','Draft','Staff']){
   await page.locator('.nav-group>summary').filter({hasText:group}).click();
   assert.equal(await page.locator('.nav-group[open]').count(),1);
   const bounds=await page.locator('.nav-group[open] .nav-menu').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
  }
  await page.keyboard.press('Escape');assert.equal(await page.locator('.nav-group[open]').count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Staff');
  if(width<=1100){await page.keyboard.press('Escape');assert.equal(await page.locator('#mobile-nav-toggle').getAttribute('aria-expanded'),'false');}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 }
 await page.setViewportSize({width:390,height:900});await page.locator('#mobile-nav-toggle').click();await page.locator('.nav-group>summary').filter({hasText:'League'}).click();await page.locator('#primary-nav a[href="#standings"]').click();
 await page.waitForFunction(()=>document.querySelector('#primary-nav a[href="#standings"]').getAttribute('aria-current')==='location');
 assert.equal(await page.locator('#primary-nav a[href="#standings"]').getAttribute('aria-current'),'location');assert.equal(await page.locator('#mobile-nav-toggle').getAttribute('aria-expanded'),'false');
 await page.screenshot({path:'/tmp/lb-navigation-phone.png'});
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{location.hash='league-home';scrollTo(0,0);});await page.locator('.nav-group>summary').filter({hasText:'League'}).click();await page.screenshot({path:'/tmp/lb-navigation-after.png'});
});
