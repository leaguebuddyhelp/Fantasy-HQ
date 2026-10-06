const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { createGameSubmissionService } = require('./game-submissions');
const { gamePayload } = require('./discord-game-submissions');
const locks = new Map();
const HOURS_48 = 48 * 60 * 60 * 1000;
function threadName(week, a, b) { return `W${week} • ${a} vs ${b}`.slice(0, 100); }
function createGameThreadService({ submissions = createGameSubmissionService(), syncOwners = guild => require('./role-ownership').roleOwnership.sync(guild), now = () => new Date(), logger = console } = {}) {
    const repository = submissions.repository;
    function context(guildId) { return repository.loadLeagueContext({ guildId }); }
    function active(guildId) { const c = context(guildId); if (c.league.currentPhase !== 'REGULAR_SEASON') throw Error('League must be in REGULAR_SEASON.'); const schedule = repository.loadSchedule(c.league.leagueId, c.seasonId); const weeks = schedule.weeks.filter(w => w.status === 'ACTIVE'); if (weeks.length !== 1 || weeks[0].week !== c.league.currentWeek) throw Error('Exactly one current ACTIVE week is required.'); return { ...c, schedule, week: weeks[0] }; }
    async function channel(guild, id) { if (!id) throw Error('Configure the Games channel first.'); const ch = await guild.channels.fetch(id); if (!ch || ch.guildId !== guild.id || ch.type !== ChannelType.GuildText) throw Error('Games channel must be a text channel in this server.'); return ch; }
    async function configure(guild, id) { await channel(guild, id); const c = context(guild.id); repository.saveSettings(c.league.leagueId, { ...repository.loadSettings(c.league.leagueId), gamesChannelId: id }); return { gamesChannelId: id }; }
    function status(guildId) { const c = active(guildId); const records = submissions.records(); return { week: c.week.week, startedAt: c.week.startedAt, deadlineAt: c.week.deadlineAt, gamesChannelId: repository.loadSettings(c.league.leagueId)?.gamesChannelId || null, games: c.week.games.map(g => { const r = records.find(r => r.game.leagueId === c.league.leagueId && r.game.seasonId === c.seasonId && r.game.weekNumber === c.week.week && r.game.team1Id === g.team1Id && r.game.team2Id === g.team2Id); return { team1Name: c.teams.find(t => t.teamId === g.team1Id)?.teamName, team2Name: c.teams.find(t => t.teamId === g.team2Id)?.teamName, activity: r ? require("./game-activity").activityView(r) : null, gameId: r?.game.gameId, discordThreadId: r?.game.discordThreadId, threadError: r?.game.threadError }; }) }; }
    async function reopenCleanedWeek(guildId, weekNumber) {
        const c = active(guildId);
        if (c.week.week !== Number(weekNumber)) throw Error('Active week changed. Refresh and try again.');
        const records = submissions.records().filter(r => r.game.leagueId === c.league.leagueId && r.game.seasonId === c.seasonId && r.game.weekId === c.week.weekId && c.week.games.some(g => g.team1Id === r.game.team1Id && g.team2Id === r.game.team2Id) && r.game.discordThreadCleanedAt);
        for (const record of records) await submissions.mutate(record.game.gameId, r => { if (r.game.discordThreadCleanedAt) r.game.discordThreadCleanedAt = null; });
        return records.length;
    }
    function create(guild) { const key = `${repository.dataRoot}:${guild.id}`; if (locks.has(key)) return locks.get(key); const work = run(guild).finally(() => locks.delete(key)); locks.set(key, work); return work; }
    async function run(guild) {
        const c = active(guild.id), parent = await channel(guild, repository.loadSettings(c.league.leagueId)?.gamesChannelId);
        const permissions = parent.permissionsFor(guild.members.me);
        if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.ReadMessageHistory])) throw Error('Bot needs View Channel, Create Private Threads, Send Messages in Threads and Read Message History in the Games channel.');
        const synced = await syncOwners(guild);
        // Upgrade an unlaunched legacy week without resetting a week that already has threads.
        const linked = submissions.records().some(r => r.game.leagueId === c.league.leagueId && r.game.seasonId === c.seasonId && r.game.weekId === c.week.weekId && r.game.discordThreadId);
        if (!c.week.threadsStartedAt && !linked && (c.week.startedAt || c.week.deadlineAt)) { delete c.week.startedAt; delete c.week.deadlineAt; repository.saveSchedule(c.schedule); }
        let deadlineAt = c.week.deadlineAt || null;
        const owners = repository.loadOwners(c.league.leagueId), result = { week: c.week.week, scheduled: c.week.games.length, existing: 0, created: 0, cleaned: 0, failed: 0, errors: [], deadlineAt };
        for (const match of c.week.games) {
            let record;
            try {
                record = submissions.ensureGame({ guildId: guild.id, weekNumber: c.week.week, teamQuery: match.team1Id });
                const game = record.game;
                if (game.discordThreadCleanedAt) { result.cleaned++; continue; }
                let thread = null;
                if (game.discordThreadId) { try { thread = await guild.channels.fetch(game.discordThreadId); } catch (e) { if (e.code !== 10003) throw e; } if (thread && (thread.type !== ChannelType.PrivateThread || thread.guildId !== guild.id)) throw Error('Existing linked channel is not a private thread in this server.'); }
                const coaches = [match.team1Id, match.team2Id].map(id => owners.filter(o => o.teamId === id));
                const ids = [...new Set([match.team1Id, match.team2Id].flatMap((teamId, i) => synced?.teamMemberIds?.[teamId] || coaches[i].map(o => o.userId)).filter(Boolean))];
                const teamRoleIds = [match.team1Id, match.team2Id].map(id => synced?.teamRoleIds?.[id]).filter(Boolean);
                if (thread) result.existing++;
                else {
                    if (game.threadCreationPending) throw Error('A previous Discord creation was interrupted. Check Discord and link its thread with /game setup before retrying.');
                    await submissions.mutate(game.gameId, r => { r.game.threadCreationPending = true; });
                    try { thread = await parent.threads.create({ name: threadName(c.week.week, game.team1Name, game.team2Name), type: ChannelType.PrivateThread, invitable: false, autoArchiveDuration: 1440, reason: `LEAGUEbuddy game ${game.gameId}` }); }
                    catch (error) {
                        // A transport failure may mean Discord created the thread but lost the response.
                        const uncertain = ['ETIMEDOUT', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.code) || error.name === 'AbortError' || error.status >= 500;
                        if (!uncertain) await submissions.mutate(game.gameId, r => { r.game.threadCreationPending = false; });
                        throw error;
                    }
                    await submissions.mutate(game.gameId, r => { r.game.discordThreadId = thread.id; r.game.discordMessageId = null; r.game.threadCreationPending = false; r.game.threadCreatedAt = new Date(thread.createdTimestamp || Date.now()).toISOString(); }); result.created++;
                }
                // Start the shared clock only after Discord has actually supplied a thread.
                if (!c.week.threadsStartedAt) {
                    c.week.startedAt = (linked && c.week.startedAt) || now().toISOString();
                    c.week.threadsStartedAt = c.week.startedAt;
                    c.week.deadlineAt = new Date(Date.parse(c.week.startedAt) + HOURS_48).toISOString();
                    repository.saveSchedule(c.schedule);
                }
                deadlineAt = c.week.deadlineAt; result.deadlineAt = deadlineAt;
                if (thread.archived) await thread.setArchived(false);
                for (const id of new Set([...ids, ...(synced.staffUserIds || [])])) await thread.members.add(id);
                await submissions.mutate(game.gameId, r => { r.game.threadCreatedAt ||= thread.createdTimestamp ? new Date(thread.createdTimestamp).toISOString() : null; r.game.startedAt = c.week.startedAt; r.game.deadlineAt = deadlineAt; Object.assign(r.game, require('./game-decisions').cpuState(repository, r.game)); r.game.coachUserIds = ids; r.game.teamRoleIds = teamRoleIds; r.game.threadError = null; });
                const fresh = submissions.load(game.gameId).game;
                let message = null; if (fresh.discordMessageId) { try { message = await thread.messages.fetch(fresh.discordMessageId); } catch (e) { if (e.code !== 10008) throw e; } }
                if (message) await message.edit(gamePayload(fresh, require("./game-activity").activityView(submissions.load(game.gameId)))); else { message = await thread.send({ ...gamePayload(fresh, require("./game-activity").activityView(submissions.load(game.gameId))), allowedMentions: { parse: [], roles: teamRoleIds } }); await submissions.setMessage(game.gameId, message.id); }
            } catch (error) { result.failed++; result.errors.push({ gameId: record?.game.gameId, team1Id: match.team1Id, message: error.message }); logger.error('Game thread creation:', match.team1Id, error.message); if (record) await submissions.mutate(record.game.gameId, r => { r.game.threadError = error.message; }); }
        }
        return result;
    }
    return { configure, create, status, reopenCleanedWeek, repository, configuration: guildId => ({ gamesChannelId: repository.loadSettings(context(guildId).league.leagueId)?.gamesChannelId || null }) };
}
module.exports = { createGameThreadService, threadName, HOURS_48 };
