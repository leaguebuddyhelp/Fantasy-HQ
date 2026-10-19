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

test('cropped review lets staff select missing teams and match players to the selected roster',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const stats=Object.fromEntries(['MIN','PTS','REB','AST','STL','BLK','TO','FG','3PT','FT','OR','FLS'].map(k=>[k,null]));
 const screen={mediaId:'image',tableTeamName:null,confidence:'HIGH',scoreboard:[{teamName:null,finalScore:null,periods:[{label:'Q1',score:null}]}],players:[{displayedName:'N. Hyland',playerId:null,dnp:false,confidence:'HIGH',stats}],totals:stats};
 const extraction={extractionId:'e',status:'REVIEW_REQUIRED',issues:[],normalized:{screenshots:[{displayedTeamName:null,teamId:null,scoreboard:[{displayedTeamName:null,teamId:null}],players:[{candidates:[]}]}]},rosterSnapshot:{wolves:[{playerId:'p',name:'Bones Hyland'}]}};
 const payload={game:{weekNumber:1,team1Id:'wolves',team2Id:'rockets',team1Name:'Wolves',team2Name:'Rockets',status:'SCHEDULED'},editable:{screenshots:[screen]},extractions:[extraction],teamRecords:[]};
 await page.route('http://review.test/**',route=>{const u=new URL(route.request().url());return route.fulfill(u.pathname==='/box-score-review.js'?{contentType:'text/javascript',body:fs.readFileSync('web/box-score-review.js','utf8')}:u.pathname.startsWith('/api/')?{json:payload}:{contentType:'text/html',body:fs.readFileSync('web/box-score-review.html','utf8')});});
 await page.goto('http://review.test/games/g/submissions/s/review');await page.locator('#key').fill('test');await page.locator('#access button').click();
 await page.getByLabel('screenshots.0.tableTeamName',{exact:true}).selectOption('Wolves');
 await page.getByLabel('N. Hyland roster match').selectOption('p');
 await page.getByLabel('screenshots.0.scoreboard.0.teamName',{exact:true}).selectOption('Rockets');
 assert.equal(await page.getByLabel('N. Hyland roster match').inputValue(),'p');
 assert.deepEqual(errors,[]);
});

test('unmatched review row can sign a free agent to its game team and save the roster match',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const stats=Object.fromEntries(['MIN','PTS','REB','AST','STL','BLK','TO','FG','3PT','FT','OR','FLS'].map(k=>[k,null]));
 const screen={mediaId:'image',tableTeamName:'Wolves',confidence:'HIGH',scoreboard:[{teamName:'Wolves',finalScore:10,periods:[{label:'Q1',score:10}]}],players:[{displayedName:'New Player',playerId:null,dnp:false,confidence:'HIGH',stats}],totals:stats};
 const extraction={extractionId:'e1',status:'REVIEW_REQUIRED',issues:[],normalized:{screenshots:[{displayedTeamName:'Wolves',teamId:'wolves',scoreboard:[{displayedTeamName:'Wolves',teamId:'wolves'}],players:[{candidates:[]}]}]},rosterSnapshot:{wolves:[]}};
 let payload={game:{gameId:'g',leagueId:'league',seasonId:'1',weekNumber:1,team1Id:'wolves',team2Id:'rockets',team1Name:'Wolves',team2Name:'Rockets',status:'SCHEDULED'},editable:{screenshots:[screen]},extractions:[extraction],teamRecords:[]};
 const calls=[];
 await page.route('http://review.test/**',async route=>{
  const request=route.request(),url=new URL(request.url());calls.push([request.method(),url.pathname]);
  if(url.pathname==='/box-score-review.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync('web/box-score-review.js','utf8')});
  if(!url.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:fs.readFileSync('web/box-score-review.html','utf8')});
  if(url.pathname==='/api/league/admin/rosters/free-agents')return route.fulfill({json:{players:[{playerId:'fa',name:'Free Agent',position1:'SG',overall:70}],rostered:[{playerId:'rp',name:'Neu Playr',teamId:'rockets',teamName:'Rockets',rostered:true,position1:'PG',overall:80}]}});
  if(url.pathname==='/api/league/admin/rosters/correction-preview')return route.fulfill({json:{token:'correction-token',reason:'Approved emergency roster addition'}});
  if(url.pathname==='/api/league/admin/rosters/assign-free-agent')return route.fulfill({json:{player:{playerId:'fa',name:'Free Agent'}}});
  if(url.pathname.endsWith('/correct')) {
   const body=request.postDataJSON();
   const corrected={...extraction,extractionId:'e2',status:'READY_FOR_REVIEW',issues:[],correctedInput:body.input,rosterAdditions:[{screenshotIndex:0,playerId:'fa',teamId:'wolves',name:'Free Agent'}]};
   payload={...payload,editable:body.input,extractions:[corrected]};
   return route.fulfill({json:corrected});
  }
  if(url.pathname.endsWith('/review'))return route.fulfill({json:payload});
  return route.fulfill({json:{}});
 });
 await page.goto('http://review.test/games/g/submissions/s/review');
 await page.locator('#key').fill('test-key');await page.locator('#access button').click();
 await page.locator('#operator').fill('Commissioner');
 await page.getByText('Add free agent or player from another roster to Wolves').click();
 await page.locator('.review-free-agent-add form').waitFor({timeout:3000}).catch(async()=>assert.fail(await page.locator('.review-free-agent-add').innerText()));
 assert.match(await page.getByLabel('Choose player').innerText(),/Neu Playr · On Rockets/);
 await page.getByLabel('Search players').fill('');
 await page.getByLabel('Choose player').selectOption('fa');
 await page.getByLabel('Starting annual salary').fill('$1M');
 await page.getByLabel('Contract years').fill('1');
 await page.getByLabel('Reason for roster addition').fill('Approved emergency roster addition');
 await page.getByRole('button',{name:'Add to roster and match player'}).click();
 await page.getByRole('button',{name:'Confirm and add player'}).click();
 await page.waitForFunction(()=>document.querySelector('#action-status')?.textContent.startsWith('Saved successfully'),null,{timeout:5000});
 assert.equal(await page.getByLabel('New Player roster match').inputValue(),'fa');
 assert.ok(calls.some(([,path])=>path.endsWith('/correction-preview')));
 assert.ok(calls.some(([,path])=>path.endsWith('/assign-free-agent')));
 assert.ok(calls.some(([,path])=>path.endsWith('/correct')));
 assert.deepEqual(errors,[]);
});
