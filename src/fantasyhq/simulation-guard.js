const path=require('path');
function requireSimulationRepository(repository,leagueId,simulationId=null) {
  const settings=repository.loadSettings(leagueId),id=settings?.simulationId;
  if(!settings?.testMode||!id||simulationId&&id!==simulationId||!path.resolve(repository.dataRoot).endsWith(path.join('simulations',id,'workspace')))throw Error('This action is restricted to an isolated simulation workspace.');
  return id;
}
function isSimulationRepository(repository,leagueId) {try{return !!requireSimulationRepository(repository,leagueId);}catch{return false;}}
module.exports={requireSimulationRepository,isSimulationRepository};
