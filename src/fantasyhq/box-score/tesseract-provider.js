const sharp = require('sharp');
// libvips sizes its thread pool from the host's cores; inside a CPU-limited container that oversubscribes and throttles everything.
sharp.concurrency(2);
const {normalizeText}=require('../service-helpers');
const { createWorker } = require('tesseract.js');
const english = require('@tesseract.js-data/eng');
// Bound concurrency across every league so bursts don't start a worker per game.
// Containers report the host's core count; the cgroup quota is the CPU the bot can really use.
function cpuBudget() {
  try {
    const [quota, period] = require('fs').readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (quota !== 'max') return Number(quota) / Number(period);
  } catch { /* not in a cgroup v2 container */ }
  return require('os').availableParallelism ? require('os').availableParallelism() : require('os').cpus().length;
}
let queue = Promise.resolve();
let queued = 0;
const COLUMNS = [
  ['MIN',.469,.036],['PTS',.507,.037],['REB',.547,.037],['AST',.589,.037],
  ['STL',.63,.037],['BLK',.672,.037],['TO',.713,.031],
  ['FG',.741,.058],['3PT',.796,.042],['FT',.839,.043],['OR',.881,.032],['FLS',.922,.029],
];
function words(tsv) {
  return tsv.split('\n').map(line => line.split('\t')).filter(c => c[0] === '5' && c[11]?.trim()).map(c => ({
    left:+c[6],top:+c[7],width:+c[8],height:+c[9],text:c.slice(11).join('\t'), x:(+c[6]+ +c[8]/2), y:(+c[7]+ +c[9]/2), confidence:+c[10],
  }));
}
function detectLayout(located, meta) {
  const names = located.filter(w => /^NAME$/i.test(w.text));
  for (const name of names) {
    const near = located.filter(w => Math.abs(w.y - name.y) < .015 && w.x > name.x);
    const min = near.find(w => /^MIN$/i.test(w.text));
    const endReference = [['FLS',.938672],['OR',.896973],['FT',.855469],['3PT',.813965],['FG',.772217]].find(([key]) => near.some(w => w.text.toUpperCase() === key));
    const end = endReference && near.find(w => w.text.toUpperCase() === endReference[0]);
    const headerCount = COLUMNS.filter(([key]) => near.some(w => w.text.toUpperCase().replace(/[^A-Z0-9]/g, '') === key)).length;
    if (!end || headerCount < 6) continue;
    // Highlighting the sorted column can obscure MIN. The remaining recognized headings independently anchor the same table.
    const anchor = min || name, anchorX = min ? .482422 : .366536;
    if (end.x - anchor.x < .15) continue;
    const scaleX = (end.x - anchor.x) / (endReference[1] - anchorX);
    const scaleY = scaleX * meta.width / (meta.height * (16 / 9));
    const offsetX = anchor.x - anchorX * scaleX, offsetY = name.y - .206019 * scaleY;
    if (scaleX < .2 || scaleX > 6 || scaleY < .15 || scaleY > 6) continue;
    // Preserve the established screenshot crops when anchors already match the template.
    if (Math.abs(scaleX - 1) < .025 && Math.abs(scaleY - 1) < .025 && Math.abs(offsetX) < .012 && Math.abs(offsetY) < .012) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
    return { scaleX, scaleY, offsetX, offsetY };
  }
  return null;
}
// Container limits and throttling are invisible to os.cpus(); read them from the cgroup so slow hosts can be diagnosed from the logs.
function cgroupStats(before) {
  const fs = require('fs'), read = file => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; } };
  const stat = Object.fromEntries((read('/sys/fs/cgroup/cpu.stat') || '').split('\n').map(l => l.split(' ')));
  if (!before) return stat;
  const diff = key => stat[key] === undefined ? '?' : Number(stat[key]) - Number(before[key] || 0);
  return `cpu.max=${read('/sys/fs/cgroup/cpu.max')} mem=${read('/sys/fs/cgroup/memory.current')}/${read('/sys/fs/cgroup/memory.max')} throttled_periods+${diff('nr_throttled')} throttled_usec+${diff('throttled_usec')} cpu_usec+${diff('usage_usec')}`;
}
async function readScreenshot(worker, suppliedImage) {
  let recognitionCalls = 0;
  const startedAt = Date.now(); let slowest = 0, recognizeMs = 0, paramMs = 0, cropMs = 0, lastParams = '';
  const cgroupBefore = cgroupStats();
  // Each parameter change is a round trip to the worker; skip it when the worker already has the values.
  const setParams = async params => {
    const key = JSON.stringify(params);
    if (key === lastParams) return;
    const began = Date.now();
    await worker.setParameters(params);
    lastParams = key; paramMs += Date.now() - began;
  };
  const recognize = async (...args) => {
    if (worker.aborted) throw new Error('OCR processing was stopped.');
    recognitionCalls++;
    const began = Date.now();
    try { return await worker.recognize(...args); }
    finally {
      const took = Date.now() - began; recognizeMs += took;
      // Full-page reads are the expensive ones; log them so slow hosts can be diagnosed from Railway logs.
      if (took > 3000 || took > slowest) { slowest = Math.max(slowest, took); if (took > 3000) console.log(`OCR read #${recognitionCalls} took ${took}ms (${Math.round((Date.now() - startedAt) / 1000)}s into screenshot)`); }
    }
  };
  // Apply EXIF orientation and decode camera formats before inspecting coordinates.
  const sourceMeta = await sharp(suppliedImage.bytes,{limitInputPixels:60000000}).metadata();
  if (sourceMeta.format === 'heif') suppliedImage = {...suppliedImage,bytes:await require('../offseason-image').normalize(suppliedImage.bytes)};
  const image = { ...suppliedImage, bytes: sourceMeta.orientation && sourceMeta.orientation !== 1 ? await sharp(suppliedImage.bytes,{limitInputPixels:40000000}).rotate().png().toBuffer() : suppliedImage.bytes };
  let meta = await sharp(image.bytes).metadata();
  await setParams({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
  let full = (await recognize(image.bytes,{}, {text:true,tsv:true})).data;
  let originalWords = words(full.tsv).map(w => ({...w,x:w.x/meta.width,y:w.y/meta.height}));
  // Deskew modest camera tilt using independently recognized table headings.
  const minHeader = originalWords.find(w => /^MIN$/i.test(w.text)) || originalWords.find(w => /^NAME$/i.test(w.text));
  const flsHeader = minHeader && [...originalWords].sort((a,b)=>b.x-a.x).find(w => /^(FLS|OR|FT|3PT|FG)$/i.test(w.text) && w.x > minHeader.x + .15 && Math.abs(w.y-minHeader.y)<.1);
  if (flsHeader) {
    const slope=(flsHeader.y-minHeader.y)*meta.height/((flsHeader.x-minHeader.x)*meta.width);
    const angle=Math.atan(slope)*180/Math.PI;
    const sameLine=originalWords.some(w=>/^NAME$/i.test(w.text) && w.x<=minHeader.x && Math.abs(w.y-(minHeader.y+slope*(w.x-minHeader.x)*meta.width/meta.height))<.015);
    if (sameLine && Math.abs(angle)>.4 && Math.abs(angle)<=8) {
      image.bytes=await sharp(image.bytes).rotate(-angle,{background:'#202329'}).png().toBuffer();
      meta=await sharp(image.bytes).metadata();
      full=(await recognize(image.bytes,{}, {text:true,tsv:true})).data;
      originalWords=words(full.tsv).map(w=>({...w,x:w.x/meta.width,y:w.y/meta.height}));
    }
  }
  const rectified=await require('./perspective').rectifyTablePerspective(image.bytes,words(full.tsv));
  if(rectified){
    image.bytes=rectified;meta=await sharp(rectified).metadata();
    full=(await recognize(rectified,{}, {text:true,tsv:true})).data;
    originalWords=words(full.tsv).map(w=>({...w,x:w.x/meta.width,y:w.y/meta.height}));
  }
  const layout = detectLayout(originalWords, meta);
  if (!layout) throw Object.assign(new Error('Could not locate a complete Association box-score table in this image. Cropped photos are supported; include readable column headings, player names and the Total row.'),{ocrRaw:full});
  // Decode once: every cell crop below would otherwise re-decode the full-resolution PNG.
  const decoded = await sharp(image.bytes).raw().toBuffer({resolveWithObject:true});
  const pixels = () => sharp(decoded.data,{raw:{width:decoded.info.width,height:decoded.info.height,channels:decoded.info.channels}});
  console.log(`OCR screenshot ${meta.width}x${meta.height}, cpu budget ${cpuBudget().toFixed(2)}`);
  const {scaleX,scaleY,offsetX,offsetY} = layout;
  const located = originalWords.map(w => ({...w,x:(w.x-offsetX)/scaleX,y:(w.y-offsetY)/scaleY}));
  function cropAt(x,y,width,height) {
    const crop = {left:Math.round((offsetX+x*scaleX)*meta.width),top:Math.round((offsetY+(y-height/2)*scaleY)*meta.height),width:Math.round(width*scaleX*meta.width),height:Math.round(height*scaleY*meta.height)};
    if (crop.left<0 || crop.top<0 || crop.width<1 || crop.height<1 || crop.left+crop.width>meta.width || crop.top+crop.height>meta.height) return null;
    return crop;
  }
  const nameHeader = located.find(w => /^NAME$/i.test(w.text) && w.x > .33 && w.x < .46 && w.y > .18 && w.y < .24);
  const total = located.find(w => /^total$/i.test(w.text) && w.x > .33 && w.x < .46 && w.y > .65);
  // A scrolled table can push the Total row off screen; rows then end at the bottom of the table panel.
  const tableBottom = total ? total.y - .02 : .885;
  let headerWords = located.filter(w=>w.y>.18&&w.y<.24&&w.x>.46);
  let scoreLabels=located.filter(w=>w.x<.33&&w.y>.49&&w.y<.54&&/^(1ST|2ND|3RD|4TH|TOTAL)$/i.test(w.text));
  // Whole-image OCR can lose yellow quarter labels amid logos. Read the labels separately.
  const scoreLabelCrop = cropAt(.04,.512,.25,.042);
  if (scoreLabels.length < 3 && scoreLabelCrop) {
    const strip = await pixels().extract(scoreLabelCrop).resize({width:1200}).greyscale().normalise().png().toBuffer();
    await setParams({tessedit_pageseg_mode:'7',tessedit_char_whitelist:''});
    const focused = (await recognize(strip,{}, {text:true,tsv:true})).data;
    scoreLabels = words(focused.tsv).filter(w=>/^(1ST|2ND|3RD|4TH|TOTAL)$/i.test(w.text));
  }
  const statHeaders=new Set(headerWords.map(w=>w.text.toUpperCase().replace(/[^A-Z0-9]/g,'')));
  const recognizedHeaders=COLUMNS.filter(([key])=>statHeaders.has(key)).length;
  if (!nameHeader || recognizedHeaders < 8) throw Object.assign(new Error('Could not reliably locate the box-score table. The original images are saved; review them or retry extraction with a clear photo or screenshot.'),{ocrRaw:full});
  const raw = {mediaId:image.mediaId,layout,perspectiveCorrected:Boolean(rectified),fullText:full.text,tsv:full.tsv,cells:[]};
  const uncertainFields=[];
  async function cell(x,y,width,height,path,numeric=false,alternative=null) {
    const crop=cropAt(x,y,width,height);
    if (!crop) {
      raw.cells.push({path,crop:null,text:null,confidence:0,readings:[]});
      uncertainFields.push({path,reason:'This field is outside the crop. Enter it from supporting evidence before approval.',confidence:'LOW'});
      return null;
    }
    await setParams({tessedit_pageseg_mode:'7',tessedit_char_whitelist:numeric ? (path.endsWith('.MIN') ? '0123456789-:DNP' : '0123456789-:') : ''});
    const readings=alternative ? [{...alternative,height:null}] : [];
    for (const height of numeric ? [40,60,100,160] : [60,100]) {
      const cropBegan=Date.now();const buffer=await pixels().extract(crop).resize({height}).png().toBuffer();cropMs+=Date.now()-cropBegan;
      const data=(await recognize(buffer,{}, {text:true})).data;
      readings.push({text:data.text.trim(),confidence:data.confidence,height});
      const confident = readings.filter(r => r.confidence >= 96 && r.text);
      const valid = numeric ? (path.endsWith('.FG') || path.endsWith('.3PT') || path.endsWith('.FT') ? /^\d+-\d+$/.test(data.text.trim()) : /^(?:\d+(?::\d{2})?|DNP)$/.test(data.text.trim())) : !!data.text.trim();
      if (valid && ((confident.length >= 2 && new Set(confident.map(r => numeric ? r.text : normalizeText(r.text))).size === 1) || (numeric && data.confidence >= 93 && !path.startsWith('scoreboard.')))) break;
    }
    if (numeric && !path.startsWith('scoreboard.') && !/\.(FG|3PT|FT)$/.test(path) && readings.some(r=>r.text==='1')) {
      const padded=await pixels().extract(crop).resize({height:100}).extend({top:20,bottom:20,left:60,right:60,extendWith:'copy'}).png().toBuffer();
      await setParams({tessedit_pageseg_mode:'8',tessedit_char_whitelist:'0123456789-:'});
      const data=(await recognize(padded,{}, {text:true})).data;
      await setParams({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789-:'});
      readings.push({text:data.text.trim(),confidence:data.confidence,height:100,preprocessing:'padded'});
    }
    if (Math.max(...readings.map(r=>r.confidence)) < 80) {
      const source=await pixels().extract(crop).greyscale().normalise().png().toBuffer();
      const {channels}=await sharp(source).stats();
      const background=channels[0].mean>130?'white':'black';
      const processed=await sharp(source).resize({height:100}).extend({top:20,bottom:20,left:20,right:20,background}).png().toBuffer();
      const data=(await recognize(processed,{}, {text:true})).data;
      readings.push({text:data.text.trim(),confidence:data.confidence,height:100,preprocessing:'grayscale-normalize-padding'});
    }
    if (numeric && !readings.some(r=>r.text && r.confidence>=70)) {
      const candidates=located.filter(w=>w.x>=x && w.x<=x+width && Math.abs(w.y-y)<height/2 && /^(?:\d+(?:[-:]\d+)?|DNP)$/.test(w.text) && w.confidence>=70);
      if(candidates.length===1) readings.push({text:candidates[0].text,confidence:candidates[0].confidence,height:null,preprocessing:'full-image-cell-recovery'});
    }
    const syntactic = text => !numeric || (path.endsWith('.FG') || path.endsWith('.3PT') || path.endsWith('.FT') ? /^\d+-\d+$/.test(text) : /^(?:\d+(?::\d{2})?|DNP)$/.test(text));
    const usable = readings.filter(r => r.text && syntactic(r.text));
    const ranked=(usable.length ? usable : readings.filter(r=>r.text)).sort((a,b)=>b.confidence-a.confidence);
    // Narrow repeated digits can merge at small sizes. Prefer the larger equally confident scoreboard reading, and retain the disagreement for review.
    const best=(path.startsWith('scoreboard.') ? ranked.filter(r=>r.confidence>=80 && r.confidence>=ranked[0].confidence-5).sort((a,b)=>(b.height||0)-(a.height||0))[0] : null) || ranked[0] || {text:'',confidence:0};
    const value=best.text;
    raw.cells.push({path,crop,text:value,confidence:best.confidence,readings});
    const disagreement=new Set(readings.filter(r=>r.confidence>=(path.startsWith('scoreboard.')?80:rectified?80:90)).map(r=>numeric?r.text:normalizeText(r.text))).size>1;
    if (!value || best.confidence < 70 || disagreement) uncertainFields.push({path,reason:disagreement?'OCR readings disagree.':!value?'Cell could not be read.':`OCR confidence ${best.confidence.toFixed(1)}%.`,confidence:'LOW'});
    return value || null;
  }
  const scoreAnchor=['1ST','2ND','3RD','4TH','TOTAL'].map(k=>scoreLabels.find(w=>w.text.toUpperCase()===k));
  const labelY=scoreLabels.length>=3?scoreLabels.reduce((n,w)=>n+w.y,0)/scoreLabels.length:null;
  const labelShifts=scoreAnchor.map((w,i)=>w&&w.x-(.0645+i*.0493)).filter(v=>v!==null&&v!==undefined&&Math.abs(v)<.03).sort((a,b)=>a-b);
  const scoreShiftX=labelShifts.length>=2?labelShifts[Math.floor(labelShifts.length/2)]:0;
  const rowOffsetY=labelY!==null&&Math.abs(labelY-.512)<.05?labelY-.512:0;
  const scoreboard=[];
  const scoreboardVisible = scoreLabels.length >= 3 && Boolean(scoreLabelCrop);
  for (let side=0;side<2;side++) {
    const teamName=scoreboardVisible ? await cell(.045, (side===0 ? .122:.621)+rowOffsetY,.28,.035,`scoreboard.${side}.teamName`) : null;
    const scores=[];
    for (let i=0;i<5;i++) scores.push(scoreboardVisible ? await cell(scoreShiftX+.043+i*.0493,(side===0 ? .473:.549)+rowOffsetY,.043,.035,`scoreboard.${side}.scores.${i}`,true) : null);
    scoreboard.push({teamName,finalScore:scores[4],periods:scores.slice(0,4).map((score,i)=>({label:`Q${i+1}`,score}))});
  }
  if (!scoreboardVisible) uncertainFields.push({path:'scoreboard',reason:'The scoreboard is cropped out or unreadable. Supply team identities, period scores and final scores before approval.',confidence:'LOW'});
  let tableTeamName;
  const tabWords=rectified && located.filter(w=>w.x>.33&&w.x<.48&&w.y<nameHeader.y-.02&&w.y>nameHeader.y-.13&&/^[A-Za-z][A-Za-z '-]*$/.test(w.text));
  if(tabWords?.length){
    const nearest=tabWords.reduce((a,b)=>a.y>b.y?a:b);
    const line=tabWords.filter(w=>Math.abs(w.y-nearest.y)<.012).sort((a,b)=>a.x-b.x);
    tableTeamName=line.map(w=>w.text).join(' ');
    raw.cells.push({path:'tableTeamName',text:tableTeamName,confidence:Math.min(...line.map(w=>w.confidence)),readings:line});
  }else tableTeamName=await cell(.385,.124,.18,.028,'tableTeamName');
  if(rectified) uncertainFields.push({path:'perspective',reason:'Camera perspective was corrected. Verify the transformed table against the original photo before approval.',confidence:'LOW'});
  const rowWords=located.filter(w => w.x>.333 && w.x<.46 && w.y>nameHeader.y+.022 && w.y<tableBottom && /[a-z]/i.test(w.text));
  const rows=[];
  for (const word of rowWords.sort((a,b)=>a.y-b.y)) if (!rows.some(y=>Math.abs(y-word.y)<.013)) rows.push(word.y);
  if (!rows.length || rows.length>18) throw new Error('Player rows could not be located reliably.');
  // Camera tilt makes row baselines drift across the table. Fit that drift from every recognised stat-area number and heading.
  const rowKeys=[nameHeader.y,...rows,...(total?[total.y]:[])];
  const tiltPoints=located.filter(w=>w.x>.46&&w.x<.97&&w.y>nameHeader.y-.02&&w.y<(total?total.y:tableBottom)+.03&&(/^(?:\d+(?:[-:]\d+)?|MIN|PTS|REB|AST|STL|BLK|TO|FG|3PT|FT|OR|FLS)$/i.test(w.text))&&w.confidence>=60);
  let tilt=[0,0];
  for(let pass=0;pass<3;pass++){
    const sample=[];
    for(const w of tiltPoints){
      const dx=w.x-.4;
      const predicted=r=>r+(tilt[0]+tilt[1]*(r-nameHeader.y))*dx;
      const row=rowKeys.reduce((a,b)=>Math.abs(predicted(b)-w.y)<Math.abs(predicted(a)-w.y)?b:a);
      const err=w.y-predicted(row);
      if(Math.abs(err)<.014)sample.push({dx,rel:row-nameHeader.y,dy:w.y-row});
    }
    if(sample.length<12)break;
    // Least squares for dy = (a + b*rel) * dx
    let s11=0,s12=0,s22=0,t1=0,t2=0;
    for(const q of sample){const u=q.dx,v=q.dx*q.rel;s11+=u*u;s12+=u*v;s22+=v*v;t1+=u*q.dy;t2+=v*q.dy;}
    const det=s11*s22-s12*s12;
    if(Math.abs(det)<1e-12)break;
    tilt=[(t1*s22-t2*s12)/det,(s11*t2-s12*t1)/det];
  }
  if(!tilt.every(Number.isFinite)||Math.abs(tilt[0])>.1||Math.abs(tilt[1])>.2)tilt=[0,0];
  // Columns also lean with the camera angle: fit horizontal drift against distance below the header.
  let lean=0;
  {
    const centers=COLUMNS.map(([,x,width])=>x+width/2);
    let num=0,den=0;
    for(const w of tiltPoints){
      if(!/^\d/.test(w.text))continue;
      const rel=w.y-nameHeader.y;if(rel<.05)continue;
      const err=centers.map(c=>w.x-c).reduce((a,b)=>Math.abs(a)<Math.abs(b)?a:b);
      if(Math.abs(err)<.012){num+=err*rel;den+=rel*rel;}
    }
    if(den>0&&Number.isFinite(num/den)&&Math.abs(num/den)<.1)lean=num/den;
  }
  const leanAt=y=>lean*(y-nameHeader.y);
  const shiftAt=(x,y)=>(tilt[0]+tilt[1]*(y-nameHeader.y))*(x-.4);
  const players=[];
  async function stats(y,prefix,minValue) {
    const result={};
    for(const [key,x,width] of COLUMNS) result[key]=key==='MIN' && minValue!==undefined ? minValue : await cell(x+leanAt(y),y+shiftAt(x+width/2,y),width,.032,`${prefix}.${key}`,true);
    return result;
  }
  for(let i=0;i<rows.length;i++) {
    const y=rows[i], path=`players.${i}`;
    const nameWords=rowWords.filter(w=>Math.abs(w.y-y)<.013).sort((a,b)=>a.x-b.x);
    const displayedName=await cell(.34,y,.119,.032,`${path}.displayedName`,false,{text:nameWords.map(w=>w.text).join(' '),confidence:Math.min(...nameWords.map(w=>w.confidence))});
    const min=await cell(.469+leanAt(y),y+shiftAt(.487,y),.036,.032,`${path}.stats.MIN`,true);
    const dnp=min==='DNP';
    const rowStats=dnp ? Object.fromEntries(COLUMNS.map(([k])=>[k,null])) : await stats(y,`${path}.stats`,min);
    players.push({displayedName,dnp,stats:rowStats,confidence:uncertainFields.some(f=>f.path===`${path}.displayedName`)?'LOW':'HIGH'});
  }
  let totals;
  if (total) totals = await stats(total.y,'totals');
  else {
    // Sum the visible rows; a hidden player then shows up as a mismatch against the scoreboard score.
    const played = players.filter(p => !p.dnp), sum = key => played.some(p => p.stats[key] == null) ? null : String(played.reduce((n,p) => n + Number(p.stats[key]), 0));
    const pairs = key => { if (played.some(p => !/^\d+-\d+$/.test(p.stats[key] || ''))) return null; const t = played.reduce((a,p) => { const [m,x] = p.stats[key].split('-').map(Number); return [a[0]+m,a[1]+x]; }, [0,0]); return `${t[0]}-${t[1]}`; };
    totals = Object.fromEntries(COLUMNS.map(([key]) => [key, ['FG','3PT','FT'].includes(key) ? pairs(key) : sum(key)]));
    uncertainFields.push({path:'totals',reason:'The Total row is not visible in this screenshot, so team totals were added up from the player rows. Confirm no player is cut off below the list.',confidence:'LOW'});
  }
  // Narrow repeated digits ("11") are often read as one digit; accept the repair only when it makes minutes add up to the Total row.
  {
    const played=players.filter(p=>!p.dnp&&/^\d+$/.test(p.stats.MIN||'')),want=Number(totals?.MIN);
    const gap=want-played.reduce((n,p)=>n+Number(p.stats.MIN),0);
    const ones=played.filter(p=>p.stats.MIN==='1');
    if(Number.isFinite(want)&&gap>0&&gap%10===0&&ones.length>=gap/10){
      const pick=ones.slice(0,gap/10);
      if(ones.length===gap/10)for(const p of pick){p.stats.MIN='11';uncertainFields.push({path:`players.${players.indexOf(p)}.stats.MIN`,reason:'Minutes were repaired from 1 to 11 so the team adds up to the Total row.',confidence:'LOW'});}
    }
  }
  // This template is deliberately four-period only: overtime layout changes must be reviewed.
  if (located.some(w => /^(OT|OT1|OT2)$/i.test(w.text))) uncertainFields.push({path:'scoreboard',reason:'Overtime layout needs review; this OCR template supports regulation screens.',confidence:'LOW'});
  console.log(`OCR screenshot done: ${recognitionCalls} reads in ${Math.round((Date.now() - startedAt) / 1000)}s, slowest ${slowest}ms, in recognize ${Math.round(recognizeMs/1000)}s, setParameters ${Math.round(paramMs/1000)}s, crops ${Math.round(cropMs/1000)}s, rss ${Math.round(process.memoryUsage().rss/1048576)}MB, cgroup ${cgroupStats(cgroupBefore)}`);
  raw.recognitionCalls = recognitionCalls;
  return {raw,screen:{mediaId:image.mediaId,confidence:'HIGH',scoreboard,tableTeamName,players,totals,uncertainFields}};
}
// Both box scores and contracts share this bounded worker queue and offline language data.
function withOcrWorker(work, { timeoutMs = 300000 } = {}) {
  if (queued >= 8) return Promise.reject(new Error('The screenshot processor is busy. Retry shortly.'));
  queued++;
  const job = queue.catch(() => {}).then(async () => {
    let worker, timer;
    try {
      worker = await createWorker('eng', 1, { langPath: english.langPath, gzip: true, cacheMethod: 'none' });
      return await Promise.race([work(worker), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('OCR processing timed out. Retry with a clear screenshot.')), timeoutMs); })]);
    } finally { clearTimeout(timer); if (worker) { worker.aborted = true; await worker.terminate().catch(() => {}); } }
  });
  queue = job;
  return job.finally(() => { queued--; });
}
function createTesseractProvider() {
  return { name: 'tesseract', model: 'tesseract.js-eng-association-v2', extract(images) {
    const raw = [], screens = [], startedAt = Date.now();
    return withOcrWorker(async worker => {
      // Each screenshot gets its own worker so the two reads run in parallel on separate cores.
      const extra = [], parallel = cpuBudget() >= 2.5;
      try {
        const results = parallel ? await Promise.all(images.map(async (image, index) => {
          if (index === 0) return readScreenshot(worker, image);
          const second = await createWorker('eng', 1, { langPath: english.langPath, gzip: true, cacheMethod: 'none' });
          extra.push(second);
          return readScreenshot(second, image);
        })) : await images.reduce(async (done, image) => [...await done, await readScreenshot(worker, image)], Promise.resolve([]));
        for (const result of results) { raw.push(result.raw); screens.push(result.screen); }
        screens.splice(0,screens.length,...mergeSplitTables(screens));
      } finally { await Promise.all(extra.map(w => { w.aborted = true; return w.terminate().catch(() => {}); })); }
      return { raw: JSON.stringify({ engine: 'tesseract', durationMs: Date.now() - startedAt, screenshots: raw, parsed: { screenshots: screens } }) };
    }).catch(error => { if (error.ocrRaw) raw.push(error.ocrRaw); return { raw: JSON.stringify({ engine: 'tesseract', screenshots: raw, error: error.message }), error: error.message }; });
  }, parse(result) { if (result.error) throw new Error(result.error); return JSON.parse(result.raw).parsed; } };
}
// A cropped table can need two photos (top rows plus the Total row). Merge photos of the same team into one table.
function mergeSplitTables(screens) {
  const key = s => normalizeText(s.tableTeamName || '');
  const merged = [];
  for (const screen of screens) {
    const lacksTotal = s => s.uncertainFields.some(f => f.path === 'totals');
    // Only a photo that is missing its Total row is a partial view; two complete photos of one team are left for review.
    const target = key(screen) && merged.find(m => key(m) === key(screen) && (lacksTotal(m) || lacksTotal(screen)));
    if (!target) { merged.push({ ...screen, mediaIds: [screen.mediaId] }); continue; }
    target.mediaIds.push(screen.mediaId);
    const known = new Set(target.players.map(p => normalizeText(p.displayedName || '')));
    // The same row photographed twice may be spelled differently; an identical stat line is the same row.
    const statKey = p => p.dnp ? 'DNP' : JSON.stringify(p.stats);
    const seenStats = new Set(target.players.map(statKey));
    const isNew = p => !known.has(normalizeText(p.displayedName || '')) && !(p.dnp ? false : seenStats.has(statKey(p)));
    const lead = screen.players.findIndex(p => normalizeText(p.displayedName || '') === normalizeText(target.players[0]?.displayedName || ''));
    // A photo showing earlier rows than the first one supplies the missing top of the list.
    if (lead > 0) { const head = screen.players.slice(0, lead).filter(isNew); head.forEach(p => known.add(normalizeText(p.displayedName || ''))); target.players.unshift(...head); }
    for (const player of screen.players) {
      if (!isNew(player)) continue;
      known.add(normalizeText(player.displayedName || ''));
      target.players.push(player);
    }
    // Keep the real Total row, and the fuller scoreboard.
    const hasTotal = t => t && !target.uncertainFields.some(f => f.path === 'totals');
    if (!hasTotal(target.totals) && !screen.uncertainFields.some(f => f.path === 'totals')) {
      target.totals = screen.totals;
      target.uncertainFields = target.uncertainFields.filter(f => f.path !== 'totals');
    }
    if (screen.scoreboard.filter(b => b.teamName).length > target.scoreboard.filter(b => b.teamName).length) target.scoreboard = screen.scoreboard;
    target.uncertainFields.push({ path: 'players', reason: 'This table was assembled from two photos. Confirm the player order and that nobody is missing.', confidence: 'LOW' });
  }
  return merged;
}
module.exports = { mergeSplitTables, createTesseractProvider, readScreenshot, detectLayout, withOcrWorker };
