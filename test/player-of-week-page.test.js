const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { chromium } = require('playwright');
test('weekly awards page shows both conferences, filters history, opens game evidence and refreshes new winners', async t => {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close()); const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  const winner = conference => ({ awardId: 'league:1:W1:' + conference, seasonId:'1', week:1, conference, playerId:conference + '-player', playerName:conference + ' Winner', teamId:conference + '-team', teamName:conference + ' Team', gameId:conference + '-game', explanation:'Verified efficient all-around performance.', stats:{PTS:30,REB:12,AST:9,STL:2,BLK:2,TO:2,FGM:12,FGA:18,FGPercent:66.67,'3PM':2,'3PA':4,FTM:4,FTA:4}, player:{playerId:conference+'-player',name:conference+' Winner',imageUrl:'https://example.com/'+conference+'.jpg'} });
  let winners = ['East','West'].map(winner); const requests=[];
  await page.route('http://weekly.test/**', async route => {
    const url = new URL(route.request().url());
    if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync('web/index.html','utf8').replace('<script src="/app.js" defer></script>','')});
    if(url.pathname==='/api/league/player-of-the-week'){ requests.push(url.searchParams.get('conference')); return route.fulfill({json:{seasonId:'1',current:winners,history:winners.filter(w=>!url.searchParams.get('conference')||w.conference===url.searchParams.get('conference')),seasons:['1'],teams:winners.map(w=>({teamId:w.teamId,teamName:w.teamName})),players:winners.map(w=>({playerId:w.playerId,name:w.playerName}))}}); }
    if(url.pathname.includes('/games'))return route.fulfill({json:{games:[{gameId:'East-game',teamName:'East Team',opponent:'Other Team',result:'W',score:'110-100',MIN:35,PTS:30,REB:12,AST:9,FG:'12-18','3PT':'2-4',FT:'4-4'}]}});
    return route.fulfill({status:404,json:{error:'Not found'}});
  });
  await page.goto('http://weekly.test/#player-of-the-week');
  await page.addScriptTag({content:fs.readFileSync('web/app.js','utf8').replace(/^initialize\(\);$/m,'').replace(/^refreshStandings\(\);$/m,'').replace(/^setInterval\(.*$/gm,'')});
  await page.locator('#pow-current [data-pow-player]').first().waitFor();assert.equal(await page.locator('#pow-current article').count(),2);
  await page.locator('#pow-conference').selectOption('West');await page.waitForFunction(()=>document.querySelectorAll('#pow-history article').length===1);assert.match(await page.locator('#pow-history').textContent(),/West Winner/);
  await page.locator('#pow-current [data-pow-game="East-game"]').click();await page.waitForFunction(()=>document.querySelector('#pow-current [data-pow-game-output="East-game"]').textContent.includes('110-100'));assert.match(await page.locator('#pow-current [data-pow-game-output="East-game"]').textContent(),/110-100/);
  winners = winners.map(w=>({...w,week:2,awardId:w.awardId.replace('W1','W2')}));await page.locator('#pow-refresh').click();await page.waitForFunction(()=>document.querySelector('#pow-current').textContent.includes('Week 2'));
  assert.ok(requests.includes('West'));assert.deepEqual(errors,[]);
});
