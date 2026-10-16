const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');

test('admin selects a released free agent, enters a contract, and sees releases return to the pool',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 const released={playerId:'released',name:'Released Guard',position1:'SG',overall:78};
 let pool=[released,{playerId:'other',name:'Other Free Agent',position1:'C',overall:80},{playerId:'reserved',name:'Reserved Player',position1:'PG',overall:82,signingBlockedReason:'Active offer window'}];
 let roster=[{player:{playerId:'rostered',name:'Roster Player',position1:'PF',overall:79},position1:'PF'}];const assigned=[];
 await page.route('http://roster.test/**',async route=>{const u=new URL(route.request().url());
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync('web/index.html','utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g,'')});
  if(u.pathname==='/api/league/teams/a')return route.fulfill({json:{team:{teamId:'a',teamName:'Team A',conference:'East',roster}}});
  if(u.pathname==='/api/league/admin/rosters/free-agents')return route.fulfill({json:{players:pool}});
  if(u.pathname==='/api/league/admin/rosters/assign-free-agent'){
   const body=route.request().postDataJSON();assigned.push(body);const player=pool.find(p=>p.playerId===body.playerId);pool=pool.filter(p=>p.playerId!==body.playerId);roster.push({player,position1:player.position1});return route.fulfill({json:{player}});
  }
  if(u.pathname==='/api/league/admin/rosters/remove-player'){
   const body=route.request().postDataJSON(),entry=roster.find(r=>r.player.playerId===body.playerId);roster=roster.filter(r=>r!==entry);pool.push(entry.player);return route.fulfill({json:{membership:{}}});
  }
  return route.fulfill({status:404,body:''});
 });
 await page.goto('http://roster.test/');await page.addStyleTag({content:fs.readFileSync('web/styles.css','utf8')});
 await page.addScriptTag({content:fs.readFileSync('web/app.js','utf8').replace(/^initialize\(\);$/m,'').replace(/^refreshStandings\(\);$/m,'').replace(/^setInterval\(.*$/gm,'')});
 await page.evaluate(async()=>{state.leagueSite={league:{currentPhase:'PRESEASON'},teams:[{teamId:'a',teamName:'Team A'}]};state.adminKey='key';state.adminAuthenticated=true;renderAdminMode();refreshLeagueSite=async()=>{};loadAdminPanels=async()=>{};await loadRosterManager('a');});
 const form=page.locator('#add-player-form');
 assert.equal(await form.locator('[name="name"]').count(),0);
 assert.ok(await form.locator('option[value="reserved"]').evaluate(el=>el.disabled), await form.locator('option[value="reserved"]').evaluate(el=>el.outerHTML));
 await form.locator('[data-free-agent-search]').fill('Released');
 assert.equal(await form.locator('[name="playerId"] option').count(),2);
 await form.locator('[name="playerId"]').selectOption('released');await form.locator('[name="salary"]').fill('$6M');await form.locator('[name="years"]').fill('2+1');
 await form.locator('[name="structure"]').selectOption('BACK');await form.locator('[name="option"]').selectOption('Team');
 await form.getByRole('button',{name:'Add to roster'}).click();
 await page.locator('[data-roster-player="released"]').waitFor();
 assert.deepEqual(assigned[0],{operator:'',teamId:'a',playerId:'released',contractDetails:{salary:'$6M',years:'2+1',structure:'BACK',option:'Team'}});
 assert.equal(await page.locator('#add-player-form option[value="released"]').count(),0);
 await page.locator('[data-remove-player="rostered"]').click();
 await page.waitForFunction(()=>document.querySelector('#add-player-form option[value="rostered"]'));
 assert.equal(await page.locator('[data-roster-player="rostered"]').count(),0);
});
