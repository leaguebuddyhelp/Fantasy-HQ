const {createHash}=require('crypto');
const {requirePostseasonStaff}=require('./postseason-state');
const {matchScenarios,metrics,THRESHOLDS}=require('./news-scenarios');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const HOUR=3600000;
function validateNews(state){if(state?.version!==1||!Array.isArray(state.articles)||new Set(state.articles.map(a=>a.id)).size!==state.articles.length||state.articles.some(a=>!a.id||!['DRAFT','APPROVED','REJECTED','PUBLISHED'].includes(a.status)||!Array.isArray(a.revisions)||!a.sourceDigest||!a.seasonId))throw Error('Invalid news records.');return state;}
function performanceArticle(facts,variant=0){if(facts.type==='VERIFIED_EVENT')return {headline:facts.headline,article:(variant%2?[facts.sentences[0],...facts.sentences.slice(1).reverse()]:facts.sentences).join(' '),statistics:null};const {name,log,scenario}=facts,values=metrics(log),value=values[scenario.metric],word=log.result==='W'?'wins':'falls',headlines=[`${name} makes the box score impossible to ignore`,`${name} delivers as ${log.teamName} ${word}`,`${name} puts ${scenario.category.toLowerCase()} in focus`];const article=[`${name} recorded ${log.PTS} points as ${log.teamName} ${log.result==='W'?'beat':'lost to'} ${log.opponent}, ${log.score.replace('-',' to ')}.`,`${log.REB} rebounds and ${log.AST} assists added to the offensive production.`,`${name} finished ${log.FG} from the field, ${log['3PT']} from three-point range and ${log.FT} from the free-throw line.`,`${log.STL} steals and ${log.BLK} blocks supplied the defensive contribution, alongside ${log.TO} turnovers in ${log.MIN} minutes.`,scenario.context==='SEASON_BEST'?`The verified ${scenario.metric} total exceeded every earlier approved performance by this player in the season.`:scenario.category==='Defense'?`The combined ${log.STL+log.BLK} steals and blocks put the defensive impact alongside the offensive totals.`:`The scoring, rebounding and passing totals provide the context for this performance beyond the final score.`,`This account uses the finalized box score from week ${log.week}${log.stage?' in '+log.stage.replaceAll('_',' '):''}; the result and statistics remain the evidence.`].join(' ');return {headline:headlines[variant%headlines.length],article,statistics:log,metricValue:value};}
function createNewsService({repository,submissions,now=Date.now}){
 const stamp=()=>new Date(now()).toISOString();
 function save(leagueId,state,action,actor={id:'system'},metadata={}){repository.commitLeagueFiles({leagueId,files:[{name:'news.json',value:state},{name:'audit-log.json',value:[...repository.loadAuditLog(leagueId),{action,userId:actor.id,timestamp:stamp(),metadata}]}]});}
 function sources(leagueId, {analysisDue=true} = {}) {
  const context = repository.loadLeague(leagueId);
  const players = new Map(repository.loadPlayers(leagueId).map(player => [player.playerId, player]));
  const memberships = repository.loadRosterMemberships(leagueId);
  const records=submissions.records(),snapshotSubmissions={records:()=>records};
  const games = new Map(records.map(record => [record.game.gameId, record.game]));
  const simulationId = repository.loadSettings(leagueId).simulationId || null;
  const existing = new Map(repository.loadNews(leagueId).articles
   .filter(article => article.seasonId === context.seasonId && article.simulationId === simulationId)
   .map(article => [article.id, article]));
  const stories = [], analysisLogs = [];
  for (const scope of ['REGULAR_SEASON', 'PLAY_IN', 'PLAYOFFS']) {
   const logs = require('./player-stats-service').createPlayerStatsService({repository, submissions:snapshotSubmissions, scope})
    .getAllGamePerformances(leagueId, context.seasonId)
    .sort((a, b) => a.week - b.week || a.gameId.localeCompare(b.gameId));
   const previous = new Map(), byGame = new Map();
   for (const log of logs) {
    const player = players.get(log.playerId), game = games.get(log.gameId);
    if (!player || !game || !memberships.some(member => require('./historical-membership').representedAt(member,
     {playerId: log.playerId, teamId: log.teamId, seasonId: context.seasonId, at: game.finalizedAt}))) continue;
    if(scope==='REGULAR_SEASON')analysisLogs.push(log);
    const id = 'news-' + hash([leagueId, context.seasonId, log.gameId, log.playerId, simulationId || 'live']).slice(0, 24);
    const tracked = existing.get(id), prior = previous.get(log.playerId) || [];
    const matches = matchScenarios(log, prior);
    const strong = [...new Map(matches.slice().reverse().map(scenario => [scenario.metric, scenario])).values()]
     .sort((a, b) => b.threshold / THRESHOLDS[b.metric][0] - a.threshold / THRESHOLDS[a.metric][0] || a.id.localeCompare(b.id))[0];
    prior.push(log); previous.set(log.playerId, prior);
    // A corrected performance remains a valid source even below the original news threshold.
    // Only new stories compete for the two-player daily game selection.
    if (!strong && !tracked) continue;
    const scenario = strong || {...tracked.facts.scenario, context: 'GAME'};
    const facts = {name: player.name, log, scenario};
    const value = metrics(log)[scenario.metric];
    const score = Math.min(99, 55 + value / THRESHOLDS[scenario.metric][0] * 12
     + (scope !== 'REGULAR_SEASON' ? 10 : 0) + (scenario.context === 'SEASON_BEST' ? 5 : 0));
    const row = {id, seasonId: context.seasonId, week: log.week, phase: scope, category: scenario.category,
     storyline: 'Performance', playerIds: [log.playerId], teamIds: [log.teamId], sourceGameIds: [log.gameId],
     newsworthiness: Math.round(score), facts, sourceDigest: hash(facts)};
    if (tracked) stories.push(row);
    else {const candidates = byGame.get(log.gameId) || []; candidates.push(row); byGame.set(log.gameId, candidates);}
   }
   for (const [gameId, candidates] of byGame) {
    const trackedCount = stories.filter(story => story.sourceGameIds.includes(gameId)).length;
    stories.push(...candidates.sort((a, b) => b.newsworthiness - a.newsworthiness || a.id.localeCompare(b.id))
     .slice(0, Math.max(0, 2 - trackedCount)));
   }
  }
  const schedule=repository.scheduleExists(leagueId,context.seasonId)?repository.loadSchedule(leagueId,context.seasonId):null;
  return [...stories,...require('./news-events').verifiedEventSources(repository,leagueId),...require('./news-analysis').analysisSources({leagueId,seasonId:context.seasonId,simulationId,logs:analysisLogs,teams:context.teams,currentWeek:context.league.currentWeek||schedule?.statsPublication?.throughWeek||1,throughWeek:schedule?.statsPublication?.throughWeek||0,existing:[...existing.values()],allowNew:analysisDue})];
 }
 function detect(leagueId){const state=repository.loadNews(leagueId),settings=repository.loadSettings(leagueId),analysisKey=repository.loadLeague(leagueId).seasonId+':'+(settings.simulationId||'live'),lastAnalysis=state.analysis?.[analysisKey],analysisDue=!lastAnalysis||now()-Date.parse(lastAnalysis.at)>=4*HOUR,eligible=sources(leagueId,{analysisDue}),byId=new Map(eligible.map(s=>[s.id,s])),testMode=!!settings.simulationId;let changed=false;if(analysisDue){state.analysis ||= {};state.analysis[analysisKey]={at:stamp(),intervalHours:4};changed=true;}
  for(const source of eligible){let article=state.articles.find(a=>a.id===source.id&&!!a.testMode===testMode);if(!article){article={...source,...performanceArticle(source.facts),status:'DRAFT',createdAt:stamp(),updatedAt:stamp(),generation:0,revisions:[],testMode,simulationId:settings.simulationId||null,breaking:false,featured:false,reactions:{}};state.articles.push(article);changed=true;}
   else if(article.sourceDigest!==source.sourceDigest||article.sourceUnavailable){if(article.status==='PUBLISHED'){if(article.pendingSource?.sourceDigest!==source.sourceDigest){article.pendingSource=source;article.revalidationRequired=true;article.correctionNotice='Underlying verified league data changed. Staff review is pending.';article.updatedAt=stamp();changed=true;}}
    else {article.revisions.push({at:stamp(),reason:'SOURCE_CHANGED',headline:article.headline,article:article.article,sourceDigest:article.sourceDigest});Object.assign(article,source,performanceArticle(source.facts),{status:'DRAFT',updatedAt:stamp()});changed=true;}}
  }
  for(const a of state.articles.filter(a=>a.seasonId===repository.loadLeague(leagueId).seasonId&&!!a.testMode===testMode&&!byId.has(a.id))){if(!a.revalidationRequired||a.pendingSource){delete a.pendingSource;a.sourceUnavailable=true;a.revalidationRequired=true;a.correctionNotice='The original source is no longer eligible. Staff must review this article.';if(a.status==='APPROVED')a.status='DRAFT';changed=true;}}
  if(changed)save(leagueId,state,'news.detected');return state;
 }
 function staffList(leagueId,actor){requirePostseasonStaff(repository.loadLeague(leagueId),actor);return detect(leagueId).articles.filter(a=>!!a.testMode===!!repository.loadSettings(leagueId).simulationId);}
 function review(leagueId,actor,{id,action,headline,article,reason,breaking=false,featured=false}){
  requirePostseasonStaff(repository.loadLeague(leagueId),actor);const state=detect(leagueId),story=state.articles.find(a=>a.id===id&&!!a.testMode===!!repository.loadSettings(leagueId).simulationId);if(!story)throw Error('Unknown article.');
  if(action==='reject'){if(!reason||String(reason).trim().length<5)throw Error('Give a rejection reason.');if(story.status==='PUBLISHED')throw Error('Correct an already published article instead of deleting its history.');story.status='REJECTED';story.reason=String(reason).trim();}
  else if(action==='regenerate'){if(story.status==='PUBLISHED')throw Error('Use correction review for published articles.');const source=story.pendingSource||story;if((story.revalidationRequired&&!story.pendingSource)||story.sourceUnavailable&&!story.pendingSource)throw Error('The source is no longer eligible.');story.revisions.push({at:stamp(),actorId:actor.id,reason:'REGENERATED',headline:story.headline,article:story.article,sourceDigest:story.sourceDigest});story.generation++;Object.assign(story,source,performanceArticle(source.facts,story.generation),{status:'DRAFT',revalidationRequired:false,sourceUnavailable:false});delete story.pendingSource;}
  else if(['edit','approve','correct'].includes(action)){
   const source=story.pendingSource||story;if((story.revalidationRequired&&!story.pendingSource)||story.sourceUnavailable&&!story.pendingSource)throw Error('The source is no longer eligible; resolve the game data first.');if(story.status==='PUBLISHED'&&action!=='correct')throw Error('Use a recorded correction for published articles.');
   const nextHeadline=headline??(story.pendingSource?performanceArticle(source.facts).headline:story.headline),nextArticle=article??(story.pendingSource?performanceArticle(source.facts).article:story.article);if(typeof nextHeadline!=='string'||nextHeadline.trim().length<5||nextHeadline.length>180||typeof nextArticle!=='string'||nextArticle.length>3800)throw Error('Use a short headline and an article under 3,800 characters.');const sentences=nextArticle.replace(/\b(?:[A-Z]|Jr|Sr)\./g,'').match(/[^.!?]+[.!?](?:\s|$)/g)||[];if(sentences.length<5||sentences.length>8)throw Error('News articles must contain 5–8 sentences.');if(/[“”"]|\b(rumor|rumour|insider|sources say|injured|injury)\b/i.test(nextArticle))throw Error('Use verified league facts; do not invent quotes, rumors or injuries.');
   story.revisions.push({at:stamp(),actorId:actor.id,reason:action.toUpperCase(),headline:story.headline,article:story.article,sourceDigest:story.sourceDigest,publishedAt:story.publishedAt||null});const published=story.status==='PUBLISHED';Object.assign(story,{...source,headline:nextHeadline.trim(),article:nextArticle.trim(),breaking:!!breaking,featured:!!featured,revalidationRequired:false,sourceUnavailable:false});delete story.pendingSource;if(published){story.status='PUBLISHED';story.correctionNotice=reason?.trim()||'Corrected after Staff review of the verified league record.';story.correctedAt=stamp();}else story.status=action==='approve'?'APPROVED':'DRAFT';story.reviewedBy=actor.id;story.reviewedAt=stamp();
  }else throw Error('Choose approve, reject, edit, regenerate or correct.');story.updatedAt=stamp();save(leagueId,state,'news.'+action,actor,{id});return story;
 }
 function publishDue(leagueId){const state=detect(leagueId),testMode=!!repository.loadSettings(leagueId).simulationId,articles=state.articles.filter(a=>!!a.testMode===testMode),routine=articles.filter(a=>a.status==='PUBLISHED'&&!a.breaking),day=time=>new Date(time).toLocaleDateString('en-CA',{timeZone:'America/New_York'}),today=routine.filter(a=>day(a.publishedAt)===day(now())),last=routine.map(a=>Date.parse(a.publishedAt)).sort((a,b)=>b-a)[0]||0;
  const candidates=articles.filter(a=>a.status==='APPROVED'&&!a.revalidationRequired).sort((a,b)=>Number(b.breaking)-Number(a.breaking)||(b.newsworthiness-(routine.at(-1)?.category===b.category?12:0))-(a.newsworthiness-(routine.at(-1)?.category===a.category?12:0))||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));let changed=false,routineUsed=false;
  for(const a of candidates){if(!a.breaking&&(routineUsed||today.length>=4||now()-last<3*HOUR))continue;a.status='PUBLISHED';a.publishedAt=stamp();a.updatedAt=stamp();if(!a.breaking)routineUsed=true;changed=true;}
  if(changed)save(leagueId,state,'news.published');return state.articles.filter(a=>a.status==='PUBLISHED'&&!!a.testMode===testMode);
 }
 function list(leagueId, filters = {}) {
  const state = repository.loadNews(leagueId), testMode = !!repository.loadSettings(leagueId).simulationId;
  const query = String(filters.q || '').trim().toLowerCase();
  return state.articles.filter(article => article.status === 'PUBLISHED' && !!article.testMode === testMode
   && Object.entries(filters).every(([key, value]) => {
    if (!value || ['q', 'sort'].includes(key)) return true;
    if (key === 'teamId') return article.teamIds.includes(value);
    if (key === 'playerId') return article.playerIds.includes(value);
    return String(article[key]) === String(value);
   }))
   .filter(article => !query || [article.headline, article.article, article.category, article.storyline,
    article.seasonId, article.publishedAt, ...article.playerIds, ...article.teamIds].join(' ').toLowerCase().includes(query))
   .sort((a, b) => filters.sort === 'oldest' ? a.publishedAt.localeCompare(b.publishedAt)
    : filters.sort === 'relevance' ? b.newsworthiness - a.newsworthiness || b.publishedAt.localeCompare(a.publishedAt)
    : b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
 }
 function reactions(leagueId, id, counts) {
  const state = repository.loadNews(leagueId), story = state.articles.find(article => article.id === id);
  if (!story || story.status !== 'PUBLISHED') throw Error('Only published articles have reactions.');
  const sanitized = Object.fromEntries(Object.entries(counts).filter(([key, value]) => key.length <= 80
   && Number.isSafeInteger(value) && value >= 0));
  if (JSON.stringify(story.reactions) === JSON.stringify(sanitized)) return story;
  story.reactions = sanitized;
  // Audience engagement affects trending display only, never newsworthiness or publishing priority.
  save(leagueId, state, 'news.reactions', {id: 'system'}, {id}); return story;
 }
 function publication(leagueId,id,delivery){const state=repository.loadNews(leagueId),a=state.articles.find(a=>a.id===id);if(!a||a.status!=='PUBLISHED')throw Error('Only published articles can be delivered.');a.publication=delivery;save(leagueId,state,'news.publication',{id:'system'},{id,...delivery});return a;}
 return {sources,detect,staffList,review,publishDue,list,publication,reactions};
}
module.exports={createNewsService,validateNews,performanceArticle};
