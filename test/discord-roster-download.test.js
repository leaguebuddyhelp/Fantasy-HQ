const test=require('node:test'),assert=require('node:assert/strict');
const {downloadDiscordImage}=require('../src/fantasyhq/game-submissions');
test('Discord report downloads accept signed ephemeral attachments and reject non-Discord or redirected hosts',async t=>{
 const original=global.fetch;let requested;t.after(()=>global.fetch=original);global.fetch=async(url,options)=>{requested={url:String(url),options};return new Response(Buffer.from('image'));};
 const url='https://cdn.discordapp.com/ephemeral-attachments/1/2/report.heic?ex=123&is=456&hm=signed';assert.equal((await downloadDiscordImage({url})).toString(),'image');assert.equal(requested.url,url);assert.equal(requested.options.redirect,'error');
 for(const bad of ['http://cdn.discordapp.com/attachments/1/2/a.jpg','https://evil.example/attachments/1/2/a.jpg','https://cdn.discordapp.com/elsewhere/a.jpg'])await assert.rejects(downloadDiscordImage({url:bad}),/Invalid Discord attachment/);
});
