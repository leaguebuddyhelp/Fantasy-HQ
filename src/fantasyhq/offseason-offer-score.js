// Separate offseason scoring keeps the existing regular-season offer policy intact.
const WEIGHTS=Object.freeze({annualSalary:.35,totalValue:.25,length:.25,age:.15});
function rankOffseasonOffers(offers,player){
 if(!offers.length)return [];const maxAnnual=Math.max(...offers.map(o=>o.contract.seasons[0].salary)),totals=new Map(offers.map(o=>[o.id,o.contract.seasons.reduce((n,s)=>n+s.salary,0)])),maxTotal=Math.max(...totals.values()),maxLength=Math.max(...offers.map(o=>o.contract.seasons.length)),age=Number.isFinite(Number(player.age))&&Number(player.age)>0?Number(player.age):null;
 return offers.map(o=>{const years=o.contract.seasons.length,ageFit=age==null?.5:age>=30?Math.min(1,years/3):Math.max(0,1-Math.abs(years-4)/4),breakdown={annualSalary:o.contract.seasons[0].salary/maxAnnual,totalValue:totals.get(o.id)/maxTotal,length:years/maxLength,age:ageFit};return {...o,score:Math.round(Object.entries(WEIGHTS).reduce((n,[key,weight])=>n+weight*breakdown[key],0)*1000000)/10000,scoreBreakdown:breakdown,totalValue:totals.get(o.id)};}).sort((a,b)=>b.score-a.score||Date.parse(a.submittedAt)-Date.parse(b.submittedAt)||a.id.localeCompare(b.id));
}
module.exports={WEIGHTS,rankOffseasonOffers};
