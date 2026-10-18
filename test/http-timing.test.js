const test=require('node:test'),assert=require('node:assert/strict');
const timing=require('../src/shared/http-timing');
test('HTTP timing reports server build and encoding work without query strings or request credentials',()=>{
 const r={};timing.begin({url:'/api/league/players?secret=private',headers:{authorization:'private'}},r);
 const headers=timing.headers(r,{bytes:20,status:200});assert.match(headers['Server-Timing'],/^app;dur=\d+\.\d, encode;dur=\d+\.\d$/);
 const last=timing.snapshot().at(-1);assert.equal(last.path,'/api/league/players');assert.doesNotMatch(JSON.stringify(last),/private|secret/);
 assert.deepEqual(timing.headers({}),{});
});
