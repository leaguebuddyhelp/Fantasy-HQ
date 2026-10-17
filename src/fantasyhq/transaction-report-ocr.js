const sharp=require('sharp');
const {playerMatch}=require('./box-score/normalize');
const {teamMatches}=require('./offseason-table-ocr');
function words(tsv){return String(tsv||'').split('\n').map(l=>l.split('\t')).filter(c=>c[0]==='5'&&c[11]?.trim()).map(c=>({text:c.slice(11).join('\t'),line:c.slice(1,5).join(':'),left:+c[6],top:+c[7],width:+c[8],height:+c[9],x:+c[6]+c[8]/2,y:+c[7]+c[9]/2}));}
function parseReportRow({news,date,type},players,teams){
 const cleaned=String(news).trim().replace(/\s*[|¥\\]+.*$/, '').replace(/(deal)\b.*$/i,'$1').trim();
 const match=cleaned.match(/^(.*?)\s+(re-?sign|sign|waive|waives|release|releases)\s+(?:PG|SG|SF|PF|C)\s+(.+)$/i);
 const body=match?.[3]||cleaned.match(/^(?:PG|SG|SF|PF|C)\s+(.+)$/i)?.[1]||'';
 const terms=body.match(/\s+to\s+(\d{1,2}|[IlT])\s*y(?:ea)?r\s*\/\s*\$([\d,.]+)\s*([MK])?/i);
 const dateMatch=String(date).replace(/\s/g,'').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
 let eventDate=null;if(dateMatch){const [,m,d,y]=dateMatch,at=new Date(Date.UTC(+y,+m-1,+d));if(at.getUTCMonth()===+m-1&&at.getUTCDate()===+d&&at.getUTCFullYear()===+y)eventDate=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;}
 const action=/WAIVE|RELEASE/i.test(type)?'WAIVE':/SIGN/i.test(type)?'SIGN':null;
 const name=(terms?body.slice(0,terms.index):body.replace(/\s+to\b.*$/i,'')).trim(),found=playerMatch(name,players),matchedTeams=match?teamMatches(match[1],teams):[];
 const reportedYears=terms?(/^[IlT]$/.test(terms[1])?1:Number(terms[1])):null,reportedTotal=terms?Number(terms[2].replaceAll(',',''))*(terms[3]?.toUpperCase()==='M'?1e6:terms[3]?.toUpperCase()==='K'?1000:1):null;
 return {date:eventDate,type:action,name,position:cleaned.match(/\b(?:PG|SG|SF|PF|C)\s+/)?.[0]?.trim()||null,playerId:found.automatic?found.candidates[0]?.playerId:null,playerCandidates:found.candidates.map(p=>({playerId:p.playerId,name:p.name})),teamId:matchedTeams.length===1?matchedTeams[0].teamId:null,reportedYears,reportedTotal,sourceText:news,dateText:date,
 warnings:[...(terms&&/^[IlT]$/.test(terms[1])?['Verify the contract year count; its digit was unclear.']:[]),...(!match?['Read the transaction text and select the player and team manually.']:[]),...(!eventDate?['Confirm the transaction date.']:[]),...(action==='SIGN'&&(!reportedYears||!reportedTotal)?['Contract total or years could not be read; leave unknown or correct from the photo.']:[])]};
}
function textLines(list){const groups=new Map();for(const w of list){const group=groups.get(w.line)||[];group.push(w);groups.set(w.line,group);}return [...groups.values()].map(ws=>({words:ws,text:ws.sort((a,b)=>a.left-b.left).map(w=>w.text).join(' '),left:Math.min(...ws.map(w=>w.left)),x:ws.reduce((n,w)=>n+w.x,0)/ws.length,y:ws.reduce((n,w)=>n+w.y,0)/ws.length}));}
async function recognizeTransactionReport(bytes){return require('./box-score/tesseract-provider').withOcrWorker(async worker=>{
 let image=bytes,meta=await sharp(image).metadata();await worker.setParameters({tessedit_pageseg_mode:'11'});
 async function locate(buffer,mode='11'){await worker.setParameters({tessedit_pageseg_mode:mode});const d=(await worker.recognize(buffer,{}, {text:true,tsv:true})).data;return {data:d,words:words(d.tsv)};}
 const headings=list=>({date:list.find(w=>/^DATE$/i.test(w.text)),type:list.find(w=>/^TYPE$/i.test(w.text)),news:list.find(w=>/^NEWS$/i.test(w.text))});
 let found=await locate(image),header=headings(found.words);
 if(!header.date||!header.type||!header.news){const block=await locate(image,'6'),h=headings(block.words);if(h.date&&h.type&&h.news){found=block;header=h;}}
 if(!header.date||!header.type||!header.news){
  // A cropped, angled report may lose the headings while retaining a news line.
  const line=textLines(found.words).find(l=>l.words.length>=5&&/(?:sign|waive|deal|to \d)/i.test(l.text)&&l.words.at(-1).x-l.words[0].x>meta.width*.15);
  if(line){const a=line.words[0],b=line.words.at(-1),angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;if(Math.abs(angle)>.5&&Math.abs(angle)<12){image=await sharp(image).rotate(-angle,{background:'#18305b'}).png().toBuffer();meta=await sharp(image).metadata();found=await locate(image);header=headings(found.words);}}
 }
 if(!header.date||!header.type||!header.news){found=await locate(await sharp(image).extractChannel('green').normalize().png().toBuffer());header=headings(found.words);}
 if(!header.date||!header.type||!header.news)throw Error('Could not locate DATE, TYPE and NEWS. Crop to the transaction table or try a clearer photo.');
 const green=await locate(await sharp(image).extractChannel('green').normalize().png().toBuffer());
 const red=await locate(await sharp(image).extractChannel('red').normalize().png().toBuffer());
 const slope=(header.news.y-header.date.y)/(header.news.x-header.date.x),baseline=w=>w.y-slope*(w.x-header.type.x);
 const all=[found,green,red],candidates=all.flatMap(f=>textLines(f.words.filter(w=>w.x>header.news.left-meta.width*.035))),dateCandidates=all.flatMap(f=>textLines(f.words.filter(w=>w.x<header.type.left-meta.width*.06)));
 const anchors=[];
 for(const w of all.flatMap(f=>f.words).filter(w=>/^(SIGNING|WAIVE)$/i.test(w.text)&&Math.abs(w.x-header.type.x)<meta.width*.08&&w.y>header.type.y+header.type.height).sort((a,b)=>a.y-b.y))if(!anchors.some(a=>Math.abs(a.y-w.y)<header.type.height))anchors.push(w);
 if(!anchors.length)throw Error('No signing or waiver rows found. Use the Signing or Waive Transaction Report.');
 const gap=anchors.length>1?Math.min(...anchors.slice(1).map((a,i)=>a.y-anchors[i].y)):header.type.height*2.5;
 const plausible=t=>/\b(?:sign|waive|release)\s+(?:PG|SG|SF|PF|C)\b/i.test(t);
 const clusters=[];
 for(const l of candidates.filter(l=>l.left>header.news.left-meta.width*.035&&(plausible(l.text)||/^(?:PG|SG|SF|PF|C)\s+/.test(l.text))).sort((a,b)=>a.y-b.y)){
  let group=clusters.find(g=>Math.abs(g[0].y-l.y)<header.type.height);if(!group){group=[];clusters.push(group);}group.push(l);
 }
 const dates=[];
 for(const l of dateCandidates.filter(l=>l.left<header.type.left-meta.width*.06&&/\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4}/.test(l.text)).sort((a,b)=>a.y-b.y))if(!dates.some(d=>Math.abs(d.y-l.y)<header.type.height))dates.push(l);
 let focusImage=image,focusMeta=meta,focusHeader=header,focusAnchors=anchors;
 const focusAngle=Math.atan(slope)*180/Math.PI;
 if(Math.abs(focusAngle)>.3&&Math.abs(focusAngle)<12){
  const candidate=await sharp(image).rotate(-focusAngle,{background:'#18305b'}).png().toBuffer(),scan=await locate(candidate),h=headings(scan.words);
  if(h.date&&h.type&&h.news){focusImage=candidate;focusMeta=await sharp(candidate).metadata();focusHeader=h;const a=scan.words.filter(w=>/^(SIGNING|WAIVE)$/i.test(w.text)&&Math.abs(w.x-h.type.x)<focusMeta.width*.08&&w.y>h.type.y+h.type.height).sort((a,b)=>a.y-b.y);if(a.length===anchors.length)focusAnchors=a;}
 }
 await worker.setParameters({tessedit_pageseg_mode:'7'});
 async function focused(left,y,width,height,channel){const crop={left:Math.max(0,Math.round(left)),top:Math.max(0,Math.round(y-height/2)),width:Math.round(width),height:Math.round(height)};crop.width=Math.min(crop.width,focusMeta.width-crop.left);crop.height=Math.min(crop.height,focusMeta.height-crop.top);if(crop.width<1||crop.height<1)return '';const buffer=await sharp(focusImage).extract(crop).extractChannel(channel).normalize().resize({height:80}).png().toBuffer();return (await worker.recognize(buffer,{}, {text:true})).data.text.trim();}
 const rows=[];
 for(const [index,a]of anchors.entries()){
  const nearby=candidates.filter(l=>Math.abs(baseline(l)-baseline(a))<gap*.45);
  const newsLines=clusters.length===anchors.length?clusters[index]:nearby.filter(l=>l.left>header.news.left-meta.width*.035);
  const ranked=newsLines.sort((a,b)=>Number(plausible(b.text))-Number(plausible(a.text))||b.text.length-a.text.length);
  const dateLines=dates.length===anchors.length?[dates[index]]:dateCandidates.filter(l=>Math.abs(baseline(l)-baseline(a))<gap*.45).filter(l=>l.left<header.type.left-meta.width*.06&&/\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4}/.test(l.text));
  let news=ranked[0]?.text||'',date=dateLines[0]?.text||'';const readings=ranked.map(l=>l.text);
  if(!plausible(news)||a.text==='SIGNING'){
   const focusAnchor=focusAnchors[index],left=focusHeader.news.left-focusHeader.news.height*.5,width=focusMeta.width-left-10,y=focusAnchor.y;
   for(const channel of ['green','red']){const text=await focused(left,y,width,Math.min(gap*.9,a.height*1.9),channel);readings.push(text);if(plausible(text)&&(a.text!=='SIGNING'||/to (?:\d+|[IlT])yr\/\$[\d.]+[MK] deal/i.test(text)))news=text;}
  }
  if(!date){const left=focusHeader.date.left-focusHeader.date.height*2.3,width=focusHeader.type.left-left-focusHeader.date.height*3,y=focusAnchors[index].y;for(const channel of ['green','red']){const text=await focused(left,y,width,Math.min(gap*.9,a.height*1.9),channel);if(/\d{1,2}\/\d{1,2}\/\d{4}/.test(text)){date=text;break;}}}
  rows.push({news,date,type:a.text,readings});
 }
 return {text:found.data.text,rows};
});}
module.exports={parseReportRow,recognizeTransactionReport};
