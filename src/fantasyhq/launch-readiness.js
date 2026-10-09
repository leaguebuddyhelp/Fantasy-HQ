// Read-only preflight. Never cuts players, clears modes, or changes historical records.
function inspectLaunchReadiness(repository,leagueId){
 const root=repository.buildLeaguePaths(repository.dataRoot,leagueId).leagueRoot;
 for(const name of ['reset-transaction.json','week-transaction.json','trade-transaction.json','player-upgrade-transaction.json','file-transaction.json'])if(require('fs').existsSync(require('path').join(root,name)))throw Error('Pending storage recovery must finish before a read-only launch check.');
 const c=repository.loadLeague(leagueId),settings=repository.loadSettings(leagueId),players=repository.loadPlayers(leagueId),memberships=repository.loadRosterMemberships(leagueId),owners=repository.loadOwners(leagueId),roles=repository.loadRoleOwnership(leagueId),blockers=[];
 const active=require('./service-helpers').activeMemberships(memberships,c.seasonId);
 for(const t of c.teams){const ids=active.filter(m=>m.teamId===t.teamId).map(m=>m.playerId);if(ids.length!==15)blockers.push({code:'ROSTER_SIZE',teamId:t.teamId,teamName:t.teamName,count:ids.length,required:15});}
 if(settings.testMode&&!settings.simulationId)blockers.push({code:'LEGACY_TEST_MODE',message:'Canonical Test Mode must be reviewed before launch.'});
 const playerIds=new Set(players.map(p=>p.playerId));if(playerIds.size!==players.length)blockers.push({code:'DUPLICATE_PLAYER_ID'});
 const seen=new Set();for(const m of active){if(!playerIds.has(m.playerId))blockers.push({code:'MISSING_PLAYER',playerId:m.playerId});if(seen.has(m.playerId))blockers.push({code:'MULTIPLE_ACTIVE_TEAMS',playerId:m.playerId});seen.add(m.playerId);}
 for(const o of owners)if(!roles.roleIds?.[o.teamId]||owners.filter(x=>x.teamId===o.teamId||x.userId===o.userId).length!==1)blockers.push({code:'OWNER_ROLE_CONFIGURATION',teamId:o.teamId});
 return {leagueId,seasonId:c.seasonId,ready:!blockers.length,blockers,notice:'Read-only local data check. Current Discord membership and deployed volume still require verification.'};
}
module.exports={inspectLaunchReadiness};
