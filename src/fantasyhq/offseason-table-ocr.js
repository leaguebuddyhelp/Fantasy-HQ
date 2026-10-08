const {playerCandidates}=require('./box-score/normalize');
const normalized=value=>String(value||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function teamMatches(text,teams) {
 const value=normalized(text);return teams.filter(team=>{
  const name=normalized(team.teamName),words=name.split(' '),nickname=words.slice(name.startsWith('portland')?1:words.length-1).join(' ');
  const aliases=[name,nickname,normalized(team.abbreviation),...(team.aliases||[]).map(normalized)];
  return aliases.some(alias=>alias.length>=3&&(' '+value+' ').includes(' '+alias+' '));
 });
}
function tableProposals({step,text,lines=[],width,players,teams}) {
 const warnings=[],rows=[];if(step==='RETIREMENTS')return {rows,warnings,screenType:step};
 if(/mock\s*draft/i.test(text)&&['LOTTERY','DRAFT'].includes(step))return {rows,warnings:['This screen is a Mock Draft projection. It cannot verify official lottery or draft results.'],screenType:'PROJECTION'};
 if(step==='LOTTERY') {
  const pickHeader=lines.find(line=>/^PICK\s*(?:#|NO\.?|NUMBER)?$/i.test(line.text.trim()));
  const ownerHeader=lines.find(line=>/^(?:TEAM|OWNER|PICK OWNER)$/i.test(line.text.trim()));
  const originalHeader=lines.find(line=>/^ORIGINAL(?: TEAM| FRANCHISE)?$/i.test(line.text.trim()));
  if(!pickHeader||!ownerHeader||!width)return {rows,warnings:['OCR could not identify lottery pick and owner columns. Review the official order manually.'],screenType:'UNKNOWN'};
  const cy=line=>(line.bbox.y0+line.bbox.y1)/2,headerY=cy(pickHeader),height=pickHeader.bbox.y1-pickHeader.bbox.y0;
  for(const pick of lines.filter(line=>/^\d{1,2}$/.test(line.text.trim())&&cy(line)>headerY+height&&Math.abs(line.bbox.x0-pickHeader.bbox.x0)<width*.12)) {
   const pickNumber=Number(pick.text);if(pickNumber<1||pickNumber>30)continue;
   const adjacent=lines.filter(line=>Math.abs(cy(line)-cy(pick))<height*1.5&&line!==pick);
   const nearest=header=>header?adjacent.filter(line=>Math.abs(line.bbox.x0-header.bbox.x0)<width*.15).flatMap(line=>teamMatches(line.text,teams)):[];
   const owners=[...new Map(nearest(ownerHeader).map(t=>[t.teamId,t])).values()],originals=[...new Map(nearest(originalHeader).map(t=>[t.teamId,t])).values()];
   rows.push({pickNumber,name:'Pick '+pickNumber,teamId:owners.length===1?owners[0].teamId:null,originalTeamId:originals.length===1?originals[0].teamId:null,playerCandidates:[],confidence:Math.round(pick.confidence||0),flags:[...(owners.length===1?[]:['Confirm the pick owner; the team label is missing or ambiguous.']),...(originals.length===1?[]:['Match the original franchise to its stored pick asset; an owner label alone does not identify the original team.'])],sourceText:[pick,...adjacent].map(line=>line.text).join(' | ')});
  }
  return {rows,warnings,screenType:'LOTTERY'};
 }
 const header=lines.find(line=>/^NAME$/i.test(line.text.trim()));
 if(step==='FREE_AGENCY') {
  const narrative=String(text).split(/\n/).filter(line=>/\b(?:sign|re-sign)\b/i.test(line));
  for(const line of narrative) {
   const match=line.match(/(?:re-)?sign\s+(?:PG|SG|SF|PF|C)\s+(.+?)\s+to\s+(\d)\s*y(?:ea)?r\s*\/\s*\$([\d,.]+)\s*([MK])?\s*(?:deal)?/i);
   if(!match)continue;
   const candidates=playerCandidates(match[1],players),matchedTeams=teamMatches(line.slice(0,match.index),teams);
   rows.push({name:match[1],playerCandidates:candidates.map(p=>({playerId:p.playerId,name:p.name})),playerId:candidates.length===1?candidates[0].playerId:null,
    teamId:matchedTeams.length===1?matchedTeams[0].teamId:null,contractYears:Number(match[2]),reportedTotal:Number(match[3].replaceAll(',',''))*(match[4]?.toUpperCase()==='M'?1e6:match[4]?.toUpperCase()==='K'?1000:1),
    flags:['The Transaction Report shows total value. Annual salaries, structure and options must be verified against the approved offer.'],sourceText:line});
  }
  return {rows,warnings,screenType:'TRANSACTION_REPORT'};
 }
 if(!header||!width)return {rows,warnings:['OCR could not locate the table columns. Review the original photo and enter the rows manually.'],screenType:'UNKNOWN'};
 const center=line=>({x:(line.bbox.x0+line.bbox.x1)/2,y:(line.bbox.y0+line.bbox.y1)/2});
 const origin=center(header),size=header.bbox.y1-header.bbox.y0,headers=lines.filter(line=>Math.abs(center(line).y-origin.y)<size*3&&/^((?:PICK\s*#?|TEAM|NAME|POS|AGE|OVR|OVERALL|[▼▽VW]?RATING|STATUS|OPTION|SALARY|CHANGE))$/i.test(line.text.trim()))
  .map(line=>({key:line.text.trim().toUpperCase().replace(/[^A-Z]/g,'').replace(/^[VW]RATING$/,'RATING'),...center(line)})).sort((a,b)=>a.x-b.x);
 const nameHeader=headers.find(h=>h.key==='NAME'),other=headers.at(-1),slope=other.x!==origin.x?(other.y-origin.y)/(other.x-origin.x):0;
 const baseline=line=>center(line).y-slope*(center(line).x-origin.x);
 const footer=lines.filter(line=>baseline(line)>origin.y&&/View Player|Quick\s*Nav|^Sort\b|^Back\b/i.test(line.text.trim())).map(baseline).sort((a,b)=>a-b)[0]||Infinity;
 const cell=(line,key)=>{const index=headers.findIndex(h=>h.key===key);if(index<0)return false;const x=center(line).x,left=index?(headers[index-1].x+headers[index].x)/2:0,right=index<headers.length-1?(headers[index].x+headers[index+1].x)/2:width;return x>=left&&x<right;};
 const tableTeams=lines.filter(line=>line.bbox.x0<width*.6&&baseline(line)<origin.y&&baseline(line)>origin.y-width*.6).flatMap(line=>teamMatches(line.text,teams));
 const teamIds=[...new Set(tableTeams.map(t=>t.teamId))],tableTeamId=teamIds.length===1?teamIds[0]:null;
 if(step==='PROGRESSION'&&!tableTeamId)warnings.push('Confirm the selected table team. The upper-right controller franchise is excluded from automatic matching.');
 const names=lines.filter(line=>cell(line,'NAME')&&baseline(line)>origin.y+size&&baseline(line)<footer&&/[A-Za-z]/.test(line.text)&&!/^NAME$/i.test(line.text.trim())).slice(0,20);
 for(const name of names) {
  const y=baseline(name),parts=lines.filter(line=>Math.abs(baseline(line)-y)<size*1.5&&baseline(line)<footer),value=key=>parts.filter(line=>cell(line,key)).map(line=>line.text.trim()).join(' ');
  const candidates=playerCandidates(name.text,players),unique=candidates.length===1?candidates[0]:null;
  const rating=value('OVR')||value('OVERALL')||value('RATING'),ratingMatch=rating.match(/^(\d{2})(?!\d{2})/),delta=rating.match(/([+-]\s*\d{1,2})(?:\s|$)/);
  const status=value('STATUS'),decision=/^accepted$/i.test(status)?'ACCEPTED':/^declined$/i.test(status)?'DECLINED':null;
  const teamText=value('TEAM'),rowTeams=teamMatches(teamText,teams),teamId=step==='PROGRESSION'?tableTeamId:rowTeams.length===1?rowTeams[0].teamId:null;
  const flags=[];if(!unique)flags.push('Confirm the permanent player ID; this name is missing or ambiguous.');
  if(step==='PROGRESSION'&&unique&&teamId&&unique.teamId!==teamId)flags.push('The photo team differs from the stored roster. Reconcile the roster before importing.');
  if(step==='PROGRESSION'&&!delta)flags.push('Verify the displayed OVR change; no signed change was read reliably.');
  if(step==='OPTIONS'&&!decision)flags.push('Choose Accepted or Declined from the photo.');
  const round=/round\s*2\s*\/\s*2/i.test(text)?2:/round\s*1\s*\/\s*2/i.test(text)?1:null,pick=Number(value('PICK'));
  if(step==='DRAFT'&&!round)flags.push('Confirm the draft round before assigning a global pick number.');
  rows.push({name:name.text.trim(),playerId:unique?.playerId||null,playerCandidates:candidates.map(p=>({playerId:p.playerId,name:p.name})),teamId,overall:ratingMatch?Number(ratingMatch[1]):null,
   age:/^\d{2}$/.test(value('AGE'))?Number(value('AGE')):null,position:value('POS'),change:delta?Number(delta[1].replaceAll(' ','')):null,decision,
   pickNumber:Number.isInteger(pick)&&pick>=1&&pick<=30&&round?pick+(round-1)*30:null,round,flags,confidence:Math.round(name.confidence||0),sourceText:parts.map(p=>p.text.trim()).join(' | ')});
 }
 return {rows,warnings,tableTeamId,screenType:step};
}
module.exports={tableProposals,teamMatches};
