const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { prospectStatsAvailable, visibleProspectStats } = require('../shared/prospect-stats-access');

const WEEKLY_POINTS = 60;
const REVEAL_COST = 10;
const REVEALS = [
    { key: 'draftGrade', label: 'Draft Grade', field: 'draft score' },
    { key: 'overall', label: 'OVR', field: 'overall' },
    { key: 'potential', label: 'Potential', field: 'potential' },
];

function normalizeSearch(value) {
    return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function createScoutingService({ repository, draftClassDir = path.join(process.cwd(), 'draft_class') } = {}) {
    if (!repository) throw new Error('A LEAGUEbuddy repository is required.');

    function contextFor(guildId) {
        if (!guildId) throw new Error('Scouting is only available in the league server.');
        const context = repository.loadLeagueContext({ guildId });
        let week = null;
        if (context.league.currentPhase === 'REGULAR_SEASON' && context.league.regularSeasonStatus !== 'COMPLETED') {
            try {
                const schedule = repository.loadSchedule(context.league.leagueId, context.seasonId);
                const activeWeeks = schedule.weeks.filter(item => item.status === 'ACTIVE');
                if (activeWeeks.length === 1 && activeWeeks[0].week === context.league.currentWeek) week = activeWeeks[0];
            } catch { /* Read-only board browsing remains available without an active schedule. */ }
        }
        return { ...context, week };
    }

    function scoutingHubChannelId(guildId) {
        if (!guildId) return null;
        const context = repository.loadLeagueContext({ guildId });
        return repository.loadSettings(context.league.leagueId)?.discordChannels?.scouting || null;
    }

    function availableDraftClasses() {
        return fs.readdirSync(draftClassDir).flatMap(file => {
            const match = file.match(/CUS(\d+)\s*-\s*Big Board\.json$/i);
            if (!match) return [];
            const prospects = Object.values(JSON.parse(fs.readFileSync(path.join(draftClassDir,file),'utf8')));
            return prospects.length >= 60 ? [{ classNumber:Number(match[1]), label:file.replace(/\.json$/i,'') }] : [];
        }).sort((a,b)=>a.classNumber-b.classNumber);
    }

    function boardFileForSeason(seasonNumber, boardLabel) {
        return require('../shared/season-draft-class').seasonDraftClass(fs.readdirSync(draftClassDir), seasonNumber, boardLabel);
    }

    function boardForContext(context, { fullMock = false } = {}) {
        const boardLabel = require('../shared/season-draft-class').seasonDraftBoard(context.league.currentPhase);
        const file = boardFileForSeason(context.league.seasonNumber, fullMock ? 'Big Board' : boardLabel);
        const raw = JSON.parse(fs.readFileSync(path.join(draftClassDir, file), 'utf8'));
        const prospects = Object.values(raw || {}).map(prospect => ({
            ...prospect,
            board_number: Number(prospect.board_number ?? prospect.id_number),
        })).filter(prospect => Number.isInteger(prospect.board_number) && prospect.board_number > 0)
            .sort((left, right) => left.board_number - right.board_number);
        const { prospectImageMap, prospectImageKey } = require('../shared/prospect-images');
        const images = prospectImageMap(draftClassDir, file);
        return {
            file, boardLabel,
            seasonNumber: context.league.seasonNumber,
            prospects: prospects.map(prospect => {
                // The board's image mapping remains authoritative when rankings change.
                const explicitPath = prospect.image ? path.resolve(draftClassDir, prospect.image) : null;
                const root = `${path.resolve(draftClassDir)}${path.sep}`;
                const imagePath = explicitPath?.startsWith(root) && fs.existsSync(explicitPath)
                    && fs.statSync(explicitPath).isFile() ? explicitPath : images.get(prospectImageKey(prospect.name)) || null;
                return { ...prospect, imagePath };
            }),
        };
    }

    function statePath(leagueId) {
        return path.join(repository.buildLeaguePaths(repository.dataRoot, leagueId).leagueRoot, 'scouting.json');
    }

    function loadState(leagueId) {
        const file = statePath(leagueId);
        if (!fs.existsSync(file)) return { schemaVersion: 1, seasons: {} };
        const state = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!state || state.schemaVersion !== 1 || !state.seasons || typeof state.seasons !== 'object') {
            throw new Error('Scouting data is invalid. Ask a commissioner to check the league data.');
        }
        return state;
    }

    function saveState(leagueId, state) {
        const file = statePath(leagueId), directory = path.dirname(file);
        fs.mkdirSync(directory, { recursive: true });
        const temporary = `${file}.${crypto.randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
            fs.renameSync(temporary, file);
        } finally {
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
    }

    function userState(state, context, userId, create = false) {
        const seasonKey = String(context.seasonId), weekKey = String(context.week.weekId);
        if (create) {
            state.seasons[seasonKey] ||= { weeks: {} };
            state.seasons[seasonKey].weeks[weekKey] ||= { users: {} };
            state.seasons[seasonKey].weeks[weekKey].users[userId] ||= { spent: 0, prospects: {} };
        }
        return state.seasons[seasonKey]?.weeks[weekKey]?.users[userId] || { spent: 0, prospects: {} };
    }

    function prospectKey(board, prospect) {
        return `${board.file}:${normalizeSearch(prospect.name).replace(/[^a-z0-9]/g, '')}`;
    }

    function seasonIntel(state, context, userId, board, create = false) {
        const seasonKey = String(context.seasonId), season = state.seasons[seasonKey];
        let intel = season?.users?.[userId];
        if (intel?.legacyImported) return intel;
        const reports = { ...(intel?.reports || {}) };
        let legacyFound = false;
        for (const week of Object.values(season?.weeks || {})) {
            const old = week.users?.[userId];
            if (!old) continue;
            legacyFound = true;
            for (const [rank, level] of Object.entries(old.prospects || {})) {
                const prospect = board.prospects.find(p => p.board_number === Number(rank));
                if (!prospect) continue;
                const key = prospectKey(board, prospect);
                // Old weekly unlocks repeated the same ratings; take the highest level, not their sum.
                reports[key] = Math.max(Number(reports[key] || 0), Math.min(REVEALS.length, Number(level) || 0));
            }
        }
        intel = { reports, legacyImported: true };
        if (create || legacyFound) {
            state.seasons[seasonKey] ||= { weeks: {} };
            state.seasons[seasonKey].users ||= {};
            state.seasons[seasonKey].users[userId] = intel;
            // Preserve weekly evidence and budgets while recording stable player identities once.
            if (legacyFound) saveState(context.league.leagueId, state);
        }
        return intel;
    }

    function scoutingContextFor(guildId) {
        const context = contextFor(guildId);
        if (require('../shared/season-draft-class').seasonDraftBoard(context.league.currentPhase) !== 'Big Board') {
            throw new Error('Scouting opens when the regular season starts. Use /toptenpreview for the Early Top Ten preview.');
        }
        return context;
    }

    function inspect(guildId, userId, boardNumber) {
        const context = scoutingContextFor(guildId), board = boardForContext(context);
        const prospect = board.prospects.find(item => item.board_number === Number(boardNumber));
        if (!prospect) throw new Error('Choose a prospect from this season’s available scouting board.');
        const state = loadState(context.league.leagueId), user = context.week ? userState(state, context, userId) : { spent: 0, prospects: {} };
        const intel = seasonIntel(state, context, userId, board);
        const level = Math.max(0, Math.min(REVEALS.length, Number(intel.reports[prospectKey(board, prospect)] || 0)));
        const remaining = context.week ? Math.max(0, WEEKLY_POINTS - Number(user.spent || 0)) : null;
        return {
            leagueId: context.league.leagueId,
            seasonId: context.seasonId,
            seasonNumber: context.league.seasonNumber,
            weekNumber: context.week?.week ?? null,
            weekId: context.week?.weekId ?? null,
            scoutingAvailable: Boolean(context.week),
            boardFile: board.file, boardLabel: board.boardLabel,
            prospect: visibleProspectStats(prospect, context.league.currentPhase),
            prospectStatsAvailable: prospectStatsAvailable(context.league.currentPhase),
            level,
            spent: Number(user.spent || 0),
            remaining,
            nextReveal: level < REVEALS.length ? REVEALS[level] : null,
            reveals: REVEALS.map((reveal, index) => ({ ...reveal, unlocked: level > index })),
        };
    }

    function boardPage(guildId, userId, requestedPage = 0) {
        const context = scoutingContextFor(guildId), board = boardForContext(context), state = loadState(context.league.leagueId);
        const user = context.week ? userState(state, context, userId) : { spent: 0, prospects: {} };
        const intel = seasonIntel(state, context, userId, board);
        const totalPages = Math.max(1, Math.ceil(board.prospects.length / 10));
        const page = Math.max(0, Math.min(totalPages - 1, Number(requestedPage) || 0));
        const start = page * 10, prospects = board.prospects.slice(start, start + 10).map(prospect => {
            const level = Math.max(0, Math.min(REVEALS.length, Number(intel.reports[prospectKey(board, prospect)] || 0)));
            return {
                ...context,
                boardFile: board.file, boardLabel: board.boardLabel,
                prospect: visibleProspectStats(prospect, context.league.currentPhase),
                prospectStatsAvailable: prospectStatsAvailable(context.league.currentPhase),
                level,
                spent: context.week ? Number(user.spent || 0) : null,
                remaining: context.week ? Math.max(0, WEEKLY_POINTS - Number(user.spent || 0)) : null,
                scoutingAvailable: Boolean(context.week),
                reveals: REVEALS.map((reveal, index) => ({ ...reveal, unlocked: level > index })),
            };
        });
        return { boardFile: board.file, boardLabel: board.boardLabel, seasonNumber: context.league.seasonNumber, page, totalPages, start, total: board.prospects.length, prospects };
    }

    function prospects(guildId, focused = '', position = null) {
        const context = scoutingContextFor(guildId), board = boardForContext(context);
        const query = normalizeSearch(focused);
        const requestedPosition = String(position || '').trim().toUpperCase();
        return board.prospects.filter(prospect => (!requestedPosition || [prospect.position_1, prospect.position_2]
            .some(value => String(value || '').trim().toUpperCase() === requestedPosition)) && (!query || [prospect.name, prospect.team, prospect.position_1, prospect.position_2]
                .some(value => normalizeSearch(value).includes(query)))).slice(0, 25)
            .map(prospect => ({ name: `#${prospect.board_number} ${prospect.name}`.slice(0, 100), value: String(prospect.board_number) }));
    }

    function scout(guildId, userId, boardNumber, position = null) {
        const before = inspect(guildId, userId, boardNumber);
        if (!before.scoutingAvailable) throw new Error('Scouting points are available during an active regular-season week.');
        const requestedPosition = String(position || '').trim().toUpperCase();
        if (requestedPosition && ![before.prospect.position_1, before.prospect.position_2]
            .some(value => String(value || '').trim().toUpperCase() === requestedPosition)) {
            throw new Error(`That prospect does not match the selected ${requestedPosition} position.`);
        }
        if (!before.nextReveal) throw new Error('You have already unlocked all three scouting ratings for this prospect.');
        if (before.remaining < REVEAL_COST) throw new Error('You are out of scouting points for this league week. Points reset next week and do not roll over.');
        const state = loadState(before.leagueId), user = userState(state, {
            seasonId: before.seasonId,
            week: { weekId: before.weekId },
        }, userId, true);
        const context = scoutingContextFor(guildId), board = boardForContext(context);
        const intel = seasonIntel(state, context, userId, board, true);
        const key = prospectKey(board, before.prospect);
        const currentLevel = Math.max(0, Math.min(REVEALS.length, Number(intel.reports[key] || 0)));
        if (currentLevel !== before.level || Number(user.spent || 0) !== before.spent) {
            return scout(guildId, userId, boardNumber, position);
        }
        user.spent = before.spent + REVEAL_COST;
        user.prospects[String(before.prospect.board_number)] = currentLevel + 1;
        intel.reports[key] = currentLevel + 1;
        saveState(before.leagueId, state);
        return inspect(guildId, userId, boardNumber);
    }

    return { inspect, boardPage, prospects, scout, scoutingHubChannelId, boardForContext, contextFor, availableDraftClasses };
}

module.exports = { createScoutingService, REVEALS, REVEAL_COST, WEEKLY_POINTS };
