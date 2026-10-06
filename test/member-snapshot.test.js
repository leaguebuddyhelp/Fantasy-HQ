const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemberSnapshots } = require('../src/fantasyhq/member-snapshot');
test('shares complete fetches and applies joins, role changes and departures without fetching again', async () => {
  let calls=0, resolve;
  const snapshots=createMemberSnapshots();
  const guild={id:'g',members:{fetch:()=>{calls++;return new Promise(r=>{resolve=r})}}};
  const first=snapshots.get(guild), second=snapshots.get(guild);
  await Promise.resolve();
  snapshots.update('g',{id:'old'},true);
  snapshots.update('g',{id:'new',role:'team'});
  resolve(new Map([['old',{id:'old'}]]));
  const [a,b]=await Promise.all([first,second]);
  assert.equal(calls,1);assert.equal(a,b);assert.equal(a.has('old'),false);assert.equal(a.get('new').role,'team');
  snapshots.update('g',{id:'new',role:'changed'});
  assert.equal((await snapshots.get(guild)).get('new').role,'changed');
  assert.equal(calls,1);
});
test('honors retry_after automatically and does not cache failed or partial requests', async () => {
  let clock=0,calls=0;const sleeps=[];
  const snapshots=createMemberSnapshots({now:()=>clock,sleep:async ms=>{sleeps.push(ms);clock+=ms}});
  const guild={id:'g',members:{fetch:async()=>{calls++;if(calls===1)throw {data:{opcode:8,retry_after:15.696}};return new Map([['a',{id:'a'}]])}}};
  assert.equal((await snapshots.get(guild)).size,1);
  assert.deepEqual(sleeps,[16696]);assert.equal(calls,2);
  await snapshots.get(guild);assert.equal(calls,2);
  snapshots.invalidate('g');guild.members.fetch=async()=>{throw Error('offline')};
  await assert.rejects(snapshots.get(guild),/offline/);
});
test('refreshes expired complete snapshots', async()=>{
  let clock=0,calls=0;const snapshots=createMemberSnapshots({now:()=>clock,ttl:300000});
  const guild={id:'g',members:{fetch:async()=>{calls++;return new Map()}}};
  await snapshots.get(guild);clock=299999;await snapshots.get(guild);assert.equal(calls,1);
  clock=300000;await snapshots.get(guild);assert.equal(calls,2);
});
