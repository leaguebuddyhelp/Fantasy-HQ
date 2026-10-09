const form = document.querySelector('#access'), status = document.querySelector('#status'), summary = document.querySelector('#summary');
localStorage.removeItem('leaguebuddyAdminKey');
const key = document.querySelector('#key'); key.value = sessionStorage.getItem('leaguebuddyAdminKey') || '';
const endpoint = `/api${location.pathname}`;
let data, draft, latest, dirty = false, busy = false, objectUrls = [];
let highlightedRow, highlightedIssueCard, revisionMode = false, revisionReason = '';
const fields = ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FG', '3PT', 'FT', 'OR', 'FLS'];
const reviewed = new Set();
const imageCache = new Map();
let imageKey = '';
function attachOriginal(original, mediaId, alt) {
  const image = el('img'); image.alt = alt; original.append(image);
  const media=(data.media||[]).find(m=>m.mediaId===mediaId),heic=['image/heic','image/heif'].includes(media?.contentType);
  const base=endpoint.replace(/review$/, 'media/' + mediaId);
  function cached(suffix){const key=mediaId+suffix;if(!imageCache.has(key)){const request=api(base+suffix).then(r=>r.blob()).then(blob=>{const url=URL.createObjectURL(blob);objectUrls.push(url);return url;});imageCache.set(key,request);request.catch(()=>imageCache.delete(key));}return imageCache.get(key);}
  cached(heic?'?preview=1':'').then(url=>{
    image.src=url;enableImageViewer(image,url);
    return heic?cached(''):url;
  }).then(url=>{const link=el('a',heic?'Download original HEIC':'Open full-size original');link.href=url;link.target='_blank';link.rel='noopener';if(heic)link.download='original.heic';original.append(link);}).catch(error=>original.append(el('p',error.message,'review-problem')));
}

