const { randomUUID } = require('crypto');
const { ChannelType } = require('discord.js');
const confirmations = new Map(), queues = new Map();
function createGameThreadCleanupService({ submissions = require('./game-submissions').createGameSubmissionService(), now = () => Date.now() } = {}) {
    const repository = submissions.repository;
    function authorize(actor) { if (!actor?.authorized || !actor.id) throw Error('Commissioner authorization required.'); }
    function selection(guildId, weekNumber) {
        const c = repository.loadLeagueContext({ guildId }), schedule = repository.loadSchedule(c.league.leagueId, c.seasonId);
        const week = schedule.weeks.find(w => w.week === weekNumber);
        if (!week) throw Error(`Week ${weekNumber} is unavailable.`);
        const all = submissions.records();
        const records = all.filter(r => r.game.leagueId === c.league.leagueId && r.game.seasonId === c.seasonId && r.game.guildId === guildId && r.game.weekNumber === week.week && r.game.weekId === week.weekId && week.games.some(m => m.team1Id === r.game.team1Id && m.team2Id === r.game.team2Id));
        return { leagueId: c.league.leagueId, seasonId: c.seasonId, week, records, all };
    }
    function list(guildId, actor) { authorize(actor); const c = repository.loadLeagueContext({ guildId }), schedule = repository.loadSchedule(c.league.leagueId, c.seasonId); return { weeks: schedule.weeks.map(w => { const { records } = selection(guildId, w.week); return { week: w.week, status: w.status, threads: records.filter(r => r.game.discordThreadId && !r.game.discordThreadCleanedAt).length, cleaned: records.filter(r => r.game.discordThreadCleanedAt).length }; }) }; }
    function targets(selection) { return selection.records.map(r => ({ gameId: r.game.gameId, threadId: r.game.discordThreadId || null })).sort((a, b) => a.gameId.localeCompare(b.gameId)); }
    async function find(guild, game, all) {
        if (all.some(r => r.game.gameId !== game.gameId && r.game.discordThreadId === game.discordThreadId)) throw Error('Thread is linked to more than one Game; deletion blocked.');
        let thread; try { thread = await guild.channels.fetch(game.discordThreadId, { force: true }); } catch (error) { if (error.code === 10003) return null; throw error; }
        if (!thread) return null;
        if (thread.id !== game.discordThreadId || thread.guildId !== guild.id || thread.type !== ChannelType.PrivateThread) throw Error('Linked channel is not this game’s private thread in this server.');
        return thread;
    }
    async function prepare(guild, actor, weekNumber) {
        authorize(actor); const selected = selection(guild.id, weekNumber); let found = 0, already = 0; const errors = [];
        for (const { game } of selected.records) { if (!game.discordThreadId || game.discordThreadCleanedAt) { already++; continue; } try { if (await find(guild, game, selected.all)) found++; else already++; } catch (error) { errors.push({ gameId: game.gameId, error: error.message }); } }
        const checked = selection(guild.id, weekNumber); if (JSON.stringify(targets(checked)) !== JSON.stringify(targets(selected))) throw Error('Thread links changed. Prepare cleanup again.');
        for (const [key, value] of confirmations) if (value.expiresAt < now()) confirmations.delete(key);
        const token = randomUUID(); confirmations.set(token, { guildId: guild.id, actorId: actor.id, root: repository.dataRoot, leagueId: selected.leagueId, seasonId: selected.seasonId, week: weekNumber, targets: targets(selected), expiresAt: now() + 5 * 60000 });
        return { token, week: weekNumber, status: selected.week.status, found, already, failed: errors.length, errors, requested: selected.records.filter(r => r.game.discordThreadId).length };
    }
    function cancel(token, actor) { authorize(actor); const c = confirmations.get(token); if (c?.actorId === actor.id) confirmations.delete(token); }
    function cleanup(guild, actor, token) {
        authorize(actor); const key = `${repository.dataRoot}:${guild.id}`;
        const job = (queues.get(key) || Promise.resolve()).catch(() => { }).then(() => run(guild, actor, token)); queues.set(key, job);
        return job.finally(() => { if (queues.get(key) === job) queues.delete(key); });
    }
    async function run(guild, actor, token) {
        const context = repository.loadLeagueContext({ guildId: guild.id });
        const previous = repository.loadAuditLog(context.league.leagueId).find(e => e.action === 'games.threads.cleanup.completed' && e.requestId === token);
        if (previous) { if (previous.userId !== actor.id) throw Error('Confirmation belongs to another commissioner.'); return { ...previous.result, replayed: true }; }
        const c = confirmations.get(token);
        if (!c || c.actorId !== actor.id || c.guildId !== guild.id || c.root !== repository.dataRoot || c.expiresAt < now()) throw Error('Cleanup confirmation expired or invalid. Prepare cleanup again.');
        const selected = selection(guild.id, c.week);
        if (selected.leagueId !== c.leagueId || selected.seasonId !== c.seasonId || JSON.stringify(targets(selected)) !== JSON.stringify(c.targets)) throw Error('League, season or thread links changed. Confirm cleanup again.');
        const result = { week: c.week, requested: selected.records.filter(r => r.game.discordThreadId).length, deleted: 0, already: 0, failed: 0, errors: [] };
        const audit = { userId: actor.id, commissionerUserId: actor.commissionerUserId || null, operator: actor.operator || actor.id, leagueId: c.leagueId, seasonId: c.seasonId, week: c.week, requestId: token, timestamp: new Date(now()).toISOString() };
        repository.appendAuditLog(c.leagueId, { ...audit, action: 'games.threads.cleanup.requested', threadsRequested: result.requested });
        for (const target of c.targets) {
            try {
                const current = selection(guild.id, c.week);
                if (current.leagueId !== c.leagueId || current.seasonId !== c.seasonId) throw Error('League binding changed; deletion blocked.');
                const record = submissions.load(target.gameId), game = record.game;
                if (game.discordThreadId !== target.threadId) throw Error('Thread link changed; deletion blocked.');
                if (!target.threadId || game.discordThreadCleanedAt) { result.already++; continue; }
                const thread = await find(guild, game, current.all);
                // Recheck the week and binding after Discord lookup, immediately before deletion.
                const checked = selection(guild.id, c.week);
                if (checked.leagueId !== c.leagueId || checked.seasonId !== c.seasonId || submissions.load(target.gameId).game.discordThreadId !== target.threadId) throw Error('Game or week changed; deletion blocked.');
                let missing = !thread;
                if (thread) { try { await thread.delete(`LEAGUEbuddy Week ${c.week} cleanup by ${actor.id}`); } catch (error) { if (error.code === 10003) missing = true; else throw error; } }
                const at = new Date(now()).toISOString();
                await submissions.mutate(target.gameId, r => {
                    if (r.game.discordThreadId !== target.threadId) throw Error('Thread link changed while cleanup was running.');
                    r.game.discordThreadCleanedAt = at; r.game.discordThreadCleanedBy = actor.id; r.game.discordThreadCleanupOutcome = missing ? 'MISSING' : 'DELETED';
                    if (!missing) r.game.discordThreadDeletedAt = at;
                });
                if (missing) result.already++; else result.deleted++;
            } catch (error) { result.failed++; result.errors.push({ gameId: target.gameId, threadId: target.threadId, error: error.message }); }
        }
        repository.appendAuditLog(c.leagueId, { ...audit, timestamp: new Date(now()).toISOString(), action: 'games.threads.cleanup.completed', threadsRequested: result.requested, threadsDeleted: result.deleted, threadsAlreadyMissing: result.already, threadsFailed: result.failed, result });
        return result;
    }
    return { list, prepare, cleanup, cancel };
}
module.exports = { createGameThreadCleanupService };
