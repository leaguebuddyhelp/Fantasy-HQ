const FIELDS=['MIN','PTS','REB','AST','STL','BLK','TO','FGM','FGA','3PM','3PA','FTM','FTA','OR','FLS'];
const minutes=[34,32,30,28,26,24,22,18,14,12];
function simulateBoxScore(team1,team2,rng=Math.random) {
  const avg=roster=>roster.slice().sort((a,b)=>b.overall-a.overall).slice(0,8).reduce((n,p)=>n+(Number(p.overall)||70),0)/Math.min(8,roster.length);
  function side(roster,opponent) {
    if(roster.length!==15||roster.some(p=>!p.playerId))throw Error('Simulation requires fifteen real stored players per team.');
    const sorted=roster.slice().sort((a,b)=>b.overall-a.overall),rotation=[];
    for(const pos of ['PG','SG','SF','PF','C']){const p=sorted.find(p=>String(p.position1||'').split('/')[0]===pos&&!rotation.includes(p));if(p)rotation.push(p);}
    for(const p of sorted)if(rotation.length<10&&!rotation.includes(p))rotation.push(p);
    rotation.sort((a,b)=>b.overall-a.overall);
    const advantage=(avg(roster)-avg(opponent))/300,night=(rng()-.5)*.28;
    const players=rotation.map((p,i)=>{
      const ovr=Number(p.overall)||70,pos=String(p.position1||'').split('/')[0],shooting=/shoot|stretch|3.level/i.test(p.archetype||p.build||'');
      const fga=Math.round(4+minutes[i]/4+(ovr-70)/15+rng()*5),threeAttempts=Math.min(fga,Math.floor(rng()*(pos==='C'&&!shooting?3:8))),fta=Math.floor(rng()*7);
      let threes=0,twos=0,ftm=0;for(let j=0;j<threeAttempts;j++)threes+=rng()<Math.max(.2,Math.min(.55,.32+(ovr-75)/250+advantage+night+(shooting?.03:0)))?1:0;
      for(let j=0;j<fga-threeAttempts;j++)twos+=rng()<Math.max(.3,Math.min(.7,.49+(ovr-75)/300+advantage+night))?1:0;
      for(let j=0;j<fta;j++)ftm+=rng()<.76?1:0;
      const reb=Math.floor(rng()*(pos==='C'||pos==='PF'?13:7));
      return {playerId:p.playerId,MIN:minutes[i],PTS:twos*2+threes*3+ftm,REB:reb,AST:Math.floor(rng()*(pos==='PG'?10:6)),STL:Math.floor(rng()*3),BLK:Math.floor(rng()*(pos==='C'?4:2)),TO:Math.floor(rng()*4),FGM:twos+threes,FGA:fga,'3PM':threes,'3PA':threeAttempts,FTM:ftm,FTA:fta,OR:Math.floor(reb*rng()*.4),FLS:Math.floor(rng()*5)};
    });
    const totals=Object.fromEntries(FIELDS.map(k=>[k,players.reduce((sum,p)=>sum+p[k],0)]));return {players,totals,dnp:roster.filter(p=>!rotation.includes(p)).map(p=>p.playerId)};
  }
  const a=side(team1,team2),b=side(team2,team1);
  if(a.totals.PTS===b.totals.PTS){const winner=rng()<.5?a:b;winner.players[0].FTA++;winner.players[0].FTM++;winner.players[0].PTS++;winner.totals.FTA++;winner.totals.FTM++;winner.totals.PTS++;}
  validateBoxScore(a);validateBoxScore(b);return [a,b];
}
function validateBoxScore(side){if(side.players.length!==10||side.totals.MIN!==240)throw Error('Invalid simulated rotation minutes.');for(const p of side.players)if(FIELDS.some(k=>!Number.isInteger(p[k])||p[k]<0)||p.FGM>p.FGA||p['3PM']>p['3PA']||p['3PM']>p.FGM||p['3PA']>p.FGA||p.FTM>p.FTA||p.OR>p.REB||p.PTS!==2*p.FGM+p['3PM']+p.FTM)throw Error('Invalid simulated player shooting/scoring.');for(const k of FIELDS)if(side.totals[k]!==side.players.reduce((n,p)=>n+p[k],0))throw Error('Simulated totals do not reconcile.');return true;}
module.exports={simulateBoxScore,validateBoxScore,FIELDS};
