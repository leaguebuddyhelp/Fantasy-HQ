const sharp = require('sharp');
const {normalizeText}=require('../service-helpers');
const { createWorker } = require('tesseract.js');
const english = require('@tesseract.js-data/eng');
// Bound concurrency across every league so bursts don't start a worker per game.
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
    if (scaleX < .2 || scaleX > 1.5 || scaleY < .15 || scaleY > 1.5) continue;
    // Preserve the established screenshot crops when anchors already match the template.
    if (Math.abs(scaleX - 1) < .025 && Math.abs(scaleY - 1) < .025 && Math.abs(offsetX) < .012 && Math.abs(offsetY) < .012) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
    return { scaleX, scaleY, offsetX, offsetY };
  }
  return null;
}
async function readScreenshot(worker, suppliedImage) {
  let recognitionCalls = 0;
  const recognize = (...args) => { recognitionCalls++; return worker.recognize(...args); };
  // Apply EXIF orientation and decode camera formats before inspecting coordinates.
  const sourceMeta = await sharp(suppliedImage.bytes,{limitInputPixels:60000000}).metadata();
  if (sourceMeta.format === 'heif') suppliedImage = {...suppliedImage,bytes:await require('../offseason-image').normalize(suppliedImage.bytes)};
  const image = { ...suppliedImage, bytes: sourceMeta.orientation && sourceMeta.orientation !== 1 ? await sharp(suppliedImage.bytes,{limitInputPixels:40000000}).rotate().png().toBuffer() : suppliedImage.bytes };
  let meta = await sharp(image.bytes).metadata();
  await worker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
  let full = (await recognize(image.bytes,{}, {text:true,tsv:true})).data;
  let originalWords = words(full.tsv).map(w => ({...w,x:w.x/meta.width,y:w.y/meta.height}));
  // Deskew modest camera tilt using independently recognized table headings.
  const minHeader = originalWords.find(w => /^MIN$/i.test(w.text));
  const flsHeader = minHeader && originalWords.find(w => /^FLS$/i.test(w.text) && w.x > minHeader.x + .15 && Math.abs(w.y-minHeader.y)<.1);
  if (flsHeader) {
    const slope=(flsHeader.y-minHeader.y)*meta.height/((flsHeader.x-minHeader.x)*meta.width);
    const angle=Math.atan(slope)*180/Math.PI;
    const sameLine=originalWords.some(w=>/^NAME$/i.test(w.text) && w.x<minHeader.x && Math.abs(w.y-(minHeader.y+slope*(w.x-minHeader.x)*meta.width/meta.height))<.015);
    if (sameLine && Math.abs(angle)>.4 && Math.abs(angle)<=8) {
      image.bytes=await sharp(image.bytes).rotate(-angle,{background:'#202329'}).png().toBuffer();
      meta=await sharp(image.bytes).metadata();
      full=(await recognize(image.bytes,{}, {text:true,tsv:true})).data;
      originalWords=words(full.tsv).map(w=>({...w,x:w.x/meta.width,y:w.y/meta.height}));
    }
  }
  const layout = detectLayout(originalWords, meta);
  if (!layout) throw Object.assign(new Error('Could not locate a complete Association box-score table in this image. Include the entire screen with readable player names and stats; photos and screenshots are supported.'),{ocrRaw:full});
  const {scaleX,scaleY,offsetX,offsetY} = layout;
  const located = originalWords.map(w => ({...w,x:(w.x-offsetX)/scaleX,y:(w.y-offsetY)/scaleY}));
  function cropAt(x,y,width,height) {
    const crop = {left:Math.round((offsetX+x*scaleX)*meta.width),top:Math.round((offsetY+(y-height/2)*scaleY)*meta.height),width:Math.round(width*scaleX*meta.width),height:Math.round(height*scaleY*meta.height)};
    if (crop.left<0 || crop.top<0 || crop.width<1 || crop.height<1 || crop.left+crop.width>meta.width || crop.top+crop.height>meta.height) throw new Error('Part of the box score is outside the image. Include the entire screen in your photo.');
    return crop;
  }
  const nameHeader = located.find(w => /^NAME$/i.test(w.text) && w.x > .33 && w.x < .46 && w.y > .18 && w.y < .24);
  const total = located.find(w => /^total$/i.test(w.text) && w.x > .33 && w.x < .46 && w.y > .65);
  let headerWords = located.filter(w=>w.y>.18&&w.y<.24&&w.x>.46);
  let scoreLabels=located.filter(w=>w.x<.33&&w.y>.49&&w.y<.54&&/^(1ST|2ND|3RD|4TH|TOTAL)$/i.test(w.text));
  // Whole-image OCR can lose yellow quarter labels amid logos. Read the labels separately.
  if (scoreLabels.length < 3) {
    const strip = await sharp(image.bytes).extract(cropAt(.04,.512,.25,.042)).resize({width:1200}).greyscale().normalise().png().toBuffer();
    await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:''});
    const focused = (await recognize(strip,{}, {text:true,tsv:true})).data;
    scoreLabels = words(focused.tsv).filter(w=>/^(1ST|2ND|3RD|4TH|TOTAL)$/i.test(w.text));
  }
  const statHeaders=new Set(headerWords.map(w=>w.text.toUpperCase().replace(/[^A-Z0-9]/g,'')));
  const recognizedHeaders=COLUMNS.filter(([key])=>statHeaders.has(key)).length;
  if (!nameHeader || !total || recognizedHeaders < 8 || scoreLabels.length < 3) throw Object.assign(new Error('Could not reliably locate the box-score table. The original images are saved; review them or retry extraction with a clear photo or screenshot.'),{ocrRaw:full});
  const raw = {mediaId:image.mediaId,layout,fullText:full.text,tsv:full.tsv,cells:[]};
  const uncertainFields=[];
  async function cell(x,y,width,height,path,numeric=false,alternative=null) {
    const crop=cropAt(x,y,width,height);
    await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:numeric ? (path.endsWith('.MIN') ? '0123456789-:DNP' : '0123456789-:') : ''});
    const readings=alternative ? [{...alternative,height:null}] : [];
    for (const height of numeric ? [40,60,100,160] : [60,100]) {
      const buffer=await sharp(image.bytes).extract(crop).resize({height}).png().toBuffer();
      const data=(await recognize(buffer,{}, {text:true})).data;
      readings.push({text:data.text.trim(),confidence:data.confidence,height});
      const confident = readings.filter(r => r.confidence >= 96 && r.text);
      const valid = numeric ? (path.endsWith('.FG') || path.endsWith('.3PT') || path.endsWith('.FT') ? /^\d+-\d+$/.test(data.text.trim()) : /^(?:\d+(?::\d{2})?|DNP)$/.test(data.text.trim())) : !!data.text.trim();
      if (valid && confident.length >= 2 && new Set(confident.map(r => numeric ? r.text : normalizeText(r.text))).size === 1) break;
    }
    if (Math.max(...readings.map(r=>r.confidence)) < 80) {
      const source=await sharp(image.bytes).extract(crop).greyscale().normalise().png().toBuffer();
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
    const disagreement=new Set(readings.filter(r=>r.confidence>=(path.startsWith('scoreboard.')?80:90)).map(r=>numeric?r.text:normalizeText(r.text))).size>1;
    if (!value || best.confidence < 70 || disagreement) uncertainFields.push({path,reason:disagreement?'OCR readings disagree.':!value?'Cell could not be read.':`OCR confidence ${best.confidence.toFixed(1)}%.`,confidence:'LOW'});
    return value || null;
  }
  const scoreboard=[];
  for (let side=0;side<2;side++) {
    const teamName=await cell(.045, side===0 ? .122:.621,.28,.035,`scoreboard.${side}.teamName`);
    const scores=[];
    for (let i=0;i<5;i++) scores.push(await cell(.043+i*.0493,side===0 ? .473:.549,.043,.035,`scoreboard.${side}.scores.${i}`,true));
    scoreboard.push({teamName,finalScore:scores[4],periods:scores.slice(0,4).map((score,i)=>({label:`Q${i+1}`,score}))});
  }
  const tableTeamName=await cell(.385,.124,.18,.028,'tableTeamName');
  const rowWords=located.filter(w => w.x>.333 && w.x<.46 && w.y>nameHeader.y+.022 && w.y<total.y-.02 && /[a-z]/i.test(w.text));
  const rows=[];
  for (const word of rowWords.sort((a,b)=>a.y-b.y)) if (!rows.some(y=>Math.abs(y-word.y)<.013)) rows.push(word.y);
  if (!rows.length || rows.length>18) throw new Error('Player rows could not be located reliably.');
  const players=[];
  async function stats(y,prefix,minValue) {
    const result={};
    for(const [key,x,width] of COLUMNS) result[key]=key==='MIN' && minValue!==undefined ? minValue : await cell(x,y,width,.032,`${prefix}.${key}`,true);
    return result;
  }
  for(let i=0;i<rows.length;i++) {
    const y=rows[i], path=`players.${i}`;
    const nameWords=rowWords.filter(w=>Math.abs(w.y-y)<.013).sort((a,b)=>a.x-b.x);
    const displayedName=await cell(.34,y,.119,.032,`${path}.displayedName`,false,{text:nameWords.map(w=>w.text).join(' '),confidence:Math.min(...nameWords.map(w=>w.confidence))});
    const min=await cell(.469,y,.036,.032,`${path}.stats.MIN`,true);
    const dnp=min==='DNP';
    const rowStats=dnp ? Object.fromEntries(COLUMNS.map(([k])=>[k,null])) : await stats(y,`${path}.stats`,min);
    players.push({displayedName,dnp,stats:rowStats,confidence:uncertainFields.some(f=>f.path===`${path}.displayedName`)?'LOW':'HIGH'});
  }
  const totals=await stats(total.y,'totals');
  // This template is deliberately four-period only: overtime layout changes must be reviewed.
  if (located.some(w => /^(OT|OT1|OT2)$/i.test(w.text))) uncertainFields.push({path:'scoreboard',reason:'Overtime layout needs review; this OCR template supports regulation screens.',confidence:'LOW'});
  raw.recognitionCalls = recognitionCalls;
  return {raw,screen:{mediaId:image.mediaId,confidence:'HIGH',scoreboard,tableTeamName,players,totals,uncertainFields}};
}
// Both box scores and contracts share this bounded worker queue and offline language data.
function withOcrWorker(work) {
  if (queued >= 8) return Promise.reject(new Error('The screenshot processor is busy. Retry shortly.'));
  queued++;
  const job = queue.catch(() => {}).then(async () => {
    let worker, timer;
    try {
      worker = await createWorker('eng', 1, { langPath: english.langPath, gzip: true, cacheMethod: 'none' });
      return await Promise.race([work(worker), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('OCR processing timed out. Retry with a clear screenshot.')), 180000); })]);
    } finally { clearTimeout(timer); if (worker) await worker.terminate(); }
  });
  queue = job;
  return job.finally(() => { queued--; });
}
function createTesseractProvider() {
  return { name: 'tesseract', model: 'tesseract.js-eng-association-v2', extract(images) {
    const raw = [], screens = [], startedAt = Date.now();
    return withOcrWorker(async worker => {
      for (const image of images) { const result = await readScreenshot(worker, image); raw.push(result.raw); screens.push(result.screen); }
      return { raw: JSON.stringify({ engine: 'tesseract', durationMs: Date.now() - startedAt, screenshots: raw, parsed: { screenshots: screens } }) };
    }).catch(error => { if (error.ocrRaw) raw.push(error.ocrRaw); return { raw: JSON.stringify({ engine: 'tesseract', screenshots: raw, error: error.message }), error: error.message }; });
  }, parse(result) { if (result.error) throw new Error(result.error); return JSON.parse(result.raw).parsed; } };
}
function recognizeContractText(bytes) {
  return withOcrWorker(async worker => {
    let oriented = await require('../offseason-image').normalize(bytes);
    await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
    async function inspect() {
      const result = (await worker.recognize(oriented, {}, {text:true,tsv:true})).data;
      const meta = await sharp(oriented).metadata();
      const found = words(result.tsv);
      const salary = found.filter(w=>/^Salary$/i.test(w.text)&&w.x>meta.width*.5).find(w=>found.some(y=>/^Years$/i.test(y.text)&&y.y>w.y&&y.y-w.y<meta.height*.15));
      const years = salary && found.find(w=>/^Years$/i.test(w.text)&&w.y>salary.y&&w.y-salary.y<meta.height*.15);
      const option = years && found.find(w=>/^Option$/i.test(w.text)&&w.y>years.y&&w.y-years.y<meta.height*.25);
      return {text:result.text,meta,salary,years,option};
    }
    let layout = await inspect();
    if (!layout.salary || !layout.years) return layout.text;
    const anchor=layout.option||layout.years;
    const angle = Math.atan2(anchor.left-layout.salary.left,anchor.y-layout.salary.y)*180/Math.PI;
    if (Math.abs(angle)>.5 && Math.abs(angle)<10) {oriented=await sharp(oriented).rotate(angle,{background:'#202329'}).png().toBuffer();layout=await inspect();}
    if (!layout.salary || !layout.years) return layout.text;
    const spacing=layout.years.y-layout.salary.y, screenHeight=spacing/.064, screenWidth=screenHeight*16/9;
    const fields=[];
    await worker.setParameters({tessedit_pageseg_mode:'7'});
    for (const [label,index] of [['Salary',0],['Years',1],['Contract Type',2],['Option',3]]) {
      const height=Math.round(screenHeight*(label==='Years'?.030:.039));
      const crop={left:Math.round(layout.salary.left+screenWidth*.184),top:Math.round(layout.salary.y+spacing*index-height/2),width:Math.round(screenWidth*.148),height};
      if(crop.left<0||crop.top<0||crop.left+crop.width>layout.meta.width||crop.top+crop.height>layout.meta.height)return layout.text;
      let cell=sharp(oriented).extract(crop).resize({width:750}).grayscale();
      if(label==='Years'){const stats=await sharp(await cell.png().toBuffer()).stats();if(stats.channels[0].mean<128)cell=cell.negate();cell=cell.normalize().threshold(150);}else cell=cell.normalize();
      await worker.setParameters({tessedit_char_whitelist:label==='Years'?'0123456789+':''});
      fields.push(label+': '+(await worker.recognize(await cell.png().toBuffer(),{},{text:true})).data.text.trim());
    }
    return fields.join('\n');
  });
}

module.exports = { createTesseractProvider, readScreenshot, detectLayout, recognizeContractText, withOcrWorker };
