const {createFantasyHQRepository}=require('../src/fantasyhq/repository');
const root=process.argv[2],leagueId=process.argv[3];
if(!root||!leagueId){console.error('Usage: node scripts/inspect-launch-readiness.js <data-root> <league-id>');process.exitCode=2;}else{const result=require('../src/fantasyhq/launch-readiness').inspectLaunchReadiness(createFantasyHQRepository({dataRoot:root}),leagueId);console.log(JSON.stringify(result,null,2));if(!result.ready)process.exitCode=1;}
