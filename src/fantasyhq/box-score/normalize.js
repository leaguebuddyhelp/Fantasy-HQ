const { normalizeText } = require('../service-helpers');
const COUNT_FIELDS = ['PTS','REB','AST','STL','BLK','TO','OR','FLS'];
const SUM_FIELDS = ['MIN', ...COUNT_FIELDS, 'FGM','FGA','3PM','3PA','FTM','FTA'];
function nameTokens(name) { return normalizeText(name).split(' ').filter(Boolean); }
function editDistance(a,b) {
  const d=Array.from({length:a.length+1},(_,i)=>Array.from({length:b.length+1},(_,j)=>i===0?j:j===0?i:0));
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){
    d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
    if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);
  }
  return d[a.length][b.length];
}
const NICKNAMES = {
  'bones hyland': ['Nahshon Hyland', 'N. Hyland'],
  'nahshon hyland': ['Bones Hyland'],
  'nic claxton': ['Nicolas Claxton'],
  'nicolas claxton': ['Nic Claxton'],
  'cam thomas': ['Cameron Thomas'],
  'cam johnson': ['Cameron Johnson'],
  'cameron thomas': ['Cam Thomas'],
  'cameron johnson': ['Cam Johnson'],
};
function playerMatch(displayed, roster, learnedAliases = {}) {
  const n=normalizeText(displayed),words=nameTokens(displayed);
  if(!n)return {candidates:[],automatic:false,method:'none'};
  const exact=roster.filter(p=>normalizeText(p.name)===n);
  if(exact.length)return {candidates:exact,automatic:exact.length===1,method:'exact',score:1};
  const ids = Object.keys(Object.hasOwn(learnedAliases, n) ? learnedAliases[n] : {});
  if (ids.length > 1) return { candidates: roster.filter(p => ids.includes(p.playerId)), automatic: false, method: 'conflicting-approved-alias', score: 0 };
  // Conflicting commissioner examples never become automatic, even after a roster move.
  if (ids.length === 1) {
    const learned = roster.filter(p => p.playerId === ids[0]);
    if (learned.length === 1) return { candidates: learned, automatic: true, method: 'approved-alias', score: 1 };
  }
  const aliases = roster.filter(p => {
    const forms = [...(Object.hasOwn(NICKNAMES, normalizeText(p.name)) ? NICKNAMES[normalizeText(p.name)] : []), ...(Array.isArray(p.aliases) ? p.aliases : []), ...(p.nickname ? [p.nickname] : [])];
    return forms.some(alias => { const tokens = nameTokens(alias); return normalizeText(alias) === n || words[0]?.length === 1 && tokens[0]?.startsWith(words[0]) && tokens.slice(1).join(' ') === words.slice(1).join(' '); });
  });
  const abbreviated=words[0]?.length===1&&words.length>=2 ? roster.filter(p=>{
    const tokens=nameTokens(p.name);
    return tokens[0]?.startsWith(words[0])&&tokens.slice(-(words.length-1)).join(' ')===words.slice(1).join(' ');
  }) : [];
  if (aliases.length || abbreviated.length) {
    const candidates=[...new Map([...aliases,...abbreviated].map(p=>[p.playerId,p])).values()];
    return {candidates,automatic:candidates.length===1,method:aliases.length?'nickname':'initial-surname',score:1};
  }
  const split=t=>{const w=[...t];const suffix=/^(jr|sr|ii|iii|iv)$/.test(w.at(-1))?w.pop():null;return {first:w.shift(),last:w.join(''),suffix};};
  const source=split(words);
  if (words.length === 1 && words[0].length >= 4) {
    const surname = roster.filter(p => nameTokens(p.name).filter(t => !/^(jr|sr|ii|iii|iv)$/.test(t)).at(-1) === words[0]);
    return { candidates: surname, automatic: false, method: 'surname-suggestion', score: surname.length ? 1 : 0 };
  }
  if(!source.first||source.last.length<4)return {candidates:[],automatic:false,method:'none'};
  const scored=roster.flatMap(p=>{
    const target=split(nameTokens(p.name));
    if(!target.first||source.first[0]!==target.first[0]||(source.suffix&&target.suffix&&source.suffix!==target.suffix))return [];
    if(source.first.length>1&&source.first!==target.first)return [];
    const distance=editDistance(source.last,target.last),length=Math.max(source.last.length,target.last.length);
    if(distance>(length>=6?2:1))return [];
    return [{player:p,distance,score:1-distance/length}];
  }).sort((a,b)=>b.score-a.score||String(a.player.playerId).localeCompare(String(b.player.playerId)));
  const best=scored[0];
  return {candidates:scored.map(s=>s.player),automatic:scored.length===1&&best.distance<=1&&best.score>=.75,method:scored.length?'fuzzy':'none',score:best?.score || 0};
}
function playerCandidates(displayed,roster){return playerMatch(displayed,roster).candidates;}
function normalizeExtraction(raw, { game, media, teams, rosters, playerMatches = {}, learnedAliases = {} }) {
  if (!raw || !Array.isArray(raw.screenshots)) throw new Error('Invalid extraction: screenshots array is required.');
  const issues = [];
  const issue = (code, path, message, details = {}) => issues.push({ code, path, message, ...details });
  function number(value, path, minutes = false) {
    if (value == null || value === '') { issue('MISSING_FIELD', path, 'Field is missing or unreadable.'); return null; }
    const text = String(value).trim();
    let n = /^\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
    if (minutes && /^\d+:\d{2}$/.test(text) && Number(text.split(':')[1]) < 60) {
      const [m, s] = text.split(':').map(Number); n = m + s / 60;
    }
    if (!Number.isFinite(n) || n < 0 || (!minutes && !Number.isInteger(n))) {
      issue('INVALID_NUMBER', path, 'Expected a nonnegative displayed number.', { displayed: value }); return null;
    }
    return n;
  }
  function stats(value, path, dnp = false) {
    const result = { raw: value || null };
    if (dnp) { for (const k of SUM_FIELDS) result[k] = null; return result; }
    result.MIN = number(value?.MIN, `${path}.MIN`, true);
    for (const k of COUNT_FIELDS) result[k] = number(value?.[k], `${path}.${k}`);
    for (const [rawKey, prefix] of [['FG','FG'],['3PT','3P'],['FT','FT']]) {
      const match = /^(\d+)\s*[-–]\s*(\d+)$/.exec(String(value?.[rawKey] ?? '').trim());
      result[`${prefix}M`] = match ? Number(match[1]) : null;
      result[`${prefix}A`] = match ? Number(match[2]) : null;
      if (!match) issue('SHOOTING_SPLIT', `${path}.${rawKey}`, 'Missing or unclear made-attempted split.');
      else if (Number(match[1]) > Number(match[2])) issue('SHOOTING_SPLIT', `${path}.${rawKey}`, 'Made exceeds attempted.');
    }
    if (result['3PM'] != null && result.FGM != null && result['3PM'] > result.FGM) issue('SHOOTING_SPLIT', path, 'Three-point makes exceed all field goals.');
    if ([result.PTS, result.FGM, result['3PM'], result.FTM].every(n => n != null)
        && result.PTS !== 2 * result.FGM + result['3PM'] + result.FTM) issue('SHOOTING_POINTS', path, 'Shooting splits do not reconcile to displayed points.');
    return result;
  }
  function confidence(value, path) {
    if (value !== 'HIGH') issue('CONFIDENCE', path, 'Extraction confidence requires review.', { confidence: value ?? null });
    return value ?? null;
  }
  function resolveTeam(name, path) {
    const n = normalizeText(name);
    const found = teams.filter(t => {
      const full = normalizeText(t.teamName);
      // Exact full name, abbreviation, nickname or city; ambiguous aliases never win.
      const words = full.split(' ');
      return n && [full, normalizeText(t.abbreviation), words.at(-1), words.slice(0,-1).join(' '),
        full.endsWith('trail blazers') ? 'trail blazers' : full].includes(n);
    });
    if (found.length !== 1 || ![game.team1Id,game.team2Id].includes(found[0].teamId)) {
      issue('TEAMS_MATCH', path, 'Team is unknown, ambiguous, or not scheduled in this game.', { displayed: name }); return null;
    }
    return found[0].teamId;
  }
  const seenMedia = new Set();
  if (raw.screenshots.length !== 2) issue('MEDIA_COVERAGE', 'screenshots', 'Exactly two screenshot readings are required.');
  const screenshots = raw.screenshots.map((screen, index) => {
    if (!screen || typeof screen !== 'object') throw new Error('Malformed screenshot extraction.');
    const base = `screenshots.${index}`;
    if (!media.some(m => m.mediaId === screen.mediaId) || seenMedia.has(screen.mediaId)) issue('MEDIA_COVERAGE', base, 'Missing, duplicate or unexpected source image ID.');
    seenMedia.add(screen.mediaId);
    confidence(screen.confidence, base);
    for (const field of screen.uncertainFields || []) issue('UNCERTAIN_FIELD', `${base}.${field.path}`, field.reason || 'Provider reported uncertainty.', { confidence: field.confidence });
    const scoreboard = (screen.scoreboard || []).map((s, i) => {
      const p = `${base}.scoreboard.${i}`;
      const periods = (s.periods || []).map((v, j) => ({ label: v.label, score: number(v.score, `${p}.periods.${j}`) }));
      if (periods.length < 4 || periods.some((v, j) => v.label !== (j < 4 ? `Q${j+1}` : `OT${j-3}`))) issue('QUARTERS_MATCH', p, 'Missing, duplicate or unordered quarter/overtime periods.');
      const finalScore = number(s.finalScore, `${p}.finalScore`);
      if (periods.some(v => v.score == null) || finalScore == null || periods.reduce((sum,v) => sum + (v.score || 0),0) !== finalScore) issue('QUARTERS_MATCH', p, 'Period scores do not reconcile to the final score.');
      return { displayedTeamName: s.teamName, teamId: resolveTeam(s.teamName,p), finalScore, periods };
    });
    if (scoreboard.length !== 2 || new Set(scoreboard.map(s => s.teamId).filter(Boolean)).size !== 2) issue('TEAMS_MATCH', `${base}.scoreboard`, 'Both scheduled teams must appear once.');
    const teamId = resolveTeam(screen.tableTeamName, `${base}.tableTeamName`);
    const matchedIds = new Set();
    const players = (screen.players || []).map((player,i) => {
      const p = `${base}.players.${i}`;
      if (typeof player.dnp !== 'boolean') issue('MISSING_FIELD', `${p}.dnp`, 'DNP status is unclear.');
      const match = playerMatch(player.displayedName, rosters[teamId] || [], learnedAliases);
      const candidates = match.candidates;
      const explicit = (rosters[teamId] || []).find(r => r.playerId === playerMatches[p]);
      const playerId = explicit?.playerId || (match.automatic && player.confidence === 'HIGH' ? candidates[0].playerId : null);
      if (!playerId) issue('PLAYER_MATCH_NEEDED', p, 'Player match needed; no unique high-confidence roster match.',
        { displayedName: player.displayedName, candidates: candidates.map(c => ({ playerId:c.playerId, name:c.name })) });
      if (playerId && matchedIds.has(playerId)) issue('DUPLICATE_PLAYER', p, 'Player appears more than once.');
      matchedIds.add(playerId);
      return { displayedName: player.displayedName ?? null, playerId, matchMethod:explicit?'commissioner':match.method, matchScore:match.score ?? null, dnp: player.dnp ?? null,
        confidence: confidence(player.confidence,p), stats: stats(player.stats,`${p}.stats`,player.dnp === true),
        candidates: candidates.map(c => ({ playerId:c.playerId, name:c.name })) };
    });
    if (!players.length) issue('MISSING_FIELD', `${base}.players`, 'No player rows detected.');
    const totals = stats(screen.totals,`${base}.totals`);
    const played = players.filter(p => p.dnp === false);
    for (const k of SUM_FIELDS) {
      const known = played.length && played.every(p => p.stats[k] != null) && totals[k] != null;
      const sum = played.reduce((s,p) => s + (p.stats[k] || 0),0);
      // Minute values may be rounded on screen; even a mismatch is retained for review.
      if (!known || Math.abs(sum - totals[k]) > 0.01) issue(k === 'PTS' ? 'PLAYER_POINTS_MATCH' : 'TEAM_TOTAL', `${base}.totals.${k}`,
        'Sum of played-player rows does not reconcile to displayed team total.', { sum: known ? sum : null, displayed: totals[k] });
    }
    const board = scoreboard.find(s => s.teamId && s.teamId === teamId);
    if (!board || board.finalScore == null || board.finalScore !== totals.PTS) issue('PLAYER_POINTS_MATCH', base, 'Team total points do not agree with scoreboard.');
    return { mediaId: screen.mediaId, confidence: screen.confidence ?? null, scoreboard,
      teamId, displayedTeamName: screen.tableTeamName, players, totals };
  });
  if (new Set(screenshots.map(s => s.teamId).filter(Boolean)).size !== 2) issue('TEAMS_MATCH','screenshots','Need one player table for each scheduled team.');
  for (const id of [game.team1Id,game.team2Id]) {
    const boards = screenshots.map(s => s.scoreboard.find(b => b.teamId === id));
    if (boards.length !== 2 || boards.some(b => !b || b.finalScore == null) || boards[0]?.finalScore !== boards[1]?.finalScore) issue('FINAL_SCORES_MATCH',id,'Independent screenshot final scores disagree or are missing.');
    if (boards.length !== 2 || boards.some(b => !b) || JSON.stringify(boards[0]?.periods) !== JSON.stringify(boards[1]?.periods)) issue('QUARTERS_MATCH',id,'Independent screenshot period scores disagree or are missing.');
  }
  return { normalized: { schemaVersion: 1, official: false, screenshots,
    playedPlayerCount: screenshots.reduce((n,s) => n + s.players.filter(p => p.dnp === false).length,0) },
    issues, validation: Object.fromEntries(['TEAMS_MATCH','FINAL_SCORES_MATCH','QUARTERS_MATCH','PLAYER_POINTS_MATCH'].map(code => [code,!issues.some(i => i.code === code)])) };
}
module.exports = { normalizeExtraction, playerCandidates, playerMatch };
