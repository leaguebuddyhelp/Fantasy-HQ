(() => {
 const root = document.querySelector('#sportsbook');
 if (!root) return;
 const element = id => document.querySelector('#sportsbook-' + id);
 const money = value => '$' + (value / 100).toFixed(2);
 const odds = value => value > 0 ? '+' + value : String(value);
 let data, mine, selected = [], preview, busy = false, reload = false;
 const game = id => data?.games.find(row => row.gameId === id);
 function label(market) {
  const match = game(market.gameId);
  const name = match ? (match.team1Id === market.selection ? match.team1Name : match.team2Name) : market.selection;
  if (market.kind === 'MONEYLINE') return name + ' ML';
  if (market.kind === 'SPREAD') return name + ' ' + (market.line > 0 ? '+' : '') + market.line;
  if (market.kind === 'TOTAL') return market.selection + ' ' + market.line + ' total';
  return market.playerName + ' ' + market.selection + ' ' + market.line + ' ' + market.kind.slice(5);
 }
 function invalidate() { preview = null; element('confirmation').innerHTML = ''; }
 function render() {
  const selectedGame = new URL(location.href).searchParams.get('gameId');
  const markets = data.markets.filter(market => selectedGame ? market.gameId === selectedGame : market.week === data.week);
  element('market-title').textContent = selectedGame ? 'Game markets' : 'Week ' + data.week + ' markets';
  element('markets').innerHTML = [...new Set(markets.map(market => market.gameId))].map(id => {
   const match = game(id);
   return '<article class="summary-card"><h3>' + escapeHtml(match ? match.team1Name + ' vs ' + match.team2Name : id) + '</h3>'
    + markets.filter(market => market.gameId === id).map(market => {
     const owned = mine && market.teamIds.includes(mine.teamId), disabled = !mine || owned || market.status !== 'OPEN' || mine.profile.frozen;
     return '<p><button data-book-market="' + escapeHtml(market.id) + '"' + (disabled ? ' disabled' : '')
      + ' aria-pressed="' + selected.includes(market.id) + '">' + escapeHtml((market.specialName ? market.specialName + ' · ' : '') + label(market)) + ' · ' + odds(market.odds) + '</button>'
      + (owned ? ' 🚫 Unavailable — You cannot bet on your own team or players.' : market.status !== 'OPEN' ? ' 🔒 Betting closed' : '') + '</p>';
    }).join('') + '</article>';
  }).join('') || '<p>No supported markets yet. Markets appear after the weekly game threads are created.</p>';
  element('profile').innerHTML = mine ? '<p><strong>Career balance: ' + money(mine.profile.balanceCents) + '</strong> · '
   + mine.profile.wins + ' wins / ' + mine.profile.losses + ' losses · P/L ' + money(mine.profile.careerProfitCents)
   + ' · Wagered ' + money(mine.profile.totalWageredCents) + ' · Best streak ' + mine.profile.bestWinningStreak + '</p>'
   + (mine.profile.frozen ? '<p>Your wallet is frozen pending Staff review of a corrected payout.</p>' : '') : '';
  element('logout').hidden = !mine;
  element('legs').innerHTML = selected.map(id => data.markets.find(market => market.id === id)).filter(Boolean)
   .map(market => '<p>' + escapeHtml((market.specialName ? market.specialName + ' · ' : '') + label(market)) + ' · ' + odds(market.odds) + ' <button data-book-remove="'
    + escapeHtml(market.id) + '">Remove</button></p>').join('')
   || '<p>Select one market for a straight bet, or multiple markets to build a parlay.</p>';
  element('bets').innerHTML = mine ? mine.bets.slice().reverse().map(bet => '<details><summary>' + escapeHtml(bet.status)
   + ' · ' + money(bet.stakeCents) + ' · ' + escapeHtml(new Date(bet.placedAt).toLocaleString()) + '</summary>'
   + bet.legs.map(market => '<p>' + escapeHtml((market.specialName ? market.specialName + ' · ' : '') + label(market)) + ' · ' + odds(market.odds) + '</p>').join('')
   + '<p>Potential return ' + money(bet.potentialReturnCents) + (bet.settlements.length ? ' · Settled return '
    + money(bet.settlements.at(-1).returnCents) : '') + '</p>'
   + (bet.pendingCorrection ? '<p>Staff is reviewing a payout correction. Previous settlement history is retained.</p>' : '') + '</details>').join('')
   || '<p>No bets placed yet.</p>' : '<p>Your bets are visible only after coach sign-in.</p>';
  element('leaderboard').innerHTML = data.leaderboard.map((row, index) => '<p>#' + (index + 1) + ' '
   + escapeHtml(row.displayName||row.userId) + ' · ' + money(row.careerProfitCents) + ' P/L · ' + row.wins + ' wins / ' + row.losses + ' losses</p>').join('')
   || '<p>No career betting results yet.</p>';
 }
 async function load() {
  if (busy) { reload = true; return; } busy = true;
  try {
   data = await requestJson('/api/league/sportsbook');
   try {
    mine = await requestJson('/api/league/sportsbook/mine');
    element('status').textContent = 'Signed in as your current Discord team. Your bets and balance are private.';
   } catch (error) { mine = null; selected = []; invalidate(); element('status').textContent = error.message; }
   render();
  } catch (error) { element('status').textContent = error.message; }
  finally { busy = false; if (reload) { reload = false; load(); } }
 }
 root.addEventListener('click', async event => {
  const add = event.target.closest('[data-book-market]'), remove = event.target.closest('[data-book-remove]');
  if (add) {
   const id = add.dataset.bookMarket, market = data.markets.find(row => row.id === id);
   selected = selected.includes(id) ? selected.filter(value => value !== id)
    : [...selected.filter(value => data.markets.find(row => row.id === value)?.group !== market.group), id];
   invalidate(); render();
  }
  if (remove) { selected = selected.filter(value => value !== remove.dataset.bookRemove); invalidate(); render(); }
  const confirm = event.target.closest('[data-book-confirm]');
  if (confirm) {
   if (!preview) return; confirm.disabled = true;
   try {
    await requestJson('/api/league/sportsbook/bet', {method:'POST', body:JSON.stringify({action:'confirm', token:preview.id})});
    selected = []; invalidate(); await load(); showToast('Bet confirmed. Exact lines and odds saved.');
   } catch (error) { invalidate(); showToast(error.message); }
  }
  if (event.target.closest('[data-book-cancel]')) invalidate();
 });
 element('wager').addEventListener('input', invalidate);
 element('preview').addEventListener('click', async () => {
  try {
   preview = await requestJson('/api/league/sportsbook/bet', {method:'POST', body:JSON.stringify({action:'preview', marketIds:selected, wager:element('wager').value})});
   element('confirmation').innerHTML = '<h4>Confirm ' + (preview.legs.length === 1 ? 'straight bet' : preview.legs.length + '-leg parlay') + '</h4>'
    + preview.legs.map(market => '<p>' + escapeHtml((market.specialName ? market.specialName + ' · ' : '') + label(market)) + ' · ' + odds(market.odds) + '</p>').join('')
    + '<p>Combined odds '+odds(preview.combinedAmericanOdds||preview.legs[0].odds)+'</p>'
    + '<p>Wager ' + money(preview.stakeCents) + ' · Potential profit ' + money(preview.profitCents)
    + ' · Total return ' + money(preview.potentialReturnCents) + '</p><button data-book-confirm>Confirm bet</button> <button data-book-cancel>Cancel</button>';
  } catch (error) { invalidate(); showToast(error.message); }
 });
 element('refresh').addEventListener('click', load);
 element('logout').addEventListener('click', async () => {
  try {await requestJson('/api/league/coach-session', {method:'POST', body:JSON.stringify({action:'logout'})});selected = [];invalidate();await load();}
  catch (error) {showToast(error.message);}
 });
 async function login() {
  if (!location.hash.startsWith('#coach-login=')) return;
  const token = location.hash.slice('#coach-login='.length);
  history.replaceState(null, '', location.pathname + location.search + '#sportsbook');
  try { await requestJson('/api/league/coach-session', {method:'POST', body:JSON.stringify({token})}); await load(); }
  catch (error) { element('status').textContent = error.message; }
 }
 window.addEventListener('hashchange', () => location.hash === '#sportsbook' ? load() : login());
 window.addEventListener('popstate', () => {if (location.hash === '#sportsbook') load();});
 if (location.hash === '#sportsbook') load(); else login();
 setInterval(() => {if (location.hash === '#sportsbook' && !document.hidden) load();}, 30000);
})();
