const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { canManageLeague } = require('./discord-permissions');
const { teamEmoji } = require('../shared/team-emojis');
const { teamPositionNeeds } = require('./mock-engine');
const COLOR = 0xffdc21, queues = new Map();
function serial(key, work) { const task = (queues.get(key) || Promise.resolve()).catch(() => { }).then(work); queues.set(key, task); return task.finally(() => { if (queues.get(key) === task) queues.delete(key); }); }
const button = (id, label, style = ButtonStyle.Secondary) => {
    const control = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
    const icon = /LOTTERY/.test(label) ? '🎲' : /INVITE/.test(label) ? '👥' : /LOCK/.test(label) ? '🔒' : /START|RESUME/.test(label) ? '▶️' : /PAUSE/.test(label) ? '⏸️' : /SEARCH/.test(label) ? '🔎' : /PICK/.test(label) ? '🏀' : /LEAVE/.test(label) ? '🚪' : null;
    return icon ? control.setEmoji(icon) : control;
};
const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);
const embed = (title, description) => new EmbedBuilder().setColor(COLOR).setTitle(title).setDescription(String(description).slice(0, 4096));
const safe = value => String(value || '—').replace(/[\r\n]/g, ' ').slice(0, 100);
function ownership(input, slot) { const original = input.teams.find(t => t.teamId === slot.originalTeamId), owner = input.teams.find(t => t.teamId === slot.currentOwnerTeamId); return slot.originalTeamId === slot.currentOwnerTeamId ? original.abbreviation : `${original.abbreviation} → ${owner.abbreviation}`; }
function ownerIcon(input, slot) {
    const owner = input.teams.find(t => t.teamId === slot.currentOwnerTeamId);
    return teamEmoji(owner.teamName) || teamEmoji(owner.abbreviation) || '🏀';
}
function lotteryEmbed(input, order, run, locked = false) {
    if (!order?.length) throw Error('Run the lottery first to create a draft order.');
    const card = embed(`🎲 ${locked ? 'Locked Draft Order' : 'Mock Draft Lottery'} · Run ${run}`, `**All 30 picks** · Original team → current owner\n\n${order.map(s => `**#${s.pickNumber}** ${ownerIcon(input, s)} **${ownership(input, s)}**`).join('\n')}`);
    if (order.length !== 30 || card.data.description.match(/\*\*#\d+\*\*/g)?.length !== 30) throw Error('The complete lottery order exceeds Discord’s embed limit.');
    return card;
}
function boardEmbeds(input, selections, title = 'LEAGUEbuddy Mock Draft') {
    return [0, 10, 20].map(start => embed(`${title} · ${start + 1}–${start + 10}`, selections.slice(start, start + 10).map(s => {
        const p = s.prospect || input.prospects.find(p => p.prospectId === s.prospectId);
        return `**#${s.pickNumber}** ${ownerIcon(input, s)} **${ownership(input, s)}**\n${safe(p.name)} — ${safe(p.position_1)} — ${safe(p.team || p.nationality)}\nBoard #${s.boardRank ?? p.board_number} | AVP ${s.avp == null ? 'Unselected in saved simulations' : s.avp.toFixed(1)}${s.grade ? ` | **${s.grade}**` : ''}`;
    }).join('\n\n')));
}
function projectionEmbed(input, selections, snapshot, warnings = []) {
    const card = new EmbedBuilder().setColor(COLOR).setTitle('🏀 LEAGUEbuddy Mock Draft')
        .setDescription(`**${input.draftYear} Draft · First Round**\n📈 Weekly projected order · All 30 picks\n🗂 ${safe(input.draftClassId.replace(/ - Big Board$/i, ''))}`)
        .setFooter({ text: `Week ${input.currentWeek ?? 'Preseason'} · 1,000 simulations · ${snapshot.generatedAt}${warnings.length ? ` · ${warnings.join(' ')}` : ''}` });
    const lines = selections.map(s => {
        const p = input.prospects.find(p => p.prospectId === s.prospectId);
        const owner = input.teams.find(t => t.teamId === s.currentOwnerTeamId);
        const icon = teamEmoji(owner.teamName) || teamEmoji(owner.abbreviation) || '🏀';
        const position = [p.position_1, p.position_2].filter(v => v && v !== 'N/A').join('/');
        return `**#${s.pickNumber}** ${icon} **${ownership(input, s)} — ${safe(p.name)}**\n${position || '—'} · ${safe(p.team || p.nationality)} · Board #${p.board_number} | AVP ${s.avp == null ? 'Unselected' : s.avp.toFixed(1)}`;
    });
    // Fields allow the complete board to exceed the 4,096-character description limit.
    // Split on pick boundaries so no pick or prospect information gets dropped.
    let start = 0;
    while (start < lines.length) {
        let end = start, value = '';
        while (end < lines.length && end - start < 5 && (value ? value.length + 2 : 0) + lines[end].length <= 1024) {
            value += `${value ? '\n\n' : ''}${lines[end++]}`;
        }
        if (end === start) throw Error('A prospect entry exceeds Discord’s embed field limit.');
        card.addFields({ name: `Picks ${start + 1}–${end}`, value, inline: false });
        start = end;
    }
    if (card.length > 6000) throw Error('The complete mock projection exceeds Discord’s single-embed limit.');
    return card;
}
function portrait(payload, p) {
    const draftRoot = path.resolve(__dirname, '../../draft_class');
    const mappedPath = p.image ? path.resolve(draftRoot, p.image) : null;
    const imagePath = mappedPath?.startsWith(`${draftRoot}${path.sep}`) && fs.existsSync(mappedPath)
        && fs.statSync(mappedPath).isFile() ? mappedPath : p.imagePath;
    if (imagePath && fs.existsSync(imagePath)) { const name = `prospect-${p.board_number}${path.extname(imagePath)}`; payload.files = [new AttachmentBuilder(imagePath, { name })]; payload.embeds[0].setThumbnail(`attachment://${name}`); }
    else if (/^https?:\/\//i.test(p.image || '')) payload.embeds[0].setThumbnail(p.image);
    return payload;
}
function reactionPayload(m, s) {
    return portrait({ embeds: [embed(`🏀 #${s.pickNumber} ${ownership(m.input, s)} · ${safe(s.prospect.name)}`, ` ${ownerIcon(m.input, s)} **${ownership(m.input, s)}**\n🏅 **${s.grade} | ${s.storyline}**\n${safe(s.prospect.position_1)} · ${safe(s.prospect.team || s.prospect.nationality)}\nBoard #${s.boardRank} | AVP ${s.avp == null ? 'Unselected' : s.avp.toFixed(1)}\n\n${s.analysis}`)], allowedMentions: { parse: [] } }, s.prospect);
}
function awardsEmbed(m) { return embed('🎯 Final draft takeaways', m.recap.awards.map(a => `**${a.category}** · ${a.pickNumber ? `#${a.pickNumber} ${m.selections[a.pickNumber - 1].prospect.name}` : `${teamEmoji(m.input.teams.find(t => t.teamId === a.teamId).teamName) || '🏀'} ${m.input.teams.find(t => t.teamId === a.teamId).teamName} · Picks ${a.pickNumbers.join(', ')}`}`).join('\n')); }
function finalRecapPayload(m) {
    const card = projectionEmbed(m.input, m.selections, { generatedAt: m.startedAt || m.createdAt });
    card.setTitle('🏁 FINAL MOCK DRAFT RECAP').setDescription(`**${m.input.draftYear} Draft · All 30 picks**\n✅ Completed live mock · Board rank, AVP and pick grades\n🗂 ${safe(m.input.draftClassId.replace(/ - Big Board$/i, ''))}`);
    for (const field of card.data.fields) field.value = field.value.replace(/(\*\*#(\d+)\*\*[^\n]*)(\n)/g, (_, line, number, newline) => `${line} · **${m.selections[Number(number) - 1].grade}**${newline}`);
    const takeaways = awardsEmbed(m).data.description;
    card.addFields({ name: '🎯 Draft takeaways', value: takeaways });
    if (card.length > 6000 || card.data.fields.some(f => f.value.length > 1024)) throw Error('The final recap exceeds Discord’s single-embed limit.');
    return { embeds: [card], allowedMentions: { parse: [] } };
}
function createDiscordMockDraft({ repository, simulations, live, client = null } = {}) {
    const key = (leagueId, id) => `${repository.dataRoot}:${leagueId}:${id}`;
    const context = interaction => repository.loadLeagueContext({ guildId: interaction.guildId });
    const actor = interaction => ({ id: interaction.user.id, staff: canManageLeague(interaction) });
    async function validateCoach(guild, leagueId, userId, interactionMember = null) {
        const coach = live.coach(leagueId, userId), member = interactionMember?.roles?.cache ? interactionMember : await guild.members.fetch(userId);
        const identity = require('./coach-identity').requireCoachIdentity(repository, repository.loadLeague(leagueId), member, userId);
        if (identity.teamId !== coach.teamId) throw Error('Your team changed. Restart this mock draft.');
        return coach;
    }
    async function ensurePin(guild, leagueId) {
        return serial(key(leagueId, 'pin'), async () => {
            let settings = repository.loadSettings(leagueId) || {}, channelId = settings.discordChannels?.scouting;
            if (!channelId) throw Error('Repair league channels to configure Scouting Hub.');
            const ch = await guild.channels.fetch(channelId);
            const payload = { embeds: [embed('🏀 LEAGUEbuddy LIVE MOCK DRAFT', 'Run a private 30-pick first-round mock with league coaches and CPU teams.\n\n👥 Invite coaches → 📋 Choose Base Order or 🎲 Run Lottery → 🔒 Lock Order → ▶️ Start Mock\n\nUses the current Big Board, rosters, pick ownership and saved 1,000-mock market snapshot.')], components: [row(button('mock:start', 'START LIVE MOCK', ButtonStyle.Primary))], allowedMentions: { parse: [] } };
            let msg = null;
            if (settings.discordPins?.liveMockMessageId) try { msg = await ch.messages.fetch(settings.discordPins.liveMockMessageId); } catch (e) { if (e.code !== 10008) throw e; }
            if (!msg) {
                const messages = await require('../shared/discord-pins').fetchPinnedMessages(ch);
                msg = messages.find(m => m.author.id === guild.members.me.id && m.components.some(r => r.components.some(c => c.customId === 'mock:start')));
                if (!msg) { const recent = await ch.messages.fetch({ limit: 100 }); msg = [...recent.values()].find(m => m.author.id === guild.members.me.id && m.components.some(r => r.components.some(c => c.customId === 'mock:start'))); }
            }
            if (msg) await msg.edit(payload); else msg = await ch.send(payload);
            settings = repository.loadSettings(leagueId) || {};
            repository.saveSettings(leagueId, { ...settings, discordPins: { ...settings.discordPins, liveMockMessageId: msg.id, liveMockChannelId: ch.id } });
            if (!msg.pinned) await msg.pin('Permanent Live Mock Draft entry');
            return msg;
        });
    }
    async function ensureRoom(guild, m) {
        if (m.threadId) { try { const thread = await guild.channels.fetch(m.threadId); if (!thread) throw Object.assign(Error('Private mock room was deleted.'), { code: 10003 }); return thread; } catch (e) { if (e.code !== 10003) throw e; throw Error('Private mock room was deleted. Backend draft data is retained.'); } }
        const ch = await guild.channels.fetch(repository.loadSettings(m.leagueId)?.discordChannels?.scouting);
        if (!ch || ch.type !== ChannelType.GuildText) throw Error('Scouting Hub must be a text channel with private thread permissions.');
        if (!m.threadName) m = live.mutate(m.leagueId, m.id, draft => { draft.threadName = `Live Mock · ${m.createdAt.replace(/[T:]/g, ' ').slice(0, 19)} · ${m.id.slice(0, 4)}`; draft.roomCreationPending = true; });
        const active = await ch.threads.fetchActive();
        let thread = [...active.threads.values()].find(t => t.name === m.threadName && t.ownerId === guild.members.me.id);
        if (!thread) { const archived = await ch.threads.fetchArchived({ type: 'private', limit: 100 }); thread = [...archived.threads.values()].find(t => t.name === m.threadName && t.ownerId === guild.members.me.id); }
        if (!thread) thread = await ch.threads.create({ name: m.threadName, type: ChannelType.PrivateThread, invitable: false, autoArchiveDuration: 1440, reason: 'Private first-round mock draft' });
        live.mutate(m.leagueId, m.id, draft => { draft.threadId = thread.id; draft.roomCreationPending = false; });
        return thread;
    }
    async function participants(guild, thread, m) {
        if (thread.archived) await thread.setArchived(false);
        for (const p of m.participants) {
            if (!p.accessGranted && p.available !== false) {
                try { await validateCoach(guild, m.leagueId, p.userId); await thread.members.add(p.userId); live.mutate(m.leagueId, m.id, draft => { const saved = draft.participants.find(a => a.userId === p.userId); saved.accessGranted = true; delete saved.accessError; }); }
                catch (e) { live.mutate(m.leagueId, m.id, draft => { const saved = draft.participants.find(a => a.userId === p.userId); saved.accessError = e.message; saved.available = false; }); }
            }
        }
        // Staff access follows the existing roles and Discord Manage Threads permissions.
        return live.get(m.leagueId, m.id);
    }
    async function sendOnce(channel, payload, marker) {
        const found = await channel.messages.fetch({ limit: 100 });
        const previous = [...found.values()].find(msg => msg.author.id === channel.client.user.id && msg.embeds.some(e => e.footer?.text === marker));
        if (previous) return previous;
        payload.embeds[0].setFooter({ text: marker });
        return channel.send({ ...payload, nonce: require('crypto').createHash('sha256').update(`${channel.id}:${marker}`).digest('hex').slice(0, 24), enforceNonce: true, allowedMentions: { parse: [] } });
    }
    function panelPayload(m) {
        const prefix = `mock:${m.id}`, controls = [], lines = [`🗂 ${safe(m.draftClassId.replace(/ - Big Board$/i, ''))}`, `📋 Status: **${m.status.replace(/_/g, ' ')}**`, `👤 Host: <@${m.hostUserId}> · ${m.participants.length} participating coach${m.participants.length === 1 ? '' : 'es'}`, `✅ ${m.selections.length}/30 picks complete`];
        if (['SETUP', 'LOTTERY_READY'].includes(m.status)) { controls.push(button(`${prefix}:invite:0`, 'INVITE COACHES'), button(`${prefix}:lottery:${m.lotteryRuns}`, m.lotteryRuns && m.orderSource !== 'BASE' ? 'RERUN LOTTERY' : 'RUN LOTTERY', ButtonStyle.Primary)); if (m.lotteryRuns) controls.push(button(`${prefix}:lock:${m.lotteryRuns}`, 'LOCK DRAFT ORDER', ButtonStyle.Success), button(`${prefix}:startorder:${m.lotteryRuns}`, 'START DRAFT', ButtonStyle.Success)); }
        if (['SETUP', 'LOTTERY_READY'].includes(m.status)) controls.push(button(`${prefix}:base`, 'VIEW BASE ORDER').setEmoji('📋'));
        else if (m.lotteryOrder?.length) controls.push(button(`${prefix}:order`, 'VIEW CURRENT ORDER').setEmoji('📋'));
        if (m.status === 'ORDER_LOCKED') controls.push(button(`${prefix}:begin`, 'START MOCK', ButtonStyle.Success));
        if (['ACTIVE', 'PAUSED'].includes(m.status)) {
            controls.push(button(`${prefix}:${m.status === 'ACTIVE' ? 'pause' : 'resume'}`, m.status === 'ACTIVE' ? 'PAUSE' : 'RESUME'));
            const slot = m.lockedDraftOrder[m.currentPick - 1], p = live.controller(m);
            lines.push(`\n**ON THE CLOCK · #${m.currentPick} — ${ownerIcon(m.input, slot)} ${m.input.teams.find(t => t.teamId === slot.currentOwnerTeamId).teamName}**`);
            lines.push(p ? `⏳ **${m.input.teams.find(t => t.teamId === slot.currentOwnerTeamId).teamName} is selecting their player.**\n<@${p.userId}> · ${m.status === 'PAUSED' ? `${Math.ceil((m.remainingMs || 0) / 1000)} seconds frozen` : `2-minute window · expires <t:${Math.floor(m.deadlineAt / 1000)}:R>`}` : 'CPU selection');
            if (m.status === 'ACTIVE' && p) controls.push(button(`${prefix}:available:${m.currentPick}`, 'MAKE PICK', ButtonStyle.Primary));
            controls.push(button(`${prefix}:leave`, 'LEAVE MOCK'));
        }
        if (m.warnings?.length) lines.push(`\n${m.warnings.join('\n')}`);
        if (m.participants.some(p => p.accessError)) lines.push('Some invited coaches could not join and are CPU controlled.');
        return { embeds: [embed('🏀 LEAGUEbuddy Live Mock', lines.join('\n'))], components: controls.length ? [row(...controls), ...(m.testMode && ['SETUP', 'LOTTERY_READY', 'ORDER_LOCKED', 'ACTIVE', 'PAUSED'].includes(m.status) ? [row(button(`${prefix}:solo:${m.soloControl ? 'off' : 'on'}`, m.soloControl ? 'SOLO CONTROL: ON' : 'TEST: CONTROL VACANT TEAMS').setEmoji('🧪'))] : [])] : [], allowedMentions: { parse: [] } };
    }
    async function publishTurn(guild, thread, m) {
        const coach = ['ACTIVE', 'PAUSED'].includes(m.status) && live.controller(m);
        const currentKey = coach && `turn:${m.currentPick}:${coach.userId}`;
        for (const [key, delivery] of Object.entries(m.delivery)) {
            if (!key.startsWith('turn:') || key === currentKey || !delivery.announcement || delivery.closed) continue;
            try { const msg = await thread.messages.fetch(delivery.announcement); await msg.edit({ components: [] }); }
            catch (e) { if (e.code !== 10008) throw e; }
            live.mutate(m.leagueId, m.id, draft => { draft.delivery[key].closed = true; });
        }
        if (!coach) return;
        const slot = m.lockedDraftOrder[m.currentPick - 1], signature = `v4:${m.status}:${m.deadlineAt}:${m.remainingMs}`;
        if (m.delivery[currentKey]?.panelSignature === signature) return;
        const payload = { embeds: [embed('⏳ On the clock', `${ownerIcon(m.input, slot)} **${m.input.teams.find(t => t.teamId === slot.currentOwnerTeamId).teamName} is selecting their player.**\n\n<@${coach.userId}>, it’s your turn! Use **Make Pick** to open your private selection panel here.\nPick #${m.currentPick} · ${m.status === 'PAUSED' ? '⏸️ Draft paused' : `Clock expires <t:${Math.floor(m.deadlineAt / 1000)}:R>`}`)], components: [row(button(`mock:${m.id}:available:${m.currentPick}`, 'MAKE PICK', ButtonStyle.Primary).setDisabled(m.status === 'PAUSED'))] };
        const marker = `Live Mock ${m.id} · ${currentKey}`;
        const msg = await sendOnce(thread, payload, marker);
        payload.embeds[0].setFooter({ text: marker });
        await msg.edit(payload);
        live.mutate(m.leagueId, m.id, draft => { draft.delivery[currentKey] ||= {}; draft.delivery[currentKey].announcement = msg.id; draft.delivery[currentKey].panelSignature = signature; });
    }
    async function publishPanel(thread, m) {
        const signature = `v7:${m.soloControl}:${m.status}:${m.currentPick}:${m.lotteryRuns}:${m.participants.map(p => `${p.userId}:${p.available}:${p.accessError || ''}`).join(',')}:${m.deadlineAt}:${m.remainingMs}`;
        if (m.panelSignature === signature && m.panelMessageId) return;
        if (m.panelMessageId) { try { const msg = await thread.messages.fetch(m.panelMessageId); await msg.edit({ ...panelPayload(m), embeds: panelPayload(m).embeds.map(e => e.setFooter({ text: `Live Mock ${m.id} · controls` })) }); live.mutate(m.leagueId, m.id, draft => { draft.panelSignature = signature; }); return; } catch (e) { if (e.code !== 10008) throw e; } }
        const msg = await sendOnce(thread, panelPayload(m), `Live Mock ${m.id} · controls`);
        await msg.edit({ ...panelPayload(m), embeds: panelPayload(m).embeds.map(e => e.setFooter({ text: `Live Mock ${m.id} · controls` })) }); live.mutate(m.leagueId, m.id, draft => { draft.panelMessageId = msg.id; draft.panelSignature = signature; });
    }
    function currentOrderPayload(m) {
        const card = lotteryEmbed(m.input || simulations.inputFor(m.leagueId, m.classNumber), m.lockedDraftOrder || m.lotteryOrder, m.lotteryRuns, !!m.lockedDraftOrder);
        if (m.orderSource === 'BASE') card.setTitle(`📋 ${m.lockedDraftOrder ? 'Locked Base Draft Order' : 'Base Draft Order'} · All 30 picks`);
        const components = m.status === 'LOTTERY_READY' ? [row(button(`mock:${m.id}:startorder:${m.lotteryRuns}`, 'START DRAFT', ButtonStyle.Success), button(`mock:${m.id}:lottery:${m.lotteryRuns}`, 'RERUN LOTTERY', ButtonStyle.Primary))] : m.status === 'ORDER_LOCKED' ? [row(button(`mock:${m.id}:begin`, 'START DRAFT', ButtonStyle.Success))] : [];
        return { embeds: [card], components, allowedMentions: { parse: [] } };
    }
    async function publishLottery(thread, m) {
        if (!m.lotteryOrder?.length || m.lotteryPresentation === `v3:${m.lotteryRuns}:${m.status}`) return;
        const marker = `Live Mock ${m.id} · lottery ${m.lotteryRuns} · 0`;
        const payload = currentOrderPayload(m);
        payload.embeds[0].setFooter({ text: marker });
        const msg = await sendOnce(thread, payload, marker);
        await msg.edit(payload);
        const recent = await thread.messages.fetch({ limit: 100 });
        for (const old of recent.values()) if (old.author.id === thread.client.user.id && old.embeds.some(e => [10, 20].some(start => e.footer?.text === `Live Mock ${m.id} · lottery ${m.lotteryRuns} · ${start}`))) { try { await old.delete(); } catch (e) { if (e.code !== 10008) throw e; } }
        live.mutate(m.leagueId, m.id, draft => { draft.lotteryMessageId = msg.id; draft.lotteryPresentation = `v3:${m.lotteryRuns}:${m.status}`; });
    }
    async function publishSelections(thread, m) {
        for (const s of m.selections) {
            if (m.delivery[`pick:${s.pickNumber}`]) continue;
            const msg = await sendOnce(thread, reactionPayload(m, s), `Live Mock ${m.id} · pick ${s.pickNumber}`);
            live.mutate(m.leagueId, m.id, draft => { draft.delivery[`pick:${s.pickNumber}`] = { messageId: msg.id }; });
        }
    }
    async function deliverRecaps(guild, m) {
        for (const p of m.participants) {
            const saved = live.get(m.leagueId, m.id).dmDelivery[p.userId];
            if (saved?.delivered || saved?.permanent || saved?.attempts >= 3 || saved?.nextRetryAt > Date.now()) continue;
            const attempts = (saved?.attempts || 0) + 1;
            try {
                const user = await guild.client.users.fetch(p.userId), dm = await user.createDM();
                const message = await sendOnce(dm, finalRecapPayload(m), `Live Mock ${m.id} · final recap`);
                live.mutate(m.leagueId, m.id, draft => { draft.dmDelivery[p.userId] = { messageId: message.id, attemptedAt: new Date().toISOString(), attempts, delivered: true }; });
            } catch (e) {
                const permanent = [50007, 10013].includes(e.code);
                live.mutate(m.leagueId, m.id, draft => { draft.dmDelivery[p.userId] = { attemptedAt: new Date().toISOString(), attempts, delivered: false, error: e.message, errorCode: e.code, permanent, nextRetryAt: Date.now() + 5000 * attempts }; });
            }
        }
        return live.get(m.leagueId, m.id);
    }
    async function complete(guild, thread, m) {
        if (m.status === 'COMPLETED') {
            if (thread) await sendOnce(thread, finalRecapPayload(m), `Live Mock ${m.id} · final recap`);
            m = live.mutate(m.leagueId, m.id, draft => { draft.status = 'CLEANUP_PENDING'; draft.recapPostedAt = new Date().toISOString(); });
        }
        m = await deliverRecaps(guild, m);
        if (m.participants.some(p => { const d = m.dmDelivery[p.userId]; return !d?.delivered && !d?.permanent && (d?.attempts || 0) < 3; })) return;
        m = live.mutate(m.leagueId, m.id, draft => { draft.cleanup.attempts++; draft.cleanup.lastAttemptAt = new Date().toISOString(); });
        try {
            if (thread) await thread.delete('Completed mock recap persisted and participant DM attempts finished');
            live.mutate(m.leagueId, m.id, draft => { draft.status = 'CLEANED'; draft.cleanup.cleanedAt = new Date().toISOString(); delete draft.cleanup.error; });
        } catch (e) { live.mutate(m.leagueId, m.id, draft => { draft.cleanup.error = e.message; draft.cleanup.nextRetryAt = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(draft.cleanup.attempts, 6)); }); }
    }
    async function pump(guild, leagueId, id) {
        let m = live.get(leagueId, id); if (['CLEANED', 'FAILED', 'CANCELLED'].includes(m.status)) return;
        let thread = null;
        try { thread = await ensureRoom(guild, m); }
        catch (e) {
            if (e.code !== 10003 && !e.message.includes('room was deleted')) throw e;
            if (!['COMPLETED', 'CLEANUP_PENDING'].includes(m.status)) { live.mutate(leagueId, id, draft => { draft.status = 'FAILED'; draft.failure = 'Private room was deleted; persisted selections retained.'; }); return; }
        }
        m = live.get(leagueId, id);
        if (['COMPLETED', 'CLEANUP_PENDING'].includes(m.status)) { if (thread) await publishSelections(thread, m); await complete(guild, thread, live.get(leagueId, id)); return; }
        m = await participants(guild, thread, m);
        await publishLottery(thread, m);
        if (m.status === 'ACTIVE') {
            while (m.status === 'ACTIVE') {
                await publishSelections(thread, m);
                let coach = live.controller(m);
                if (coach) {
                    try { await validateCoach(guild, leagueId, coach.userId); await thread.members.fetch(coach.userId); if (coach.testControlled) { const member = await guild.members.fetch(coach.userId); if (!canManageLeague({ guildId: guild.id, guild, member, memberPermissions: member.permissions })) { m = live.mutate(leagueId, id, draft => { draft.soloControl = false; }); coach = null; } } }
                    catch (e) { if ([10007, 10013].includes(e.code) || e.message.includes('Coach role') || e.message.includes('league team') || e.message.includes('ownership conflicts')) { m = live.setAvailable(leagueId, id, coach.userId, false); coach = null; } else throw e; }
                }
                if (coach && m.deadlineAt != null && m.deadlineAt > Date.now()) break;
                m = live.commit(leagueId, id, { expectedPick: m.currentPick, type: coach ? 'TIMEOUT_CPU' : 'CPU' });
            }
        }
        await publishSelections(thread, m);
        if (m.status === 'COMPLETED') await complete(guild, thread, live.get(leagueId, id)); else { await publishPanel(thread, live.get(leagueId, id)); await publishTurn(guild, thread, live.get(leagueId, id)); }
    }
    function choices(m, query, page) {
        const pool = live.available(m, query), pages = Math.max(1, Math.ceil(pool.length / 10)), index = Math.max(0, Math.min(pages - 1, page));
        return { pool: pool.slice(index * 10, index * 10 + 10), page: index, pages };
    }
    function selectionPayload(m, requestedPick, query = '', page = 0, searchToken = null) {
        if (m.status !== 'ACTIVE' || m.currentPick !== Number(requestedPick)) throw Error('That pick is no longer active.');
        const saved = simulations.byId(m.leagueId, m.simulationSnapshotId), prefix = `mock:${m.id}`, result = searchToken ? choices(m, query, page) : { pool: live.available(m).slice(0, 10), page: 0, pages: 1 };
        const info = embed(searchToken ? `🔎 Search results · Page ${result.page + 1}/${result.pages}` : '🔎 TOP 10 BEST AVAILABLE', result.pool.map(p => `**${safe(p.name)}** · ${safe(p.position_1)} · ${safe(p.team || p.nationality)}\nBoard #${p.board_number} | AVP ${saved.prospectAggregates[p.prospectId]?.avp?.toFixed(1) || 'Unselected'}`).join('\n\n') || 'No undrafted prospects match this search.');
        const menuPool = searchToken ? result.pool : live.available(m).slice(0, 25);
        const components = [];
        if (menuPool.length) components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`${prefix}:select:${m.currentPick}`).setPlaceholder(`Select from ${menuPool.length} prospects to preview and confirm`).addOptions(menuPool.map(p => ({ label: `${p.board_number}. ${p.name}`.slice(0, 100), description: `${p.position_1} · ${p.team || p.nationality || 'Prospect'}`.slice(0, 100), value: String(p.board_number) })))));
        const controls = [button(`${prefix}:search:${m.currentPick}`, 'SEARCH ALL PROSPECTS', ButtonStyle.Primary)];
        if (searchToken) { controls.push(button(`${prefix}:results:${m.currentPick}:${searchToken}:${Math.max(0, result.page - 1)}`, 'Previous').setDisabled(result.page === 0), button(`${prefix}:results:${m.currentPick}:${searchToken}:${result.page + 1}`, 'Next').setDisabled(result.page === result.pages - 1)); }
        components.push(row(...controls));
        const slot = m.lockedDraftOrder[m.currentPick - 1];
        info.setDescription(`${ownerIcon(m.input, slot)} **Pick #${m.currentPick} · ${ownership(m.input, slot)}**\n\n${info.data.description}`.slice(0, 4096));
        const needs = teamPositionNeeds(m.input, slot.currentOwnerTeamId, m.selections);
        const team = m.input.teams.find(team => team.teamId === slot.currentOwnerTeamId);
        info.addFields({ name: `🎯 ${safe(team.teamName)} · Position needs`, value: needs.rosterAvailable
            ? `${needs.positions.map(position => `${position.priority === 'High' ? '🔴' : position.priority === 'Moderate' ? '🟡' : '🟢'} **${position.position} · ${position.priority} need** — ${position.primaryCount} primary · Rotation depth ${position.rotationDepth.toFixed(1)}${position.bestOverall == null ? '' : ` · Best ${position.bestOverall} OVR`}${position.contractReason ? `\n↳ ${position.contractReason}` : ''}`).join('\n')}\n\n**Target:** ${needs.targets.length ? needs.targets.join(' → ') : 'Best player available'}\nPrimary positions only. Based on rotation quality, starter/backup strength, age and contract expiry/options. Fringe depth is discounted. Updates with your mock picks.`
            : 'Roster data is unavailable. Import the team roster to see position targets.' });
        if (result.pool.length) info.setFooter({ text: `Portrait: ${safe(result.pool[0].name)}` });
        const payload = { embeds: [info], components, allowedMentions: { parse: [] } };
        return result.pool.length ? portrait(payload, result.pool[0]) : payload;
    }
    async function projection(interaction) {
        const c = context(interaction), leagueId = c.league.leagueId;
        await validateCoach(interaction.guild, leagueId, interaction.user.id);
        const classNumber = interaction.options?.getInteger?.('draft_class') ?? null;
        if (classNumber == null || classNumber === Number(c.league.seasonNumber)) {
            await simulations.refresh(leagueId);
        }
        const weekly = await simulations.classProjection(leagueId, classNumber);
        await interaction.editReply({ embeds: [projectionEmbed(weekly.input, weekly.selections, weekly, weekly.warnings)], allowedMentions: { parse: [] } });
    }
    async function handle(interaction) {
        try {
            const [, id, action, pickValue, token, pageValue] = interaction.customId.split(':');
            const guild = interaction.guild;
            if (!guild) throw Error('This live mock server is unavailable.');
            const c = repository.loadLeagueContext({ guildId: guild.id }), leagueId = c.league.leagueId;
            if (action !== 'search') await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            if (!['start', 'startclass'].includes(id)) {
                const m = live.get(leagueId, id);
                if (m.guildId !== guild.id || (m.threadId !== interaction.channelId)) throw Error('Use this control inside its private mock room.');
                if (!m.participants.some(p => p.userId === interaction.user.id) && !canManageLeague(interaction)) throw Error('You are not participating in this mock.');
                if (['search', 'available', 'select', 'confirm', 'results', 'searchsubmit'].includes(action)) {
                    await validateCoach(guild, leagueId, interaction.user.id, interaction.member);
                    if (live.controller(m)?.testControlled && !canManageLeague(interaction)) throw Error('Only staff can control vacant test teams.');
                    if (m.status !== 'ACTIVE' || m.currentPick !== Number(pickValue) || live.controller(m)?.userId !== interaction.user.id || m.deadlineAt <= Date.now()) throw Error('You are not on the clock for this pick.');
                }
                if (action === 'search') {
                    const modal = new ModalBuilder().setCustomId(`mock:${id}:searchsubmit:${pickValue}`).setTitle('Search all undrafted prospects').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('query').setLabel('Name, school, position or Big Board number').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(false)));
                    await interaction.showModal(modal); return;
                }
            }
            if (id === 'start') {
                await validateCoach(guild, leagueId, interaction.user.id);
                await interaction.editReply({ embeds: [embed('🗂 Choose a draft class', 'Select the prospect class for your Live Mock Draft.')], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('mock:startclass').setPlaceholder('Choose CUS01, CUS02, CUS03 or CUS04').addOptions([1, 2, 3, 4].map(n => ({ label: `2K27 CUS${String(n).padStart(2, '0')}`, value: String(n) }))))], allowedMentions: { parse: [] } });
                return;
            }
            if (id === 'startclass') {
                await validateCoach(guild, leagueId, interaction.user.id);
                const classNumber = Number(interaction.values?.[0]);
                if (!Number.isInteger(classNumber) || classNumber < 1 || classNumber > 4) throw Error('Choose draft class CUS01 through CUS04.');
                if (classNumber === Number(c.league.seasonNumber)) {
                    await simulations.refresh(leagueId);
                }
                await simulations.classProjection(leagueId, classNumber);
                await serial(key(leagueId, `host:${interaction.user.id}`), async () => { const m = live.create(leagueId, interaction.user.id, guild.id, classNumber); await serial(key(leagueId, m.id), () => pump(guild, leagueId, m.id)); const current = live.get(leagueId, m.id); await interaction.editReply({ content: `Your private Live Mock is ready: <#${current.threadId}>`, embeds: [], components: [] }); });
                return;
            }
            await serial(key(leagueId, id), async () => {
                let m = live.get(leagueId, id), a = actor(interaction);
                if (action === 'base') {
                    const input = simulations.inputFor(leagueId, m.classNumber), generated = live.baseOrder(leagueId, m.classNumber), card = lotteryEmbed(input, generated.order, 0).setTitle('📋 Base Draft Order · Before Lottery');
                    card.setDescription(`**Current standings · No lottery draw**\nOriginal team → current owner\n\n${generated.order.map(s => `**#${s.pickNumber}** ${ownerIcon(input, s)} **${ownership(input, s)}**`).join('\n')}`);
                    const controls = ['SETUP', 'LOTTERY_READY'].includes(m.status) && (a.id === m.hostUserId || a.staff) ? [row(button(`mock:${id}:usebase:${m.lotteryRuns}`, 'USE THIS ORDER', ButtonStyle.Secondary), button(`mock:${id}:startbase:${m.lotteryRuns}`, 'START DRAFT', ButtonStyle.Success))] : [];
                    await interaction.editReply({ embeds: [card], components: controls, allowedMentions: { parse: [] } }); return;
                }
                if (action === 'order') { await interaction.editReply(currentOrderPayload(m)); return; }
                if (action === 'invite' || action === 'invitepage') {
                    if (a.id !== m.hostUserId && !a.staff) throw Error('Only the host can invite coaches.');
                    if (!['SETUP', 'LOTTERY_READY'].includes(m.status)) throw Error('Invites are closed.');
                    const owners = repository.loadOwners(leagueId).filter(o => c.teams.some(t => t.teamId === o.teamId) && !m.participants.some(p => p.userId === o.userId)), page = Number(pickValue) || 0, options = owners.slice(page * 15, page * 15 + 15);
                    const components = options.length ? [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`mock:${id}:invites`).setPlaceholder('Invite configured league coaches').setMinValues(1).setMaxValues(options.length).addOptions(options.map(o => ({ label: c.teams.find(t => t.teamId === o.teamId).teamName.slice(0, 100), description: safe(o.displayName || o.username || 'Team coach'), value: o.userId }))))] : [];
                    if (owners.length > 15) components.push(row(button(`mock:${id}:invitepage:${page ? 0 : 1}`, page ? 'Previous coaches' : 'More coaches')));
                    await interaction.editReply({ content: options.length ? 'Invited coaches control their actual teams and every first-round pick those teams own.' : 'All configured coaches are already participating.', components }); return;
                }
                if (action === 'invites') {
                    for (const userId of interaction.values) await validateCoach(guild, leagueId, userId);
                    m = live.invite(leagueId, id, a, interaction.values);
                } else if (action === 'lottery') {
                    if (m.lotteryRuns !== Number(pickValue)) throw Error('This lottery control is stale. Use the latest room controls.');
                    m = live.lottery(leagueId, id, a);
                    const thread = await guild.channels.fetch(m.threadId);
                    await publishLottery(thread, m);
                } else if (action === 'startbase' || action === 'startorder') {
                    if (m.lotteryRuns !== Number(pickValue) || !['SETUP', 'LOTTERY_READY'].includes(m.status)) throw Error('This order control is stale. Use the latest order controls.');
                    if (action === 'startbase') m = live.useBaseOrder(leagueId, id, a, pickValue);
                    m = live.lock(leagueId, id, a);
                    m = live.start(leagueId, id, a);
                } else if (action === 'usebase') { m = live.useBaseOrder(leagueId, id, a, pickValue); } else if (action === 'lock') { if (m.lotteryRuns !== Number(pickValue)) throw Error('This lottery order was replaced. Use the latest controls.'); m = live.lock(leagueId, id, a); }
                else if (action === 'begin') m = live.start(leagueId, id, a);
                else if (action === 'solo') m = live.setSoloControl(leagueId, id, a, pickValue === 'on');
                else if (action === 'pause') m = live.pause(leagueId, id, a);
                else if (action === 'resume') m = live.resume(leagueId, id, a);
                else if (action === 'leave') m = live.setAvailable(leagueId, id, interaction.user.id, false);
                else if (action === 'available') { await interaction.editReply(selectionPayload(m, pickValue)); return; }
                else if (action === 'searchsubmit') {
                    const q = interaction.fields.getTextInputValue('query'), searchToken = randomUUID().slice(0, 8);
                    m = live.mutate(leagueId, id, draft => { draft.searches ||= {}; for (const [k, v] of Object.entries(draft.searches)) if (v.expiresAt < Date.now()) delete draft.searches[k]; draft.searches[searchToken] = { query: q, userId: interaction.user.id, pick: Number(pickValue), expiresAt: Date.now() + 120000 }; });
                    await interaction.editReply(selectionPayload(m, pickValue, q, 0, searchToken)); return;
                } else if (action === 'results') {
                    const saved = m.searches?.[token]; if (!saved || saved.userId !== interaction.user.id || saved.pick !== m.currentPick || saved.expiresAt < Date.now()) throw Error('Search expired. Search again.');
                    await interaction.editReply(selectionPayload(m, pickValue, saved.query, Number(pageValue), token)); return;
                } else if (action === 'select') {
                    const p = live.available(m).find(p => p.board_number === Number(interaction.values[0])); if (!p) throw Error('Prospect is no longer available.');
                    const market = simulations.byId(leagueId, m.simulationSnapshotId).prospectAggregates[p.prospectId];
                    const payload = portrait({ embeds: [embed(`🎯 Confirm ${safe(p.name)}`, `${ownerIcon(m.input, m.lockedDraftOrder[m.currentPick - 1])} **Pick #${m.currentPick} · ${ownership(m.input, m.lockedDraftOrder[m.currentPick - 1])}**\n${safe(p.position_1)} · ${safe(p.team || p.nationality)}\nBoard #${p.board_number} | AVP ${market.avp?.toFixed(1) || 'Unselected'}\n${market.earliest ? `Range #${market.earliest}–#${market.latest} · Available at this pick in ${Math.round(market.availabilityByPick[m.currentPick - 1] * 100)}% of simulations` : 'Not selected in the saved first-round sample'}\n\n${String(p.about || p.build || '').slice(0, 1800)}\n\n**Confirmation is final.**`)], components: [row(button(`mock:${id}:confirm:${m.currentPick}:${p.board_number}`, 'CONFIRM PICK', ButtonStyle.Success), button(`mock:${id}:available:${m.currentPick}`, 'BACK TO PLAYERS'))] }, p);
                    await interaction.editReply(payload); return;
                } else if (action === 'confirm') {
                    // Recheck after queued Discord work, immediately before atomic commit.
                    await validateCoach(guild, leagueId, interaction.user.id);
                    const p = m.input.prospects.find(p => p.board_number === Number(token));
                    m = live.commit(leagueId, id, { expectedPick: Number(pickValue), userId: interaction.user.id, staff: canManageLeague(interaction), prospectId: p?.prospectId });
                } else throw Error('Unknown mock control.');
                await interaction.editReply(['lottery', 'usebase'].includes(action) ? currentOrderPayload(m) : { content: action === 'confirm' ? 'Selection confirmed and saved.' : 'Mock updated.', components: [], embeds: [] });
                await pump(guild, leagueId, id);
            });
        } catch (error) {
            const payload = { content: error.message, components: [], embeds: [] };
            if (interaction.deferred || interaction.replied) await interaction.editReply(payload); else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
        }
    }
    const nextRefresh = new Map();
    async function tick(runtimeClient = client) {
        if (!runtimeClient) return;
        for (const guild of runtimeClient.guilds.cache.values()) {
            let c; try { c = repository.loadLeagueContext({ guildId: guild.id }); } catch { continue; }
            const leagueId = c.league.leagueId;
            if ((nextRefresh.get(leagueId) || 0) <= Date.now()) {
                nextRefresh.set(leagueId, Date.now() + 30000);
                try { simulations.reconcileRequests(leagueId); } catch (e) { console.error('Mock refresh inputs:', e.message); }
                simulations.refresh(leagueId).catch(e => console.error('Mock simulations:', e.message));
            }
            for (const m of live.all(leagueId).filter(m => m.guildId === guild.id && m.status === 'CLEANED' && m.participants.some(p => { const d = m.dmDelivery[p.userId]; return d && !d.delivered && !d.permanent && (d.attempts || 0) < 3 && (!d.nextRetryAt || d.nextRetryAt <= Date.now()); }))) {
                await serial(key(leagueId, m.id), () => deliverRecaps(guild, live.get(leagueId, m.id))).catch(e => console.error('Mock recap recovery:', e.message));
            }
            for (const m of live.all(leagueId).filter(m => m.guildId === guild.id && !['CLEANED', 'FAILED', 'CANCELLED'].includes(m.status) && (!m.cleanup.nextRetryAt || m.cleanup.nextRetryAt <= Date.now()))) {
                if (m.seasonId !== c.seasonId && !['COMPLETED', 'CLEANUP_PENDING'].includes(m.status)) { live.mutate(leagueId, m.id, draft => { draft.status = 'CANCELLED'; draft.failure = 'League season changed.'; }); continue; }
                await serial(key(leagueId, m.id), () => pump(guild, leagueId, m.id)).catch(e => { live.mutate(leagueId, m.id, draft => { draft.lastRecoveryError = e.message; }); console.error('Live Mock recovery:', e.message); });
            }
        }
    }
    async function restore(runtimeClient = client) {
        for (const guild of runtimeClient.guilds.cache.values()) {
            try { const c = repository.loadLeagueContext({ guildId: guild.id }); await ensurePin(guild, c.league.leagueId); }
            catch (e) { console.error('Live Mock pin:', e.message); }
        }
        await tick(runtimeClient);
    }
    return { projection, handle, ensurePin, tick, restore, pump, validateCoach, selectionPayload, panelPayload };
}
module.exports = { createDiscordMockDraft, boardEmbeds, projectionEmbed, lotteryEmbed, reactionPayload, awardsEmbed, finalRecapPayload };
