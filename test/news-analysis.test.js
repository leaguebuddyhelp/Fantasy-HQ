const test=require('node:test'),assert=require('node:assert/strict');
const {analysisSources}=require('../src/fantasyhq/news-analysis');
const teams=[{teamId:'a',teamName:'Team A'},{teamId:'b',teamName:'Team B'}];
const logs=Array.from({length:7},(_,index)=>({playerId:'p',name:'Player P',teamId:'a',week:index+1,gameId:'g'+index,PTS:index<4?20:32,MIN:30,result:'W',score:'110-100'}));
const input={leagueId:'l',seasonId:'1',simulationId:null,logs,teams,currentWeek:7,throughWeek:7};
test('multi-game trends and weekly analysis use verified samples, stable IDs and one team result per game',()=>{
 const first=analysisSources(input);assert.equal(first.length,2);const trend=first.find(a=>a.category==='Trends');assert.match(trend.facts.sentences.join(' '),/32.0 points/);assert.equal(trend.sourceGameIds.length,7);
 const weekly=first.find(a=>a.category==='Weekly review');assert.match(weekly.facts.sentences.join(' '),/combined scoring margin was \+10/);
 const duplicate=analysisSources({...input,logs:[...logs,{...logs.at(-1),playerId:'q',name:'Player Q'}]});assert.equal(duplicate.find(a=>a.category==='Weekly review').sourceDigest,weekly.sourceDigest);
 assert.deepEqual(analysisSources({...input,allowNew:false}),[]);assert.equal(analysisSources({...input,allowNew:false,existing:first}).length,2);
 const changed=analysisSources({...input,logs:logs.map(l=>l.week===7?{...l,PTS:38}:l),existing:first,allowNew:false});assert.equal(changed[0].id,trend.id);assert.notEqual(changed[0].sourceDigest,trend.sourceDigest);
 assert.equal(analysisSources({...input,logs:logs.slice(1)}).some(a=>a.category==='Trends'),false);
});