function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
function feedback(message, error = false) {
  const node = document.querySelector('#action-status'); if (node) { node.textContent = message; node.classList.toggle('review-error', error); }
}
function approvalConfirmation(game) {
  let dialog = document.querySelector('#approval-confirmation');
  if (!dialog) { dialog = el('dialog', null, 'review-approval-dialog'); dialog.id = 'approval-confirmation'; dialog.setAttribute('aria-labelledby', 'approval-title'); document.body.append(dialog); }
  dialog.replaceChildren(); const heading = el('h2', 'Game approved'); heading.id = 'approval-title';
  dialog.append(heading, el('p', `${game.team1Name} vs ${game.team2Name}`), el('p', 'The final result, player stats and standings have been saved. No further approval is needed.'));
  const close = el('button', 'Done', 'primary-action'); close.onclick = () => dialog.close(); dialog.append(close); dialog.showModal(); close.focus();
}
function showImageViewer(src, alt) {
  let dialog = document.querySelector('#review-image-viewer');
  if (!dialog) { dialog = el('dialog', null, 'review-image-dialog'); dialog.id = 'review-image-viewer'; dialog.setAttribute('aria-label', 'Screenshot zoom'); document.body.append(dialog); }
  const toolbar = el('div', null, 'review-image-toolbar'), stage = el('div', null, 'review-image-stage'), image = el('img'); image.src = src; image.alt = alt;
  const zoom = el('input'); zoom.type = 'range'; zoom.min = '100'; zoom.max = '300'; zoom.step = '25'; zoom.value = '100'; zoom.setAttribute('aria-label', 'Image zoom');
  const level = el('output', '100%');
  const applyZoom = () => { image.style.width = `${zoom.value}%`; level.value = `${zoom.value}%`; level.textContent = `${zoom.value}%`; };
  const changeZoom = amount => { zoom.value = String(Math.max(Number(zoom.min), Math.min(Number(zoom.max), Number(zoom.value) + amount))); applyZoom(); };
  const out = el('button', 'Zoom out'); out.type = 'button'; out.onclick = () => changeZoom(-25);
  const inside = el('button', 'Zoom in'); inside.type = 'button'; inside.onclick = () => changeZoom(25);
  const reset = el('button', 'Reset zoom'); reset.type = 'button'; reset.onclick = () => { zoom.value = '100'; applyZoom(); };
  const close = el('button', 'Close image'); close.type = 'button'; close.onclick = () => dialog.close();
  zoom.addEventListener('input', applyZoom); toolbar.append(out, zoom, inside, level, reset, close); stage.append(image); dialog.replaceChildren(toolbar, stage); applyZoom(); dialog.showModal(); close.focus();
}
function enableImageViewer(image, src) {
  image.tabIndex = 0; image.setAttribute('role', 'button'); image.setAttribute('aria-label', `Zoom ${image.alt}`); image.title = 'Open screenshot zoom';
  const open = () => showImageViewer(src, image.alt);
  image.addEventListener('click', open);
  image.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
}
function issueLocation(issue) {
  const parts = (issue.path || '').split('.'), screen = draft.screenshots[Number(parts[1])];
  if (!screen) return { label: 'Game scores', path: issue.path };
  const player = parts[2] === 'players' ? screen.players[Number(parts[3])] : null;
  const stat = parts.at(-1), names = { MIN: 'Minutes', AST: 'Assists', REB: 'Rebounds', PTS: 'Points', TO: 'Turnovers', STL: 'Steals', BLK: 'Blocks', FG: 'Field goals', '3PT': 'Three-pointers', '3PA': 'Three-point attempts', '3PM': 'Three-pointers made', FT: 'Free throws', OR: 'Offensive rebounds', FLS: 'Fouls' };
  const path = (issue.path || '').replace(/\.scores\.([0-4])$/, (_, n) => Number(n) === 4 ? '.finalScore' : `.periods.${n}`).replace(/\.(FGM|FGA)$/, '.FG').replace(/\.(3PM|3PA)$/, '.3PT').replace(/\.(FTM|FTA)$/, '.FT');
  return { label: [screen.tableTeamName, player?.displayedName || (parts[2] === 'totals' ? 'Team totals' : 'Scoreboard / team'), names[stat] || (parts[2] === 'players' ? 'Player match / confidence' : '')].filter(Boolean).join(' · '), path };
}
function jumpToIssue(path, issueCard) {
  const nodes = [...summary.querySelectorAll('[data-path]')].filter(n => !n.dataset.path.startsWith('Verified '));
  const node = nodes.find(n => n.dataset.path === path) || nodes.find(n => n.dataset.path.startsWith(path + '.'));
  if (highlightedRow) highlightedRow.classList.remove('review-row-highlight');
  if (highlightedIssueCard) highlightedIssueCard.classList.remove('review-issue-active');
  highlightedRow = node?.closest('tr'); highlightedIssueCard = issueCard;
  if (highlightedRow) highlightedRow.classList.add('review-row-highlight');
  if (highlightedIssueCard) highlightedIssueCard.classList.add('review-issue-active');
  if (node) { node.scrollIntoView({ behavior: 'smooth', block: 'center' }); node.focus({ preventScroll: true }); }
}
async function api(url, body) { const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'x-leaguebuddy-admin-key': key.value, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Request failed.'); } return r; }
function markDirty() { dirty = true; feedback('Unsaved changes. Save and revalidate before approving.'); const b = document.querySelector('#approve'); if (b) b.disabled = true; }
function input(value, path, update, type = 'text') {
  const n = el('input'); n.type = type; if (type === 'checkbox') n.checked = value === true; else n.value = value ?? '';
  n.setAttribute('aria-label', path); n.dataset.path = path;
  const warnings = (latest.issues || []).filter(i => {
    const mapped = i.path.replace(/\.scores\.([0-4])$/, (_, n) => Number(n) === 4 ? '.finalScore' : `.periods.${n}`).replace(/\.(FGM|FGA)$/, '.FG').replace(/\.(3PM|3PA)$/, '.3PT').replace(/\.(FTM|FTA)$/, '.FT');
    return mapped === path || path.startsWith(mapped + '.') || mapped.startsWith(path + '.') || (['FINAL_SCORES_MATCH', 'QUARTERS_MATCH'].includes(i.code) && path.includes('.scoreboard.'));
  });
  if (warnings.length) { n.classList.add('review-problem'); n.title = warnings.map(w => w.message).join('\n'); }
  n.addEventListener('input', () => { update(type === 'checkbox' ? n.checked : n.value); markDirty(); }); return n;
}
async function load() {
  status.textContent = 'Loading…';
  const next = await (await api(endpoint)).json();
  if (imageKey !== key.value) { objectUrls.forEach(URL.revokeObjectURL); objectUrls = []; imageCache.clear(); imageKey = key.value; } data = next; draft = structuredClone(data.editable); latest = data.extractions.at(-1); dirty = false; reviewed.clear(); await render();
}
async function render() {
  summary.replaceChildren(); highlightedRow = null; highlightedIssueCard = null;
  if (data.game.discordThreadCleanedAt) summary.append(el("p", `Discord Thread: Cleaned after Week ${data.game.weekNumber} · ${new Date(data.game.discordThreadCleanedAt).toLocaleString()}. Game history and original screenshots remain available.`));
  if (data.teamRecords?.length) summary.append(el("p", data.teamRecords.map(t => `${t.teamName}: ${t.W}–${t.L}`).join(" · ")));
  status.textContent = `Week ${data.game.weekNumber} · ${data.game.team1Name} vs ${data.game.team2Name} · ${data.game.status}`;
  const score = el('p', latest?.normalized?.screenshots.map(s => `${s.displayedTeamName}: ${s.scoreboard.find(b => b.teamId === s.teamId)?.finalScore ?? 'Unreadable'}`).join(' · ')); score.className = 'review-score'; summary.append(score);
  if (!data.game.locked && latest?.normalized) summary.append(el('p', 'Extracted score · Pending approval. Stats and standings publish when the week advances.', 'review-score-caption'));
  const history = el('details', null, 'review-history'), historyTitle = el('summary', `Submission history · ${data.extractions.length} extraction / correction revisions`); history.append(historyTitle);
  for (const attempt of data.extractions) {
    const d = el('details'); d.append(el('summary', `${attempt.timestamp} · ${attempt.actor?.operator || attempt.provider} · ${attempt.status}`));
    let loading = false;
    d.addEventListener('toggle', async () => {
      if (!d.open || loading) return; loading = true;
      const detail = el('pre', 'Loading revision…'); d.append(detail);
      try { detail.textContent = JSON.stringify(await (await api(endpoint + '?history=' + encodeURIComponent(attempt.extractionId))).json(), null, 2); }
      catch(error) { detail.textContent = error.message; loading = false; detail.remove(); }
    }); history.append(d);
  } summary.append(history);
  if (!draft) {
    if (data.game.status === 'FINAL') {
      const operator = el('input'); operator.placeholder = 'Commissioner name'; operator.maxLength = 100; operator.setAttribute('aria-label', 'Commissioner name');
      const reason = el('input'); reason.placeholder = 'Reason for reversing this result'; reason.maxLength = 1000; reason.setAttribute('aria-label', 'Reversal reason');
      const button = el('button', 'Reverse approved result'); let confirmed = false;
      button.onclick = async () => {
        if (busy) return;
        if (!operator.value.trim() || reason.value.trim().length < 5) { status.textContent = 'Enter your commissioner name and a reason of at least five characters.'; return; }
        if (!confirmed) { confirmed = true; button.textContent = 'Confirm reversal — remove official result'; return; }
        busy = true; button.disabled = true;
        try { await api(endpoint.replace(/review$/, 'reverse'), { extractionId: latest.extractionId, operator: operator.value.trim(), revisionReason: reason.value.trim() }); await load(); }
        catch(error) { status.textContent = error.message; button.disabled = false; } finally { busy = false; }
      }; summary.append(operator,reason,button);
    }
    summary.append(el('p', latest?.error || 'No extracted data yet.'));
    for (const [i, media] of (data.media || []).entries()) {
      const card = el('section', null, 'review-card'), original = el('div', null, 'review-original'); card.append(el('h3', `Original screenshot ${i + 1}`)); card.append(original); summary.append(card);
      attachOriginal(original, media.mediaId, `Original image ${i + 1}`);
    }
    return;
  }
  const final = data.game.status === 'FINAL';
  if (final && latest.revisesExtractionId === data.game.result?.extractionId) { revisionMode = true; revisionReason ||= latest.revisionReason; }
  const locked = (!!data.game.locked || final) && !revisionMode;
  const operator = el('label', 'Commissioner name'); operator.className = 'review-operator'; const name = el('input'); name.id = 'operator'; name.maxLength = 100; name.required = true; name.placeholder = 'Your name'; name.value = sessionStorage.getItem('leaguebuddyReviewOperator') || ''; operator.append(name, el('small', 'Required so corrections and approval are recorded under your name.')); summary.append(operator);
  const reasonLabel = el('label', 'Reason for correction, rejection or reversal'), reasonInput = el('input'); reasonInput.maxLength = 1000; reasonInput.value = revisionReason; reasonInput.setAttribute('aria-label', 'Review decision reason'); reasonInput.oninput = () => { revisionReason = reasonInput.value.trim(); }; reasonLabel.append(reasonInput); summary.append(reasonLabel);
  if (final && locked) {
    const beginCorrection = el('button', 'Correct approved result'); beginCorrection.type = 'button';
    beginCorrection.onclick = () => { if (revisionReason.length < 5) { feedback('Enter a reason of at least five characters.', true); reasonInput.focus(); return; } revisionMode = true; render(); };
    summary.append(beginCorrection);
  }
  if (final && revisionMode) summary.append(el('p', 'Correction in progress. The original result remains official until you save, revalidate and approve this correction.'));
  const warningBox = el('section', null, 'review-warnings'); warningBox.id = 'review-issues';
  const issues = latest.issues || [], checks = issues.filter(i => ['UNCERTAIN_FIELD', 'CONFIDENCE'].includes(i.code)).length;
  warningBox.append(el('h3', locked ? 'Game approved' : issues.length ? `${issues.length} items to review` : 'All validation checks passed'));
  warningBox.append(el('p', locked ? 'This game is final. The result, player stats and standings are saved.' : issues.length ? `${checks} screenshot checks · ${issues.length - checks} corrections needed. Verify uncertain readings against the original; edit incorrect values in the table, then save.` : 'Save and revalidate to confirm your review, then approve the game to record the result.'));
  const issueNav = el('div', null, 'review-issue-nav'), previousIssue = el('button', 'Previous issue'), nextIssue = el('button', 'Next issue'), issueProgress = el('span');
  previousIssue.type = 'button'; nextIssue.type = 'button'; issueProgress.id = 'issue-progress'; issueProgress.setAttribute('aria-live', 'polite');
  issueNav.append(previousIssue, issueProgress, nextIssue); warningBox.append(issueNav);
  const issueCards = [];
  let currentIssueIndex = 0;
  function updateIssueProgress() {
    const unresolved = issues.filter(issue => !(['UNCERTAIN_FIELD', 'CONFIDENCE'].includes(issue.code) && reviewed.has(issue.path))).length;
    issueProgress.textContent = issues.length ? `Item ${currentIssueIndex + 1} of ${issues.length} · ${unresolved} unresolved` : 'No review items';
    previousIssue.disabled = nextIssue.disabled = issues.length < 2;
  }
  function focusIssue(index) {
    if (!issues.length) return;
    currentIssueIndex = (index + issues.length) % issues.length;
    updateIssueProgress();
    jumpToIssue(issueCards[currentIssueIndex].location.path, issueCards[currentIssueIndex].card);
  }
  previousIssue.onclick = () => focusIssue(currentIssueIndex - 1); nextIssue.onclick = () => focusIssue(currentIssueIndex + 1);
  for (const [issueIndex, issue] of issues.entries()) {
    const location = issueLocation(issue), row = el('div', null, 'review-issue'), checkable = ['UNCERTAIN_FIELD', 'CONFIDENCE'].includes(issue.code);
    row.append(el('strong', location.label), el('p', issue.message));
    const tools = el('div', null, 'review-issue-tools'), jump = el('button', 'Show in table'); jump.type = 'button'; jump.onclick = () => focusIssue(issueIndex); tools.append(jump);
    if (checkable && !locked) { const label = el('label', 'Matches the original screenshot'); const check = input(false, `Verified ${issue.path}`, v => { v ? reviewed.add(issue.path) : reviewed.delete(issue.path); updateIssueProgress(); }, 'checkbox'); label.prepend(check); tools.append(label); }
    else if (!checkable) tools.append(el('small', 'Correct the highlighted value before approval.'));
    row.append(tools); warningBox.append(row); issueCards.push({ location, card: row });
  }
  updateIssueProgress(); summary.append(warningBox);
  for (const [i, screen] of draft.screenshots.entries()) {
    const base = `screenshots.${i}`, card = el('section', null, 'review-card'); card.append(el('h3', screen.tableTeamName));
    const comparison = el('div', null, 'review-comparison'), original = el('div', null, 'review-original');
    attachOriginal(original, screen.mediaId, `Original ${screen.tableTeamName} box score`);
    const editor = el('fieldset'); editor.disabled = locked; editor.append(el('legend', 'Extracted box score'));
    for (const [j, board] of screen.scoreboard.entries()) {
      const row = el('div', null, 'review-toolbar'); row.append(el('strong', board.teamName));
      for (const [k, period] of board.periods.entries()) { const label = el('label', period.label); label.append(input(period.score, `${base}.scoreboard.${j}.periods.${k}`, v => period.score = v)); row.append(label); }
      const label = el('label', 'Final score'); label.append(input(board.finalScore, `${base}.scoreboard.${j}.finalScore`, v => board.finalScore = v)); row.append(label); editor.append(row);
    }
    const scroll = el('div', null, 'review-table-wrap'), table = el('table'), head = el('tr');
    for (const title of ['Player / roster match', 'DNP', ...fields]) head.append(el('th', title)); table.append(head);
    const teamId = latest.normalized.screenshots[i].teamId, roster = latest.rosterSnapshot?.[teamId] || [];
    for (const [j, p] of screen.players.entries()) {
      const row = el('tr'), cell = el('td'); cell.append(el('span', p.displayedName));
      const select = el('select'); select.setAttribute('aria-label', `${p.displayedName} roster match`); select.dataset.path = `${base}.players.${j}.playerId`; select.append(new Option('Select roster player…', ''));
      for (const candidate of roster) select.append(new Option(candidate.name, candidate.playerId)); select.value = p.playerId || ''; if (!p.playerId) select.classList.add('review-problem');
      select.addEventListener('change', () => { p.playerId = select.value || null; markDirty(); }); cell.append(select);
      const candidates = latest.normalized.screenshots[i]?.players?.[j]?.candidates || [];
      const suggestions = candidates.filter(candidate => candidate.playerId !== p.playerId).slice(0, 3);
      if (suggestions.length) {
        const choices = el('div', null, 'review-match-suggestions');
        choices.append(el('span', p.playerId ? 'Other possible matches' : 'Suggested matches'));
        for (const candidate of suggestions) {
          const button = el('button', candidate.name); button.type = 'button'; button.setAttribute('aria-label', `Assign ${candidate.name} to this row`);
          button.title = `Assign this screenshot row's stats to ${candidate.name}`;
          button.addEventListener('click', () => { select.value = candidate.playerId; select.dispatchEvent(new Event('change')); });
          choices.append(button);
        }
        if (candidates.length > 3) choices.append(el('small', `${candidates.length - 3} more in roster list`));
        cell.append(choices);
      }
      const rowIssues = issues.filter(issue => ['UNCERTAIN_FIELD','CONFIDENCE'].includes(issue.code) && (issue.path === `${base}.players.${j}` || issue.path.startsWith(`${base}.players.${j}.`)));
      if (rowIssues.length && !locked) {
        const verify = el('button', 'Verified this row'); verify.type = 'button';
        verify.onclick = () => { for (const issue of rowIssues) { reviewed.add(issue.path); const checkbox = summary.querySelector(`[data-path="Verified ${issue.path}"]`); if (checkbox) checkbox.checked = true; } updateIssueProgress(); markDirty(); verify.textContent = 'Row verified ✓'; };
        cell.append(verify);
      }
      row.append(cell);
      const dnp = el('td'); dnp.append(input(p.dnp, `${base}.players.${j}.dnp`, v => { p.dnp = v; for (const n of row.querySelectorAll('[data-stat]')) n.disabled = v; }, 'checkbox')); row.append(dnp);
      for (const field of fields) { const td = el('td'); const n = input(p.stats[field], `${base}.players.${j}.stats.${field}`, v => p.stats[field] = v); n.dataset.stat = field; n.disabled = p.dnp === true; td.append(n); row.append(td); } table.append(row);
    }
    const totals = el('tr'); totals.append(el('th', 'Team totals'), el('td'));
    for (const field of fields) { const td = el('td'); td.append(input(screen.totals[field], `${base}.totals.${field}`, v => screen.totals[field] = v)); totals.append(td); } table.append(totals); scroll.append(table); editor.append(scroll); comparison.append(original, editor); card.append(comparison); summary.append(card);
  }
  const actions = el('div', null, 'review-toolbar'), save = el('button', 'Save corrections & revalidate', 'primary-action'), approve = el('button', 'APPROVE GAME', 'primary-action'); approve.id = 'approve'; if (locked) approve.textContent = 'APPROVED ✓'; save.disabled = locked; approve.disabled = locked || !latest.correctedInput || latest.issues.length > 0;
  const actionPanel = el('section', null, 'review-action-panel');
  actionPanel.append(el('h3', locked ? 'Game approved' : 'Finish your review'), el('p', locked ? 'Review complete. No further action is needed.' : '1. Save corrections and verify the checks.  2. Approve the game to save its result for the next week advancement.'));
  const notice = el('p', null, 'review-action-status'); notice.id = 'action-status'; notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  actionPanel.append(notice);
  async function act(action) {
    if (busy) return;
    if (!name.value.trim()) { feedback('Enter your commissioner name above before saving or approving.', true); name.setAttribute('aria-invalid', 'true'); name.focus(); return; }
    name.removeAttribute('aria-invalid'); busy = true; save.disabled = true; approve.disabled = true;
    feedback(action === 'correct' ? 'Saving corrections and checking the box scores…' : 'Approving game and updating stats…');
    let accepted = false;
    try {
      sessionStorage.setItem('leaguebuddyReviewOperator', name.value.trim());
      const response = await api(endpoint.replace(/review$/, action), { extractionId: latest.extractionId, operator: name.value.trim(), revisionReason, ...(action === 'correct' ? { input: draft, reviewedPaths: [...reviewed] } : {}) });
      if (action === 'approve') { const game = await response.json(); accepted = true; dirty = false; revisionMode = false; revisionReason = ''; approve.textContent = 'APPROVED ✓'; approvalConfirmation(game); }
      await load();
      feedback(action === 'approve' ? 'Game approved. Stats and standings are saved.' : latest.issues.length ? `Saved successfully. ${latest.issues.length} items still need review above before approval.` : 'Saved successfully. All checks passed — you can now approve the game.');
      document.querySelector('#action-status')?.scrollIntoView({ block: 'center' });
    } catch (e) { if (accepted) { feedback('Game approved and saved. The page could not refresh; reload to see the updated result.', true); return; } feedback(e.message, true); save.disabled = locked; approve.disabled = locked || dirty || !latest.correctedInput || latest.issues.length > 0; }
    finally { busy = false; }
  }
  save.onclick = () => act('correct'); approve.onclick = () => act('approve'); actions.append(save, approve); actionPanel.append(actions);
  const decision = el('button', final ? 'Reverse approved result' : 'Reject this submission'); decision.type = 'button';
  let confirmDecision = false;
  decision.onclick = async () => {
    if (busy) return;
    if (!name.value.trim() || revisionReason.length < 5) { feedback('Enter your commissioner name and a reason of at least five characters.', true); return; }
    if (!confirmDecision) { confirmDecision = true; decision.textContent = final ? 'Confirm reversal — remove official result' : 'Confirm rejection'; return; }
    busy = true; decision.disabled = true;
    try { await api(endpoint.replace(/review$/, final ? 'reverse' : 'reject'), { extractionId: latest.extractionId, operator: name.value.trim(), revisionReason }); revisionMode = false; dirty = false; await load(); feedback(final ? 'Approval reversed. The original result is retained in the audit history; review or resubmit the correct scores.' : 'Submission rejected. Coaches can submit new box scores.'); }
    catch (error) { feedback(error.message, true); decision.disabled = false; } finally { busy = false; }
  };
  actionPanel.append(decision);
  const back = el('a', 'Back to review items'); back.href = '#review-issues'; actionPanel.append(back); summary.append(actionPanel);
  feedback(locked ? 'Game approved.' : issues.length ? 'Approval is unavailable until the review items above are resolved.' : latest.correctedInput ? 'Ready to approve.' : 'Save and revalidate to enable approval.');
  if (locked) summary.append(el('p', 'Final score and stats are saved. Originals and revision history remain preserved.'));
}
form.addEventListener('submit', async e => { e.preventDefault(); try { sessionStorage.setItem('leaguebuddyAdminKey', key.value); localStorage.removeItem('leaguebuddyAdminKey'); await load(); } catch (err) { status.textContent = err.message; summary.replaceChildren(); } });
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
if (key.value) load().catch(e => status.textContent = e.message);
