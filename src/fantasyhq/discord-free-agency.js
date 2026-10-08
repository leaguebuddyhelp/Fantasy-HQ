const fs = require('fs');
const path = require('path');
const { randomUUID, createHash } = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, ModalBuilder, LabelBuilder, FileUploadBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, MessageFlags, PermissionFlagsBits: P } = require('discord.js');
const { STAFF_ROLES } = require('./discord-permissions');
const { createFreeAgencyService, offerWindowDuration, ROSTER_SIZE } = require('./free-agency-service');
const { parseContractText, normalizeOffer } = require('./offer-score');
const { compactDollars } = require('../shared/player-contract');
const { activeMemberships } = require('./service-helpers');
const { recognizeContractText } = require('./box-score/tesseract-provider');
const EPHEMERAL = MessageFlags.Ephemeral;
const pinLocks = new Map();
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`fa:${id}`).setLabel(label).setStyle(style);
const embed = (title, description) => new EmbedBuilder().setColor(0xffdc21).setTitle(title).setDescription(description || '—');
const time = value => `<t:${Math.floor(Date.parse(value) / 1000)}:t>`;
const contractText = details => `Salary: **${typeof details.salary === 'number' ? compactDollars(details.salary) : details.salary || 'Not read'}**\nYears: **${details.years || 'Not read'}**\nStructure: **${({ FLAT: 'Flat', FRONT: 'Front (-5%)', BACK: 'Back (+5%)' })[details.structure] || details.structure || 'Not read'}**\nOption: **${details.option === 'PLAYER' ? 'Player Option' : details.option === 'TEAM' ? 'Team Option' : details.option || 'None'}**`;
const isStaff = interaction => Boolean(interaction.member?.roles?.cache?.some(role => STAFF_ROLES.has(role.name)));
function permanentPayload(settings = {}, phase = 'REGULAR_SEASON') {
  if (phase === 'FREE_AGENCY') return { embeds:[embed('LEAGUEbuddy OFFSEASON FREE AGENCY','Exclusive re-signing, then three rating stages. Each period normally lasts **24 hours**.\n\nKeep up to **5 private active offers**, with unique priorities **1–5**. Open stages allow **3 signings per team per stage**, **9 total**. Exclusive re-signings do not use those limits.\n\nStaff confirms winning offers after the deadline. Use the buttons below for the current stage.')],components:[row(button('sign','SIGN FREE AGENT',ButtonStyle.Primary),button('active','MY ACTIVE OFFERS'))],allowedMentions:{parse:[]} };
  const duration = offerWindowDuration(settings);
  const clock = duration === 3600000 ? '**1 hour**' : `**${duration / 1000} seconds (Test Mode)**`;
  return { embeds: [embed('LEAGUEbuddy FREE AGENCY', `Submit an official NBA 2K contract offer for an available free agent.\n\nNew offer windows remain open for ${clock}. Existing windows keep their saved deadlines. Contract details stay private until the player signs.\n\nRegular season: maximum **5 signings** and **2 active targets** per team.`)], components: [row(button('sign', 'SIGN FREE AGENT', ButtonStyle.Primary), button('active', 'MY ACTIVE OFFERS'))], allowedMentions: { parse: [] } };
}
function createDiscordFreeAgency({ repository, service = createFreeAgencyService({ repository }), client, ocr = recognizeContractText, fetcher = fetch } = {}) {
  let sweeping = false;
  const state = leagueId => repository.loadFreeAgencyState(leagueId);
  const playerName = (leagueId, id) => repository.loadPlayers(leagueId).find(p => p.playerId === id)?.name || id;
  const teamName = (context, id) => context.teams.find(t => t.teamId === id)?.teamName || id;
  function contextFor(interaction) { if (!interaction.guildId) throw Error('Open this control in your league server.'); return repository.loadLeagueContext({ guildId: interaction.guildId }); }
  function requireStaff(interaction) { if (!isStaff(interaction)) throw Error('Only configured league Staff can review proof.'); }
  function ownedTeam(interaction, context) {
    return require('./coach-identity').requireCoachIdentity(repository, context, interaction.member, interaction.user.id).teamId;
  }
  function newDraft(interaction, context, teamId, extra = {}) {
    const draft = { id: randomUUID(), leagueId: context.league.leagueId, seasonId: context.seasonId, guildId: interaction.guildId, coachUserId: interaction.user.id, teamId, createdAt: new Date().toISOString(), ...extra };
    service.update(draft.leagueId, s => { s.drafts = s.drafts.filter(d => Date.now() - Date.parse(d.createdAt) < 86400000); s.drafts.push(draft); }); return draft;
  }
  function getDraft(interaction, context, id) {
    const d = state(context.league.leagueId).drafts.find(d => d.id === id);
    if (!d || d.cancelled || d.coachUserId !== interaction.user.id || d.guildId !== interaction.guildId || d.seasonId !== context.seasonId || Date.now() - Date.parse(d.createdAt) > 86400000) throw Error('This private workflow expired. Start again.');
    service.authorize(d.leagueId, { teamId: d.teamId, actorUserId: interaction.user.id, staffAuthorized: isStaff(interaction) });
    if (!(repository.loadSettings(d.leagueId)?.testMode === true && isStaff(interaction)) && ownedTeam(interaction, context) !== d.teamId) throw Error('Your Coach role changed. Restart this workflow.');
    return d;
  }
  function changeDraft(d, updates) { service.update(d.leagueId, s => Object.assign(s.drafts.find(a => a.id === d.id), updates)); return Object.assign(d, updates); }
  function positions(d) {
    return { embeds: [embed('SIGN FREE AGENT', 'Choose a primary position. Players appear under their primary position only.')], components: [row(new StringSelectMenuBuilder().setCustomId(`fa:position:${d.id}`).setPlaceholder('Choose primary position').addOptions(['PG', 'SG', 'SF', 'PF', 'C'].map(p => ({ label: p, value: p }))))] };
  }
  function browser(d, page = 0) {
    const all = service.browse(d.leagueId, d.position), pages = Math.max(1, Math.ceil(all.length / 25)); page = Math.max(0, Math.min(page, pages - 1));
    const list = all.slice(page * 25, page * 25 + 25);
    const rows = [];
    if (list.length) rows.push(row(new StringSelectMenuBuilder().setCustomId(`fa:player:${d.id}`).setPlaceholder('Choose a free agent').addOptions(list.map(p => ({ label: `${p.name} · ${p.position1} · ${p.overall ?? '—'} OVR`.slice(0, 100), value: p.playerId, description: p.status === 'AVAILABLE' ? 'Available' : `Offer window ${p.status === 'OPEN' ? 'active' : 'closed'} · deadline ${new Date(p.deadlineAt).toLocaleTimeString('en-US', { timeZone: 'UTC' }) + ' UTC'}` })))));
    const nav = [button(`positions:${d.id}`, 'CHANGE POSITION')];
    if (page > 0) nav.push(button(`page:${d.id}:${page - 1}`, 'PREVIOUS'));
    if (page + 1 < pages) nav.push(button(`page:${d.id}:${page + 1}`, 'NEXT'));
    rows.push(row(...nav));
    const activeLines = list.filter(p => p.status !== 'AVAILABLE').map(p => `**${p.name}** · ${p.status === 'OPEN' ? 'Offer window active' : 'Offer window closed'} · deadline ${time(p.deadlineAt)}`).join('\n');
    return { embeds: [embed(`${d.position} FREE AGENTS`, `${all.length} available players · highest OVR first · page ${page + 1}/${pages}\n${list.length ? 'Choose a player to upload your private contract screenshot.' : 'No free agents at this position.'}${activeLines ? `\n\n${activeLines}` : ''}`)], components: rows };
  }
  function uploadModal(d) { return new ModalBuilder().setCustomId(`fa:upload:${d.id}`).setTitle('NBA 2K Contract Offer').addLabelComponents(new LabelBuilder().setLabel('Upload the NBA 2K offer screenshot').setDescription('Salary, Years, Contract Type and Option must be visible.').setFileUploadComponent(new FileUploadBuilder().setCustomId('screenshot').setMinValues(1).setMaxValues(1).setRequired(true))); }
  function detailsModal(id, details, staff = false) {
    const modal = new ModalBuilder().setCustomId(`fa:${staff ? 'correctsave' : 'editdetails'}:${id}`).setTitle(staff ? 'Correct Contract Details' : 'Confirm OCR Details');
    for (const [key, label] of [['salary', 'Salary, e.g. $6.66M'], ['years', 'Years, e.g. 3+1'], ['structure', 'Flat / Front (-5%) / Back (+5%)'], ['option', 'None / Team / Player']]) {
      let value = details[key];
      if (key === 'option') value = value === 'PLAYER' ? 'Player' : value === 'TEAM' ? 'Team' : value || 'None';
      const input = new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true);
      if (value != null && value !== '') input.setValue(String(value).slice(0, 100));
      modal.addComponents(row(input));
    }
    return modal;
  }
  function confirmation(d) { return { embeds: [embed(`FREE AGENT OFFER · ${playerName(d.leagueId, d.playerId)}`, `${contractText(d.details)}\n\nYour screenshot is the official offer. Staff verifies it before it can win.${d.ocrError ? `\n\n${d.ocrError}\nUse FIX OCR DETAILS or upload a clearer screenshot.` : ''}`)], components: [row(button(`submit:${d.id}`, 'CONFIRM & SUBMIT', ButtonStyle.Success).setDisabled(Boolean(d.ocrError)), button(`edit:${d.id}`, 'FIX OCR DETAILS'), button(`cancel:${d.id}`, 'CANCEL'))] }; }
  function releaseMenu(d, mode, windowId = null, page = 0) {
    const list = service.eligibleReleases(d.leagueId, d.teamId, windowId), pages = Math.max(1, Math.ceil(list.length / 25)); page = Math.max(0, Math.min(page, pages - 1));
    const visible = list.slice(page * 25, page * 25 + 25), rows = [];
    if (visible.length) rows.push(row(new StringSelectMenuBuilder().setCustomId(`fa:${mode}:${d.id}`).setPlaceholder(mode === 'waiveplayer' ? 'Select a player to waive' : 'Select a conditional release').addOptions(visible.map(p => ({ label: `${p.name} · ${p.position1 || '—'} · ${p.overall ?? '—'} OVR`.slice(0, 100), value: p.playerId })))));
    const nav = [];
    if (page > 0) nav.push(button(`releasepage:${d.id}:${page - 1}`, 'PREVIOUS'));
    if (page + 1 < pages) nav.push(button(`releasepage:${d.id}:${page + 1}`, 'NEXT'));
    if (nav.length) rows.push(row(...nav));
    return { embeds: [embed(mode === 'waiveplayer' ? 'WAIVE PLAYER' : 'CHOOSE CONDITIONAL RELEASE', `${visible.length ? 'Only current, unlocked roster players are selectable.' : 'No eligible unlocked roster players.'}\n${mode === 'waiveplayer' ? 'Staff must approve your waiver. No screenshot is required.' : 'The release happens only if this signing completes.'}\nPage ${page + 1}/${pages}`)], components: rows };
  }
  function activePayload(d) {
    const s = state(d.leagueId), status = service.getStatus(d.leagueId, d.teamId), windows = status.targets, rows = [];
    const text = windows.map(w => {
      const own = s.offers.filter(o => o.windowId === w.id && o.teamId === d.teamId && ['PENDING_REVIEW', 'APPROVED'].includes(o.status));
      const approved = own.find(o => o.status === 'APPROVED'), pending = own.find(o => o.status === 'PENDING_REVIEW'), current = pending || approved;
      if (w.status === 'OPEN' && Date.now() < Date.parse(w.deadlineAt)) rows.push(row(button(`improve:${d.id}:${w.id}`, `IMPROVE ${playerName(d.leagueId, w.playerId)}`.slice(0,80)), button(`withdraw:${d.id}:${w.id}`, 'WITHDRAW OFFER', ButtonStyle.Danger)));
      if (w.status === 'AWAITING_WINNER_ROSTER_CUT' && s.offers.find(o => o.id === w.winnerOfferId)?.teamId === d.teamId) rows.push(row(button(`cut:${d.id}:${w.id}`, 'CHOOSE ROSTER CUT', ButtonStyle.Primary)));
      return `**${playerName(d.leagueId, w.playerId)}**\n${contractText(current.details)}\nStaff: ${current.status.replaceAll('_', ' ')}${approved && pending ? ' · previous approved offer remains valid' : ''}\nDeadline: ${time(w.deadlineAt)}${w.cutDeadlineAt && w.winnerOfferId === current.id ? `\nCut deadline: ${time(w.cutDeadlineAt)}` : ''}\nConditional release: ${current.conditionalReleasePlayerId ? playerName(d.leagueId, current.conditionalReleasePlayerId) : 'None'}`;
    });
    return { embeds: [embed('MY ACTIVE OFFERS', `FA Signings: **${status.completedSignings}/5** · Active Targets: **${status.activeTargets}/${status.allowedActiveTargets}**\n\n${text.join('\n\n') || 'No active offers.'}`)], components: rows };
  }
  async function begin(interaction, context, mode) {
    const settings = repository.loadSettings(context.league.leagueId);
    if (settings?.testMode === true && isStaff(interaction)) {
      const owners = repository.loadOwners(context.league.leagueId), teams = context.teams.filter(t => !owners.some(o => o.teamId === t.teamId && o.userId !== interaction.user.id));
      const d = newDraft(interaction, context, null, { mode });
      return testTeams(interaction, context, d);
    }
    const d = newDraft(interaction, context, ownedTeam(interaction, context), { mode });
    return startMode(d);
  }
  function testTeams(interaction, context, d, page = 0) {
    const owners = repository.loadOwners(context.league.leagueId);
    const teams = context.teams.filter(t => !owners.some(o => o.teamId === t.teamId && o.userId !== interaction.user.id));
    const pages = Math.max(1, Math.ceil(teams.length / 25)); page = Math.max(0, Math.min(page, pages - 1));
    const rows = [];
    if (teams.length) rows.push(row(new StringSelectMenuBuilder().setCustomId(`fa:testteam:${d.id}`).setPlaceholder('Choose test team').addOptions(teams.slice(page * 25, page * 25 + 25).map(t => ({ label: t.teamName, value: t.teamId })))));
    const nav = [];
    if (page > 0) nav.push(button(`testpage:${d.id}:${page - 1}`, 'PREVIOUS'));
    if (page + 1 < pages) nav.push(button(`testpage:${d.id}:${page + 1}`, 'NEXT'));
    if (nav.length) rows.push(row(...nav));
    rows.push(row(button(`testclock:${d.id}`, offerWindowDuration(repository.loadSettings(context.league.leagueId)) < 3600000 ? 'RESTORE 1h CLOCK' : 'USE 60s TEST CLOCK'), button(`testphase:${d.id}:PLAYOFFS`, 'TEST PLAYOFF TRANSITION'), button(`testphase:${d.id}:REGULAR_SEASON`, 'RESTORE TEST REGULAR SEASON')));
    return { embeds: [embed('TEST MODE · CHOOSE TEAM', `Staff may act for their own team or a vacant team. Assigned coaches remain protected. Use a separate test league/server to keep production data safe.\nPage ${page + 1}/${pages}`)], components: rows };
  }
  function startMode(d) { if (d.mode === 'waive' && repository.loadLeague(d.leagueId).league.currentPhase !== 'REGULAR_SEASON') throw Error('New waiver requests require REGULAR_SEASON.'); if (d.mode === 'active') return activePayload(d); if (d.mode === 'waive') { changeDraft(d, { releaseMode: 'waiveplayer' }); return releaseMenu(d, 'waiveplayer'); } return positions(d); }
  async function submitDraft(interaction, context, d, releaseId = null) {
    await channelFor(interaction.guild, d.leagueId, 'proof');
    await channelFor(interaction.guild, d.leagueId, 'announcements');
    const submitted = service.offer(d.leagueId, { teamId: d.teamId, actorUserId: interaction.user.id, playerId: d.playerId, details: d.details, ocrOriginal: d.ocrOriginal, screenshot: d.screenshot, conditionalReleasePlayerId: releaseId || d.conditionalReleasePlayerId || null, staffAuthorized: isStaff(interaction), requestId: d.id });
    await interaction.editReply({ embeds: [embed('OFFER SUBMITTED', `${playerName(d.leagueId, d.playerId)} · awaiting Staff review.\nDeadline: ${time(state(d.leagueId).windows.find(w => w.id === submitted.windowId).deadlineAt)}\n\nYour roster stays unchanged until a signing completes.`)], components: [] });
    await tick();
  }
  async function handle(interaction) {
    try {
      const context = contextFor(interaction), leagueId = context.league.leagueId;
      const [, action, id, extra] = interaction.customId.split(':');
      if (context.league.currentPhase === 'FREE_AGENCY' && ['sign','active'].includes(action)) { await require('./discord-offseason-free-agency').createDiscordOffseasonFreeAgency({ repository }).handle(interaction); return; }
      if (['approve', 'reject', 'correct', 'waiverapprove', 'waiverreject', 'correctsave'].includes(action)) {
        requireStaff(interaction);
        if (action === 'correct') { const o = state(leagueId).offers.find(o => o.id === id && o.status === 'PENDING_REVIEW'); if (!o) throw Error('This offer is no longer pending.'); await interaction.showModal(detailsModal(id, o.details, true)); return; }
        await interaction.deferReply({ flags: EPHEMERAL });
        if (action === 'correctsave') service.reviewOffer(leagueId, { offerId: id, decision: 'CORRECT', actorUserId: interaction.user.id, staffAuthorized: true, correction: Object.fromEntries(['salary','years','structure','option'].map(k => [k, interaction.fields.getTextInputValue(k)])) });
        else if (action.startsWith('waiver')) service.reviewWaiver(leagueId, { waiverId: id, decision: action === 'waiverapprove' ? 'APPROVE' : 'REJECT', actorUserId: interaction.user.id, staffAuthorized: true });
        else service.reviewOffer(leagueId, { offerId: id, decision: action === 'approve' ? 'APPROVE' : 'REJECT', actorUserId: interaction.user.id, staffAuthorized: true });
        await interaction.editReply({ content: 'Staff decision saved.' }); await tick(); return;
      }
      if (['sign', 'active', 'waive'].includes(action)) {
        await interaction.deferReply({ flags: EPHEMERAL }); await interaction.editReply(await begin(interaction, context, action)); return;
      }
      // Test-team selection has no team yet; verify Staff before assigning a vacant team.
      if (action === 'testteam' || action === 'testpage' || action === 'testclock' || action === 'testphase') {
        requireStaff(interaction); const d = state(leagueId).drafts.find(d => d.id === id && d.coachUserId === interaction.user.id);
        if (!d || repository.loadSettings(leagueId)?.testMode !== true) throw Error('Test Mode is not enabled.');
        if (action === 'testphase') {
          if (!['REGULAR_SEASON','PLAYOFFS'].includes(context.league.currentPhase) || !['REGULAR_SEASON','PLAYOFFS'].includes(extra)) throw Error('Start the test league normally before testing its playoff transition.');
          repository.saveLeague(leagueId, { currentPhase: extra });
          repository.appendAuditLog(leagueId, { action: 'fa.test.phasechanged', userId: interaction.user.id, leagueId, seasonId: context.seasonId, timestamp: new Date().toISOString(), metadata: { from: context.league.currentPhase, to: extra } });
          await interaction.update({ content: `Test league phase is now ${extra}. Existing FA windows and pending waivers keep their original deadlines and can finish.`, ...testTeams(interaction, context, d) }); return;
        }
        if (action === 'testclock') {
          const settings = repository.loadSettings(leagueId), shortened = offerWindowDuration(settings) < 3600000;
          const next = { ...settings };
          if (shortened) delete next.freeAgencyTestWindowSeconds; else next.freeAgencyTestWindowSeconds = 60;
          repository.saveSettings(leagueId, next);
          repository.appendAuditLog(leagueId, { action: 'fa.test.clockchanged', userId: interaction.user.id, timestamp: new Date().toISOString(), metadata: { fromMs: offerWindowDuration(settings), toMs: offerWindowDuration(next) } });
          await interaction.update({ content: `New test windows use ${shortened ? '1 hour' : '60 seconds'}. Existing offer and cut deadlines stay unchanged.`, ...testTeams(interaction, context, d) });
          await ensurePin(interaction.guild, leagueId); return;
        }

        if (action === 'testpage') { await interaction.update(testTeams(interaction, context, d, Number(extra))); return; }
        service.authorize(leagueId, { teamId: interaction.values[0], actorUserId: interaction.user.id, staffAuthorized: true });
        changeDraft(d, { teamId: interaction.values[0] }); await interaction.update(startMode(d)); return;
      }
      const d = getDraft(interaction, context, id);
      if (action === 'player' || action === 'improve') {
        const w = action === 'improve' ? state(leagueId).windows.find(w => w.id === extra) : null;
        const playerId = w?.playerId || interaction.values?.[0];
        const window = state(leagueId).windows.find(a => a.playerId === playerId && ['OPEN','CLOSED_AWAITING_REVIEW','RESOLVING','AWAITING_WINNER_ROSTER_CUT'].includes(a.status));
        if (window && (window.status !== 'OPEN' || Date.now() >= Date.parse(window.deadlineAt))) throw Error('This offer window is closed.');
        if (context.league.currentPhase !== 'REGULAR_SEASON' && !(action === 'player' && context.league.currentPhase === 'PLAYOFFS' && window?.startedPhase === 'REGULAR_SEASON')) throw Error('New windows and improvements require REGULAR_SEASON.');
        if (!repository.loadPlayers(leagueId).some(p => p.playerId === playerId) || activeMemberships(repository.loadRosterMemberships(leagueId), context.seasonId).some(m => m.playerId === playerId)) throw Error('Player is no longer a free agent.');
        const next = newDraft(interaction, context, d.teamId, { playerId, conditionalReleasePlayerId: w ? state(leagueId).offers.find(o => o.windowId === w.id && o.teamId === d.teamId && o.status === 'APPROVED')?.conditionalReleasePlayerId : null });
        await interaction.showModal(uploadModal(next)); return;
      }
      if (action === 'edit') { await interaction.showModal(detailsModal(d.id, d.details)); return; }
      if (action === 'upload') {
        await interaction.deferReply({ flags: EPHEMERAL });
        const upload = interaction.fields.getUploadedFiles('screenshot', true).first();
        if (!upload || upload.size > 20 * 1024 * 1024 || !['image/png','image/jpeg','image/webp'].includes(upload.contentType)) throw Error('Upload a PNG, JPEG or WebP screenshot under 20 MB.');
        const response = await fetcher(upload.url, { signal: AbortSignal.timeout(20000) }); if (!response.ok) throw Error('Screenshot download failed.');
        const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > 20 * 1024 * 1024) throw Error('Screenshot exceeds 20 MB.');
        // Decode before retaining it, preserving the original bytes for Staff audit.
        await require('sharp')(bytes, { limitInputPixels: 40000000 }).metadata();
        const file = path.join(repository.buildLeaguePaths(repository.dataRoot, leagueId).leagueRoot, 'free-agency-proof', `${d.id}${path.extname(upload.name).toLowerCase() || '.png'}`);
        fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes, { flag: 'wx' });
        let text = '', error = null; try { text = await ocr(bytes); } catch (e) { error = e.message; }
        const details = parseContractText(text);
        try { normalizeOffer(details, { year: require('./asset-valuation').leagueSeasonStartYear(context.seasonId) }); } catch (e) { error ||= e.message; }
        changeDraft(d, { screenshot: { path: file, name: path.basename(file), url: upload.url }, details, ocrOriginal: details, ocrError: error });
        await interaction.editReply(confirmation(d)); return;
      }
      if (action === 'editdetails') {
        const details = Object.fromEntries(['salary','years','structure','option'].map(k => [k, interaction.fields.getTextInputValue(k)]));
        normalizeOffer(details, { year: require('./asset-valuation').leagueSeasonStartYear(context.seasonId) }); changeDraft(d, { details, ocrError: null });
        await interaction.reply({ ...confirmation(d), flags: EPHEMERAL }); return;
      }
      if (action === 'submit' || action === 'release' || action === 'winnercut' || action === 'waiversubmit') {
        await interaction.deferUpdate();
        if (action === 'submit') {
          normalizeOffer(d.details, { year: require('./asset-valuation').leagueSeasonStartYear(context.seasonId) });
          const count = activeMemberships(repository.loadRosterMemberships(leagueId), context.seasonId).filter(m => m.teamId === d.teamId).length;
          if (count >= ROSTER_SIZE && !d.conditionalReleasePlayerId) { changeDraft(d, { releaseMode: 'release' }); await interaction.editReply(releaseMenu(d, 'release')); return; }
          await submitDraft(interaction, context, d); return;
        }
        if (action === 'release') { await submitDraft(interaction, context, d, interaction.values[0]); return; }
        if (action === 'winnercut') { service.chooseCut(leagueId, { windowId: d.windowId, teamId: d.teamId, playerId: interaction.values[0], actorUserId: interaction.user.id, staffAuthorized: isStaff(interaction) }); await interaction.editReply({ content: 'Roster cut and signing completed.', embeds: [], components: [] }); await tick(); return; }
        const w = service.requestWaiver(leagueId, { teamId: d.teamId, playerId: d.playerId, actorUserId: interaction.user.id, staffAuthorized: isStaff(interaction), requestId: d.id });
        await interaction.editReply({ content: `Waiver requested for ${playerName(leagueId, w.playerId)}. Your roster stays unchanged until Staff approves.`, embeds: [], components: [] }); await tick(); return;
      }
      if (action === 'withdraw') { service.withdraw(leagueId, { windowId: extra, teamId: d.teamId, actorUserId: interaction.user.id, staffAuthorized: isStaff(interaction) }); await interaction.update(activePayload(d)); await tick(); return; }
      if (action === 'cut') { changeDraft(d, { windowId: extra, releaseMode: 'winnercut' }); await interaction.update(releaseMenu(d, 'winnercut', extra)); return; }
      if (action === 'waiveplayer') { changeDraft(d, { playerId: interaction.values[0] }); await interaction.update({ embeds: [embed('REVIEW WAIVER', `Team: **${teamName(context, d.teamId)}**\nPlayer: **${playerName(leagueId, d.playerId)}**\n\nStaff approval will remove this player and clear their active contract. This does not restore an FA signing slot.`)], components: [row(button(`waiversubmit:${d.id}`, 'SUBMIT WAIVER', ButtonStyle.Danger), button(`cancel:${d.id}`, 'CANCEL'))] }); return; }
      if (action === 'position') { changeDraft(d, { position: interaction.values[0] }); await interaction.update(browser(d)); return; }
      if (action === 'page') { await interaction.update(browser(d, Number(extra))); return; }
      if (action === 'positions') { await interaction.update(positions(d)); return; }
      if (action === 'releasepage') { await interaction.update(releaseMenu(d, d.releaseMode, d.windowId, Number(extra))); return; }
      if (action === 'cancel') { changeDraft(d, { cancelled: true }); await interaction.update({ content: 'Cancelled.', embeds: [], components: [] }); return; }
      throw Error('Unknown Free Agency action.');
    } catch (error) {
      const payload = { content: error.message, flags: EPHEMERAL };
      if (interaction.deferred && !interaction.replied) await interaction.editReply({ content: error.message }); else if (interaction.replied) await interaction.followUp(payload); else await interaction.reply(payload);
    }
  }
  async function channelFor(guild, leagueId, kind) {
    const settings = repository.loadSettings(leagueId) || {}, ids = settings.discordChannels || {};
    const id = kind === 'proof' ? ids.freeAgencyProof || ids.staff : ids[kind];
    if (!id) throw Error(`Configure ${kind === 'proof' ? 'a Staff-only proof channel' : kind} from /league setup → Create / repair channels.`);
    const channel = await guild.channels.fetch(id);
    if (!channel?.isTextBased?.()) throw Error(`Configured ${kind} channel is unavailable.`);
    if (kind === 'proof') {
      const botRoleId = guild.members.me.roles?.botRole?.id;
      const nonStaffRoles = [...guild.roles.cache.values()].filter(r => !STAFF_ROLES.has(r.name) && r.id !== botRoleId && !r.permissions?.has(P.Administrator));
      if (channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel) || nonStaffRoles.some(r => channel.permissionsFor(r)?.has(P.ViewChannel))) throw Error('Free Agent Proof must be Staff-only. Coach-visible proof would expose private offers.');
      for (const overwrite of channel.permissionOverwrites?.cache?.values() || []) {
        if (overwrite.type !== 1 || overwrite.id === guild.members.me.id || !overwrite.allow.has(P.ViewChannel)) continue;
        const member = await guild.members.fetch(overwrite.id);
        if (!member.permissions.has(P.Administrator) && !member.roles.cache.some(r => STAFF_ROLES.has(r.name))) throw Error('Free Agent Proof has a non-Staff member access override. Repair its private permissions first.');
      }
    }
    return channel;
  }
  async function ensurePin(guild, leagueId) {
    const key = `${repository.dataRoot}:${leagueId}`;
    if (pinLocks.has(key)) return pinLocks.get(key);
    const work = (async () => {
      const channel = await channelFor(guild, leagueId, 'freeAgency'), settings = repository.loadSettings(leagueId) || {};
      let message = settings.discordPins?.freeAgencyMessageId ? await channel.messages.fetch(settings.discordPins.freeAgencyMessageId).catch(e => e.code === 10008 ? null : Promise.reject(e)) : null;
      const pins = await require('../shared/discord-pins').fetchPinnedMessages(channel);
      const matching = [...pins.values()].filter(m => m.author.id === guild.members.me.id && m.components.some(r => r.components.some(c => (c.customId || c.custom_id || c.data?.custom_id) === 'fa:sign')));
      message ||= matching[0];
      if (!message) {
        const history = await channel.messages.fetch({ limit: 100 });
        message = [...history.values()].find(m => m.author.id === guild.members.me.id && m.components.some(r => r.components.some(c => (c.customId || c.custom_id || c.data?.custom_id) === 'fa:sign')));
      }
      if (message) await message.edit(permanentPayload(settings, repository.loadLeague(leagueId).league.currentPhase)); else message = await channel.send({ ...permanentPayload(settings, repository.loadLeague(leagueId).league.currentPhase), nonce: createHash('sha256').update(`fa-pin:${leagueId}`).digest('hex').slice(0,24), enforceNonce: true });
      if (!message.pinned) await message.pin('Permanent LEAGUEbuddy Free Agency entry');
      for (const duplicate of matching.filter(m => m.id !== message.id)) await duplicate.unpin('Repair duplicate Free Agency pin');
      const latest = repository.loadSettings(leagueId) || {};
      repository.saveSettings(leagueId, { ...latest, discordPins: { ...latest.discordPins, freeAgencyMessageId: message.id, freeAgencyChannelId: channel.id }, discordChannels: { ...latest.discordChannels, freeAgencyProof: latest.discordChannels?.freeAgencyProof || latest.discordChannels?.staff } });
      return message;
    })();
    pinLocks.set(key, work); try { return await work; } finally { pinLocks.delete(key); }
  }
  function publicPayload(context, w, offers, players) {
    const player = players.find(p => p.playerId === w.playerId), winner = offers.find(o => o.id === w.winnerOfferId);
    const count = new Set(offers.filter(o => o.windowId === w.id && ['PENDING_REVIEW','APPROVED'].includes(o.status)).map(o => o.teamId)).size;
    let description = `**${player?.name || w.playerId}** · ${player?.position1 || '—'}\nStatus: ${w.status.replaceAll('_', ' ')}\nTeams Interested: **${count}**\nOffer Deadline: ${time(w.deadlineAt)}\n\nContract details stay private until signing completes.`;
    if (w.status === 'COMPLETED' && winner) description = `**${player?.name || w.playerId}** has signed with **${teamName(context, winner.teamId)}**.\n\n${contractText(winner.details)}\nTotal scheduled salary: **${compactDollars(winner.contract.seasons.reduce((sum,r) => sum + r.salary, 0))}**\nPlayer-controlled value: **${compactDollars(winner.contract.guaranteedTotal)}**`;
    else if (['CANCELLED','NO_VALID_OFFERS'].includes(w.status)) description = `**${player?.name || w.playerId}** · ${player?.position1 || '—'}\nStatus: ${w.status.replaceAll('_',' ')}\n${w.reason}\nNo signing completed.`;
    return { embeds: [embed(w.status === 'COMPLETED' ? 'FREE AGENT SIGNING' : 'FREE AGENT OFFER WINDOW', description).setFooter({ text: `FA Window ${w.id}` })], components: [], allowedMentions: { parse: [] } };
  }
  function proofPayload(context, o, w) {
    const body = `Player: **${playerName(o.leagueId, o.playerId)}**\nTeam: **${teamName(context, o.teamId)}**\nCoach: <@${o.coachUserId}>\nVersion: **${o.version}** · ${o.status.replaceAll('_',' ')}\nSubmitted: ${time(o.submittedAt)}\nImmutable deadline: ${time(w.deadlineAt)}\n\n${contractText(o.details)}\nConditional release: ${o.conditionalReleasePlayerId ? playerName(o.leagueId, o.conditionalReleasePlayerId) : 'None'}`;
    const card = embed('FREE AGENT OFFER — STAFF REVIEW', body).setFooter({ text: `FA Proof ${o.id}` });
    if (o.corrections.length) card.addFields({ name: 'OCR original', value: contractText(o.ocrOriginal) }, { name: 'Latest Staff correction', value: `<@${o.corrections.at(-1).actorUserId}> · ${time(o.corrections.at(-1).timestamp)}\n${contractText(o.corrections.at(-1).after)}` });
    const file = new AttachmentBuilder(o.screenshot.path, { name: `contract${path.extname(o.screenshot.path)}` });
    card.setImage(`attachment://${file.name}`);
    return { embeds: [card], files: [file], attachments: [], components: o.status === 'PENDING_REVIEW' ? [row(button(`approve:${o.id}`, 'APPROVE', ButtonStyle.Success), button(`correct:${o.id}`, 'CORRECT DETAILS'), button(`reject:${o.id}`, 'REJECT', ButtonStyle.Danger))] : [], allowedMentions: { parse: [] } };
  }
  function waiverProof(context, w) {
    return { embeds: [embed('PLAYER WAIVER — STAFF REVIEW', `Team: **${teamName(context, w.teamId)}**\nCoach: <@${w.coachUserId}>\nPlayer: **${playerName(w.leagueId, w.playerId)}**\nSubmitted: ${time(w.submittedAt)}\nStatus: **${w.status}**${w.reason ? `\n${w.reason}` : ''}`).setFooter({ text: `Waiver Proof ${w.id}` })], components: w.status === 'PENDING' ? [row(button(`waiverapprove:${w.id}`, 'APPROVE', ButtonStyle.Success), button(`waiverreject:${w.id}`, 'REJECT', ButtonStyle.Danger))] : [], allowedMentions: { parse: [] } };
  }
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  async function publish(channel, record, payload, marker, startedAt) {
    let message = record.messageId ? await channel.messages.fetch(record.messageId).catch(e => e.code === 10008 ? null : Promise.reject(e)) : null;
    if (!message) {
      // Recover lost acknowledgements using the audit marker, even after restart.
      let before;
      while (true) {
        const history = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        message = [...history.values()].find(m => m.author.id === channel.guild.members.me.id && m.embeds.some(e => e.footer?.text === marker));
        if (message || history.size < 100) break;
        const oldest = [...history.values()].at(-1);
        if (!oldest || oldest.createdTimestamp < Date.parse(startedAt)) break;
        before = oldest.id;
      }
    }
    if (message) { await message.edit({ ...payload, content: '', allowedMentions: { parse: [] } }); return message; }
    return channel.send({ ...payload, nonce: hash(marker).slice(0, 24), enforceNonce: true });
  }
  function ping(guild, leagueId) { const settings = repository.loadSettings(leagueId) || {}; return settings.leaguePingRoleId || guild.roles.cache.find(r => r.name === 'LEAGUEbuddy Coach')?.id; }
  async function notify(w, offers, delivered) {
    const own = [...new Map(offers.filter(o => o.windowId === w.id).map(o => [o.teamId, o])).values()];
    const winner = offers.find(o => o.id === w.winnerOfferId);
    const cutoff = w.status === 'AWAITING_WINNER_ROSTER_CUT';
    if (!cutoff && !['COMPLETED','CANCELLED','NO_VALID_OFFERS'].includes(w.status)) return;
    for (const o of own) {
      if (cutoff && o.teamId !== winner?.teamId) continue;
      const key = `${w.id}:${w.status}:${cutoff ? w.cutDeadlineAt : ''}:${o.teamId}`;
      if (delivered.has(key)) continue;
      const attempts = state(w.leagueId).deliveries.filter(d => d.key === key);
      const last = attempts.at(-1);
      if (last?.failed && Date.now() - Date.parse(last.timestamp) < Math.min(3600000, 15000 * 2 ** Math.min(attempts.length - 1, 8))) continue;
      const text = cutoff ? `${playerName(w.leagueId,w.playerId)} is reserved for your team. Choose a roster cut by ${time(w.cutDeadlineAt)}. Open MY ACTIVE OFFERS in your league's Free Agency channel, then CHOOSE ROSTER CUT. If your roster exceeds 15, complete Staff-approved waivers first.` : w.status === 'COMPLETED' && winner?.teamId === o.teamId ? `You signed ${playerName(w.leagueId,w.playerId)}.\n${contractText(winner.details)}` : `${playerName(w.leagueId,w.playerId)}: ${w.status === 'COMPLETED' ? 'another team completed the signing' : 'the offer window closed without a signing'}. Your FA target slot and unexecuted conditional releases are unlocked.`;
      let failed = false;
      try { const user = await client.users.fetch(o.coachUserId); await user.send({ embeds: [embed(cutoff ? 'FA WINNER · ROSTER CUT REQUIRED' : 'FREE AGENT RESULT', text)], allowedMentions: { parse: [] } }); } catch { failed = true; }
      service.update(w.leagueId, s => s.deliveries.push({ key, failed, timestamp: new Date().toISOString() }));
      if (!failed) delivered.add(key);
    }
  }
  async function syncGuild(guild) {
    const context = repository.loadLeagueContext({ guildId: guild.id }), leagueId = context.league.leagueId;
    const s = service.tick(leagueId), players = repository.loadPlayers(leagueId);
    const delivered = new Set(s.deliveries.filter(d => !d.failed).map(d => d.key));
    if (!s.windows.length && !s.waivers.length) return;
    // Missing proof access blocks publication; never leak contracts to another channel.
    const proof = await channelFor(guild, leagueId, 'proof'), announcements = await channelFor(guild, leagueId, 'announcements');
    for (const w of s.windows) {
      const payload = publicPayload(context, w, s.offers, players), revision = hash(payload);
      if (w.publicRevision !== revision) {
        const roleId = !w.announcementMessageId ? ping(guild, leagueId) : null;
        const message = await publish(announcements, { messageId: w.announcementMessageId }, { ...payload, ...(roleId ? { content: `<@&${roleId}>`, allowedMentions: { roles: [roleId], parse: [] } } : {}) }, `FA Window ${w.id}`, w.startedAt);
        service.update(leagueId, current => Object.assign(current.windows.find(a => a.id === w.id), { announcementMessageId: message.id, announcementChannelId: announcements.id, publicRevision: revision }));
      }
      for (const o of s.offers.filter(o => o.windowId === w.id)) {
        const payload = proofPayload(context, o, w), revision = hash({ details: o.details, status: o.status, corrections: o.corrections, conditionalReleasePlayerId: o.conditionalReleasePlayerId });
        if (o.proofRevision === revision) continue;
        const message = await publish(proof, { messageId: o.proofMessageId }, payload, `FA Proof ${o.id}`, o.submittedAt);
        service.update(leagueId, current => Object.assign(current.offers.find(a => a.id === o.id), { proofMessageId: message.id, proofChannelId: proof.id, proofRevision: revision }));
      }
      await notify(w, s.offers, delivered);
    }
    for (const w of s.waivers) {
      if (w.proofRevision !== w.status) {
        const message = await publish(proof, { messageId: w.proofMessageId }, waiverProof(context, w), `Waiver Proof ${w.id}`, w.submittedAt);
        service.update(leagueId, current => Object.assign(current.waivers.find(a => a.id === w.id), { proofMessageId: message.id, proofChannelId: proof.id, proofRevision: w.status }));
      }
      if (w.status === 'APPROVED' && !w.announcementMessageId) {
        const roleId = ping(guild, leagueId), payload = { embeds: [embed('PLAYER WAIVED', `**${teamName(context,w.teamId)}** have waived **${playerName(leagueId,w.playerId)}**.\n\nThis player is immediately available in Free Agency.`).setFooter({ text: `Waiver ${w.id}` })], content: roleId ? `<@&${roleId}>` : '', allowedMentions: { roles: roleId ? [roleId] : [], parse: [] } };
        const message = await publish(announcements, {}, payload, `Waiver ${w.id}`, w.submittedAt);
        service.update(leagueId, current => Object.assign(current.waivers.find(a => a.id === w.id), { announcementMessageId: message.id }));
      }
    }
  }
  async function tick() {
    if (sweeping || !client) return;
    sweeping = true;
    try { for (const guild of client.guilds.cache.values()) { if (!repository.loadGuildLeagueBinding(guild.id)) continue; try { await syncGuild(guild); } catch (e) { console.error(`Free Agency recovery ${guild.id}:`, e.message); } } }
    finally { sweeping = false; }
  }
  return { handle, tick, ensurePin, service, permanentPayload, publicPayload, proofPayload, waiverProof, activePayload, browser, uploadModal, syncGuild };
}
module.exports = { createDiscordFreeAgency, permanentPayload, contractText, isStaff };
