const THRESHOLDS={PTS:[30,35,40,45,50,55,60,65,70,80],REB:[12,14,16,18,20,22,24,26,28,30],AST:[10,11,12,13,14,15,16,18,20,25],STL:[3,4,5,6,7,8,9,10,11,12],BLK:[3,4,5,6,7,8,9,10,11,12],'3PM':[5,6,7,8,9,10,11,12,13,15],FG_PERCENT:[60,62,65,67,70,72,75,80,85,90],TS_PERCENT:[65,67,70,72,75,77,80,85,90,95],ALL_AROUND:[50,55,60,65,70,75,80,85,90,100],DEFENSIVE:[5,6,7,8,9,10,11,12,13,15]};
const CONTEXTS=['GAME','WIN','LOSS','CLOSE','BLOWOUT','SEASON_BEST'];
const SCENARIOS=Object.entries(THRESHOLDS).flatMap(([metric,thresholds])=>thresholds.flatMap(threshold=>CONTEXTS.map(context=>({id:`PERFORMANCE:${metric}:${threshold}:${context}`,metric,threshold,context,category:['STL','BLK','DEFENSIVE'].includes(metric)?'Defense':['FG_PERCENT','TS_PERCENT','3PM'].includes(metric)?'Shooting':'Player Performance'}))));
function metrics(log){const [fgm,fga]=log.FG.split('-').map(Number),[threes]=log['3PT'].split('-').map(Number),[,fta]=log.FT.split('-').map(Number);return {...log,'3PM':threes,FG_PERCENT:fga>=15?fgm/fga*100:null,TS_PERCENT:fga+.44*fta>=15?log.PTS/(2*(fga+.44*fta))*100:null,ALL_AROUND:log.PTS+log.REB+log.AST,DEFENSIVE:log.STL+log.BLK};}
function matchScenarios(log, previous = []) {
 const values=metrics(log),[own,opponent]=log.score.split('-').map(Number),margin=own-opponent;
 const context={GAME:true,WIN:log.result==='W',LOSS:log.result==='L',CLOSE:Math.abs(margin)<=5,BLOWOUT:Math.abs(margin)>=20};
 const prior=previous.map(metrics),best={};
 for(const metric of Object.keys(THRESHOLDS)) {
  const eligible=prior.map(row=>row[metric]).filter(value=>value!==null&&value!==undefined);
  best[metric]=eligible.length>=3&&eligible.every(value=>value<values[metric]);
 }
 return SCENARIOS.filter(s=>values[s.metric]!=null&&values[s.metric]>=s.threshold
  &&(s.context==='SEASON_BEST'?best[s.metric]:context[s.context]))
  .sort((a,b)=>b.threshold-a.threshold||CONTEXTS.indexOf(b.context)-CONTEXTS.indexOf(a.context));
}
module.exports={SCENARIOS,THRESHOLDS,metrics,matchScenarios};
