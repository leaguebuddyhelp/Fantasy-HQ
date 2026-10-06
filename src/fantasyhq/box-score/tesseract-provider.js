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
    text:c.slice(11).join('\t'), x:(+c[6]+ +c[8]/2), y:(+c[7]+ +c[9]/2), confidence:+c[10],
  }));
}
async function readScreenshot(worker, image) {
  const meta = await sharp(image.bytes,{limitInputPixels:40000000}).metadata();
  if (Math.abs(meta.width/meta.height - 16/9) > .06) throw new Error('Upload a full, uncropped 16:9 Association Box Score screenshot.');
  await worker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
  const full = (await worker.recognize(image.bytes,{}, {text:true,tsv:true})).data;
  const located = words(full.tsv).map(w => ({...w,x:w.x/meta.width,y:w.y/meta.height}));
  const nameHeader = located.find(w => w.text === 'NAME' && w.x > .33 && w.x < .46 && w.y > .18 && w.y < .24);
  const total = located.find(w => /^total$/i.test(w.text) && w.x > .33 && w.x < .46 && w.y > .65);
  // Red 'Association' text is often dropped by OCR even on clear full-size captures.
  // Recognize the table by independently located stat headers and quarter-score labels instead.
  const statHeaders=new Set(located.filter(w=>w.y>.18&&w.y<.24&&w.x>.46).map(w=>w.text.toUpperCase().replace(/[^A-Z0-9]/g,'')));
  const recognizedHeaders=COLUMNS.filter(([key])=>statHeaders.has(key)).length;
  const scoreLabels=located.filter(w=>w.x<.33&&w.y>.49&&w.y<.54&&/^(1ST|2ND|3RD|4TH|TOTAL)$/i.test(w.text));
  if (!nameHeader || !total || recognizedHeaders < 8 || scoreLabels.length < 3) throw Object.assign(new Error('Could not reliably locate the box-score table. The original images are saved; review them or retry extraction.'),{ocrRaw:full});
  const raw = {mediaId:image.mediaId,fullText:full.text,tsv:full.tsv,cells:[]};
  const uncertainFields=[];
  async function cell(x,y,width,height,path,numeric=false,alternative=null) {
    const crop={left:Math.round(x*meta.width),top:Math.round((y-height/2)*meta.height),width:Math.round(width*meta.width),height:Math.round(height*meta.height)};
    await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:numeric ? (path.endsWith('.MIN') ? '0123456789-:DNP' : '0123456789-:') : ''});
    const readings=alternative ? [{...alternative,height:null}] : [];
    for (const height of numeric ? [40,60,100,160] : [60,100]) {
      const buffer=await sharp(image.bytes).extract(crop).resize({height}).png().toBuffer();
      const data=(await worker.recognize(buffer,{}, {text:true})).data;
      readings.push({text:data.text.trim(),confidence:data.confidence,height});
    }
    if (Math.max(...readings.map(r=>r.confidence)) < 80) {
      const source=await sharp(image.bytes).extract(crop).greyscale().normalise().png().toBuffer();
      const {channels}=await sharp(source).stats();
      const background=channels[0].mean>130?'white':'black';
      const processed=await sharp(source).resize({height:100}).extend({top:20,bottom:20,left:20,right:20,background}).png().toBuffer();
      const data=(await worker.recognize(processed,{}, {text:true})).data;
      readings.push({text:data.text.trim(),confidence:data.confidence,height:100,preprocessing:'grayscale-normalize-padding'});
    }
    const best=readings.filter(r=>r.text).sort((a,b)=>b.confidence-a.confidence)[0] || {text:'',confidence:0};
    const value=best.text;
    raw.cells.push({path,crop,text:value,confidence:best.confidence,readings});
    const disagreement=new Set(readings.filter(r=>r.confidence>=90).map(r=>numeric?r.text:normalizeText(r.text))).size>1;
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
  return {raw,screen:{mediaId:image.mediaId,confidence:'HIGH',scoreboard,tableTeamName,players,totals,uncertainFields}};
}
function createTesseractProvider() {
  return {name:'tesseract',model:'tesseract.js-eng-association-v1',extract(images) {
    if (queued >= 8) return Promise.reject(new Error('The screenshot processor is busy. Originals are stored; retry shortly.'));
    queued += 1;
    const job=queue.catch(()=>{}).then(async()=>{
      const worker=await createWorker('eng',1,{langPath:english.langPath,gzip:true,cacheMethod:'none'});
      const raw=[],screens=[];
      let timer;
      try {
        await Promise.race([(async()=>{for(const image of images){const result=await readScreenshot(worker,image);raw.push(result.raw);screens.push(result.screen);}})(),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('OCR processing timed out. Retry with clear screenshots.')),180000);})]);
        return {raw:JSON.stringify({engine:'tesseract',screenshots:raw,parsed:{screenshots:screens}})};
      } catch(error) {if(error.ocrRaw) raw.push(error.ocrRaw);return {raw:JSON.stringify({engine:'tesseract',screenshots:raw,error:error.message}),error:error.message};}
      finally {clearTimeout(timer);await worker.terminate();}
    });
    queue=job;
    return job.finally(()=>{queued -= 1;});
  },parse(result) {if(result.error)throw new Error(result.error);return JSON.parse(result.raw).parsed;}};
}
module.exports={createTesseractProvider,readScreenshot};
