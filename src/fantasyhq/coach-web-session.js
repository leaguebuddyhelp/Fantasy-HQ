const {randomBytes,createHash} = require('crypto');
const {requireCoachIdentity} = require('./coach-identity');
const hash = token => createHash('sha256').update(token).digest('hex');
const token = () => randomBytes(32).toString('hex');
function websiteBase() {
 const configured = process.env.WEBSITE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '');
 let url;try {url=new URL(configured);}catch {throw Error('Configure WEBSITE_URL before opening private coach pages.');}
 if(url.protocol!=='https:' && !(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Coach sign-in requires HTTPS, except for local development.');
 if(url.username||url.password)throw Error('Invalid website origin configuration.');return url;
}
function validateSessions(state) {
 if(state?.version!==1||!Array.isArray(state.links)||!Array.isArray(state.sessions)
  ||[...state.links,...state.sessions].some(row=>!/^[a-f0-9]{64}$/.test(row.hash)||!row.userId||!row.guildId||!Number.isFinite(row.expiresAt))
  ||new Set(state.links.map(row=>row.hash)).size!==state.links.length||new Set(state.sessions.map(row=>row.hash)).size!==state.sessions.length)throw Error('Invalid coach website sessions.');
 return state;
}
function createCoachWebSessions({repository,fetchMember,now=Date.now}) {
 const save=(leagueId,state)=>repository.commitLeagueFiles({leagueId,files:[{name:'coach-web-sessions.json',value:state}]});
 const clean=state=>{state.links=state.links.filter(row=>row.expiresAt>now());state.sessions=state.sessions.filter(row=>row.expiresAt>now());return state;};
 async function verify(leagueId,userId,guildId) {
  const binding=repository.loadGuildLeagueBinding(guildId);if(binding?.leagueId!==leagueId)throw Error('League binding changed. Sign in again from Discord.');
  if(!fetchMember)throw Error('Discord must be connected to verify coach access.');
  const member=await fetchMember(guildId,userId);
  const context=repository.loadLeague(leagueId),coach=requireCoachIdentity(repository,context,member,userId);
  return {id:userId,member,...coach};
 }
 function issue(leagueId,{id,member,guildId}) {
  requireCoachIdentity(repository,repository.loadLeague(leagueId),member,id);
  if(repository.loadGuildLeagueBinding(guildId)?.leagueId!==leagueId)throw Error('League binding changed.');
  const url=websiteBase(),secret=token(),state=clean(repository.loadCoachWebSessions(leagueId));
  // Issuing a newer link invalidates older unused links for the same coach.
  state.links=state.links.filter(row=>row.userId!==id);state.links.push({hash:hash(secret),userId:id,guildId,expiresAt:now()+300000});save(leagueId,state);
  url.pathname='/';url.search='';url.hash='coach-login='+secret;return {url:url.href,expiresAt:now()+300000};
 }
 function sameOrigin(request) {
  const origin=request.headers?.origin;if(!origin||origin!==websiteBase().origin)throw Error('Use the coach page on the configured league website.');
 }
 async function exchange(leagueId,secret,request) {
  sameOrigin(request);if(typeof secret!=='string'||!/^[a-f0-9]{64}$/.test(secret))throw Error('Invalid coach sign-in link.');
  let state=clean(repository.loadCoachWebSessions(leagueId)),link=state.links.find(row=>row.hash===hash(secret));
  if(!link)throw Error('This sign-in link expired or was already used. Open a new link from MyTeam.');
  const actor=await verify(leagueId,link.userId,link.guildId);
  // Re-read after Discord lookup so concurrent requests cannot consume the same token twice.
  state=clean(repository.loadCoachWebSessions(leagueId));link=state.links.find(row=>row.hash===hash(secret));
  if(!link)throw Error('This sign-in link was already used.');
  const session=token();state.links=state.links.filter(row=>row.hash!==link.hash);
  state.sessions.push({hash:hash(session),userId:link.userId,guildId:link.guildId,expiresAt:now()+12*3600000});save(leagueId,state);
  const secure=websiteBase().protocol==='https:';
  return {actor,cookie:`lb_coach=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure?'; Secure':''}`};
 }
 async function authenticate(leagueId,request,{mutation=false}={}) {
  if(mutation)sameOrigin(request);
  const pairs=String(request.headers?.cookie||'').split(';').map(part=>part.trim().split('='));
  const secrets=pairs.filter(([name])=>name==='lb_coach').map(([,value])=>value);
  if(secrets.length!==1||!/^[a-f0-9]{64}$/.test(secrets[0]))throw Error('Sign in from Discord MyTeam to access your private coach pages.');
  const row=repository.loadCoachWebSessions(leagueId).sessions.find(row=>row.hash===hash(secrets[0])&&row.expiresAt>now());
  if(!row)throw Error('Coach session expired. Open a new link from Discord MyTeam.');
  return verify(leagueId,row.userId,row.guildId);
 }
 function logout(leagueId,request) {
  sameOrigin(request);const secret=String(request.headers?.cookie||'').match(/(?:^|;\s*)lb_coach=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(secret){const state=repository.loadCoachWebSessions(leagueId);state.sessions=state.sessions.filter(row=>row.hash!==hash(secret));save(leagueId,state);}
  return `lb_coach=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${websiteBase().protocol==='https:'?'; Secure':''}`;
 }
 return {issue,exchange,authenticate,logout};
}
module.exports={createCoachWebSessions,validateSessions,websiteBase};
