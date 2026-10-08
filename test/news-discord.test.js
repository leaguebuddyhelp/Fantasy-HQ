const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/free-agency');
test('published News edits preserve message identity, reaction counts and original publication dates',async t=>{
 const f=fixture(t),at='2026-10-08T12:00:00Z';
 const story={id:'news-story',seasonId:'1',week:1,phase:'REGULAR_SEASON',category:'Player performance',storyline:'Performance',playerIds:['a-0'],teamIds:['a'],sourceGameIds:[],newsworthiness:88,status:'PUBLISHED',createdAt:at,publishedAt:at,sourceDigest:'digest',revisions:[],headline:'A verified performance earns attention',article:'One. Two. Three. Four. Five.',testMode:false,simulationId:null,reactions:{}};
 f.repository.commitLeagueFiles({leagueId:'league',files:[{name:'news.json',value:{version:1,articles:[story]}}]});f.repository.saveLeague('league',{currentSeasonId:'2'});f.repository.saveSettings('league',{discordChannels:{news:'news-channel'}});
 const messages=new Map();let sends=0,edits=0;
 const channel={id:'news-channel',messages:{fetch:async query=>typeof query==='string'?messages.get(query):messages},send:async body=>{sends++;const message={id:'post',embeds:body.embeds,createdTimestamp:Date.now(),body,reactions:{cache:new Map([['fire',{emoji:{name:'🔥'},count:4,me:true}]])},edit:async body=>{edits++;message.body=body;}};messages.set('post',message);return message;}};
 const guild={channels:{fetch:async()=>channel}},submissions={records:()=>[]};const create=()=>require('../src/fantasyhq/discord-news').createDiscordNews({...f,submissions});
 await create().reconcile(guild,'league');await create().reconcile(guild,'league');assert.equal(sends,1);assert.equal(edits,0);assert.deepEqual(f.repository.loadNews('league').articles[0].reactions,{'🔥':3});
 const state=f.repository.loadNews('league');state.articles[0].headline='The corrected verified performance';state.articles[0].correctionNotice='Approved correction.';f.repository.commitLeagueFiles({leagueId:'league',files:[{name:'news.json',value:state}]});
 await create().reconcile(guild,'league');assert.equal(sends,1);assert.equal(edits,1);assert.match(messages.get('post').body.embeds[0].toJSON().description,/Approved correction/);
 const final=f.repository.loadNews('league').articles[0];assert.equal(final.publication.messageId,'post');assert.equal(final.publishedAt,at);assert.deepEqual(final.reactions,{'🔥':3});
 f.repository.saveSettings('league',{simulationId:'simulation'});await create().reconcile(guild,'league');assert.equal(sends,1);assert.equal(edits,1);
});
