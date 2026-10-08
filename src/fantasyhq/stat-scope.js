const SCOPES = ['REGULAR_SEASON','PLAY_IN','PLAYOFFS'];
function normalizeStatScope(value = 'REGULAR_SEASON') {
  if (!SCOPES.includes(value)) throw Error('Choose REGULAR_SEASON, PLAY_IN or PLAYOFFS statistics.');
  return value;
}
function officialScopeGames(records, {repository,leagueId,seasonId,schedule,publishedOnly=false,scope='REGULAR_SEASON'}) {
  normalizeStatScope(scope);
  if (scope==='REGULAR_SEASON')return require('./official-game')[publishedOnly?'publishedRegularGames':'officialRegularGames'](records,{leagueId,seasonId,schedule});
  const state=repository.loadPlayoffs(leagueId,seasonId);
  if (!state)return {games:[],duplicates:[]};
  require('./postseason-state').validatePostseason(state);
  const series=new Map(state.series.filter(s=>(s.stage==='PLAY_IN')===(scope==='PLAY_IN')).map(s=>[s.id,s]));
  const byId=new Map(),duplicates=[];
  for(const r of records) {
    const s=series.get(r.game.seriesId);
    if(!s || !s.gameIds.includes(r.game.gameId) || s.gameIds.indexOf(r.game.gameId)+1!==r.game.seriesGameNumber || !require('./postseason-service').approvedPostseasonGame(r,state,s))continue;
    if(byId.has(r.game.gameId)){duplicates.push(r,byId.get(r.game.gameId));byId.delete(r.game.gameId);}else byId.set(r.game.gameId,r);
  }
  return {games:[...byId.values()],duplicates};
}
module.exports={SCOPES,normalizeStatScope,officialScopeGames};
