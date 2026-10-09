const fs=require('fs'),path=require('path');
// Reads evidence only. Restoration and recovery remain explicit Discord actions.
function readSimulationPreview(repository,leagueId,id){
 if(!/^[a-f0-9-]{36}$/.test(id||''))throw Error('Choose an existing isolated simulation.');
 const directory=path.join(repository.dataRoot,'simulations',id),base=fs.realpathSync(path.join(repository.dataRoot,'simulations'));
 if(fs.realpathSync(directory)!==path.join(base,id))throw Error('Simulation path is not an isolated directory.');
 if(fs.existsSync(path.join(directory,'restore.json')))throw Error('Complete the pending restoration in Discord before previewing.');
 const read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8')),identity=read('identity.json');if(identity.id!==id||identity.leagueId!==leagueId)throw Error('Simulation belongs to another league.');
 const settings=read('workspace/leagues/'+leagueId+'/settings.json');if(!settings.testMode||settings.simulationId!==id)throw Error('Simulation identity mismatch.');
 const league=read('workspace/leagues/'+leagueId+'/league.json'),runtime=read('workspace/simulation-runtime.json');
 return {isolated:true,simulationId:id,phase:league.currentPhase,week:league.currentWeek,seasonId:league.currentSeasonId,status:runtime.status||'IDLE',gamesSimulated:runtime.gamesSimulated||0,history:(runtime.history||[]).slice(-20),errors:(runtime.errors||[]).slice(-10),notice:'Isolated practice data. Live standings and statistics remain separate.'};
}
module.exports={readSimulationPreview};
