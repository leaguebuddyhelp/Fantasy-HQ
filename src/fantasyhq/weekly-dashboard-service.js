const { officialRegularGame } = require('./official-game');
const { activityView } = require('./game-activity');
const { ACTIVE_TRADES, ACTIVE_WINDOWS, LIVE_OFFERS } = require('./transaction-locks');
const MATCHUP_LABELS = { CPU_VS_CPU: 'CPU vs CPU', HUMAN_VS_CPU: 'User vs CPU', HUMAN_VS_HUMAN: 'User vs user' };
function discordLink(guildId, channelId, messageId) {
  return channelId ? `https://discord.com/channels/${guildId}/${channelId}${messageId ? '/' + messageId : ''}` : null;
}
function weekGames(context, schedule, week, records, guildId, now = Date.now()) {
  const names = new Map(context.teams.map(t => [t.teamId, t.teamName]));
  return week.games.map(match => {
    const found = records.filter(r => r.game.leagueId === context.league.leagueId && String(r.game.seasonId) === String(context.seasonId) && r.game.weekId === week.weekId && r.game.team1Id === match.team1Id && r.game.team2Id === match.team2Id);
    const record = found.length === 1 ? found[0] : null, game = record?.game;
    const latest = record?.submissions.filter(s => s.status !== 'CANCELLED').at(-1);
    const media = record?.media.filter(m => m.submissionId === latest?.submissionId) || [];
    const extraction = record?.extractions?.find(e => e.extractionId === latest?.latestExtractionId) || record?.extractions?.filter(e => e.submissionId === latest?.submissionId).at(-1);
    const final = !!record && officialRegularGame(record, { leagueId: context.league.leagueId, seasonId: context.seasonId, schedule });
    const receivedTeamIds = [...new Set(media.map(m => m.teamId).filter(Boolean))];
    const status = final ? 'APPROVED' : latest?.status || 'NOT_SUBMITTED';
    const reviewPending = !final && ['REVIEW_REQUIRED', 'READY_FOR_REVIEW'].includes(extraction?.status) && status !== 'PROCESSING';
    return {
      team1Id: match.team1Id, team2Id: match.team2Id, team1Name: names.get(match.team1Id) || match.team1Id, team2Name: names.get(match.team2Id) || match.team2Id,
      gameId: game?.gameId || null, final, recordCount: found.length,
      activity: record ? activityView(record, now) : null, inGameDate: game?.inGameDate ? require('./game-date').formatGameDate(game.inGameDate) : null,
      threadUrl: game?.discordThreadId && !game.discordThreadCleanedAt ? discordLink(guildId, game.discordThreadId) : null,
      reviewUrl: latest && (extraction?.normalized || game?.result?.type === 'FORFEIT') && status !== 'PROCESSING' ? `/games/${game.gameId}/submissions/${latest.submissionId}/review` : null,
      status, screenshots: media.length, receivedTeamIds, reviewPending,
      extractionFailed: !final && (status === 'EXTRACTION_FAILED' || extraction?.status === 'EXTRACTION_FAILED'),
      decisionPending: !final && !!game?.matchupDecision && !game.matchupDecision.confirmed,
    };
  });
}
function createWeeklyDashboardService({ repository = require('./repository').createFantasyHQRepository(), submissions, now = Date.now } = {}) {
  submissions ||= require('./game-submissions').createGameSubmissionService({ repository });
  function report(guildId, requestedWeek = null) {
    const context = repository.loadLeagueContext({ guildId }), { league, seasonId } = context;
    if (league.currentPhase !== 'REGULAR_SEASON') return { available: false, phase: league.currentPhase, leagueId: league.leagueId };
    const schedule = repository.loadSchedule(league.leagueId, seasonId);
    const week = schedule.weeks.find(w => w.week === (requestedWeek ?? league.currentWeek));
    if (!week) throw Error('The current week is missing from the schedule.');
    const settings = repository.loadSettings(league.leagueId) || {}, owners = repository.loadOwners(league.leagueId);
    const games = weekGames(context, schedule, week, submissions.records(), guildId, now());
    for (const game of games) {
      const humans = [game.team1Id, game.team2Id].filter(id => owners.some(o => o.teamId === id && o.userId));
      game.matchupType = humans.length === 2 ? 'HUMAN_VS_HUMAN' : humans.length === 1 ? 'HUMAN_VS_CPU' : 'CPU_VS_CPU';
    }
    const groups = Object.entries(MATCHUP_LABELS).map(([type, label]) => ({ type, label, total: games.filter(g => g.matchupType === type).length, final: games.filter(g => g.matchupType === type && g.final).length }));
    const pendingGames = games.filter(g => !g.final);
    const blockers = {
      unresolved: pendingGames.length, missingThreads: pendingGames.filter(g => !g.threadUrl).length,
      missingDates: pendingGames.filter(g => !g.inGameDate).length,
      missingBoxScores: pendingGames.filter(g => g.screenshots < 2).length,
      pendingReviews: pendingGames.filter(g => g.reviewPending).length,
      extractionFailures: pendingGames.filter(g => g.extractionFailed).length,
      processing: pendingGames.filter(g => g.status === 'PROCESSING').length,
      noActivity: pendingGames.filter(g => g.matchupType !== 'CPU_VS_CPU' && !g.activity?.count).length,
      duplicateRecords: games.filter(g => g.recordCount > 1).length,
    };
    const trades = repository.loadTrades(league.leagueId).filter(t => String(t.seasonId) === String(seasonId) && ACTIVE_TRADES.has(t.status)).map(t => ({
      id: t.tradeId, status: t.status, teams: (t.participatingTeams || []).map(id => context.teams.find(team => team.teamId === id)?.teamName || id), teamIds: t.participatingTeams || [], deadlineAt: t.expiresAt || null,
      url: discordLink(guildId, t.currentVersion?.proof?.threadId || settings.discordChannels?.[t.status === 'PENDING_COMMITTEE' ? 'tradeCommittee' : 'submitTrade']),
      waitingTeamIds: (t.participatingTeams || []).filter(id => !(t.currentVersion?.gmDecisions || []).some(d => d.teamId === id && d.decision === 'APPROVE')),
    }));
    const fa = repository.loadFreeAgencyState(league.leagueId), players = repository.loadPlayers(league.leagueId);
    const windows = fa.windows.filter(w => String(w.seasonId) === String(seasonId) && ACTIVE_WINDOWS.has(w.status));
    const windowIds = new Set(windows.map(w => w.id));
    const offers = fa.offers.filter(o => String(o.seasonId) === String(seasonId) && windowIds.has(o.windowId) && LIVE_OFFERS.has(o.status)).map(o => ({ id: o.id, teamId: o.teamId, player: players.find(p => p.playerId === o.playerId)?.name || o.playerId, status: o.status, deadlineAt: windows.find(w => w.id === o.windowId)?.deadlineAt || null, cutRequired: windows.some(w => w.id === o.windowId && w.status === 'AWAITING_WINNER_ROSTER_CUT' && w.winnerOfferId === o.id), cutDeadlineAt: windows.find(w => w.id === o.windowId)?.winnerOfferId === o.id ? windows.find(w => w.id === o.windowId)?.cutDeadlineAt || null : null, url: discordLink(guildId, o.proofChannelId, o.proofMessageId) }));
    const upgradeState = repository.loadPlayerUpgradeState(league.leagueId);
    const deliveredKeys = new Set(fa.deliveries.filter(d => !d.failed).map(d => d.key));
    const failedKeys = new Set(fa.deliveries.filter(d => d.failed && !deliveredKeys.has(d.key)).map(d => d.key));
    const waivers = fa.waivers.filter(w => String(w.seasonId) === String(seasonId) && w.status === 'PENDING').map(w => ({ id: w.id, teamId: w.teamId, player: players.find(p => p.playerId === w.playerId)?.name || w.playerId, status: w.status, url: discordLink(guildId, w.proofChannelId, w.proofMessageId) }));
    const channels = Object.fromEntries(Object.entries(settings.discordChannels || {}).map(([key, id]) => [key, discordLink(guildId, id)]));
    return { available: true, guildId, leagueId: league.leagueId, leagueName: league.leagueName, seasonId, week: week.week, weekId: week.weekId, closed: week.status === 'COMPLETED', startedAt: week.startedAt || null, deadlineAt: week.deadlineAt || null, testMode: settings.testMode === true,
      total: games.length, final: games.filter(g => g.final).length, groups, blockers, games, byes: (week.byes || []).map(b => ({ teamId: b.teamId, teamName: context.teams.find(t => t.teamId === b.teamId)?.teamName || b.teamId })),
      storageIssues: submissions.storageIssues?.() || [],
      upgradeDebtCount: (upgradeState?.tenures || []).filter(t => t.seasonId === seasonId && t.upgradeDebt > 0).length,
      notificationFailures: (upgradeState?.notificationOutbox || []).filter(n => n.status === 'FAILED').length + failedKeys.size,
      transactions: { trades, offers, waivers, cuts: offers.filter(o => o.cutRequired), activeWindows: windows.length, waitingCuts: windows.filter(w => w.status === 'AWAITING_WINNER_ROSTER_CUT').length }, channels,
      staffReportUrl: discordLink(guildId, settings.discordChannels?.staff, settings.weeklyStaffReports?.[`${guildId}:${seasonId}:${week.weekId}`]?.messageId),
      readyToAdvance: pendingGames.length === 0 && !week.status?.includes('COMPLETED'),
    };
  }
  function teamDashboard(guildId, teamId, privateDetails = false) {
    const context = repository.loadLeagueContext({ guildId }), team = context.teams.find(t => t.teamId === teamId);
    if (!team) throw Error('Unknown team.');
    const view = report(guildId);
    if (!view.available) return { ...view, teamId, teamName: team.teamName };
    const game = view.games.find(g => [g.team1Id, g.team2Id].includes(teamId));
    const ownUploaded = game?.receivedTeamIds.includes(teamId) || (game?.screenshots === 2);
    const nextAction = view.closed ? 'Regular season complete.' : !game ? 'Bye week — no game submission needed.' : game.final ? 'Game approved. Stats publish when the week advances.' : !game.threadUrl ? 'Staff needs to create or repair this game thread.' : !game.inGameDate ? 'Set the NBA 2K game date in your game thread.' : game.extractionFailed ? 'Ask Staff to retry or review the stored box scores.' : game.reviewPending ? 'Waiting for Staff to review the box scores.' : game.status === 'PROCESSING' ? 'Box scores are processing.' : ownUploaded ? 'Your box score is received. Waiting for the other side.' : 'Schedule your game and submit your team’s box score.';
    const result = { available: true, teamId, teamName: team.teamName, leagueName: view.leagueName, seasonId: view.seasonId, week: view.week, closed: view.closed, deadlineAt: view.deadlineAt, bye: !game, nextAction,
      game: game ? { opponent: game.team1Id === teamId ? game.team2Name : game.team1Name, final: game.final, status: game.status, screenshots: game.screenshots, ownUploaded: !!ownUploaded, threadUrl: game.threadUrl, inGameDate: game.inGameDate } : null,
      channels: Object.fromEntries(['freeAgency', 'submitTrade', 'scouting', 'playerUpgrades'].map(key => [key, view.channels[key] || null])),
    };
    if (privateDetails) result.transactions = { trades: view.transactions.trades.filter(t => t.teamIds.includes(teamId)), offers: view.transactions.offers.filter(o => o.teamId === teamId).map(({url, ...o}) => o), waivers: view.transactions.waivers.filter(w => w.teamId === teamId).map(({url, ...w}) => w) };
    return result;
  }
  return { report, teamDashboard };
}
module.exports = { createWeeklyDashboardService, weekGames, discordLink, MATCHUP_LABELS };
