const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
test('review form works before slow images arrive, caches originals after save, and loads history only when opened', async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let release;const slowImages=new Promise(r=>{release=r;});let mediaRequests=0,historyRequests=0;
 const player={displayedName:'N. Hyland',playerId:null,dnp:false,confidence:'HIGH',stats:{MIN:'20',PTS:'10',REB:'1',AST:'1',STL:'0',BLK:'0',TO:'0',FG:'4-5','3PT':'2-3',FT:'0-0',OR:'0',FLS:'1'}};
 const screen={mediaId:'image',tableTeamName:'Wolves',confidence:'HIGH',scoreboard:[{teamName:'Wolves',finalScore:10,periods:[{label:'Q1',score:10}]}],players:[player],totals:player.stats};
 const extraction={extractionId:'e',timestamp:'now',provider:'tesseract',status:'REVIEW_REQUIRED',issues:[{code:'PLAYER_MATCH_NEEDED',path:'screenshots.0.players.0',message:'Match this player'}],normalized:{screenshots:[{displayedTeamName:'Wolves',teamId:'wolves',scoreboard:[{teamId:'wolves',finalScore:10}],players:[{candidates:[{playerId:'p',name:'Bones Hyland'}]}]}]},rosterSnapshot:{wolves:[{playerId:'p',name:'Bones Hyland'}]}};
 const payload={game:{weekNumber:1,team1Name:'Wolves',team2Name:'Rockets',status:'SCHEDULED'},editable:{screenshots:[screen]},extractions:[extraction],teamRecords:[]};
 await page.route('http://review.test/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/box-score-review.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync('web/box-score-review.js','utf8')});
  if(!u.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:fs.readFileSync('web/box-score-review.html','utf8')});
  if(u.pathname.includes('/media/')){mediaRequests++;await slowImages;return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1sAAAAASUVORK5CYII=','base64')});}
  if(u.searchParams.has('history')){historyRequests++;return route.fulfill({json:{...extraction,raw:'large audit evidence'}});}
  return route.fulfill({json:payload});
 });
 await page.goto('http://review.test/games/g/submissions/s/review');
 await page.locator('#key').fill('test-key');await page.locator('#access button').click();
 await page.locator('#approve').waitFor({state:'visible',timeout:3000});
 assert.equal(mediaRequests,1);assert.equal(historyRequests,0);
 await page.getByRole('button',{name:'Assign Bones Hyland to this row'}).click();
 assert.equal(await page.getByLabel('N. Hyland roster match').inputValue(),'p');
 await page.locator('#operator').fill('Tester');await page.getByRole('button',{name:'Save corrections & revalidate'}).click();
 await page.waitForFunction(()=>document.querySelector('#action-status').textContent.startsWith('Saved successfully'));
 assert.equal(mediaRequests,1);
 release();await page.locator('.review-original img').waitFor();
 await page.locator('.review-history > summary').click();await page.locator('.review-history details > summary').click();
 await page.getByText('large audit evidence',{exact:false}).waitFor();assert.equal(historyRequests,1);assert.deepEqual(errors,[]);
});
