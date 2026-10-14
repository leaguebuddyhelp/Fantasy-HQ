const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EmbedBuilder,AttachmentBuilder}=require('discord.js');
function renderer(){
 const source=fs.readFileSync('src/index.js','utf8');
 const names=['classImageDirectoryId','recursiveImageFiles','imagePreferenceScore','bundledImageMap','withBundledImages','topTenPreviewProfileUrl','topTenPreviewProspects','topTenPreviewHeader','topTenPreviewEmbed','topTenPreviewImage'];
 const context={EmbedBuilder,AttachmentBuilder,fs,path,console,DRAFT_CLASS_DIR:path.resolve('draft_class'),DRAFT_IMAGE_DIR:path.resolve('draft_class/images'),URLSearchParams,process:{env:{WEBSITE_URL:'https://example.test'}},
  resolveDraftClassFile:()=> '2k27_CUS01 - Early Top Ten.json',
  readJson:file=>JSON.parse(fs.readFileSync(file,'utf8')),
  guildEmojiByName:()=>{throw Error('Removed logos must not be added automatically.');},
};
 const functions=names.map(name=>{const start=source.indexOf('function '+name+'(');assert.ok(start>=0);const end=source.indexOf('\nfunction ',start+1);return source.slice(start,end);}).join('\n');
 vm.runInNewContext(functions+'\nglobalThis.renderer={'+names.join(',')+'};',context);
 return context.renderer;
}
test('early preview restores bundled portraits and displays complete scouting details',()=>{
 const r=renderer(),players=r.topTenPreviewProspects();assert.equal(players.length,10);
 for(const [index,p] of players.entries()){
  const image=r.topTenPreviewImage(p);assert.ok(image.url.startsWith("attachment://"));assert.ok(image.attachment);assert.ok(fs.existsSync(image.attachment.attachment));
  const card=r.topTenPreviewEmbed(new Map([['france','<:france:123>']]),p,index,players.length,'2k27_CUS01 - Early Top Ten.json',image.url).toJSON();
  assert.equal(card.thumbnail.url,image.url);const url=new URL(card.url);assert.equal(url.searchParams.get("prospect"),String(p.id_number));assert.equal(url.searchParams.get("source"),"top-ten");assert.equal(url.hash,"#early-top-ten");assert.equal(card.description.split('\n')[0],p.team);
  assert.ok(card.description.includes([...new Set([p.position_1,p.position_2].filter(v=>v&&v!=='N/A'))].join('/')));
  for(const [prefix,label] of [['strength','Strengths'],['weakness','To improve']]){
   const field=card.fields.find(f=>f.name===label);for(const n of [1,2,3])assert.ok(field.value.includes(p[prefix+'_'+n]));
  }
  assert.equal(card.footer.text,`Early Top Ten • ${index+1}/10 • Draft Grade ${p['draft score']}`);
  assert.ok(card.fields.every(f=>f.value.length<=1024));
 }
});
test('explicit preview images still work and missing grades do not become zero',()=>{
 const r=renderer(),p={id_number:1,name:'Player',team:'Team',position_1:'PG',position_2:'PG',image:'https://example.test/player.png'};
 const image=r.topTenPreviewImage(p);assert.equal(image.url,p.image);
 const card=r.topTenPreviewEmbed(new Map(),p,0,1,'class.json',image.url).toJSON();
 assert.equal(card.thumbnail.url,p.image);assert.ok(!card.description.includes('PG/PG'));
 assert.equal(card.footer.text,'Early Top Ten • 1/1');
});
