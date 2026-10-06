const test=require('node:test');
const assert=require('node:assert/strict');
const {detectLayout}=require('../src/fantasyhq/box-score/tesseract-provider');
test('layout tolerates an unreadable sorted MIN heading but requires independently recognized stat headings',()=>{
 const words=[{text:'NAME',x:.366536,y:.206019},...['PTS','REB','AST','STL','BLK','TO','FG','3PT','FT','OR'].map((text,i)=>({text,x:.52+i*.04,y:.206019})),{text:'FLS',x:.938672,y:.206019}];
 assert.deepEqual(detectLayout(words,{width:3840,height:2160}),{scaleX:1,scaleY:1,offsetX:0,offsetY:0});
 const withoutFls=words.filter(w=>w.text!=='FLS'&&w.text!=='OR');withoutFls.push({text:'OR',x:.896973,y:.206019});
 assert.deepEqual(detectLayout(withoutFls,{width:3840,height:2160}),{scaleX:1,scaleY:1,offsetX:0,offsetY:0});
 assert.equal(detectLayout([words[0],words.at(-1)],{width:3840,height:2160}),null);
});
