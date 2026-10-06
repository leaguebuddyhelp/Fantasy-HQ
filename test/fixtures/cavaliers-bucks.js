// Manually transcribed from IMG_1155.JPG / IMG_1156.JPG. This is a parser fixture,
// NOT a captured vision API response or a claim of live model accuracy.
const keys = ['MIN','PTS','REB','AST','STL','BLK','TO','FG','3PT','FT','OR','FLS'];
const stats = values => Object.fromEntries(keys.map((key,i) => [key,values ? String(values[i]) : null]));
const player = (displayedName, values) => ({ displayedName, confidence:'HIGH', dnp:!values, stats:stats(values) });
const scoreboard = () => [
  { teamName:'Cleveland Cavaliers',finalScore:'116',periods:[28,33,24,31].map((n,i) => ({label:`Q${i+1}`,score:String(n)})) },
  { teamName:'Milwaukee Bucks',finalScore:'120',periods:[19,46,22,33].map((n,i) => ({label:`Q${i+1}`,score:String(n)})) },
];
function sample() { return { screenshots:[
  { mediaId:'mil-image',confidence:'HIGH',scoreboard:scoreboard(),tableTeamName:'Bucks',uncertainFields:[],
    players:[
      player('K. Ware',[31,28,16,1,3,1,1,'13-17','2-4','0-0',5,4]),
      player('T. Herro',[28,18,1,2,1,0,1,'8-16','2-7','0-0',0,6]),
      player('G. Trent Jr.',[16,18,0,1,0,0,0,'6-10','4-6','2-3',0,0]),
      player('R. Rollins',[25,13,3,3,2,0,2,'5-9','0-1','3-4',2,0]),
      player('M. Turner',[24,13,3,0,0,1,0,'5-12','1-6','2-3',0,3]),
      player('C. LeVert',[27,9,2,5,2,0,0,'3-11','0-3','3-5',0,2]),
      player('J. Jaquez Jr.',[28,8,4,6,0,0,1,'4-7','0-2','0-0',2,2]),
      player('K. Porter Jr.',[27,6,2,3,3,0,2,'2-8','2-6','0-0',1,3]),
      player('K. Jakucionis',[13,4,1,4,0,0,0,'2-3','0-1','0-0',0,0]),
      player('O. Dieng',[21,3,5,3,1,0,1,'1-7','1-4','0-0',1,2]),
      ...['B. Burries','J. Sims','N. Ament','P. Nance'].map(n => player(n)),
    ], totals:stats([240,120,37,28,12,2,8,'49-100','12-40','10-15',11,22]) },
  { mediaId:'cle-image',confidence:'HIGH',scoreboard:scoreboard(),tableTeamName:'Cavaliers',uncertainFields:[],
    players:[
      player('D. Mitchell',[34,25,4,3,1,0,5,'8-16','2-6','7-7',0,2]),
      player('S. Merrill',[20,24,0,4,0,0,2,'7-11','6-9','4-4',0,3]),
      player('J. Harden',[33,20,2,8,3,0,5,'7-10','3-5','3-4',0,3]),
      player('J. Allen',[32,17,11,2,0,0,2,'6-8','0-1','5-9',3,1]),
      player('E. Mobley',[34,12,10,1,0,0,3,'5-6','2-2','0-0',1,3]),
      player('J. Tyson',[19,8,2,0,1,1,1,'2-6','1-3','3-4',1,1]),
      player('T. Bryant',[17,4,8,0,0,0,0,'2-5','0-0','0-0',2,0]),
      player('P. Watson',[29,2,4,1,1,3,2,'1-8','0-5','0-0',1,3]),
      player('M. Hezonja',[12,2,5,0,0,0,1,'1-2','0-1','0-0',0,1]),
      player('C. Porter Jr.',[10,2,1,4,0,1,1,'1-3','0-1','0-0',0,0]),
      ...['T. Proctor','N. Tomlin','M. Thomas','K. Diop'].map(n => player(n)),
    ], totals:stats([240,116,47,23,6,5,22,'40-75','14-33','22-28',8,17]) },
] }; }
module.exports = { sample };
