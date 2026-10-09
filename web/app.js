window.localStorage.removeItem("leaguebuddyAdminKey");

const state = {
  coachWeekLoading: false,
  staffWeekLoading: false,
  boards: [],
  classLabel: null,
  leagueSite: null,
  topTenProspects: [],
  prospects: [],
  position: new Set(),
  query: "",
  sort: "rank",
  statsPosition: new Set(),
  statsSortDirection: "asc",
  statsSortKey: "rank",
  playerQuery: "",
  playerTeam: "",
  playerConference: "",
  playerPosition: "",
  playerSort: "overall-desc",
  playerPage: 1,
  leagueStats: [],
  leagueStatsLoaded: false,
  leagueStatsLoading: false,
  leagueStatsWarnings: [],
  leagueStatsSearch: "",
  leagueStatsTeam: "",
  leagueStatsConference: "",
  leagueStatsSort: "PPG",
  leagueStatsDirection: "desc",
  leagueStatsPage: 1,
  expandedStatsPlayerId: null,
  statsGameLogs: new Map(),
  statsGameLogLoading: null,
  teamStats: [],
  teamStatsLoaded: false,
  teamStatsLoading: false,
  teamStatsWarnings: [],
  teamStatsConference: "",
  teamStatsSort: "teamName",
  teamStatsDirection: "asc",
  expandedTeamStatsId: null,
  teamGameLogs: new Map(),
  teamGameLogLoading: null,
  teamDetailCache: new Map(),
  playerDetailCache: new Map(),
  currentRosterTeamId: "",
  currentRosterDetail: null,
  adminKey: window.sessionStorage.getItem("leaguebuddyAdminKey") || "",
  importPreview: null,
  toastTimeout: null,
};

const elements = {
  mobileNavToggle: document.querySelector("#mobile-nav-toggle"),
  primaryNav: document.querySelector("#primary-nav"),
  siteToast: document.querySelector("#site-toast"),
  classSwitcher: document.querySelector("#class-switcher"),
  topTenClassLabel: document.querySelector("#top-ten-class-label"),
  topTenCount: document.querySelector("#top-ten-count"),
  topTenEmpty: document.querySelector("#top-ten-empty"),
  topTenGrid: document.querySelector("#top-ten-grid"),
  bigBoardClassLabel: document.querySelector("#big-board-class-label"),
  dialog: document.querySelector("#prospect-dialog"),
  dialogContent: document.querySelector("#dialog-content"),
  leagueDialog: document.querySelector("#league-dialog"),
  leagueDialogContent: document.querySelector("#league-dialog-content"),
  empty: document.querySelector("#empty-state"),
  grid: document.querySelector("#prospect-grid"),
  leagueStatusPill: document.querySelector("#league-status-pill"),
  positionCount: document.querySelector("#position-count"),
  positionFilters: document.querySelector("#position-filters"),
  prospectCount: document.querySelector("#prospect-count"),
  prospectLabel: document.querySelector("#prospect-label"),
  resultCount: document.querySelector("#result-count"),
  search: document.querySelector("#search"),
  sortSelect: document.querySelector("#sort-select"),
  summaryOwners: document.querySelector("#summary-owners"),
  summaryPlayers: document.querySelector("#summary-players"),
  summaryTeams: document.querySelector("#summary-teams"),
  summaryWeeks: document.querySelector("#summary-weeks"),
  schedulePreview: document.querySelector("#schedule-preview"),
  adminRosters: document.querySelector("#admin-rosters"),
  adminRosterIssues: document.querySelector("#admin-roster-issues"),
  adminDataWarnings: document.querySelector("#admin-data-warnings"),
  adminReady: document.querySelector("#admin-ready"),
  adminUnassignedList: document.querySelector("#admin-unassigned-list"),
  statsBody: document.querySelector("#stats-body"),
  statsClassLabel: document.querySelector("#stats-class-label"),
  statsCompletion: document.querySelector("#stats-completion"),
  statsPositionFilters: document.querySelector("#stats-position-filters"),
  statsTable: document.querySelector(".stats-table"),
  teamDirectory: document.querySelector("#team-directory"),
  playerDirectory: document.querySelector("#player-directory"),
  playerPagination: document.querySelector("#player-pagination"),
  playersPrevious: document.querySelector("#players-previous"),
  playersNext: document.querySelector("#players-next"),
  playersPageStatus: document.querySelector("#players-page-status"),
  playerSearch: document.querySelector("#player-search"),
  playerTeamFilter: document.querySelector("#player-team-filter"),
  playerConferenceFilter: document.querySelector("#player-conference-filter"),
  playerPositionFilter: document.querySelector("#player-position-filter"),
  playerSort: document.querySelector("#player-sort"),
  leagueStatsSearch: document.querySelector("#league-stats-search"),
  leagueStatsTeam: document.querySelector("#league-stats-team"),
  leagueStatsConference: document.querySelector("#league-stats-conference"),
  leagueStatsStatus: document.querySelector("#league-stats-status"),
  leagueStatsBody: document.querySelector("#league-stats-body"),
  leagueStatsPagination: document.querySelector("#league-stats-pagination"),
  leagueStatsPrevious: document.querySelector("#league-stats-previous"),
  leagueStatsNext: document.querySelector("#league-stats-next"),
  leagueStatsPageStatus: document.querySelector("#league-stats-page-status"),
  teamStatsConference: document.querySelector("#team-stats-conference"),
  teamStatsStatus: document.querySelector("#team-stats-status"),
  teamStatsBody: document.querySelector("#team-stats-body"),
  adminKey: document.querySelector("#admin-key"),
  adminKeySave: document.querySelector("#admin-key-save"),
  adminKeyStatus: document.querySelector("#admin-key-status"),
  importTeamSelect: document.querySelector("#import-team-select"),
  previewImportButton: document.querySelector("#preview-import-button"),
  applyImportButton: document.querySelector("#apply-import-button"),
  importPreviewOutput: document.querySelector("#import-preview-output"),
  validatePreseasonButton: document.querySelector("#validate-preseason-button"),
  startSeasonButton: document.querySelector("#start-season-button"),
  preseasonValidationOutput: document.querySelector("#preseason-validation-output"),
  dataIssuesList: document.querySelector("#data-issues-list"),
  auditLogList: document.querySelector("#audit-log-list"),
  rosterTeamSelect: document.querySelector("#roster-team-select"),
  loadRosterManager: document.querySelector("#load-roster-manager"),
  rosterManager: document.querySelector("#roster-manager"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function values(prospect, prefix) {
  return [prospect[`${prefix}_1`], prospect[`${prefix}_2`], prospect[`${prefix}_3`]].filter(Boolean);
}

function visibleDetails(items, fallback = "") {
  const details = [...new Set(items.filter((item) => item && item !== "N/A"))];
  return details.length ? details.map(escapeHtml).join(" · ") : escapeHtml(fallback);
}

function prospectPositions(prospect) {
  return [prospect.position_1, prospect.position_2].filter((position) => position && position !== "N/A");
}

function leagueTeams() {
  return state.leagueSite?.teams || [];
}

function leaguePlayers() {
  return state.leagueSite?.players || [];
}

function hasAdminAccess() {
  return Boolean(state.adminKey);
}

function setPanelMessage(element, message) {
  element.innerHTML = `<div class="empty-panel">${escapeHtml(message)}</div>`;
}

function showToast(message) {
  const host = document.querySelector("dialog[open]") || document.body;
  if (elements.siteToast.parentElement !== host) host.append(elements.siteToast);
  elements.siteToast.textContent = String(message || "Something went wrong.");
  elements.siteToast.hidden = false;
  window.clearTimeout(state.toastTimeout);
  state.toastTimeout = window.setTimeout(() => { elements.siteToast.hidden = true; }, 8000);
}


async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

async function adminRequestJson(url, options = {}) {
  if (!hasAdminAccess()) throw new Error("Enter the website admin key to use admin tools.");
  const headers = new Headers(options.headers || {});
  headers.set("x-leaguebuddy-admin-key", state.adminKey);
  const requestOptions = { ...options, headers };
  if (requestOptions.body || (requestOptions.method && requestOptions.method.toUpperCase() !== "GET")) {
    const body = requestOptions.body ? JSON.parse(requestOptions.body) : {};
    body.operator = document.querySelector("#admin-operator")?.value.trim() || "";
    requestOptions.body = JSON.stringify(body);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  }
  return requestJson(url, requestOptions);
}

function filteredProspects() {
  const query = state.query.toLowerCase();
  const positions = ["PG", "SG", "SF", "PF", "C"];
  return state.prospects.filter((prospect) => {
    const matchesPosition = state.position.size === 0 || state.position.has(prospect.position_1);
    const haystack = [prospect.name, prospect.team, prospect.nationality, prospect.build, prospect.pro_comp]
      .filter(Boolean).join(" ").toLowerCase();
    return matchesPosition && (!query || haystack.includes(query));
  }).sort((a, b) => {
    if (state.sort === "position") {
      const positionDifference = positions.indexOf(a.position_1) - positions.indexOf(b.position_1);
      return positionDifference || a.rank - b.rank;
    }
    return a.rank - b.rank;
  });
}

function cardMarkup(prospect, index = 0, source = "big-board") {
  const isPlaceholder = !prospect.name;
  const grade = Number(prospect["draft score"]);
  const gradeMarkup = source === "top-ten" && Number.isFinite(grade)
    ? `<span class="grade-chip">Grade ${grade.toFixed(2)}</span>`
    : "";
  const loading = index < 10 ? "eager" : "lazy";
  const priority = index < 5 ? "high" : "auto";
  const cardTag = isPlaceholder ? "article" : "button";
  const cardAttributes = isPlaceholder
    ? `aria-label="Rank ${escapeHtml(prospect.rank)} is awaiting player data"`
    : `type="button" data-prospect="${escapeHtml(prospect.rank)}" data-source="${source}"`;
  return `
    <${cardTag} class="prospect-card${isPlaceholder ? " placeholder-card" : ""}" ${cardAttributes}>
      <div class="portrait-wrap">
        ${prospect.image ? `<img src="${escapeHtml(prospect.image)}" alt="${escapeHtml(prospect.name)}" loading="${loading}" fetchpriority="${priority}" decoding="async">` : ""}
        <span class="rank">${escapeHtml(prospect.rank)}</span>
        <span class="position-badge">${escapeHtml(prospect.position_1 || "—")}</span>
      </div>
      <div class="card-copy">
        <h3>${escapeHtml(prospect.name || "Open Slot")}</h3>
        <p class="card-team">${visibleDetails([prospect.team, prospect.nationality], isPlaceholder ? "Player details pending" : "Unknown")}</p>
        <div class="card-tags"><span>${escapeHtml(prospect.class || (isPlaceholder ? "Awaiting data" : "—"))}</span>${gradeMarkup}</div>
      </div>
    </${cardTag}>`;
}

function renderBoard() {
  const prospects = filteredProspects();
  elements.grid.innerHTML = prospects.map((prospect, index) => cardMarkup(prospect, index, "big-board")).join("");
  elements.empty.hidden = prospects.length !== 0;
  elements.empty.textContent = state.prospects.length
    ? "No prospects match those filters."
    : "The Big Board is not available for this class yet.";
  elements.resultCount.textContent = `${prospects.length} prospect${prospects.length === 1 ? "" : "s"}`;
}

function renderTopTen() {
  elements.topTenGrid.innerHTML = state.topTenProspects
    .map((prospect, index) => cardMarkup(prospect, index, "top-ten"))
    .join("");
  elements.topTenEmpty.hidden = state.topTenProspects.length !== 0;
  elements.topTenCount.textContent = state.topTenProspects.length
    ? `${state.topTenProspects.length} ranked prospects`
    : "No rankings loaded";
}

function hasProduction(prospect) {
  return [prospect.pts, prospect.rbs, prospect.ast, prospect.stls, prospect.blks]
    .some((value) => value !== null && value !== undefined && value !== "");
}

function statsValue(prospect, key) {
  if (key === "rank") return prospect.rank;
  if (key === "name") return prospect.name;
  if (key === "position") return prospect.position_1;
  return prospect[key];
}

function compareStats(a, b) {
  const key = state.statsSortKey;
  const aValue = statsValue(a, key);
  const bValue = statsValue(b, key);
  const aMissing = aValue === null || aValue === undefined || aValue === "";
  const bMissing = bValue === null || bValue === undefined || bValue === "";
  if (aMissing !== bMissing) return aMissing ? 1 : -1;
  if (aMissing && bMissing) return a.rank - b.rank;

  let comparison;
  if (key === "position") {
    const order = ["PG", "SG", "SF", "PF", "C"];
    comparison = order.indexOf(aValue) - order.indexOf(bValue);
  } else if (typeof aValue === "number" && typeof bValue === "number") {
    comparison = aValue - bValue;
  } else {
    comparison = String(aValue).localeCompare(String(bValue));
  }
  return (state.statsSortDirection === "asc" ? comparison : -comparison) || a.rank - b.rank;
}

function displayStat(value, digits = null) {
  if (value === null || value === undefined || value === "") return '<span class="not-loaded">—</span>';
  if (digits !== null && Number.isFinite(Number(value))) return Number(value).toFixed(digits);
  return escapeHtml(value);
}

function statCell(prospect, key, digits = 1) {
  return `<td class="stat-value">${displayStat(prospect[key], digits)}</td>`;
}

function renderStats() {
  const positionOrder = ["PG", "SG", "SF", "PF", "C"];
  const available = new Set(state.prospects.map((prospect) => prospect.position_1).filter(Boolean));
  const positions = positionOrder.filter((position) => available.has(position));
  state.statsPosition = new Set([...state.statsPosition].filter((position) => available.has(position)));
  elements.statsPositionFilters.innerHTML = ["ALL", ...positions]
    .map((position) => {
      const active = position === "ALL" ? state.statsPosition.size === 0 : state.statsPosition.has(position);
      return `<button type="button" class="${active ? "active" : ""}" data-stats-position="${position}" aria-pressed="${active}">${position === "ALL" ? "All" : position}</button>`;
    }).join("");

  const prospects = state.prospects
    .filter((prospect) => state.statsPosition.size === 0 || state.statsPosition.has(prospect.position_1))
    .sort(compareStats);
  const completed = state.prospects.filter(hasProduction).length;
  elements.statsCompletion.textContent = `${completed} of ${state.prospects.length} stat lines loaded`;
  elements.statsBody.innerHTML = prospects.map((prospect, index) => `
    <tr class="${hasProduction(prospect) ? "stats-loaded" : "stats-pending"}"${prospect.name ? ` data-stats-prospect="${escapeHtml(prospect.rank)}"` : ""}>
      <td><strong class="table-rank">${index + 1}</strong></td>
      <td class="player-column">
        <div class="stats-prospect">
          <div class="stats-headshot">${prospect.image ? `<img src="${escapeHtml(prospect.image)}" alt="" loading="lazy" decoding="async">` : `<span>${escapeHtml(prospect.position_1 || "—")}</span>`}</div>
          <div class="stats-identity">
            <strong>${escapeHtml(prospect.name || "Open Slot")}</strong>
            <small><b>${escapeHtml(prospectPositions(prospect).join("/") || "—")}</b> · ${visibleDetails([prospect.team, prospect.nationality], prospect.name ? "—" : "Awaiting player data")}</small>
            <em>${[prospect.height, prospect.weight ? `${prospect.weight} lbs` : null, prospect.class, prospect.age ? `${prospect.age} yrs` : null].filter(Boolean).map(escapeHtml).join(" · ") || "Profile details pending"}</em>
          </div>
        </div>
      </td>
      ${statCell(prospect, "pts")}
      ${statCell(prospect, "rbs")}
      ${statCell(prospect, "ast")}
      ${statCell(prospect, "stls")}
      ${statCell(prospect, "blks")}
    </tr>`).join("");

  elements.statsTable.querySelectorAll("[data-stat-sort]").forEach((button) => {
    const active = button.dataset.statSort === state.statsSortKey;
    button.dataset.direction = active ? state.statsSortDirection : "";
    button.closest("th").setAttribute("aria-sort", active
      ? (state.statsSortDirection === "asc" ? "ascending" : "descending")
      : "none");
  });
}

function renderFilters() {
  const positionOrder = ["PG", "SG", "SF", "PF", "C"];
  const available = new Set(state.prospects.map((prospect) => prospect.position_1).filter(Boolean));
  const positions = positionOrder.filter((position) => available.has(position));
  elements.positionFilters.innerHTML = ["ALL", ...positions].map((position) => `
    <button type="button" class="filter-button${position === "ALL" ? (state.position.size === 0 ? " active" : "") : (state.position.has(position) ? " active" : "")}" data-position="${position}" aria-pressed="${position === "ALL" ? state.position.size === 0 : state.position.has(position)}">${position === "ALL" ? "All" : position}</button>
  `).join("");
  if (elements.positionCount) elements.positionCount.textContent = positions.length;
}

function classLabels() {
  return [...new Set(state.boards.flatMap((board) => board.classes.map((item) => item.label)))];
}

function shortClassLabel(label) {
  return String(label || "").replace(/^2k27_/i, "");
}

function renderClassSwitcher() {
  elements.classSwitcher.textContent = `Season ${state.leagueSite?.league?.seasonNumber || state.draftSeasonNumber || 1} · ${shortClassLabel(state.classLabel)}`;
}

function fact(label, value) {
  if (value === null || value === undefined || value === "" || value === "N/A") return "";
  return `<div class="fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function stat(label, value) {
  if (value === null || value === undefined || value === "") return "";
  return `<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function openProfile(id, source = "big-board", updateUrl = true) {
  const collection = source === "top-ten" ? state.topTenProspects : state.prospects;
  const prospect = collection.find((item) => String(item.rank) === String(id));
  if (!prospect) return;
  const strengths = values(prospect, "strength");
  const weaknesses = values(prospect, "weakness");
  const positions = prospectPositions(prospect).join("/");
  const production = [
    stat("PTS", prospect.pts),
    stat("REB", prospect.rbs),
    stat("AST", prospect.ast),
    stat("STL", prospect.stls),
    stat("BLK", prospect.blks),
  ].filter(Boolean);
  elements.dialogContent.innerHTML = `
    <section class="profile-hero">
      <div class="profile-copy">
        <span class="profile-rank">No. ${escapeHtml(prospect.rank)} overall</span>
        <h2>${escapeHtml(prospect.name)}</h2>
        <p class="profile-sub">${visibleDetails([prospect.team, prospect.nationality], "Unknown")} · ${escapeHtml(positions)} · ${escapeHtml(prospect.class || "N/A")}</p>
      </div>
      <div class="profile-portrait">${prospect.image ? `<img src="${escapeHtml(prospect.image)}" alt="${escapeHtml(prospect.name)}" loading="eager" fetchpriority="high" decoding="async">` : ""}</div>
    </section>
    <section class="profile-body">
      <div>
        <div class="report-section"><h3>Scouting report</h3><p>${escapeHtml(prospect.about || "Scouting report coming soon.")}</p></div>
        ${production.length ? `<div class="report-section"><h3>Season production</h3><div class="stat-grid">${production.join("")}</div></div>` : ""}
        <div class="report-section"><h3>Strengths</h3><div class="trait-list">${strengths.map((item) => `<span>${escapeHtml(item)}</span>`).join("") || "—"}</div></div>
        <div class="report-section"><h3>Development areas</h3><div class="trait-list concerns">${weaknesses.map((item) => `<span>${escapeHtml(item)}</span>`).join("") || "—"}</div></div>
      </div>
      <aside class="fact-list">
        ${fact("Build", prospect.build)}
        ${fact("Pro comparison", prospect.pro_comp)}
        ${fact("Nationality", prospect.nationality)}
        ${fact("Height", prospect.height)}
        ${fact("Weight", prospect.weight ? `${prospect.weight} lbs` : null)}
        ${fact("Wingspan", prospect.wingspan || prospect.wingspain)}
        ${fact("Age", prospect.age)}
        ${fact("Shoots", String(prospect.handle || "").toLowerCase() === "left" ? "Left" : "Right")}
        ${fact("Jersey", prospect["jersey_#"])}
      </aside>
    </section>`;
  elements.dialog.showModal();
  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set("prospect", prospect.rank);
    url.searchParams.set("source", source);
    history.pushState({}, "", url);
  }
}

function closeProfile(updateUrl = true) {
  if (elements.dialog.open) elements.dialog.close();
  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.delete("prospect");
    url.searchParams.delete("source");
    history.pushState({}, "", url);
  }
}

function openLeagueDialog(html) {
  elements.leagueDialogContent.innerHTML = html;
  if (!elements.leagueDialog.open) elements.leagueDialog.showModal();
}

function closeLeagueDialog() {
  if (elements.leagueDialog.open) elements.leagueDialog.close();
}

function classEntry(boardId, label) {
  return state.boards.find((board) => board.id === boardId)?.classes.find((item) => item.label === label);
}

async function fetchClassBoard(boardId, label) {
  const entry = classEntry(boardId, label);
  if (!entry) return null;
  return requestJson(`/api/prospects?board=${encodeURIComponent(boardId)}&class=${encodeURIComponent(entry.file)}`);
}

function ovrValue(player) {
  return Number.isFinite(Number(player.overall)) ? Number(player.overall) : null;
}

function positionLabel(player) {
  return [player.position1, player.position2].filter(Boolean).join("/") || "N/A";
}

function filteredLeaguePlayers() {
  const query = state.playerQuery.toLowerCase();
  return leaguePlayers().filter((player) => {
    const haystack = [player.name, player.teamName, player.nationality, player.archetype, player.position1, player.position2]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (player.retiredAt) return false;
    if (state.playerTeam === "free-agents" ? Boolean(player.teamId || player.retiredAt) : state.playerTeam && player.teamId !== state.playerTeam) return false;
    if (state.playerConference && player.conference !== state.playerConference) return false;
    if (state.playerPosition && ![player.position1, player.position2].includes(state.playerPosition)) return false;
    return true;
  }).sort((left, right) => {
    if (state.playerSort === "name-asc") return String(left.name || "").localeCompare(String(right.name || ""));
    if (state.playerSort === "team-asc") return String(left.teamName || "").localeCompare(String(right.teamName || "")) || String(left.name || "").localeCompare(String(right.name || ""));
    const leftOvr = ovrValue(left);
    const rightOvr = ovrValue(right);
    if (state.playerSort === "overall-asc") return (leftOvr ?? Infinity) - (rightOvr ?? Infinity) || String(left.name || "").localeCompare(String(right.name || ""));
    return (rightOvr ?? -Infinity) - (leftOvr ?? -Infinity) || String(left.name || "").localeCompare(String(right.name || ""));
  });
}

function playerPortraitMarkup(player, className = "") {
  let source = player.imageUrl || "";
  try {
    const profile = new URL(player.profileUrl);
    const slug = profile.pathname.split("/").filter(Boolean).pop();
    if (/(^|\.)2kratings\.com$/.test(profile.hostname) && /^[a-z0-9-]+$/.test(slug)
      && (!source || /https:\/\/(www\.)?2kratings\.com\//.test(source))) {
      source = `/ratings-assets/${slug}`;
    }
  } catch { }
  return source
    ? `<img class="${className}" data-player-portrait data-fallback="${escapeHtml(player.imageUrl || "")}" src="${escapeHtml(source)}" alt="${escapeHtml(player.name)}" loading="lazy" decoding="async">`
    : `<span>${escapeHtml(player.position1 || "P")}</span>`;
}

function ownerLabel(team) {
  return team.ownerUserId ? (team.ownerDisplayName || "Assigned member") : "Unassigned";
}

function teamLogoMarkup(name, large = false) {
  const team = leagueTeams().find((entry) => entry.teamName === name || entry.teamId === name);
  const slug = String(team?.teamName || name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug || name === "Free Agent") return "";
  return `<img class="team-logo${large ? " team-logo-large" : ""}" src="/assets/nba/${encodeURIComponent(slug)}.png" alt="${escapeHtml(team?.teamName || name)} logo" loading="lazy" data-team-logo>`;
}

function playerCardMarkup(player, rank) {
  const overall = ovrValue(player);
  return `
    <button type="button" class="prospect-card league-player-card" data-player-id="${escapeHtml(player.playerId)}">
      <div class="portrait-wrap">
        ${playerPortraitMarkup(player)}
        <span class="rank" aria-label="List position ${rank}">${rank}</span>
        <span class="position-badge">${escapeHtml(positionLabel(player))}</span>
      </div>
      <div class="card-copy">
        <h3 title="${escapeHtml(player.name || "Unknown Player")}">${escapeHtml(player.name || "Unknown Player")}</h3>
        <p class="card-team">${teamLogoMarkup(player.teamName)}${visibleDetails([player.teamName || "Free Agent", player.nationality])}</p>
        <div class="card-tags">
          <span class="player-build" title="${escapeHtml(player.archetype || "")}">${escapeHtml(player.archetype || "Player")}</span>
          <span class="grade-chip">OVR ${overall ?? "—"}</span>
          <span class="grade-chip">AGE ${player.age ?? "—"}</span>
          <span class="grade-chip">TV ${Number(player.tradeValue || 1).toLocaleString("en-US")}</span>
          ${contractMarkup(player)}
        </div>
      </div>
    </button>`;
}

function schedulePreviewMarkup(week) {
  return `
    <article class="schedule-week-card">
      <div class="week-card-head">
        <strong>Week ${week.week}</strong>
        <span>${week.games.length} games</span>
      </div>
      <div class="week-lines">
        ${week.games.slice(0, 6).map((game) => `<p>${teamLogoMarkup(game.team1Name)}${escapeHtml(game.team1Name)} vs ${teamLogoMarkup(game.team2Name)}${escapeHtml(game.team2Name)} <small>${escapeHtml(game.conference)}</small></p>`).join("")}
      </div>
      <div class="week-bye">Byes: ${week.byes.map((bye) => `${escapeHtml(bye.teamName)} (${escapeHtml(bye.conference)})`).join(", ")}</div>
    </article>`;
}

function renderLeagueFilters() {
  const teamOptions = ['<option value="">All teams</option>', `<option value="free-agents"${state.playerTeam === "free-agents" ? " selected" : ""}>Free agents</option>`]
    .concat(leagueTeams().map((team) => `<option value="${escapeHtml(team.teamId)}"${team.teamId === state.playerTeam ? " selected" : ""}>${escapeHtml(team.teamName)}</option>`));
  elements.playerTeamFilter.innerHTML = teamOptions.join("");
  elements.importTeamSelect.innerHTML = leagueTeams().map((team) => `<option value="${escapeHtml(team.teamId)}">${escapeHtml(team.teamName)}</option>`).join("");
  elements.rosterTeamSelect.innerHTML = leagueTeams().map((team) => `<option value="${escapeHtml(team.teamId)}">${escapeHtml(team.teamName)}</option>`).join("");
  if (!state.currentRosterTeamId && leagueTeams().length) state.currentRosterTeamId = leagueTeams()[0].teamId;
  if (state.currentRosterTeamId) elements.rosterTeamSelect.value = state.currentRosterTeamId;
}

function renderPlayerDirectory() {
  const players = filteredLeaguePlayers();
  const pages = Math.max(1, Math.ceil(players.length / 30));
  state.playerPage = Math.max(1, Math.min(state.playerPage, pages));
  const start = (state.playerPage - 1) * 30;
  elements.playerPagination.hidden = players.length === 0;
  elements.playersPrevious.disabled = state.playerPage === 1;
  elements.playersNext.disabled = state.playerPage === pages;
  elements.playersPageStatus.textContent = `${start + 1}–${Math.min(start + 30, players.length)} of ${players.length} · Page ${state.playerPage} of ${pages}`;
  if (!players.length) {
    setPanelMessage(elements.playerDirectory, "No players match the current filters.");
    return;
  }
  elements.playerDirectory.innerHTML = players.slice(start, start + 30).map((player, index) => playerCardMarkup(player, start + index + 1)).join("");
}

function formatSeasonStat(value, percent = false) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(1)}${percent ? "%" : ""}`;
}

function filteredLeagueStats() {
  const query = state.leagueStatsSearch.trim().toLowerCase();
  return state.leagueStats.filter(player => {
    const matchesTeam = !state.leagueStatsTeam || player.teamId === state.leagueStatsTeam;
    const matchesConference = !state.leagueStatsConference || player.conference === state.leagueStatsConference;
    const matchesSearch = !query || String(player.name || "").toLowerCase().includes(query);
    const shootingEligible = !['FGPercent', 'threePPercent', 'FTPercent'].includes(state.leagueStatsSort) || player.percentageQualification?.[state.leagueStatsSort]?.eligible === true;
    return matchesTeam && matchesConference && matchesSearch && shootingEligible;
  }).sort((left, right) => {
    const key = state.leagueStatsSort, a = left[key], b = right[key];
    const aMissing = a === null || a === undefined || a === "";
    const bMissing = b === null || b === undefined || b === "";
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    let comparison = aMissing ? 0 : typeof a === "string" || typeof b === "string"
      ? String(a).localeCompare(String(b)) : Number(a) - Number(b);
    if (state.leagueStatsDirection === "desc") comparison *= -1;
    return comparison || String(left.name).localeCompare(String(right.name)) || left.playerId.localeCompare(right.playerId);
  });
}

function statsGameLogMarkup(playerId) {
  if (state.statsGameLogLoading === playerId) return '<div class="empty-panel">Loading official game log…</div>';
  const result = state.statsGameLogs.get(playerId);
  if (result?.error) return `<div class="empty-panel">${escapeHtml(result.error)}</div>`;
  if (!result?.games?.length) return '<div class="empty-panel">No official regular-season games yet.</div>';
  return `<div class="player-game-log-wrap"><table class="stats-table player-game-log"><thead><tr>${['Week', 'Date', 'Team', 'Opponent', 'Result', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FG', '3PT', 'FT', 'OREB', 'FLS'].map(title => `<th>${title}</th>`).join('')}</tr></thead><tbody>${result.games.map(game => {
    const week = game.submissionId
      ? `<a href="/games/${encodeURIComponent(game.gameId)}/submissions/${encodeURIComponent(game.submissionId)}/review">${escapeHtml(game.week)}</a>`
      : escapeHtml(game.week);
    const value = key => game.DNP ? '—' : escapeHtml(game[key] ?? '—');
    return `<tr class="${game.DNP ? 'dnp-row' : ''}"><td>${week}</td><td>${escapeHtml(game.date || '—')}</td><td>${escapeHtml(game.teamName || '—')}</td><td>${escapeHtml(game.opponent || '—')}</td><td>${game.DNP ? '<strong>DNP</strong>' : `${escapeHtml(game.result)} ${escapeHtml(game.score)}`}</td><td>${value('MIN')}</td><td>${value('PTS')}</td><td>${value('REB')}</td><td>${value('AST')}</td><td>${value('STL')}</td><td>${value('BLK')}</td><td>${value('TO')}</td><td>${value('FG')}</td><td>${value('3PT')}</td><td>${value('FT')}</td><td>${value('OREB')}</td><td>${value('FLS')}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderLeagueStats() {
  const players = filteredLeagueStats(), pageSize = 30, pages = Math.max(1, Math.ceil(players.length / pageSize));
  state.leagueStatsPage = Math.max(1, Math.min(state.leagueStatsPage, pages));
  const start = (state.leagueStatsPage - 1) * pageSize, visible = players.slice(start, start + pageSize);
  const rows = [];
  for (const player of visible) {
    rows.push(`<tr><td><button type="button" class="stats-player-toggle" data-season-stats-player="${escapeHtml(player.playerId)}" aria-expanded="${state.expandedStatsPlayerId === player.playerId}">${escapeHtml(player.name)}</button></td><td>${teamLogoMarkup(player.teamName)}${escapeHtml(player.teamName || 'Free Agent')}</td><td>${player.GP}</td><td>${formatSeasonStat(player.MPG)}</td><td>${formatSeasonStat(player.PPG)}</td><td>${formatSeasonStat(player.RPG)}</td><td>${formatSeasonStat(player.APG)}</td><td>${formatSeasonStat(player.SPG)}</td><td>${formatSeasonStat(player.BPG)}</td><td>${formatSeasonStat(player.FGPercent, true)}</td><td>${formatSeasonStat(player.threePPercent, true)}</td><td>${formatSeasonStat(player.FTPercent, true)}</td><td>${formatSeasonStat(player.TOV)}</td></tr>`);
    if (state.expandedStatsPlayerId === player.playerId) rows.push(`<tr class="stats-expanded-row"><td colspan="13">${statsGameLogMarkup(player.playerId)}</td></tr>`);
  }
  elements.leagueStatsBody.innerHTML = rows.join('') || '<tr><td colspan="13">No players match these filters.</td></tr>';
  elements.leagueStatsPagination.hidden = players.length <= pageSize;
  elements.leagueStatsPrevious.disabled = state.leagueStatsPage === 1;
  elements.leagueStatsNext.disabled = state.leagueStatsPage === pages;
  elements.leagueStatsPageStatus.textContent = `${players.length ? start + 1 : 0}–${Math.min(start + pageSize, players.length)} of ${players.length} · Page ${state.leagueStatsPage} of ${pages}`;
  const warningCount = state.leagueStatsWarnings.length;
  const percentageKey = ['FGPercent', 'threePPercent', 'FTPercent'].includes(state.leagueStatsSort) ? state.leagueStatsSort : null;
  const qualificationHint = percentageKey ? ' · Qualified shooting leaders only; full percentages remain on player profiles' : '';
  elements.leagueStatsStatus.textContent = `${state.leagueStats.length} players · ${document.querySelector('#player-stats-scope')?.value === 'REGULAR_SEASON' ? 'Published when the week advances' : 'Official approved postseason games'}${warningCount ? ` · ${warningCount} invalid game-stat rows excluded` : ''}${qualificationHint}`;
}

async function loadLeagueStats(force = false) {
  if (state.leagueStatsLoading || (state.leagueStatsLoaded && !force)) { if (state.leagueStatsLoaded) renderLeagueStats(); return; }
  state.leagueStatsLoading = true;
  elements.leagueStatsStatus.textContent = 'Loading official player statistics…';
  try {
    const payload = await requestJson('/api/league/stats'+statScopeQuery('player'));
    state.leagueStats = payload.players || [];
    state.leagueStatsWarnings = payload.warnings || [];
    state.leagueStatsLoaded = true;
    const options = ['<option value="">All teams</option>', ...leagueTeams().map(team => `<option value="${escapeHtml(team.teamId)}">${escapeHtml(team.teamName)}</option>`)];
    elements.leagueStatsTeam.innerHTML = options.join('');
    elements.leagueStatsTeam.value = state.leagueStatsTeam;
    renderLeagueStats();
  } catch (error) {
    elements.leagueStatsStatus.textContent = error.message;
    elements.leagueStatsBody.innerHTML = '<tr><td colspan="13">Unable to load season stats.</td></tr>';
  } finally { state.leagueStatsLoading = false; }
}

async function toggleStatsGameLog(playerId) {
  if (state.expandedStatsPlayerId === playerId) { state.expandedStatsPlayerId = null; renderLeagueStats(); return; }
  state.expandedStatsPlayerId = playerId;
  renderLeagueStats();
  if (state.statsGameLogs.has(playerId)) return;
  state.statsGameLogLoading = playerId;
  renderLeagueStats();
  try {
    state.statsGameLogs.set(playerId, await requestJson(`/api/league/stats/players/${encodeURIComponent(playerId)}/games${statScopeQuery('player')}`));
  } catch (error) { state.statsGameLogs.set(playerId, { error: error.message }); }
  finally { state.statsGameLogLoading = null; renderLeagueStats(); }
}

function filteredTeamStats() {
  return state.teamStats.filter(team => !state.teamStatsConference || team.conference === state.teamStatsConference)
    .sort((left, right) => {
      const key = state.teamStatsSort, a = left[key], b = right[key];
      let comparison = typeof a === "string" || typeof b === "string"
        ? String(a ?? "").localeCompare(String(b ?? "")) : Number(a ?? 0) - Number(b ?? 0);
      if (state.teamStatsDirection === "desc") comparison *= -1;
      return comparison || String(left.teamName).localeCompare(String(right.teamName));
    });
}

function formatTeamDifferential(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number > 0 ? "+" : ""}${number.toFixed(1)}` : "—";
}

function teamGameLogMarkup(teamId) {
  if (state.teamGameLogLoading === teamId) return '<div class="empty-panel">Loading official team game log…</div>';
  const result = state.teamGameLogs.get(teamId);
  if (result?.error) return `<div class="empty-panel">${escapeHtml(result.error)}</div>`;
  if (!result?.games?.length) return '<div class="empty-panel">No official regular-season games yet.</div>';
  return `<div class="team-game-log-wrap"><table class="stats-table team-game-log"><thead><tr>${['Week', 'Date', 'Team', 'Opponent', 'Result', 'PTS', 'PTS ALLOWED', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FG', '3PT', 'FT', 'OREB', 'FLS'].map(title => `<th>${title}</th>`).join('')}</tr></thead><tbody>${result.games.map(game => {
    const week = game.submissionId
      ? `<a href="/games/${encodeURIComponent(game.gameId)}/submissions/${encodeURIComponent(game.submissionId)}/review">${escapeHtml(game.week)}</a>`
      : escapeHtml(game.week);
    return `<tr><td>${week}</td><td>${escapeHtml(game.date || '—')}</td><td>${escapeHtml(game.teamName || '—')}</td><td>${escapeHtml(game.opponent || '—')}</td><td>${escapeHtml(game.result)} ${escapeHtml(game.score)}</td><td>${escapeHtml(game.PTS)}</td><td>${escapeHtml(game.PTS_ALLOWED)}</td><td>${escapeHtml(game.REB ?? '—')}</td><td>${escapeHtml(game.AST ?? '—')}</td><td>${escapeHtml(game.STL ?? '—')}</td><td>${escapeHtml(game.BLK ?? '—')}</td><td>${escapeHtml(game.TO ?? '—')}</td><td>${escapeHtml(game.FG ?? '—')}</td><td>${escapeHtml(game['3PT'] ?? '—')}</td><td>${escapeHtml(game.FT ?? '—')}</td><td>${escapeHtml(game.OREB ?? '—')}</td><td>${escapeHtml(game.FLS ?? '—')}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderTeamStats() {
  const teams = filteredTeamStats(), rows = [];
  for (const team of teams) {
    rows.push(`<tr><td><button type="button" class="team-stats-profile-link" data-team-stats-profile="${escapeHtml(team.teamId)}">${teamLogoMarkup(team.teamName)}${escapeHtml(team.teamName)}</button></td><td>${team.GP}</td><td>${team.W}</td><td>${team.L}</td><td>${Number(team.PCT).toFixed(3).replace(/^0\./, '.')}</td><td>${formatSeasonStat(team.PPG)}</td><td>${formatSeasonStat(team.OPP_PPG)}</td><td>${formatTeamDifferential(team.AVG_DIFF)}</td><td>${formatSeasonStat(team.RPG)}</td><td>${formatSeasonStat(team.APG)}</td><td>${formatSeasonStat(team.SPG)}</td><td>${formatSeasonStat(team.BPG)}</td><td>${formatSeasonStat(team.TOV)}</td><td>${formatSeasonStat(team.FGPercent, true)}</td><td>${formatSeasonStat(team.threePPercent, true)}</td><td>${formatSeasonStat(team.FTPercent, true)}</td><td><button type="button" class="team-stats-log-toggle" data-team-stats-log="${escapeHtml(team.teamId)}" aria-expanded="${state.expandedTeamStatsId === team.teamId}">Games</button></td></tr>`);
    if (state.expandedTeamStatsId === team.teamId) rows.push(`<tr class="stats-expanded-row"><td colspan="17">${teamGameLogMarkup(team.teamId)}</td></tr>`);
  }
  elements.teamStatsBody.innerHTML = rows.join('') || '<tr><td colspan="17">No teams are available.</td></tr>';
  const warnings = state.teamStatsWarnings.length;
  elements.teamStatsStatus.textContent = `${teams.length} teams · ${document.querySelector('#team-stats-scope')?.value === 'REGULAR_SEASON' ? 'Published when the week advances' : 'Official approved postseason games'}${warnings ? ` · ${warnings} invalid team-stat rows excluded` : ''}`;
}

async function loadTeamStats(force = false) {
  if (state.teamStatsLoading || (state.teamStatsLoaded && !force)) { if (state.teamStatsLoaded) renderTeamStats(); return; }
  state.teamStatsLoading = true;
  elements.teamStatsStatus.textContent = 'Loading official team statistics…';
  try {
    const payload = await requestJson('/api/league/team-stats'+statScopeQuery('team'));
    state.teamStats = payload.teams || [];
    state.teamStatsWarnings = payload.warnings || [];
    state.teamStatsLoaded = true;
    renderTeamStats();
  } catch (error) {
    elements.teamStatsStatus.textContent = error.message;
    elements.teamStatsBody.innerHTML = '<tr><td colspan="17">Unable to load team stats.</td></tr>';
  } finally { state.teamStatsLoading = false; }
}

async function toggleTeamGameLog(teamId) {
  if (state.expandedTeamStatsId === teamId) { state.expandedTeamStatsId = null; renderTeamStats(); return; }
  state.expandedTeamStatsId = teamId;
  renderTeamStats();
  if (state.teamGameLogs.has(teamId)) return;
  state.teamGameLogLoading = teamId;
  renderTeamStats();
  try { state.teamGameLogs.set(teamId, await requestJson(`/api/league/team-stats/${encodeURIComponent(teamId)}/games${statScopeQuery('team')}`)); }
  catch (error) { state.teamGameLogs.set(teamId, { error: error.message }); }
  finally { state.teamGameLogLoading = null; renderTeamStats(); }
}

function updateAdminPanelVisibility(phase, hasLeague = true) {
  const preseason = hasLeague && phase === "PRESEASON";
  document.querySelector("#roster-import-panel").hidden = !hasLeague || phase === "REGULAR_SEASON";
  document.querySelector("#season-start-panel").hidden = !preseason;
}

function renderLeagueSite() {
  const payload = state.leagueSite;
  updateAdminPanelVisibility(payload?.league?.currentPhase, Boolean(payload?.league));
  if (!payload?.league) {
    elements.leagueStatusPill.textContent = "League not connected";
    setPanelMessage(elements.teamDirectory, "Start in Discord: run /league create with a unique ID (for example 2k-test-03) and a league name. Roles and players are prepared automatically. Choose test_mode:true for solo testing.");
    setPanelMessage(elements.schedulePreview, "After creating your league, open /league setup and use Generate schedule, then Confirm schedule.");
    setPanelMessage(elements.playerDirectory, "Players appear after league creation imports the NBA rosters and free agents. Refresh this page after setup.");
    elements.adminUnassignedList.innerHTML = "<li>Start with /league create in Discord, then follow /league setup. Existing team roles keep their owners. Draft browsing below works without a league.</li>";
    return;
  }

  const { league, summary, teams, schedulePreview, admin, preseason } = payload;
  renderCoachWeekPicker(teams);
  document.querySelector("#staff-weekly").hidden = !hasAdminAccess() || league.currentPhase !== "REGULAR_SEASON";
  if (location.hash === "#staff-weekly" && !hasAdminAccess()) requestAnimationFrame(() => document.querySelector("#league-admin").scrollIntoView({ block: "start" }));
  elements.leagueStatusPill.textContent = `Season ${league.seasonNumber} • ${league.currentPhase}`;
  elements.summaryTeams.textContent = summary.teams;
  elements.summaryPlayers.textContent = summary.players;
  elements.summaryWeeks.textContent = `${summary.weeks} / ${summary.games}`;
  elements.summaryOwners.textContent = `${summary.ownersAssigned}/${summary.teams}`;
  elements.adminRosters.textContent = `${summary.rostersImported}/${summary.teams}`;
  elements.adminRosterIssues.textContent = admin.rosterIssues;
  elements.adminDataWarnings.textContent = admin.dataWarnings;
  elements.adminReady.textContent = preseason.ready ? "Ready" : "Review";

  elements.teamDirectory.innerHTML = teams.map((team) => `
    <button type="button" class="team-tile" data-team-id="${escapeHtml(team.teamId)}">
      <div class="team-top">
        <div>
          ${teamLogoMarkup(team.teamName)}<strong>${escapeHtml(team.teamName)}</strong>
          <small>${escapeHtml(team.abbreviation)} • ${escapeHtml(team.conference)}</small>
        </div>
        <span class="team-badge">${escapeHtml(team.rosterSize)}</span>
      </div>
      <p>Owner: <span data-team-owner="${escapeHtml(team.teamId)}">${escapeHtml(ownerLabel(team))}</span></p>
      <span class="team-meta">${team.rosterImported ? "Roster imported" : "Roster missing"}</span>
    </button>
  `).join("");

  elements.schedulePreview.innerHTML = schedulePreview.length
    ? schedulePreview.map(schedulePreviewMarkup).join("")
    : '<article class="empty-panel">Generate and confirm a schedule to see the league calendar here.</article>';

  elements.adminUnassignedList.innerHTML = admin.unassignedTeams.length
    ? admin.unassignedTeams.map((team) => `<li>${escapeHtml(team)}</li>`).join("")
    : "<li>All teams currently have owners assigned.</li>";

  renderLeagueFilters();
  renderPlayerDirectory();
  elements.adminKey.value = state.adminKey;
  elements.adminKeyStatus.textContent = hasAdminAccess()
    ? "Admin tools unlocked for this browser session."
    : "Admin tools are currently locked.";
}

function previewSummaryMarkup(preview) {
  return `
    <div class="admin-summary">
      <strong>${escapeHtml(preview.teamName)} import preview</strong>
      <p>Roster date: ${escapeHtml(preview.sourceRosterDate || "Unknown")}</p>
      <p>Unchanged: ${preview.unchanged} · Changed: ${preview.changes.length} · Added: ${preview.added.length} · Removed: ${preview.removed.length} · Unresolved: ${preview.unresolved.length}</p>
      ${preview.changes.length ? `<div><h4>Changed</h4><ul>${preview.changes.slice(0, 12).map((item) => `<li>${escapeHtml(item.playerName)}: ${item.changes.map((change) => `${escapeHtml(change.field)} ${escapeHtml(change.before ?? "—")} → ${escapeHtml(change.after ?? "—")}`).join(", ")}</li>`).join("")}</ul></div>` : ""}
      ${preview.added.length ? `<div><h4>Added</h4><ul>${preview.added.slice(0, 12).map((item) => `<li>${escapeHtml(item.name)} (${escapeHtml(positionLabel(item))})</li>`).join("")}</ul></div>` : ""}
      ${preview.removed.length ? `<div><h4>Removed</h4><ul>${preview.removed.slice(0, 12).map((item) => `<li>${escapeHtml(item.name)}</li>`).join("")}</ul></div>` : ""}
      ${preview.unresolved.length ? `<div><h4>Unresolved</h4><ul>${preview.unresolved.slice(0, 12).map((item) => `<li>${escapeHtml(item.imported.name)} may match ${escapeHtml(item.existing.name)} (${escapeHtml(item.confidence)})</li>`).join("")}</ul></div>` : ""}
    </div>`;
}

function validationMarkup(validation) {
  return `
    <div class="admin-summary">
      <strong>${validation.ready ? "Preseason ready" : "Preseason blocked"}</strong>
      <p>${Object.entries(validation.checks).map(([key, value]) => `${escapeHtml(key)}: ${value ? "PASS" : "FAIL"}`).join(" · ")}</p>
      ${validation.errors.length ? `<div><h4>Errors</h4><ul>${validation.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul></div>` : "<p>No blocking errors.</p>"}
      ${validation.warnings.length ? `<div><h4>Warnings</h4><ul>${validation.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></div>` : ""}
    </div>`;
}

function auditMarkup(entries) {
  if (!entries.length) return '<div class="empty-panel">No audit log entries yet.</div>';
  return entries.slice(0, 40).map((entry) => `
    <article class="list-row">
      <strong>${escapeHtml(entry.action)}</strong>
      <small>${escapeHtml(entry.timestamp || "")}</small>
      <p>${escapeHtml(entry.operator || entry.userId || "system")}</p>
      ${entry.commissionerUserId ? `<small>Commissioner ID: ${escapeHtml(entry.commissionerUserId)}</small>` : ""}
    </article>`).join("");
}

function issuesMarkup(issues) {
  if (!issues.length) return '<div class="empty-panel">No data issues detected.</div>';
  return issues.map((issue) => `
    <article class="list-row ${issue.severity === "error" ? "list-row-error" : ""}">
      <strong>${escapeHtml(issue.type)}</strong>
      <small>${escapeHtml(issue.severity)}</small>
      <p>${escapeHtml(issue.message)}</p>
    </article>`).join("");
}

async function refreshLeagueSite() {
  state.leagueSite = await requestJson("/api/league-site");
  renderLeagueSite();
}

async function loadAdminPanels() {
  if (!hasAdminAccess()) {
    document.querySelector("#staff-week-output").replaceChildren();
    document.querySelector("#staff-weekly").hidden = true;
    setPanelMessage(elements.dataIssuesList, "Unlock admin access to load preseason issues.");
    setPanelMessage(elements.auditLogList, "Unlock admin access to load the audit log.");
    setPanelMessage(elements.preseasonValidationOutput, "Unlock admin access to run preseason validation.");
    return;
  }
  const [issuesPayload, auditPayload] = await Promise.all([
    adminRequestJson("/api/league/admin/data-issues"),
    adminRequestJson("/api/league/admin/audit-log"),
  ]);
  elements.dataIssuesList.innerHTML = issuesMarkup(issuesPayload.issues || []);
  elements.auditLogList.innerHTML = auditMarkup(auditPayload.auditLog || []);
}

async function getTeamDetail(teamId) {
  {
    const payload = await requestJson(`/api/league/teams/${encodeURIComponent(teamId)}`);
    state.teamDetailCache.set(teamId, payload.team);
  }
  return state.teamDetailCache.get(teamId);
}

async function getPlayerDetail(playerId) {
  {
    const payload = await requestJson(`/api/league/players/${encodeURIComponent(playerId)}`);
    state.playerDetailCache.set(playerId, payload.player);
  }
  return state.playerDetailCache.get(playerId);
}

function teamDialogMarkup(team) {
  return `
    <section class="league-profile">
      <div class="league-profile-head">
        <div>
          <p class="eyebrow">Team profile · ${team.record ? `${team.record.W}–${team.record.L}` : "0–0"}</p>
          ${teamLogoMarkup(team.teamName, true)}<h2>${escapeHtml(team.teamName)}</h2>
          <p class="profile-sub">${escapeHtml(team.abbreviation)} · ${escapeHtml(team.conference)} · <span data-team-owner="${escapeHtml(team.teamId)}">${escapeHtml(ownerLabel(team))}</span></p>
        </div>
        <div class="summary-chip">${team.rosterSize} players</div>
      </div>
      <div class="league-detail-grid">
        <section class="detail-panel">
          <h3>Roster</h3>${team.payroll ? `<p>💵 ${escapeHtml(team.payroll.short)}</p>` : ""}
          ${team.positionNeeds ? `<h4>🎯 Position needs</h4><p>Target: ${team.positionNeeds.targets.map(escapeHtml).join(' → ')}</p><p>${team.positionNeeds.positions.map(p => `${p.targeted ? '🟡' : '🟢'} ${escapeHtml(p.position)} · ${escapeHtml(p.priority)} need · ${p.primaryCount} primary${p.bestOverall == null ? '' : ' · Best ' + p.bestOverall + ' OVR'}`).join('<br>')}</p><small>Primary positions, rotation quality, age and contract security. Two to four positions are highlighted.</small>` : ''}
          <div class="detail-list">
            ${(team.roster || []).map((entry) => `
              <button type="button" class="detail-list-row" data-dialog-player="${escapeHtml(entry.player.playerId)}">
                <span>${escapeHtml(entry.player.name)}</span>
                <small>${escapeHtml(positionLabel(entry))} · ${escapeHtml(entry.jerseyNumber ?? "--")} · ${escapeHtml(entry.player.overall ?? "—")} OVR</small>
                <small>Age ${entry.player.age ?? "—"} · Trade Value ${Number(entry.player.tradeValue || 1).toLocaleString("en-US")}</small>
                ${contractMarkup(entry.player)}<small>${escapeHtml(seasonStatLine(entry.seasonStats))}</small>
              </button>`).join("") || "<p>No roster loaded.</p>"}
          </div>
        </section>
        <section class="detail-panel">
          <h3>Draft Picks</h3>
          <div class="detail-list">
            ${(team.draftPicks || []).map((pick) => `
              <div class="detail-list-row detail-static-row">
                <span>${escapeHtml(pick.draftYear)} · ${pick.round === 1 ? "1st" : "2nd"} · ${escapeHtml(pick.originalTeamName)}</span>
                <small>Owner ${escapeHtml(pick.currentOwnerTeamName)} · ${escapeHtml(pick.protectionLabel)} · Trade Value ${Number(pick.tradeValue).toLocaleString("en-US")}</small>
              </div>`).join("") || "<p>No future picks available.</p>"}
          </div>
        </section>
        <section class="detail-panel">
          <h3>Schedule</h3>
          <div class="detail-list">
            ${(team.schedule || []).map((week) => `
              <div class="detail-list-row detail-static-row">
                <span>Week ${escapeHtml(week.week)}</span>
                <small>${week.bye ? "BYE" : `${escapeHtml(team.teamName)} vs ${escapeHtml(week.opponent || "Unknown")} · ${escapeHtml(week.conference || "")}`}</small>
              </div>`).join("") || "<p>No schedule saved.</p>"}
          </div>
        </section>
      </div>
    </section>`;
}

function seasonStatLine(stats) {
  if (!stats) return "Regular season · No stats";
  if (!stats.GP) return "Regular season · 0 GP";
  return `Regular season · ${stats.GP} GP · ${stats.PPG.toFixed(1)} PPG · ${stats.RPG.toFixed(1)} RPG · ${stats.APG.toFixed(1)} APG`;
}

function contractMarkup(player, detailed = false) {
  const view = player.contractView;
  if (!view) return '<small>Contract unavailable</small>';
  if (!detailed) return `<small>💵 ${escapeHtml(view.short)}</small>`;
  return `<section class="detail-panel"><h3>Contract</h3><p>${escapeHtml(view.short)}</p>
    ${view.seasons.length ? `<table><thead><tr><th>Season</th><th>Salary</th><th>Option</th></tr></thead><tbody>${view.seasons.map(row => `<tr><td>${escapeHtml(row.season)}</td><td>${row.salary == null ? 'Unknown' : '$' + Number(row.salary).toLocaleString('en-US')}</td><td>${row.option === 'PLAYER' ? 'Player option' : row.option === 'TEAM' ? 'Team option' : '—'}</td></tr>`).join('')}</tbody></table>` : ''}
    ${view.guaranteedTotal == null ? '' : `<p>Published guaranteed total: $${Number(view.guaranteedTotal).toLocaleString('en-US')}</p>`}
    ${player.tradeValueReason ? `<p>${escapeHtml(player.tradeValueReason)}</p>` : ''}
    ${view.sourceUrl && /^https:\/\/www\.basketball-reference\.com\//.test(view.sourceUrl) ? `<p><a href="${escapeHtml(view.sourceUrl)}" target="_blank" rel="noopener">Payroll source</a> · Updated ${escapeHtml(view.fetchedAt?.slice(0,10) || 'Unknown')}</p>` : ''}
  </section>`;
}

function readonlyPlayerFacts(player) {
  return `
    <div class="league-facts">
      ${fact("Team", player.teamName)}
      ${fact("OVR", player.overall)}
      ${fact("Age", player.age)}
      ${fact("Trade Value", Number(player.tradeValue || 1).toLocaleString("en-US"))}
      ${fact("Contract", player.contractView?.short)}
      ${fact("Positions", positionLabel(player))}
      ${fact("Archetype", player.archetype)}
      ${fact("Nationality", player.nationality)}
      ${fact("Height", player.height)}
      ${fact("Height (cm)", player.heightCm)}
      ${fact("Weight", player.weightLbs ? `${player.weightLbs} lbs` : null)}
      ${fact("Wingspan", player.wingspan)}
      ${fact("Years in NBA", player.yearsInNBA)}
      ${fact("Birthdate", player.birthdate)}
      ${fact("Prior to NBA", player.priorToNBA)}
      ${fact("Jersey", player.jerseyNumber)}
    </div>${contractMarkup(player, true)}`;
}

function playerDialogMarkup(player) {
  const teamOptions = leagueTeams().map((team) => `<option value="${escapeHtml(team.teamId)}"${team.teamId === player.teamId ? " selected" : ""}>${escapeHtml(team.teamName)}</option>`).join("");
  return `
    <section class="league-profile">
      <div class="league-profile-head">
        <div>
          <p class="eyebrow">Player profile</p>
          <h2>${escapeHtml(player.name)}</h2>
          <p class="profile-sub">${escapeHtml(player.teamName || "No team")} · ${escapeHtml(positionLabel(player))} · ${escapeHtml(player.overall ?? "—")} OVR</p>
        </div>
        ${playerPortraitMarkup(player, "league-player-portrait")}
      </div>
      ${readonlyPlayerFacts(player)}
      <section class="detail-panel"><h3>🏆 Player of the Week</h3>${(player.playerOfWeek || []).map(w => `<p><a href="#player-of-the-week" data-award-season="${escapeHtml(w.seasonId)}" data-award-week="${w.week}">Season ${escapeHtml(w.seasonId)} · Week ${w.week} · ${escapeHtml(w.conference)}</a> · ${escapeHtml(w.teamName)}</p>`).join('') || '<p>No weekly awards yet.</p>'}</section>
      ${hasAdminAccess() ? `
        <form id="player-admin-form" class="admin-form" data-player-id="${escapeHtml(player.playerId)}">
          <h3>Admin editor</h3>
          <div class="admin-form-grid">
            <label><span>Name</span><input name="name" value="${escapeHtml(player.name || "")}"></label>
            <label><span>OVR</span><input name="overall" type="number" min="0" max="99" value="${escapeHtml(player.overall ?? "")}"></label>
            <label><span>Team</span><select name="teamId">${teamOptions}</select></label>
            <label><span>Jersey</span><input name="jerseyNumber" type="number" value="${escapeHtml(player.jerseyNumber ?? "")}"></label>
            <label><span>Position 1</span><input name="position1" value="${escapeHtml(player.position1 || "")}"></label>
            <label><span>Position 2</span><input name="position2" value="${escapeHtml(player.position2 || "")}"></label>
            <label><span>Archetype</span><input name="archetype" value="${escapeHtml(player.archetype || "")}"></label>
            <label><span>Nationality</span><input name="nationality" value="${escapeHtml(player.nationality || "")}"></label>
            <label><span>Height</span><input name="height" value="${escapeHtml(player.height || "")}"></label>
            <label><span>Height Cm</span><input name="heightCm" type="number" value="${escapeHtml(player.heightCm ?? "")}"></label>
            <label><span>Weight Lbs</span><input name="weightLbs" type="number" value="${escapeHtml(player.weightLbs ?? "")}"></label>
            <label><span>Wingspan</span><input name="wingspan" value="${escapeHtml(player.wingspan || "")}"></label>
            <label><span>Years In NBA</span><input name="yearsInNBA" type="number" value="${escapeHtml(player.yearsInNBA ?? "")}"></label>
            <label><span>Birthdate</span><input name="birthdate" value="${escapeHtml(player.birthdate || "")}"></label>
            <label><span>Prior To NBA</span><input name="priorToNBA" value="${escapeHtml(player.priorToNBA || "")}"></label>
            <label><span>Image URL</span><input name="imageUrl" value="${escapeHtml(player.imageUrl || "")}"></label>
            <label><span>Profile URL</span><input name="profileUrl" value="${escapeHtml(player.profileUrl || "")}"></label>
          </div>
          <div class="admin-inline">
            <button type="submit">Save player</button>
          </div>
          <div id="player-admin-status" class="inline-status"></div>
        </form>` : '<p class="admin-lock-copy">Unlock admin mode to edit this player.</p>'}
    </section>`;
}

async function showTeamDetail(teamId) {
  const team = await getTeamDetail(teamId);
  openLeagueDialog(teamDialogMarkup(team));
}

async function showPlayerDetail(playerId) {
  const player = await getPlayerDetail(playerId);
  openLeagueDialog(playerDialogMarkup(player));
}

function rosterManagerMarkup(team) {
  const destinationOptions = leagueTeams().map((entry) => `<option value="${escapeHtml(entry.teamId)}">${escapeHtml(entry.teamName)}</option>`).join("");
  return `
    <div class="admin-summary">
      <strong>${escapeHtml(team.teamName)} roster manager</strong>
      <p>${escapeHtml(team.conference)} · ${team.roster.length} players</p>
    </div>
    <div class="roster-table-wrap">
      <table class="roster-table">
        <thead>
          <tr><th>Player</th><th>OVR</th><th>Jersey</th><th>Pos 1</th><th>Pos 2</th><th>Move</th><th>Remove</th></tr>
        </thead>
        <tbody>
          ${team.roster.map((entry) => `
            <tr data-roster-player="${escapeHtml(entry.player.playerId)}">
              <td><strong>${escapeHtml(entry.player.name)}</strong><small>${escapeHtml(entry.player.nationality || "N/A")}</small><small>Age ${escapeHtml(entry.player.age ?? "—")} · Trade Value ${Number(entry.player.tradeValue || 1).toLocaleString("en-US")}</small>${contractMarkup(entry.player)}<small>${escapeHtml(seasonStatLine(entry.seasonStats))}</small></td>
              <td><input data-field="overall" type="number" min="0" max="99" value="${escapeHtml(entry.player.overall ?? "")}"></td>
              <td><input data-field="jerseyNumber" type="number" value="${escapeHtml(entry.jerseyNumber ?? "")}"></td>
              <td><input data-field="position1" value="${escapeHtml(entry.position1 || "")}"></td>
              <td><input data-field="position2" value="${escapeHtml(entry.position2 || "")}"></td>
              <td>
                <div class="table-action-cell">
                  <select data-move-select>
                    ${destinationOptions}
                  </select>
                  <button type="button" data-move-player="${escapeHtml(entry.player.playerId)}" data-from-team="${escapeHtml(team.teamId)}">Move</button>
                </div>
              </td>
              <td><button type="button" data-remove-player="${escapeHtml(entry.player.playerId)}" data-team-id="${escapeHtml(team.teamId)}">Remove</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="admin-inline">
      <button type="button" id="save-roster-bulk">Save roster edits</button>
    </div>
    <form id="add-player-form" class="admin-form admin-form-compact">
      <h4>Add player</h4>
      <div class="admin-form-grid">
        <label><span>Name</span><input name="name" required></label>
        <label><span>OVR</span><input name="overall" type="number" min="0" max="99" required></label>
        <label><span>Jersey</span><input name="jerseyNumber" type="number"></label>
        <label><span>Position 1</span><input name="position1" required></label>
        <label><span>Position 2</span><input name="position2"></label>
        <label><span>Nationality</span><input name="nationality"></label>
        <label><span>Archetype</span><input name="archetype"></label>
        <label><span>Height</span><input name="height"></label>
        <label><span>Height Cm</span><input name="heightCm" type="number"></label>
        <label><span>Weight Lbs</span><input name="weightLbs" type="number"></label>
        <label><span>Wingspan</span><input name="wingspan"></label>
        <label><span>Years In NBA</span><input name="yearsInNBA" type="number"></label>
        <label><span>Birthdate</span><input name="birthdate"></label>
        <label><span>Prior To NBA</span><input name="priorToNBA"></label>
        <label><span>Image URL</span><input name="imageUrl"></label>
        <label><span>Profile URL</span><input name="profileUrl"></label>
      </div>
      <div class="admin-inline">
        <button type="submit">Add player</button>
      </div>
      <input type="hidden" name="teamId" value="${escapeHtml(team.teamId)}">
    </form>`;
}

async function loadRosterManager(teamId = elements.rosterTeamSelect.value) {
  state.currentRosterTeamId = teamId;
  if (!hasAdminAccess()) {
    setPanelMessage(elements.rosterManager, "Unlock admin access to manage rosters.");
    return;
  }
  setPanelMessage(elements.rosterManager, "Loading roster manager…");
  const team = await getTeamDetail(teamId);
  if (state.currentRosterTeamId !== teamId) return;
  state.currentRosterDetail = team;
  elements.rosterManager.innerHTML = rosterManagerMarkup(team);
  elements.rosterManager.querySelectorAll("[data-move-select]").forEach((select) => {
    select.value = team.teamId;
  });
}

async function previewRosterImport() {
  const teamId = elements.importTeamSelect.value;
  const payload = await adminRequestJson("/api/league/admin/import/preview", {
    method: "POST",
    body: JSON.stringify({ teamId }),
  });
  state.importPreview = { ...payload.preview, selectedTeamId: teamId };
  elements.applyImportButton.disabled = payload.preview.unresolved.length > 0;
  elements.importPreviewOutput.innerHTML = previewSummaryMarkup(payload.preview);
}

async function applyRosterImport() {
  const teamId = elements.importTeamSelect.value;
  if (!state.importPreview || state.importPreview.selectedTeamId !== teamId) throw new Error("Preview this team's import before applying it.");
  if (state.importPreview.unresolved.length) throw new Error("Resolve the possible player matches before applying this import.");
  elements.applyImportButton.disabled = true;
  const payload = await adminRequestJson("/api/league/admin/import/apply", {
    method: "POST",
    body: JSON.stringify({ teamId }),
  });
  state.importPreview = null;
  elements.importPreviewOutput.innerHTML = `${previewSummaryMarkup(payload.preview)}<p class="inline-status success">Import applied.</p>`;
  state.teamDetailCache.delete(teamId);
  await refreshLeagueSite();
  await loadAdminPanels();
  if (state.currentRosterTeamId === teamId) await loadRosterManager(teamId);
}

async function runPreseasonValidation() {
  const validation = await adminRequestJson("/api/league/admin/preseason/validate");
  elements.preseasonValidationOutput.innerHTML = validationMarkup(validation);
  return validation;
}

async function startRegularSeason() {
  const payload = await adminRequestJson("/api/league/admin/start-season", { method: "POST" });
  elements.preseasonValidationOutput.innerHTML = `<div class="admin-summary"><strong>Regular season started</strong><p>${escapeHtml(payload.league.leagueName)} is now in ${escapeHtml(payload.league.currentPhase)} with Week 1 active.</p></div>`;
  await refreshLeagueSite();
  await loadAdminPanels();
}

function serializeForm(form) {
  const payload = {};
  for (const [key, value] of new FormData(form).entries()) {
    payload[key] = value;
  }
  return payload;
}

function normalizePatchValues(payload) {
  const next = { ...payload };
  ["overall", "jerseyNumber", "heightCm", "weightLbs", "yearsInNBA"].forEach((field) => {
    if (field in next) next[field] = next[field] === "" ? null : Number(next[field]);
  });
  return next;
}

async function savePlayerFromDialog(form) {
  const playerId = form.dataset.playerId;
  const payload = normalizePatchValues(serializeForm(form));
  const response = await adminRequestJson(`/api/league/admin/players/${encodeURIComponent(playerId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  state.playerDetailCache.set(playerId, response.player);
  state.teamDetailCache.clear();
  await refreshLeagueSite();
  await loadAdminPanels();
  document.querySelector("#player-admin-status").textContent = "Player saved.";
}

async function saveBulkRosterEdits() {
  if (!state.currentRosterDetail) return;
  const rows = [...elements.rosterManager.querySelectorAll("[data-roster-player]")];
  const updates = rows.map((row) => ({
    playerId: row.dataset.rosterPlayer,
    overall: row.querySelector('[data-field="overall"]').value === "" ? null : Number(row.querySelector('[data-field="overall"]').value),
    jerseyNumber: row.querySelector('[data-field="jerseyNumber"]').value === "" ? null : Number(row.querySelector('[data-field="jerseyNumber"]').value),
    position1: row.querySelector('[data-field="position1"]').value.trim() || null,
    position2: row.querySelector('[data-field="position2"]').value.trim() || null,
  }));
  await adminRequestJson("/api/league/admin/rosters/bulk-update", {
    method: "PATCH",
    body: JSON.stringify({ teamId: state.currentRosterDetail.teamId, updates }),
  });
  state.teamDetailCache.delete(state.currentRosterDetail.teamId);
  await refreshLeagueSite();
  await loadAdminPanels();
  await loadRosterManager(state.currentRosterDetail.teamId);
}

async function moveRosterPlayer(playerId, fromTeamId, toTeamId) {
  await adminRequestJson("/api/league/admin/rosters/move-player", {
    method: "POST",
    body: JSON.stringify({ playerId, fromTeamId, toTeamId }),
  });
  state.teamDetailCache.clear();
  state.playerDetailCache.delete(playerId);
  await refreshLeagueSite();
  await loadAdminPanels();
  await loadRosterManager(state.currentRosterTeamId);
}

async function removeRosterPlayer(playerId, teamId) {
  await adminRequestJson("/api/league/admin/rosters/remove-player", {
    method: "POST",
    body: JSON.stringify({ playerId, teamId }),
  });
  state.teamDetailCache.delete(teamId);
  state.playerDetailCache.delete(playerId);
  await refreshLeagueSite();
  await loadAdminPanels();
  await loadRosterManager(teamId);
}

async function addPlayerToRoster(form) {
  const payload = normalizePatchValues(serializeForm(form));
  await adminRequestJson("/api/league/admin/rosters/add-player", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.teamDetailCache.delete(payload.teamId);
  await refreshLeagueSite();
  await loadAdminPanels();
  await loadRosterManager(payload.teamId);
  form.reset();
  form.querySelector('[name="teamId"]').value = payload.teamId;
}

async function loadDraftClass(selection) {
  const labels = classLabels();
  state.classLabel = labels[0];
  renderClassSwitcher();
  elements.grid.innerHTML = "";
  elements.topTenGrid.innerHTML = "";
  elements.resultCount.textContent = "Loading prospects…";
  elements.topTenCount.textContent = "Loading prospects…";
  const [topTen, bigBoard] = await Promise.all([
    fetchClassBoard("top-ten", state.classLabel),
    fetchClassBoard("big-board", state.classLabel),
  ]);
  state.topTenProspects = topTen?.prospects || [];
  state.prospects = bigBoard?.prospects || [];
  state.position.clear();
  state.statsPosition.clear();
  state.query = "";
  elements.search.value = "";
  elements.topTenClassLabel.textContent = state.classLabel;
  elements.bigBoardClassLabel.textContent = state.classLabel;
  elements.statsClassLabel.textContent = state.classLabel;
  if (elements.prospectCount) elements.prospectCount.textContent = state.prospects.length;
  if (elements.prospectLabel) elements.prospectLabel.textContent = state.prospects.length ? "on the big board" : "big board pending";
  renderTopTen();
  renderFilters();
  renderBoard();
  renderStats();

  const url = new URL(window.location.href);
  url.searchParams.delete("board");
  url.searchParams.delete("class");
  history.replaceState({}, "", url);
  const requestedProspect = url.searchParams.get("prospect");
  const requestedSource = url.searchParams.get("source") === "top-ten" ? "top-ten" : "big-board";
  if (requestedProspect) openProfile(requestedProspect, requestedSource, false);
  if (window.location.hash) {
    requestAnimationFrame(() => document.querySelector(window.location.hash)?.scrollIntoView({ block: "start" }));
  }
}

async function initialize() {
  try {
    const [leaguePayload, draftPayload] = await Promise.all([
      requestJson("/api/league-site"),
      requestJson("/api/draft-classes"),
    ]);
    state.leagueSite = leaguePayload;
    renderLeagueSite();
    state.boards = draftPayload.boards;
    state.draftSeasonNumber = draftPayload.seasonNumber;
    const currentUrl = new URL(window.location.href);
    const requestedClass = currentUrl.searchParams.get("class");
    await loadDraftClass(requestedClass);
    if (window.location.hash === "#league-stats") await loadLeagueStats();
    if (window.location.hash === "#team-stats") await loadTeamStats();
    if (hasAdminAccess()) {
      try { await loadAdminPanels(); await loadAdminWorkflow(); }
      catch (error) { elements.adminKeyStatus.textContent = error.message; }
    }
  } catch (error) {
    console.error(error);
    elements.resultCount.textContent = "The draft board could not be loaded.";
  }
}

elements.search.addEventListener("input", () => {
  state.query = elements.search.value.trim();
  renderBoard();
});

elements.sortSelect.addEventListener("change", () => {
  state.sort = elements.sortSelect.value;
  renderBoard();
});

elements.statsPositionFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-stats-position]");
  if (!button) return;
  const position = button.dataset.statsPosition;
  if (position === "ALL") state.statsPosition.clear();
  else if (state.statsPosition.has(position)) state.statsPosition.delete(position);
  else state.statsPosition.add(position);
  renderStats();
});

elements.statsTable.addEventListener("click", (event) => {
  const sortButton = event.target.closest("[data-stat-sort]");
  if (sortButton) {
    const key = sortButton.dataset.statSort;
    if (state.statsSortKey === key) state.statsSortDirection = state.statsSortDirection === "asc" ? "desc" : "asc";
    else {
      state.statsSortKey = key;
      state.statsSortDirection = ["rank", "name", "position"].includes(key) ? "asc" : "desc";
    }
    renderStats();
    return;
  }
  const row = event.target.closest("[data-stats-prospect]");
  if (row) openProfile(row.dataset.statsProspect, "big-board");
});

elements.positionFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-position]");
  if (!button) return;
  const position = button.dataset.position;
  if (position === "ALL") state.position.clear();
  else if (state.position.has(position)) state.position.delete(position);
  else state.position.add(position);
  renderFilters();
  renderBoard();
});

elements.grid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-prospect]");
  if (card) openProfile(card.dataset.prospect, "big-board");
});

elements.topTenGrid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-prospect]");
  if (card) openProfile(card.dataset.prospect, "top-ten");
});

elements.teamDirectory.addEventListener("click", (event) => {
  const tile = event.target.closest("[data-team-id]");
  if (tile) showTeamDetail(tile.dataset.teamId).catch((error) => showToast(error.message));
});

elements.playerDirectory.addEventListener("click", (event) => {
  const card = event.target.closest("[data-player-id]");
  if (card) showPlayerDetail(card.dataset.playerId).catch((error) => showToast(error.message));
});

function changePlayerPage(offset) {
  state.playerPage += offset;
  renderPlayerDirectory();
  elements.playerDirectory.scrollIntoView({ block: "start", behavior: "smooth" });
}
elements.playersPrevious.addEventListener("click", () => changePlayerPage(-1));
elements.playersNext.addEventListener("click", () => changePlayerPage(1));

elements.playerSearch.addEventListener("input", () => {
  state.playerQuery = elements.playerSearch.value.trim();
  state.playerPage = 1;
  renderPlayerDirectory();
});

elements.playerTeamFilter.addEventListener("change", () => {
  state.playerTeam = elements.playerTeamFilter.value;
  state.playerPage = 1;
  renderPlayerDirectory();
});

elements.playerConferenceFilter.addEventListener("change", () => {
  state.playerConference = elements.playerConferenceFilter.value;
  state.playerPage = 1;
  renderPlayerDirectory();
});

elements.playerPositionFilter.addEventListener("change", () => {
  state.playerPosition = elements.playerPositionFilter.value;
  state.playerPage = 1;
  renderPlayerDirectory();
});

elements.playerSort.addEventListener("change", () => {
  state.playerSort = elements.playerSort.value;
  state.playerPage = 1;
  renderPlayerDirectory();
});

function resetLeagueStatsPage() {
  state.leagueStatsPage = 1;
  state.expandedStatsPlayerId = null;
  renderLeagueStats();
}
elements.leagueStatsSearch.addEventListener("input", () => {
  state.leagueStatsSearch = elements.leagueStatsSearch.value;
  resetLeagueStatsPage();
});
elements.leagueStatsTeam.addEventListener("change", () => {
  state.leagueStatsTeam = elements.leagueStatsTeam.value;
  resetLeagueStatsPage();
});
elements.leagueStatsConference.addEventListener("change", () => {
  state.leagueStatsConference = elements.leagueStatsConference.value;
  resetLeagueStatsPage();
});
document.querySelector(".league-player-stats-table thead").addEventListener("click", event => {
  const button = event.target.closest("[data-season-stats-sort]");
  if (!button) return;
  const key = button.dataset.seasonStatsSort;
  if (state.leagueStatsSort === key) state.leagueStatsDirection = state.leagueStatsDirection === "asc" ? "desc" : "asc";
  else {
    state.leagueStatsSort = key;
    state.leagueStatsDirection = ["name", "teamName"].includes(key) ? "asc" : "desc";
  }
  resetLeagueStatsPage();
});
elements.leagueStatsBody.addEventListener("click", event => {
  const button = event.target.closest("[data-season-stats-player]");
  if (button) toggleStatsGameLog(button.dataset.seasonStatsPlayer);
});
elements.leagueStatsPrevious.addEventListener("click", () => {
  state.leagueStatsPage = Math.max(1, state.leagueStatsPage - 1);
  state.expandedStatsPlayerId = null;
  renderLeagueStats();
});
elements.leagueStatsNext.addEventListener("click", () => {
  state.leagueStatsPage++;
  state.expandedStatsPlayerId = null;
  renderLeagueStats();
});
document.querySelector("#league-stats-refresh").addEventListener("click", () => {
  state.statsGameLogs.clear();
  loadLeagueStats(true);
});
window.addEventListener("hashchange", () => {
  if (location.hash === "#league-stats") loadLeagueStats();
  if (location.hash === "#team-stats") loadTeamStats();
});

elements.teamStatsConference.addEventListener("change", () => {
  state.teamStatsConference = elements.teamStatsConference.value;
  state.expandedTeamStatsId = null;
  renderTeamStats();
});
document.querySelector(".team-season-stats-table thead").addEventListener("click", event => {
  const button = event.target.closest("[data-team-stats-sort]");
  if (!button) return;
  const key = button.dataset.teamStatsSort;
  if (state.teamStatsSort === key) state.teamStatsDirection = state.teamStatsDirection === "asc" ? "desc" : "asc";
  else {
    state.teamStatsSort = key;
    state.teamStatsDirection = key === "teamName" ? "asc" : "desc";
  }
  renderTeamStats();
});
elements.teamStatsBody.addEventListener("click", event => {
  const profile = event.target.closest("[data-team-stats-profile]");
  if (profile) { showTeamDetail(profile.dataset.teamStatsProfile).catch(error => showToast(error.message)); return; }
  const gameLog = event.target.closest("[data-team-stats-log]");
  if (gameLog) toggleTeamGameLog(gameLog.dataset.teamStatsLog);
});
document.querySelector("#team-stats-refresh").addEventListener("click", () => {
  state.teamGameLogs.clear();
  loadTeamStats(true);
});

elements.adminKeySave.addEventListener("click", async () => {
  state.adminKey = elements.adminKey.value.trim();
  if (state.adminKey) window.sessionStorage.setItem("leaguebuddyAdminKey", state.adminKey);
  else window.sessionStorage.removeItem("leaguebuddyAdminKey");
  window.localStorage.removeItem("leaguebuddyAdminKey");
  renderLeagueSite();
  try {
    await loadAdminPanels();
    if (hasAdminAccess()) await loadAdminWorkflow();
  } catch (error) {
    elements.adminKeyStatus.textContent = error.message;
  }
});

elements.previewImportButton.addEventListener("click", async () => {
  state.importPreview = null;
  elements.applyImportButton.disabled = true;
  elements.previewImportButton.disabled = true;
  try {
    setPanelMessage(elements.importPreviewOutput, "Loading import preview…");
    await previewRosterImport();
  } catch (error) {
    setPanelMessage(elements.importPreviewOutput, error.message);
  } finally {
    elements.previewImportButton.disabled = false;
  }
});

elements.applyImportButton.addEventListener("click", async () => {
  try {
    await applyRosterImport();
  } catch (error) {
    setPanelMessage(elements.importPreviewOutput, error.message);
    elements.applyImportButton.disabled = !state.importPreview || state.importPreview.unresolved.length > 0;
  }
});
elements.importTeamSelect.addEventListener("change", () => {
  state.importPreview = null;
  elements.applyImportButton.disabled = true;
  setPanelMessage(elements.importPreviewOutput, "Preview this team's import before applying changes.");
});

let seasonStartState = "idle";
function setSeasonStartState(next) {
  seasonStartState = next;
  elements.startSeasonButton.disabled = next !== "idle";
  elements.validatePreseasonButton.disabled = next !== "idle";
}

elements.validatePreseasonButton.addEventListener("click", async () => {
  if (seasonStartState !== "idle") return;
  setSeasonStartState("validating");
  try {
    setPanelMessage(elements.preseasonValidationOutput, "Running preseason validation…");
    await runPreseasonValidation();
  } catch (error) {
    setPanelMessage(elements.preseasonValidationOutput, error.message);
  } finally { setSeasonStartState("idle"); }
});

elements.startSeasonButton.addEventListener("click", async () => {
  if (seasonStartState !== "idle") return;
  setSeasonStartState("confirming");
  elements.preseasonValidationOutput.innerHTML = `
    <div class="admin-summary" role="group" aria-labelledby="start-season-confirm-title">
      <strong id="start-season-confirm-title">Start the regular season?</strong>
      <p>This activates Week 1 and is a real league state change.</p>
      <div class="admin-inline">
        <button type="button" data-confirm-start-season>Confirm start</button>
        <button type="button" data-cancel-start-season>Cancel</button>
      </div>
    </div>`;
  elements.preseasonValidationOutput.querySelector("[data-confirm-start-season]")?.focus();
});

elements.preseasonValidationOutput.addEventListener("click", async event => {
  if (seasonStartState !== "confirming") return;
  if (event.target.closest("[data-cancel-start-season]")) {
    setSeasonStartState("idle");
    elements.preseasonValidationOutput.innerHTML = '<p class="inline-status">Season start cancelled.</p>';
    elements.startSeasonButton.focus();
    return;
  }
  const confirmButton = event.target.closest("[data-confirm-start-season]");
  if (!confirmButton) return;
  setSeasonStartState("submitting");
  try {
    confirmButton.disabled = true;
    setPanelMessage(elements.preseasonValidationOutput, 'Checking readiness and starting the season…');
    await startRegularSeason();
    await loadAdminWorkflow();
  } catch (error) {
    setPanelMessage(elements.preseasonValidationOutput, error.message);
  } finally { setSeasonStartState("idle"); }
});

elements.loadRosterManager.addEventListener("click", async () => {
  try {
    await loadRosterManager(elements.rosterTeamSelect.value);
  } catch (error) {
    setPanelMessage(elements.rosterManager, error.message);
  }
});

elements.rosterManager.addEventListener("click", async (event) => {
  const saveButton = event.target.closest("#save-roster-bulk");
  if (saveButton) {
    try {
      await saveBulkRosterEdits();
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  const moveButton = event.target.closest("[data-move-player]");
  if (moveButton) {
    const row = moveButton.closest("[data-roster-player]");
    const select = row?.querySelector("[data-move-select]");
    try {
      await moveRosterPlayer(moveButton.dataset.movePlayer, moveButton.dataset.fromTeam, select.value);
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  const removeButton = event.target.closest("[data-remove-player]");
  if (removeButton) {
    try {
      await removeRosterPlayer(removeButton.dataset.removePlayer, removeButton.dataset.teamId);
    } catch (error) {
      showToast(error.message);
    }
  }
});

elements.rosterManager.addEventListener("submit", async (event) => {
  const form = event.target.closest("#add-player-form");
  if (!form) return;
  event.preventDefault();
  try {
    await addPlayerToRoster(form);
  } catch (error) {
    showToast(error.message);
  }
});

elements.leagueDialogContent.addEventListener("click", (event) => {
  const button = event.target.closest("[data-dialog-player]");
  if (!button) return;
  showPlayerDetail(button.dataset.dialogPlayer).catch((error) => showToast(error.message));
});

elements.leagueDialogContent.addEventListener("submit", async (event) => {
  const form = event.target.closest("#player-admin-form");
  if (!form) return;
  event.preventDefault();
  try {
    await savePlayerFromDialog(form);
  } catch (error) {
    const status = document.querySelector("#player-admin-status");
    if (status) status.textContent = error.message;
  }
});

document.querySelector(".dialog-close").addEventListener("click", () => closeProfile());
document.querySelector(".league-dialog-close").addEventListener("click", () => closeLeagueDialog());
elements.dialog.addEventListener("click", (event) => { if (event.target === elements.dialog) closeProfile(); });
elements.dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeProfile(); });
elements.leagueDialog.addEventListener("click", (event) => { if (event.target === elements.leagueDialog) closeLeagueDialog(); });
elements.leagueDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeLeagueDialog(); });

window.addEventListener("popstate", async () => {
  const url = new URL(window.location.href);
  const prospect = url.searchParams.get("prospect");
  const source = url.searchParams.get("source") === "top-ten" ? "top-ten" : "big-board";
  if (prospect) openProfile(prospect, source, false);
  else closeProfile(false);
});

document.addEventListener("error", (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.hasAttribute("data-team-logo")) { image.remove(); return; }
  if (image instanceof HTMLImageElement && image.hasAttribute("data-player-portrait")) {
    const fallback = image.dataset.fallback;
    if (fallback && image.getAttribute("src") !== fallback) {
      image.dataset.fallback = "";
      image.src = fallback;
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "portrait-placeholder";
      placeholder.textContent = (image.alt || "Player").split(/\s+/).map((word) => word[0]).slice(0, 2).join("");
      placeholder.setAttribute("aria-label", `${image.alt || "Player"} — photo unavailable`);
      image.replaceWith(placeholder);
    }
    return;
  }
  if (!(image instanceof HTMLImageElement) || !/\.webp(?:$|[?#])/i.test(image.src)) return;
  image.src = image.src.replace(/\.webp(?=$|[?#])/i, ".png");
}, true);

initialize();

// Refresh owner labels without resetting filters, pagination, or unsaved forms.
let ownershipRefreshPending = false;
async function refreshOwnerLabels() {
  if (document.hidden || ownershipRefreshPending || !state.leagueSite?.league) return;
  ownershipRefreshPending = true;
  try {
    const payload = await requestJson("/api/league-site");
    if (payload.league?.leagueId !== state.leagueSite.league.leagueId) return;
    const teams = new Map((payload.teams || []).map((team) => [team.teamId, team]));
    for (const team of state.leagueSite.teams || []) {
      const current = teams.get(team.teamId);
      if (!current) continue;
      team.ownerUserId = current.ownerUserId;
      team.ownerDisplayName = current.ownerDisplayName;
    }
    document.querySelectorAll("[data-team-owner]").forEach((element) => {
      const team = teams.get(element.dataset.teamOwner);
      if (team) element.textContent = ownerLabel(team);
    });
    elements.summaryOwners.textContent = `${payload.summary.ownersAssigned}/${payload.summary.teams}`;
    state.teamDetailCache.clear();
  } catch (error) { console.warn("Owner display refresh failed:", error.message); }
  finally { ownershipRefreshPending = false; }
}
setInterval(refreshOwnerLabels, 10000);
window.addEventListener("focus", refreshOwnerLabels);

let standingsRefreshPending = false;
async function refreshStandings() {
  if (standingsRefreshPending) return;
  standingsRefreshPending = true;
  const refreshButton = document.querySelector('#standings-refresh');
  refreshButton.disabled = true;
  const label = document.querySelector('#standings-week'), container = document.querySelector('#standings-tables');
  try {
    const data = await requestJson('/api/league/standings');
    label.textContent = `${data.publishedThroughWeek ? 'Through Week ' + data.publishedThroughWeek : 'Awaiting first week advancement'} · ${data.countedGames} published games`;
    container.innerHTML = ['East', 'West'].map(conference => `<section class="admin-panel"><h3>${conference === 'East' ? 'EASTERN' : 'WESTERN'} CONFERENCE</h3><div class="standings-scroll"><table class="standings-table"><thead><tr>${['Rank', 'Team', 'GP', 'W', 'L', 'PCT', 'PF', 'PA', 'DIFF'].map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${data.conferences[conference].map(team => `<tr><td>${team.rank}</td><td><button type="button" data-standings-team="${escapeHtml(team.teamId)}">${teamLogoMarkup(team.teamName)}${escapeHtml(team.teamName)}</button></td>${['GP', 'W', 'L', 'PCT', 'PF', 'PA', 'DIFF'].map(k => `<td>${k === 'PCT' ? team.PCT.toFixed(3).replace(/^0\./, '.') : k === 'DIFF' && team.DIFF > 0 ? '+' + team.DIFF : team[k]}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`).join('');
  } catch (error) {
    label.textContent = container.children.length ? `Could not reload: ${error.message}. Showing previously loaded standings.` : error.message;
  } finally { standingsRefreshPending = false; refreshButton.disabled = false; }
}
document.querySelector('#standings-refresh').onclick = refreshStandings;
document.querySelector('#standings-tables').addEventListener('click', async event => {
  const button = event.target.closest('[data-standings-team]'); if (!button) return;
  try { await showTeamDetail(button.dataset.standingsTeam); } catch (error) { document.querySelector('#standings-week').textContent = error.message; }
});
window.addEventListener('hashchange', () => { if (location.hash === '#standings') refreshStandings(); });
refreshStandings();

setInterval(() => { if (location.hash === '#standings' && !document.hidden) refreshStandings(); }, 30000);


// Load read-only admin information together after unlocking. No automatic mutations.
async function loadAdminWorkflow() {
  if (hasAdminAccess() && state.leagueSite?.league?.currentPhase === "REGULAR_SEASON") await loadStaffWeek();
  if (elements.rosterTeamSelect.value) await loadRosterManager().catch(error => setPanelMessage(elements.rosterManager, error.message));
}
const commissionerName = document.querySelector('#admin-operator');
commissionerName.value = sessionStorage.getItem('leaguebuddyReviewOperator') || '';
commissionerName.addEventListener('input', () => sessionStorage.setItem('leaguebuddyReviewOperator', commissionerName.value));
elements.adminKey.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); elements.adminKeySave.click(); } });
elements.rosterTeamSelect.addEventListener('change', () => loadRosterManager().catch(error => setPanelMessage(elements.rosterManager, error.message)));

function weeklyLink(url, label) {
  if (!url || !(/^(https:\/\/discord\.com\/channels\/|\/games\/)/.test(url))) return '';
  return `<a class="weekly-action" href="${escapeHtml(url)}"${url.startsWith('https:') ? ' target="_blank" rel="noopener"' : ''}>${escapeHtml(label)}</a>`;
}
function weeklyDeadline(date) {
  return date ? new Date(date).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Starts when game threads are created';
}
function renderCoachWeekPicker(teams) {
  const picker = document.querySelector('#coach-week-team');
  const selected = picker.value || new URLSearchParams(location.search).get('team') || localStorage.getItem('leaguebuddyWeeklyTeam') || '';
  picker.innerHTML = '<option value="">Choose team</option>' + teams.map(t => `<option value="${escapeHtml(t.teamId)}">${escapeHtml(t.teamName)}</option>`).join('');
  picker.value = teams.some(t => t.teamId === selected) ? selected : '';
  if (picker.value && !state.coachWeekLoading) loadCoachWeek();
}
async function loadCoachWeek() {
  if (state.coachWeekLoading) return;
  const picker = document.querySelector('#coach-week-team'), teamId = picker.value;
  const output = document.querySelector('#coach-week-output'), status = document.querySelector('#coach-week-status'), button = document.querySelector('#coach-week-refresh');
  if (!teamId) { output.replaceChildren(); status.textContent = 'Choose your team.'; return; }
  state.coachWeekLoading = true; button.disabled = true; picker.disabled = true; status.textContent = 'Loading your week…';
  try {
    const view = await requestJson(`/api/league/weekly/${encodeURIComponent(teamId)}`);
    if (!view.available) { status.textContent = 'Weekly dashboards open during the regular season.'; output.replaceChildren(); return; }
    status.textContent = `Week ${view.week} · ${view.teamName}${view.closed ? ' · Regular season complete' : ''}`;
    output.innerHTML = `<div class="admin-summary"><strong>${view.bye ? 'Bye week' : `vs ${escapeHtml(view.game.opponent)}`}</strong>
      <p>${escapeHtml(view.nextAction)}</p><p>${view.bye || view.closed ? '' : `Deadline: ${escapeHtml(weeklyDeadline(view.deadlineAt))}`}</p>
      ${view.game ? `<p>${view.game.final ? '✅ Approved' : `${view.game.screenshots}/2 box scores received`}${view.game.inGameDate ? ` · Game date: ${escapeHtml(view.game.inGameDate)}` : ''}</p>` : ''}
      <div class="weekly-links">${weeklyLink(view.game?.threadUrl, 'Open game thread')}${weeklyLink(view.channels.freeAgency, 'Free agency')}${weeklyLink(view.channels.submitTrade, 'Trade channel')}${weeklyLink(view.channels.playerUpgrades, 'Player upgrades')}</div></div>`;
  } catch (error) { status.textContent = `Could not load this week: ${error.message}`; }
  finally { state.coachWeekLoading = false; button.disabled = false; picker.disabled = false; }
}
function staffWeekMarkup(view) {
  if (!view.available) return '<p>Weekly reports open during the regular season.</p>';
  const b = view.blockers, t = view.transactions;
  const queue = view.games.filter(g => !g.final).sort((a, b) => Number(b.reviewPending || b.extractionFailed) - Number(a.reviewPending || a.extractionFailed));
  const gameRows = queue.map(g => `<tr><td>${escapeHtml(g.team1Name)} vs ${escapeHtml(g.team2Name)}</td><td>${escapeHtml(g.status.replaceAll('_', ' '))}${!g.inGameDate ? ' · Date not set' : ''}</td><td>${g.screenshots}/2</td><td>${weeklyLink(g.threadUrl, 'Thread')}${g.reviewUrl ? weeklyLink(g.reviewUrl, 'Review box scores') : ''}${g.recordCount > 1 ? 'Duplicate records need repair' : !g.threadUrl ? 'Create / repair game threads in Discord' : ''}</td></tr>`).join('');
  const transactionRows = [
    ...t.trades.map(x => ({ name: x.teams.join(' ↔ '), status: x.status.replaceAll('_', ' '), url: x.url, type: 'Trade' })),
    ...t.offers.map(x => ({ name: `${x.player} · ${state.leagueSite?.teams?.find(team => team.teamId === x.teamId)?.teamName || x.teamId}`, status: x.cutRequired ? `Coach roster cut needed by ${weeklyDeadline(x.cutDeadlineAt)}` : x.status === 'PENDING_REVIEW' ? 'Staff proof review' : 'Approved; window pending', url: x.url || view.channels.freeAgencyProof || view.channels.staff, type: 'FA offer' })),
    ...t.waivers.map(x => ({ name: `${x.player} · ${state.leagueSite?.teams?.find(team => team.teamId === x.teamId)?.teamName || x.teamId}`, status: 'Staff review', url: x.url || view.channels.freeAgencyProof || view.channels.staff, type: 'Waiver request' })),
  ];
  return `<div class="summary-grid weekly-summary">${view.groups.map(g => `<article class="summary-card"><span>${escapeHtml(g.label)}</span><strong>${g.final}/${g.total}</strong><small>Approved · ${g.total - g.final} remaining</small></article>`).join('')}</div>
    <div class="admin-summary"><strong>${view.closed ? 'Week closed' : view.readyToAdvance ? 'Ready for week-advance review' : `${b.unresolved} games still need a final result`}</strong>
      <p>Deadline: ${escapeHtml(weeklyDeadline(view.deadlineAt))}</p>
      <p>${b.missingThreads} missing threads · ${b.missingDates} dates not set · ${b.missingBoxScores} incomplete box-score pairs</p>
      <p>${b.pendingReviews} awaiting review · ${b.extractionFailures} OCR failures · ${b.processing} processing${b.duplicateRecords ? ` · ${b.duplicateRecords} duplicate records` : ''}</p>
      <p>Byes: ${escapeHtml(view.byes.map(x => x.teamName).join(' · ') || 'None')}</p>
      ${view.testMode ? '<p>Test Mode: matchup groups reflect actual assigned coaches.</p>' : ''}
      ${weeklyLink(view.staffReportUrl, 'Open Staff report / review week advancement')}
      <p>Week advancement still requires the existing confirmation in Discord. Pending transactions below are reminders, not additional advancement blockers.</p></div>
    ${view.storageIssues?.length || view.notificationFailures ? `<p>⚠ Recovery needed: ${view.storageIssues?.length || 0} unreadable game records · ${view.notificationFailures || 0} failed notification attempts. Create a backup before repairing stored records.</p>` : ''}
    <details><summary>Approved games — review or correct</summary>${view.games.filter(g => g.final).map(g => `<p>${escapeHtml(g.team1Name)} vs ${escapeHtml(g.team2Name)} ${weeklyLink(g.reviewUrl, 'Review result')}</p>`).join('') || '<p>No approved games yet.</p>'}</details>
    <h4>Game closeout queue</h4>${queue.length ? `<div class="standings-scroll"><table class="standings-table"><thead><tr><th>Matchup</th><th>Status</th><th>Box scores</th><th>Action</th></tr></thead><tbody>${gameRows}</tbody></table></div>` : '<p>All scheduled games are approved.</p>'}
    <h4>Pending transactions</h4><p>${t.trades.length} trades · ${t.offers.length} active offers · ${t.offers.filter(o => o.status === 'PENDING_REVIEW').length} FA proof reviews · ${t.waivers.length} waiver requests · ${t.waitingCuts} winner roster cuts needed</p>
    ${transactionRows.length ? `<div class="standings-scroll"><table class="standings-table"><thead><tr><th>Type</th><th>Teams / player</th><th>Status</th><th>Action</th></tr></thead><tbody>${transactionRows.map(x => `<tr><td>${x.type}</td><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.status)}</td><td>${weeklyLink(x.url, 'Open in Discord')}</td></tr>`).join('')}</tbody></table></div>` : '<p>No pending trades, offers or waiver requests.</p>'}`;
}
async function loadStaffWeek() {
  if (state.staffWeekLoading || !hasAdminAccess()) return;
  const key = state.adminKey, output = document.querySelector('#staff-week-output'), status = document.querySelector('#staff-week-status'), button = document.querySelector('#staff-week-refresh');
  state.staffWeekLoading = true; button.disabled = true; status.textContent = 'Loading weekly checklist…';
  try {
    const view = await adminRequestJson('/api/league/admin/weekly');
    if (state.adminKey !== key || !hasAdminAccess()) return;
    const firstLoad = !output.children.length;
    output.innerHTML = staffWeekMarkup(view);
    if (firstLoad && location.hash === "#staff-weekly") requestAnimationFrame(() => document.querySelector("#staff-weekly").scrollIntoView({ block: "start" }));
    status.textContent = view.available ? `Week ${view.week} · ${view.final}/${view.total} approved · Updated ${new Date().toLocaleTimeString()}` : 'Not in regular season.';
  } catch (error) { if (state.adminKey === key) { output.replaceChildren(); status.textContent = error.message; } }
  finally { state.staffWeekLoading = false; button.disabled = false; }
}
document.querySelector('#coach-week-team').addEventListener('change', event => { localStorage.setItem('leaguebuddyWeeklyTeam', event.target.value); document.querySelector('#coach-week-output').replaceChildren(); loadCoachWeek(); });
document.querySelector('#coach-week-refresh').addEventListener('click', loadCoachWeek);
document.querySelector('#staff-week-refresh').addEventListener('click', loadStaffWeek);
window.addEventListener('hashchange', () => { if (location.hash === '#my-week') loadCoachWeek(); if (location.hash === '#staff-weekly' && hasAdminAccess()) loadStaffWeek(); });
setInterval(() => { if (document.hidden) return; if (location.hash === '#my-week') loadCoachWeek(); if (['#staff-weekly', '#league-admin'].includes(location.hash) && hasAdminAccess()) loadStaffWeek(); }, 60000);

let playoffRequestRunning = false;
document.querySelector('#playoffs-review')?.addEventListener('click', async () => {
  if (playoffRequestRunning) return;
  const output = document.querySelector('#playoffs-output'); playoffRequestRunning = true;
  try {
    const view = await adminRequestJson('/api/league/admin/playoffs', { method: 'POST', body: JSON.stringify({ action: 'prepare', operator: commissionerName.value.trim() }) });
    output.replaceChildren();
    if (view.alreadyStarted) { output.textContent = 'Playoffs have already started.'; return; }
    if (view.blocked) { output.textContent = `${view.unresolved.length} unresolved games must be finalized first.`; return; }
    const summary = document.createElement('p'); summary.textContent = Object.entries(view.seeds).map(([c, teams]) => `${c}: ${teams.map((t,i) => `${i+1}. ${t.teamName}`).join(', ')}`).join(' | '); output.append(summary);
    const policy = document.createElement('p'); policy.textContent = 'Confirming freezes these seeds and closes upgrade spending. Existing trades, FA windows and waivers retain their saved rules.'; output.append(policy);
    const confirm = document.createElement('button'); confirm.textContent = 'Confirm playoff handoff';
    const operator = commissionerName.value.trim();
    confirm.addEventListener('click', async () => { if (playoffRequestRunning) return; playoffRequestRunning = true; confirm.disabled = true;
      try { await adminRequestJson('/api/league/admin/playoffs', { method: 'POST', body: JSON.stringify({ action: 'confirm', token: view.token, operator }) }); output.textContent = 'Playoffs started. Seeds and final standings are saved.'; }
      catch (error) { output.textContent = error.message + ' Review seeding again.'; }
      finally { playoffRequestRunning = false; }
    }); output.append(confirm);
  } catch(error) { output.textContent = error.message; }
  finally { playoffRequestRunning = false; }
});


document.querySelector('#backup-create')?.addEventListener('click', async event => {
 const button=event.currentTarget, output=document.querySelector('#backup-output'); if(button.disabled)return; button.disabled=true;
 try { const result=await adminRequestJson('/api/league/admin/backups',{method:'POST',body:JSON.stringify({})}); output.textContent=`Backup saved: ${result.id} · ${result.files} files${result.corruptFiles.length ? ` · ${result.corruptFiles.length} unreadable JSON files preserved for repair` : ''}`; }
 catch(error){output.textContent=error.message;} finally{button.disabled=false;}
});

function statScopeQuery(kind) {
  const scope=document.querySelector(`#${kind}-stats-scope`)?.value || 'REGULAR_SEASON',season=document.querySelector(`#${kind}-stats-season`)?.value || '';
  return '?'+new URLSearchParams({scope,...(season?{season}:{})});
}
for (const kind of ['player','team']) for(const control of ['scope','season'])document.querySelector(`#${kind}-stats-${control}`)?.addEventListener('change',()=>{
  if(kind==='player'){state.statsGameLogs.clear();state.expandedStatsPlayerId=null;state.leagueStatsPage=1;loadLeagueStats(true);}
  else{state.teamGameLogs.clear();state.expandedTeamStatsId=null;loadTeamStats(true);}
});

(() => {
  const season=document.querySelector('#playoffs-season'),status=document.querySelector('#playoffs-status'),output=document.querySelector('#playoffs-bracket');
  let loading=false,pendingReload=false;
  const stages=['PLAY_IN','FIRST_ROUND','SECOND_ROUND','CONFERENCE_FINALS','NBA_FINALS'];
  async function load() {
    if(loading){pendingReload=true;return;}loading=true;status.textContent='Loading official bracket…';
    try {
      const response=await fetch('/api/league/playoffs'+(season.value?'?season='+encodeURIComponent(season.value):''));const payload=await response.json();if(!response.ok)throw Error(payload.error || 'Unable to load bracket.');
      for(const select of [season,document.querySelector('#player-stats-season'),document.querySelector('#team-stats-season')])if(select){const value=select.value;select.innerHTML='<option value="">Current season</option>'+payload.seasons.map(s=>`<option value="${escapeHtml(s)}">Season ${escapeHtml(String(s).split('-reset-')[0])}${String(s).includes('-reset-')?' · restart '+escapeHtml(String(s).slice(-6)):''}</option>`).join('');select.value=value;}
      const state=payload.playoffs;if(!state){status.textContent='Playoffs have not started for this season.';output.innerHTML='';return;}
      if(state.version!==2){status.textContent='Historical seeds are available; this season predates the series bracket.';output.innerHTML=Object.entries(state.seeds||{}).map(([c,teams])=>`<h3>${escapeHtml(c)}</h3><ol>${teams.map(t=>`<li>${escapeHtml(t.teamName)}</li>`).join('')}</ol>`).join('');return;}
      const label=id=>Object.values(state.seeds).flat().find(t=>t.teamId===id)?.teamName||id;
      const seed=id=>{const team=Object.entries(state.qualifiedSeeds||{}).find(([,ids])=>ids.includes(id));return team?team[1].indexOf(id)+1:Object.values(state.seeds).flatMap(teams=>teams.map((t,i)=>({id:t.teamId,seed:i+1}))).find(t=>t.id===id)?.seed;};
      status.textContent=`${payload.testMode?'TEST MODE · ':''}Season ${state.seasonNumber||String(payload.seasonId).split('-reset-')[0]} · ${state.stage.replaceAll('_',' ')}${state.conflicts.length?' · Commissioner review required':''}`;
      function seriesCard(s) {
        const games=payload.games.filter(g=>g.seriesId===s.id),round=state.rounds.find(r=>r.stage===s.stage);
        return `<article class="postseason-matchup"><p>${escapeHtml(s.status)}${s.forfeit?' · Series forfeit':''}</p>${[s.team1Id,s.team2Id].map(id=>`<div class="postseason-team ${s.winnerTeamId===id?'series-winner':''}">${teamLogoMarkup(label(id))}<span>#${seed(id)||'—'} ${escapeHtml(label(id))}</span><strong>${s.wins[id]}</strong></div>`).join('')}<small>First to ${s.requiredWins} win${s.requiredWins===1?'':'s'}${round?.deadlineAt?' · Deadline '+escapeHtml(new Date(round.deadlineAt).toLocaleString()):''}</small><details><summary>Official games (${games.length})</summary>${games.map(g=>`<p>Game ${g.gameNumber}: ${g.result.type==='FORFEIT'?escapeHtml(label(g.result.winnerTeamId))+' wins by forfeit':escapeHtml(label(s.team1Id))+' '+g.result.scores[s.team1Id]+' – '+g.result.scores[s.team2Id]+' '+escapeHtml(label(s.team2Id))}</p>`).join('')||'<p>No approved games yet.</p>'}</details></article>`;
      }
      output.innerHTML=['East','West'].map(c=>`<h3>${c}ern Conference</h3><div class="postseason-rounds">${stages.slice(0,4).map(stage=>`<div class="postseason-round"><h4>${stage.replaceAll('_',' ')}</h4>${state.series.filter(s=>s.stage===stage&&s.conference===c).map(seriesCard).join('')||'<p>Awaiting previous round.</p>'}</div>`).join('')}</div>`).join('')+`<h3>NBA Finals</h3>${state.series.filter(s=>s.stage==='NBA_FINALS').map(seriesCard).join('')||'<p>Awaiting conference champions.</p>'}${state.champion?`<h3>🏆 ${escapeHtml(label(state.champion.teamId))} · League Champion</h3>`:''}<h3>Championship history</h3>${Object.entries(payload.championships||{}).map(([season,c])=>`<p>Season ${escapeHtml(c.seasonNumber||String(season).split('-reset-')[0])} · ${escapeHtml(label(c.teamId))} · Finals ${Object.values(c.seriesScore).join('–')}${c.coachUserId?' · <a href="https://discord.com/users/'+escapeHtml(c.coachUserId)+'">Championship coach</a>':''}</p>`).join('')||'<p>No finalized championships yet.</p>'}<details><summary>Eliminated teams</summary>${[...new Set(state.series.filter(s=>s.winnerTeamId&&(s.stage!=='PLAY_IN'||s.id.endsWith('9-10')||s.id.endsWith('final'))).map(s=>s.winnerTeamId===s.team1Id?s.team2Id:s.team1Id))].map(id=>`<p>${escapeHtml(label(id))}</p>`).join('')||'<p>None yet.</p>'}</details>`;
    }catch(error){status.textContent=error.message;output.innerHTML='<p>Unable to load the bracket. Use Reload bracket to retry.</p>';}finally{loading=false;if(pendingReload){pendingReload=false;load();}}
  }
  season.addEventListener('change',load);document.querySelector('#playoffs-refresh').addEventListener('click',load);window.addEventListener('hashchange',()=>{if(location.hash==='#playoffs')load();});
  // Populate historical season selectors without opening simulation controls on the website.
  setInterval(()=>{if(location.hash==='#playoffs'&&!document.hidden)load();},30000);
  load();
})();

// Offseason controls use the existing authenticated commissioner gateway.
(() => {
  const button = document.querySelector('#offseason-review'), output = document.querySelector('#offseason-output');
  if (!button || !output) return;
  let busy = false;
  async function request(action, token) {
    if (busy) return;
    busy = true; button.disabled = true;
    try {
      const view = await adminRequestJson('/api/league/admin/offseason', { method: 'POST', body: JSON.stringify({ action, token, operator: commissionerName.value.trim() }) });
      output.replaceChildren();
      const heading = document.createElement('p'); heading.textContent = `Current step: ${view.step.replaceAll('_', ' ')}`; output.append(heading);
      if (view.blockers.length) {
        const list = document.createElement('ul');
        for (const text of view.blockers) { const item = document.createElement('li'); item.textContent = text; list.append(item); }
        output.append(list);
      } else if (action === 'prepare' && view.token) {
        const summary = document.createElement('p'); summary.textContent = `Confirm advancement to ${view.nextStep.replaceAll('_', ' ')}? A storage backup will be saved.`; output.append(summary);
        const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = 'Confirm next step';
        confirm.addEventListener('click', () => { confirm.disabled = true; request('confirm', view.token); });
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => request('cancel', view.token));
        output.append(confirm, cancel);
      } else { const text = document.createElement('p'); text.textContent = action === 'cancel' ? 'Transition cancelled. No phase changed.' : 'Step advanced. Review the next step when its work is complete.'; output.append(text); }
    } catch (error) { output.textContent = error.message; } finally { busy = false; button.disabled = false; }
  }
  button.addEventListener('click', () => request('prepare'));
})();

(() => {
  const output = document.querySelector('#retirement-output'), input = document.querySelector('#retirement-images');
  const upload = document.querySelector('#retirement-upload'), reload = document.querySelector('#retirement-reload');
  if (!output || !input || !upload || !reload) return;
  let busy = false, originalUrls = [];
  const post = body => adminRequestJson('/api/league/admin/retirements', { method: 'POST', body: JSON.stringify(body) });
  async function review() {
    const [batch, playerResponse] = await Promise.all([adminRequestJson('/api/league/admin/retirements'), requestJson('/api/league/players')]);
    for (const url of originalUrls) URL.revokeObjectURL(url); originalUrls = [];
    output.replaceChildren();
    if (!batch.images.length) { output.textContent = 'Upload all retirement pages first.'; return; }
    for (const image of batch.images) {
      const details = document.createElement('details'), title = document.createElement('summary'); title.textContent = `${image.filename} · ${image.status.replaceAll('_', ' ')}`; details.append(title);
      const original = document.createElement('img'); original.alt = `Original evidence: ${image.filename}`; original.style.maxWidth = '100%';
      details.addEventListener('toggle', async () => {
        if (!details.open || original.src) return;
        try {
          const response = await fetch(`/api/league/admin/retirements?preview=1&imageId=${encodeURIComponent(image.imageId)}`, { headers: { 'x-leaguebuddy-admin-key': state.adminKey } });
          if (!response.ok) throw Error('Unable to load the original evidence.');
          const url = URL.createObjectURL(await response.blob()); originalUrls.push(url); original.src = url;
        } catch (error) { const p = document.createElement('p'); p.textContent = error.message; details.append(p); }
      });
      const text = document.createElement('pre'); text.textContent = image.text || image.error || 'OCR unavailable. Review the original and select players manually.'; details.append(original, text);
      if (!batch.confirmed && ['PROCESSING', 'NEEDS_MANUAL_REVIEW'].includes(image.status)) {
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry OCR from saved photo';
        retry.addEventListener('click', () => run(async () => { retry.disabled = true; await post({ action: 'retry', imageId: image.imageId }); await review(); })); details.append(retry);
      }
      output.append(details);
    }
    if (batch.confirmed) { const p = document.createElement('p'); p.textContent = 'Retirements confirmed. Return to the offseason checklist to advance.'; output.append(p); return; }
    const players = (Array.isArray(playerResponse) ? playerResponse : playerResponse.players || []).filter(p => !p.retiredAt);
    const selected = new Set(), list = document.createElement('div');
    const suggested = new Set(batch.images.flatMap(i => i.candidates.flatMap(row => row.candidates.map(p => p.playerId))));
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search all players to add or correct a match'; search.setAttribute('aria-label', 'Find retired players'); output.append(search, list);
    function renderPlayers() {
      list.replaceChildren(); const query = search.value.trim().toLowerCase();
      const matches = players.filter(p => selected.has(p.playerId) || (query ? p.name.toLowerCase().includes(query) : suggested.has(p.playerId))).sort((a,b) => a.name.localeCompare(b.name));
      for (const p of matches.slice(0, 100)) {
        const label = document.createElement('label'), box = document.createElement('input'); box.type = 'checkbox'; box.checked = selected.has(p.playerId);
        box.addEventListener('change', () => box.checked ? selected.add(p.playerId) : selected.delete(p.playerId));
        label.append(box, document.createTextNode(`${p.name} · ${p.teamName || 'Free Agent'}`)); label.style.display = 'block'; list.append(label);
      }
      if (!matches.length) list.textContent = 'No suggested matches. Search the player name shown in the photo.';
    }
    search.addEventListener('input', renderPlayers); renderPlayers();
    const reviewed = document.createElement('input'); reviewed.type = 'checkbox'; const reviewedLabel = document.createElement('label'); reviewedLabel.append(reviewed, document.createTextNode(' I reviewed every original photo and selected every retired player.'));
    const none = document.createElement('input'); none.type = 'checkbox'; const noneLabel = document.createElement('label'); noneLabel.append(none, document.createTextNode(' The photos show no retirements.')); noneLabel.style.display = 'block';
    const prepare = document.createElement('button'); prepare.type = 'button'; prepare.textContent = 'Review retirement changes'; output.append(reviewedLabel, noneLabel, prepare);
    prepare.addEventListener('click', () => run(async () => {
      const preview = await post({ action: 'prepare', playerIds: [...selected], noRetirements: none.checked, reviewedAllImages: reviewed.checked });
      output.replaceChildren(); const text = document.createElement('p'); text.textContent = preview.noRetirements ? 'Confirm no retirements?' : `Retire ${preview.selected.map(p => p.name).join(', ')}? Their IDs, contracts and history will be preserved.`; output.append(text);
      const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = 'Confirm retirements';
      confirm.addEventListener('click', () => run(async () => { await post({ action: 'confirm', token: preview.token }); await review(); }));
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Back to review'; cancel.addEventListener('click', () => run(review)); output.append(confirm, cancel);
    }));
  }
  async function run(work) {
    if (busy) return; busy = true; upload.disabled = reload.disabled = true;
    try { await work(); } catch (error) { const p = document.createElement('p'); p.textContent = error.message; output.append(p); }
    finally { busy = false; upload.disabled = reload.disabled = false; }
  }
  reload.addEventListener('click', () => run(review));
  upload.addEventListener('click', () => run(async () => {
    if (!input.files.length) throw Error('Choose retirement photos first.');
    for (const [index, file] of [...input.files].entries()) {
      if (file.size > 24 * 1024 * 1024) throw Error(`${file.name}: maximum file size is 24 MB.`);
      output.textContent = `Processing photo ${index + 1} of ${input.files.length}: ${file.name}…`;
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
      await post({ action: 'upload', filename: file.name, base64: data });
    }
    input.value = ''; await review();
  }));
})();

// Weekly awards use the existing public league API and permanent player profiles.
(() => {
  const status = document.querySelector('#pow-status'), current = document.querySelector('#pow-current'), history = document.querySelector('#pow-history');
  const controls = { seasonId: document.querySelector('#pow-season'), week: document.querySelector('#pow-week'), conference: document.querySelector('#pow-conference'), teamId: document.querySelector('#pow-team'), playerId: document.querySelector('#pow-player') };
  let loading = false, reload = false;
  const card = w => `<article class="summary-card" data-award-id="${escapeHtml(w.awardId)}">${playerPortraitMarkup(w.player, 'league-player-portrait')}<h3>🏆 ${escapeHtml(w.conference)} · Week ${w.week}</h3><button type="button" data-pow-player="${escapeHtml(w.playerId)}">${escapeHtml(w.playerName)}</button><p>${escapeHtml(w.teamName)} · Season ${escapeHtml(w.seasonId)}</p><p>🏀 ${w.stats.PTS} PTS · ${w.stats.REB} REB · 🎯 ${w.stats.AST} AST<br>🛡️ ${w.stats.STL} STL · ${w.stats.BLK} BLK · ${w.stats.TO} TO<br>📊 ${w.stats.FGPercent == null ? '—' : Math.round(w.stats.FGPercent) + '%'} FG · ${w.stats['3PM']}/${w.stats['3PA']} 3PT · ${w.stats.FTM}/${w.stats.FTA} FT</p><p>${escapeHtml(w.explanation)}</p><button type="button" data-pow-game="${escapeHtml(w.gameId)}" data-pow-game-player="${escapeHtml(w.playerId)}" data-pow-game-season="${escapeHtml(w.seasonId)}">View verified game</button><div data-pow-game-output="${escapeHtml(w.gameId)}" hidden></div></article>`;
  function options(select, entries, label) { const previous = select.value; select.innerHTML = `<option value="">${label}</option>` + entries.map(([value, text]) => `<option value="${escapeHtml(String(value))}">${escapeHtml(text)}</option>`).join(''); select.value = previous; }
  async function load() {
    if (loading) { reload = true; return; } loading = true;
    try {
      const query = new URLSearchParams(Object.entries(controls).filter(([, select]) => select.value).map(([key, select]) => [key, select.value]));
      const payload = await requestJson('/api/league/player-of-the-week?' + query);
      options(controls.seasonId, payload.seasons.map(s => [s, 'Season ' + s]), 'All seasons');
      options(controls.week, Array.from({ length: 15 }, (_, i) => [i + 1, 'Week ' + (i + 1)]), 'All weeks');
      options(controls.teamId, payload.teams.map(t => [t.teamId, t.teamName]), 'All teams');
      options(controls.playerId, payload.players.map(p => [p.playerId, p.name]), 'All players');
      current.innerHTML = payload.current.map(card).join('') || '<p>No finalized weekly awards this season.</p>';
      history.innerHTML = payload.history.map(card).join('') || '<p>No awards match these filters.</p>';
      status.textContent = 'Calculated from verified single-game performances after week finalization.';
    } catch (error) { status.textContent = error.message + (history.children.length ? ' Showing previously loaded awards.' : ''); }
    finally { loading = false; if (reload) { reload = false; load(); } }
  }
  for (const control of Object.values(controls)) control.addEventListener('change', load);
  document.querySelector('#pow-refresh').addEventListener('click', load);
  document.querySelector('#player-of-the-week').addEventListener('click', async event => {
    const player = event.target.closest('[data-pow-player]'), game = event.target.closest('[data-pow-game]');
    try {
      if (player) await showPlayerDetail(player.dataset.powPlayer);
      if (game) {
        const payload = await requestJson(`/api/league/stats/players/${encodeURIComponent(game.dataset.powGamePlayer)}/games?season=${encodeURIComponent(game.dataset.powGameSeason)}`);
        const log = payload.games.find(row => row.gameId === game.dataset.powGame);
        const output = game.closest('article').querySelector('[data-pow-game-output]'); output.hidden = false;
        output.textContent = log ? `${log.teamName} vs ${log.opponent} · ${log.result} ${log.score} · ${log.MIN} MIN · ${log.PTS} PTS · ${log.REB} REB · ${log.AST} AST · FG ${log.FG} · 3PT ${log['3PT']} · FT ${log.FT}` : 'The historical game log is unavailable.';
      }
    } catch (error) { showToast(error.message); }
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-award-week]'); if (!link) return;
    const option = document.createElement('option'); option.value = link.dataset.awardSeason; option.textContent = 'Season ' + link.dataset.awardSeason;
    if (![...controls.seasonId.options].some(o => o.value === option.value)) controls.seasonId.add(option);
    controls.seasonId.value = link.dataset.awardSeason;
    if (!controls.week.options.length || controls.week.options.length === 1) options(controls.week, Array.from({ length: 15 }, (_, i) => [i + 1, 'Week ' + (i + 1)]), 'All weeks');
    controls.week.value = link.dataset.awardWeek;
    controls.conference.value = ''; controls.teamId.value = ''; controls.playerId.value = '';
    elements.leagueDialog?.close(); load();
  });
  window.addEventListener('hashchange', () => { if (location.hash === '#player-of-the-week') load(); });
  if (location.hash === '#player-of-the-week') load();
  setInterval(() => { if (location.hash === '#player-of-the-week' && !document.hidden) load(); }, 30000);
})();

(() => {
  const kind = document.querySelector('#offseason-import-kind'), output = document.querySelector('#offseason-import-output');
  let data, rows = [], policy = {}, imageUrls = [], busy = false;
  const endpoint = () => '/api/league/admin/offseason-import?step=' + kind.value;
  const post = body => adminRequestJson(endpoint(), { method:'POST', body:JSON.stringify(body) });
  const number = value => value === '' || value == null ? null : Number(value);
  function selection(key, row, entries, blank = 'Choose…') { return `<select data-import-field="${key}" data-import-row="${row}"><option value="">${blank}</option>${entries.map(([value,label])=>`<option value="${escapeHtml(String(value))}"${String(rows[row]?.[key]??'')===String(value)?' selected':''}>${escapeHtml(label)}</option>`).join('')}</select>`; }
  const numeric = (key,index,value) => `<input type="number" data-import-field="${key}" data-import-row="${index}" value="${value??''}" aria-label="${escapeHtml(key)}">`;
  function table(teamFilter = '') {
    const body = output.querySelector('#import-review-body'); if(!body)return;
    const teams = data.teams.map(t=>[t.teamId,t.teamName]), players = data.players.map(p=>[p.playerId,p.name]);
    body.innerHTML = rows.map((r,index)=>{
      if(teamFilter&&r.teamId!==teamFilter)return '';
      let cells = kind.value==='LOTTERY' ? `<td>${r.pickNumber}</td><td>${selection('originalTeamId',index,teams)}</td><td>${selection('teamId',index,teams)}</td><td><input data-import-field="reason" data-import-row="${index}" value="${escapeHtml(r.reason||'')}" placeholder="Reason if ownership differs"></td>`
        : kind.value==='OPTIONS' ? `<td>${escapeHtml(data.players.find(p=>p.playerId===r.playerId)?.name||r.playerId)}</td><td>${escapeHtml(data.teams.find(t=>t.teamId===r.teamId)?.teamName||'')}</td><td>${selection('decision',index,[['ACCEPTED','Accepted'],['DECLINED','Declined']])}</td>`
        : kind.value==='PROGRESSION' ? `<td>${selection('playerId',index,players)}</td><td>${selection('teamId',index,teams)}</td><td>${escapeHtml(String(data.players.find(p=>p.playerId===r.playerId)?.overall??'—'))}</td><td>${numeric('overall',index,r.overall)}</td><td>${numeric('change',index,r.change)}</td>`
        : `<td>${r.pickNumber}</td><td>${selection('playerId',index,players)}</td><td>${selection('teamId',index,teams)}</td><td>${numeric('overall',index,r.overall)}</td><td>${numeric('age',index,r.age)}</td><td>${r.pickNumber>30?selection('pickAssetId',index,data.picks.filter(p=>Number(p.round)===2).map(p=>[p.pickId,(data.teams.find(t=>t.teamId===p.originalTeamId)?.teamName||p.originalTeamId)+' → '+(data.teams.find(t=>t.teamId===p.currentOwnerTeamId)?.teamName||p.currentOwnerTeamId)])):'Official lottery asset'}</td><td>${r.pickNumber>30?selection('contractYears',index,[[3,'2 + 1 team option'],[4,'3 + 1 team option']]):'2 + 1 + 1 team options'}</td><td>${r.pickNumber>30?numeric('firstYearSalary',index,r.firstYearSalary):'NBA-derived rookie scale'}</td><td>${r.pickNumber>30&&r.contractYears===4?numeric('secondYearSalary',index,r.secondYearSalary):'NBA-derived scale'}</td>`;
      return '<tr>'+cells+'</tr>';
    }).join('');
  }
  function proposalMarkup(image) {
    const report=image.proposals;if(!report)return '';
    return '<h4>OCR row suggestions</h4>'+report.warnings.map(w=>'<p>'+escapeHtml(w)+'</p>').join('')
      +report.rows.map(r=>'<p><strong>'+escapeHtml(r.name)+'</strong> · '+(kind.value==='LOTTERY'?'Review original franchise and owner':escapeHtml(r.playerCandidates.map(p=>p.name).join(' / ')||'Player requires matching'))
      +(r.teamId?' · '+escapeHtml(data.teams.find(t=>t.teamId===r.teamId)?.teamName||r.teamId):'')
      +(r.overall!=null?' · '+r.overall+' OVR':'')+(r.change!=null?' · '+(r.change>0?'+':'')+r.change:'')
      +(r.pickNumber?' · Pick '+r.pickNumber:'')+(r.decision?' · '+escapeHtml(r.decision):'')
      +r.flags.map(flag=>'<br>'+escapeHtml(flag)).join('')+'</p>').join('');
  }
  function applyProposals() {
    const grouped=new Map();let changed=0,conflicts=0;
    for(const image of data.images)for(const proposal of image.proposals?.rows||[]) {
      if(proposal.confidence<80||proposal.flags.some(flag=>/stored roster|ambiguous/.test(flag))||(kind.value!=='LOTTERY'&&!proposal.playerId))continue;
      const key=['DRAFT','LOTTERY'].includes(kind.value)?proposal.pickNumber:proposal.playerId;if(!key)continue;
      const candidates=grouped.get(key)||[];candidates.push(proposal);grouped.set(key,candidates);
    }
    for(const row of rows) {
      const candidates=grouped.get(['DRAFT','LOTTERY'].includes(kind.value)?row.pickNumber:row.playerId)||[];
      for(const field of kind.value==='LOTTERY'?['teamId','originalTeamId']:kind.value==='OPTIONS'?['decision']:kind.value==='PROGRESSION'?['overall','change']:['playerId','teamId','overall','age']) {
        const values=[...new Set(candidates.map(p=>p[field]).filter(v=>v!==null&&v!==undefined&&v!==''))];
        if(values.length>1){conflicts++;continue;}
        if(values.length===1&&(row[field]===null||row[field]===undefined||row[field]==='')){row[field]=values[0];changed++;}
      }
    }
    output.querySelector('#import-confirmation')?.replaceChildren();output.querySelector('#import-reviewed').checked=false;
    table(output.querySelector('#import-team-filter')?.value||'');showToast(changed+' matched fields added for review'+(conflicts?' · '+conflicts+' conflicts require manual entry':'')+'. Review every photo before confirmation.');
  }
  function render() {
    imageUrls.forEach(URL.revokeObjectURL); imageUrls = [];
    const headers = kind.value==='LOTTERY'?['Pick','Original franchise','Pick owner','Reconciliation reason']:kind.value==='DRAFT'?['Pick','Prospect','Team','OVR','Age','Owned second-round pick','Contract years','Year 1 salary ($)','Year 2 salary ($)']:kind.value==='OPTIONS'?['Player','Current team','Option decision']:['Player','Table team','Previous OVR','New OVR','OVR change'];
    output.innerHTML = `<p>${escapeHtml(kind.options[kind.selectedIndex].text)} · ${data.images.length} saved photos${data.receipt?' · Confirmed':''}</p>
      <div>${data.images.map(image=>`<details><summary>${escapeHtml(image.filename)} · ${escapeHtml(image.status)}</summary><button type="button" data-import-original="${escapeHtml(image.imageId)}">View photo</button><button type="button" data-import-retry="${escapeHtml(image.imageId)}">Retry OCR</button><pre>${escapeHtml(image.text||image.error||'')}</pre>${proposalMarkup(image)}${(image.candidates||[]).map(c=>`<p>${escapeHtml(c.text)} → ${c.candidates.map(p=>escapeHtml(p.name)).join(' / ')}</p>`).join('')}</details>`).join('')}</div>
      ${kind.value==='DRAFT'?`<label>NBA 2K salary cap for ${escapeHtml(data.nextSeason)} ($)<input type="number" id="import-salary-cap" value="${policy.salaryCap||''}"></label><label>First-round scale percentage<input type="number" min="80" max="120" id="import-scale-percent" value="${policy.scalePercentage??120}"></label><button type="button" id="import-apply-scale">Preview NBA-derived salary limits</button><p id="import-scale-info">Verify these contracts against NBA 2K. Later-year tables are derived from the confirmed cap.</p>`:''}
      ${kind.value==='PROGRESSION'?`<label>Review team<select id="import-team-filter"><option value="">All teams</option>${data.teams.map(t=>`<option value="${escapeHtml(t.teamId)}">${escapeHtml(t.teamName)}</option>`).join('')}</select></label><p id="import-coverage">${data.coverage.map(t=>escapeHtml(t.teamName)+': '+t.rosterCount+'/15 roster players').join(' · ')}</p><label><input type="checkbox" id="import-preserve-schedule"${policy.preserveExistingSchedule?' checked':''}> Keep the existing 15-week conference schedule (14 games and one bye per team)</label>`:''}
      ${['LOTTERY','DRAFT','OPTIONS','PROGRESSION'].includes(kind.value)?'<button type="button" id="import-apply-ocr">Add matched OCR fields for review</button>':''}
      <div class="standings-scroll"><table class="standings-table"><thead><tr>${headers.map(h=>'<th>'+h+'</th>').join('')}</tr></thead><tbody id="import-review-body"></tbody></table></div>
      <label><input type="checkbox" id="import-reviewed"${data.review?.reviewedAllImages?' checked':''}> I reviewed all photos and every player/team mapping.</label>
      <button type="button" id="import-save">Save review progress</button><button type="button" id="import-prepare">Review final changes</button><div id="import-confirmation"></div>`;
    table();
  }
  async function load() {
    data = await adminRequestJson(endpoint());policy=data.review?.policy||{};
    rows = data.review?.rows || (kind.value==='LOTTERY'?Array.from({length:30},(_,i)=>({pickNumber:i+1,teamId:'',originalTeamId:''})):kind.value==='DRAFT'?Array.from({length:60},(_,i)=>({pickNumber:i+1,playerId:'',teamId:'',overall:null,age:null,contractYears:i>=30?3:null})):kind.value==='OPTIONS'?data.players.filter(p=>p.option&&!p.option.optionDecision).map(p=>({playerId:p.playerId,teamId:p.teamId,decision:''})):data.players.filter(p=>p.teamId).map(p=>({playerId:p.playerId,teamId:p.teamId,overall:null,change:null})));
    render();
  }
  function review() {
    if(kind.value==='DRAFT'){policy.salaryCap=number(output.querySelector('#import-salary-cap').value);policy.scalePercentage=number(output.querySelector('#import-scale-percent').value);}
    if(kind.value==='PROGRESSION')policy.preserveExistingSchedule=output.querySelector('#import-preserve-schedule').checked;
    return {rows,policy,reviewedAllImages:output.querySelector('#import-reviewed').checked};
  }
  output.addEventListener('change',event=>{
    output.querySelector('#import-confirmation')?.replaceChildren();
    const field=event.target.dataset.importField,index=Number(event.target.dataset.importRow);
    if(field){rows[index][field]=['overall','age','change','contractYears','firstYearSalary','secondYearSalary'].includes(field)?number(event.target.value):event.target.value;
      if(field==='playerId'&&kind.value==='DRAFT'){const player=data.players.find(p=>p.playerId===event.target.value);rows[index].age=player?.age??null;}if(field==='contractYears'||field==='playerId')table(output.querySelector('#import-team-filter')?.value||'');}
    if(event.target.id==='import-team-filter')table(event.target.value);
  });
  output.addEventListener('click',async event=>{
    if(!(event.target instanceof HTMLElement)||event.target.tagName!=='BUTTON')return;
    try {
      if(event.target.dataset.importOriginal){const response=await fetch(endpoint()+'&preview=1&imageId='+encodeURIComponent(event.target.dataset.importOriginal),{headers:{ 'x-leaguebuddy-admin-key':state.adminKey }});if(!response.ok)throw Error((await response.json()).error);const url=URL.createObjectURL(await response.blob());imageUrls.push(url);const image=document.createElement('img');image.src=url;image.alt='Photo preview; original file preserved';image.style.maxWidth='100%';event.target.closest('details').append(image);}
      else if(event.target.dataset.importRetry){await post({action:'retry',imageId:event.target.dataset.importRetry});await load();}
      else if(event.target.id==='import-apply-ocr'){applyProposals();}
      else if(event.target.id==='import-save'){await post({action:'review',...review()});showToast('Review saved.');}
      else if(event.target.id==='import-prepare'){const result=await post({action:'prepare',...review()});output.querySelector('#import-confirmation').innerHTML=`<p>${escapeHtml(result.summary)}. These changes become official together.</p><button type="button" id="import-confirm" data-token="${escapeHtml(result.token)}">Confirm ${escapeHtml(kind.options[kind.selectedIndex].text)}</button>`;}
      else if(event.target.id==='import-confirm'){await post({action:'confirm',token:event.target.dataset.token});await load();showToast('Import confirmed. Review the offseason checklist to advance.');}
      else if(event.target.id==='import-apply-scale'){
        review();const result=await adminRequestJson(endpoint()+'&salaryCap='+encodeURIComponent(policy.salaryCap));const scale=result.scale;
        output.querySelector('#import-scale-info').textContent=`${scale.derived?'NBA-derived league table':'Published NBA base table'} · First pick at ${policy.scalePercentage}%: $${Math.round(scale.rows[0].salaries[0]*policy.scalePercentage/100).toLocaleString()} · Second-round year 1 range: $${scale.secondRound.minimumFirstYear.toLocaleString()}–$${scale.secondRound.fourYears[0].toLocaleString()}. Confirm the actual offered amounts in the rows.`;
      }
    }catch(error){showToast(error.message);}
  });
  document.querySelector('#offseason-import-load').addEventListener('click',()=>load().catch(e=>showToast(e.message)));
  document.querySelector('#offseason-import-upload').addEventListener('click',async()=>{
    if(busy)return;busy=true;
    try {for(const file of document.querySelector('#offseason-import-images').files){const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});await post({action:'upload',filename:file.name,base64});}await load();}
    catch(error){showToast(error.message);}finally{busy=false;}
  });
  kind.addEventListener('change',()=>{rows=[];policy={};output.innerHTML='Upload or load the saved import for this step.';});
})();

(() => {
  const output = document.querySelector('#offseason-rosters-output');
  const endpoint = '/api/league/admin/offseason-rosters';
  const post = body => adminRequestJson(endpoint, {method:'POST',body:JSON.stringify(body)});
  async function load() {
    const data = await adminRequestJson(endpoint);
    output.innerHTML = `<p><strong>${escapeHtml(data.step)}</strong> · ${data.window?.deadlineAt?'Deadline '+escapeHtml(new Date(data.window.deadlineAt).toLocaleString()):'Cutdown period has not opened.'}</p>${data.blockers.map(b=>'<p>'+escapeHtml(b)+'</p>').join('')}<div class="admin-inline">${data.step==='CUTDOWN'&&!data.receipt?'<button data-roster-action="'+(data.window?'extend':'open')+'">'+(data.window?'Extend by 24 hours':'Open 24-hour cutdowns')+'</button>':''}${!data.receipt?'<button data-roster-action="prepare">Review completion</button>':'<p>Completion confirmed.</p>'}</div><div id="roster-confirmation"></div><div>${data.teams.map(team=>'<details><summary>'+escapeHtml(team.teamName)+' · '+team.count+'/15</summary>'+team.players.map(p=>'<p>'+escapeHtml(p.name)+' · '+escapeHtml(String(p.overall))+' OVR'+(p.protected?' · Protected':data.step==='CUTDOWN'&&team.count>15&&data.window?.status==='OPEN'&&!data.receipt?' <button data-waive-player="'+escapeHtml(p.playerId)+'">Review waiver</button>':'')+'</p>').join('')+'</details>').join('')}</div>`;
  }
  output.addEventListener('click', async event => {
    const button = event.target.closest('button'); if(!button)return;
    button.disabled=true;
    try {
      const playerId=button.dataset.waivePlayer,action=button.dataset.rosterAction;
      if(playerId||action==='prepare'){
        const preview=await post(playerId?{action:'prepare-waiver',playerId}:{action:'prepare'});
        if(!preview.token){showToast('Resolve the listed blockers first.');await load();return;}
        const target=output.querySelector('#roster-confirmation');
        target.innerHTML='<p>'+escapeHtml(playerId?'Waive '+preview.playerName+' and release their contract?':'Confirm this offseason step is complete?')+'</p>';
        const confirm=document.createElement('button');confirm.textContent=playerId?'Confirm waiver':'Confirm completion';
        confirm.addEventListener('click',async()=>{confirm.disabled=true;try{await post({action:playerId?'confirm-waiver':'confirm',token:preview.token});await load();}catch(e){showToast(e.message);confirm.disabled=false;}});target.append(confirm);
      } else if(action){await post({action,hours:24});await load();}
    }catch(e){showToast(e.message);}finally{button.disabled=false;}
  });
  document.querySelector('#offseason-rosters-load').addEventListener('click',()=>load().catch(e=>showToast(e.message)));
})();

(() => {
  const controls={seasonId:document.querySelector('#progression-season'),teamId:document.querySelector('#progression-team'),playerId:document.querySelector('#progression-player')};let busy=false;
  const card=c=>`<article class="summary-card">${playerPortraitMarkup(c.player,'league-player-portrait')}<button data-progression-player="${escapeHtml(c.playerId)}">${escapeHtml(c.playerName)}</button><p>${escapeHtml(c.teamName)} · Season ${escapeHtml(c.seasonId)}</p><p>${c.previousOverall} → ${c.overall} OVR · ${c.change>0?'+':''}${c.change}</p></article>`;
  function options(select,entries,label){const old=select.value;select.innerHTML='<option value="">'+label+'</option>'+entries.map(([id,name])=>'<option value="'+escapeHtml(id)+'">'+escapeHtml(name)+'</option>').join('');select.value=old;}
  async function load(){if(busy)return;busy=true;try{
    const query=new URLSearchParams(Object.entries(controls).filter(([,v])=>v.value).map(([k,v])=>[k,v.value]));
    const data=await requestJson('/api/league/progression?'+query);
    options(controls.seasonId,data.seasons.map(s=>[s,'Season '+s]),'All seasons');options(controls.teamId,data.teams.map(t=>[t.teamId,t.teamName]),'All teams');
    // Keep the selected player across filtered requests; clearing the filter restores the full list.
    const entries=[...new Map(data.changes.map(c=>[c.playerId,[c.playerId,c.playerName]])).values()];if(!entries.some(([id])=>id===controls.playerId.value)&&controls.playerId.value)entries.push([controls.playerId.value,controls.playerId.selectedOptions[0]?.textContent||controls.playerId.value]);options(controls.playerId,entries,'All players');
    for(const key of ['risers','fallers'])document.querySelector('#progression-'+key).innerHTML=data[key].map(card).join('')||'<p>No matching changes.</p>';
    document.querySelector('#progression-history').innerHTML=data.changes.map(card).join('')||'<p>No confirmed progression yet.</p>';
    document.querySelector('#progression-rankings').innerHTML=data.teamRankings.map((t,i)=>'<p>'+ (i+1)+'. '+escapeHtml(t.teamName)+' · '+(t.averageChange>0?'+':'')+t.averageChange.toFixed(2)+' average OVR change · '+t.players+' verified changes</p>').join('');
    document.querySelector('#progression-status').textContent='Changes preserve the team represented at the time of confirmation.';
  }catch(e){document.querySelector('#progression-status').textContent=e.message;}finally{busy=false;}}
  for(const c of Object.values(controls))c.addEventListener('change',load);
  document.querySelector('#progression-refresh').addEventListener('click',load);
  document.querySelector('#progression').addEventListener('click',e=>{const p=e.target.closest('[data-progression-player]');if(p)showPlayerDetail(p.dataset.progressionPlayer).catch(e=>showToast(e.message));});
  window.addEventListener('hashchange',()=>{if(location.hash==='#progression')load();});if(location.hash==='#progression')load();
  setInterval(()=>{if(location.hash==='#progression'&&!document.hidden)load();},30000);
})();

(() => {
 const season=document.querySelector('#rankings-season'),snapshot=document.querySelector('#rankings-snapshot');let history=[],busy=false;
 function render(){const selected=history.find(s=>s.seasonId+':'+s.key===snapshot.value)||history.at(-1);document.querySelector('#rankings-table').innerHTML=selected?'<p>Season '+escapeHtml(selected.seasonId)+' · '+escapeHtml(selected.key)+'</p><table><thead><tr><th>Rank</th><th>Team</th><th>Score</th><th>Record</th><th>Movement</th><th>Season</th><th>Roster</th><th>Recent</th><th>Schedule</th></tr></thead><tbody>'+selected.teams.map(t=>'<tr><td>'+t.rank+'</td><td>'+escapeHtml(t.teamName)+'</td><td>'+t.score.toFixed(1)+'</td><td>'+t.wins+'-'+t.losses+'</td><td>'+(t.movement==null?'New':t.movement>0?'↑ '+t.movement:t.movement<0?'↓ '+Math.abs(t.movement):'—')+'</td>'+['seasonPerformance','rosterStrength','recentForm','strengthOfSchedule'].map(k=>'<td>'+t.breakdown[k].toFixed(1)+'</td>').join('')+'</tr>').join('')+'</tbody></table>':'<p>No published rankings yet.</p>';}
 async function load(){if(busy)return;busy=true;try{const data=await requestJson('/api/league/power-rankings?seasonId='+encodeURIComponent(season.value)),old=season.value,oldSnapshot=snapshot.value;history=data.history;season.innerHTML='<option value="">All seasons</option>'+data.seasons.map(s=>'<option value="'+escapeHtml(s)+'">Season '+escapeHtml(s)+'</option>').join('');season.value=old;snapshot.innerHTML='<option value="">Latest snapshot</option>'+history.map(s=>'<option value="'+escapeHtml(s.seasonId+':'+s.key)+'">Season '+escapeHtml(s.seasonId)+' · '+escapeHtml(s.key)+'</option>').join('');snapshot.value=oldSnapshot;render();}catch(e){document.querySelector('#rankings-status').textContent=e.message;}finally{busy=false;}}
 season.addEventListener('change',()=>{snapshot.value='';load();});snapshot.addEventListener('change',render);document.querySelector('#rankings-refresh').addEventListener('click',load);window.addEventListener('hashchange',()=>{if(location.hash==='#power-rankings')load();});if(location.hash==='#power-rankings')load();setInterval(()=>{if(location.hash==='#power-rankings'&&!document.hidden)load();},30000);
})();

(() => {
 const output=document.querySelector('#offseason-fa-output'),endpoint='/api/league/admin/offseason-free-agency';let data,urls=[];
 const post=body=>adminRequestJson(endpoint,{method:'POST',body:JSON.stringify(body)});
 const field=(key,row,value)=>`<input data-fa-contract="${key}" data-fa-row="${row}" value="${escapeHtml(String(value??''))}" aria-label="${escapeHtml(key)}">`;
 async function load(){data=await adminRequestJson(endpoint);if(data.receipt){output.innerHTML='<p>Offseason free agency verified. Return to the offseason checklist to advance.</p>';return;}urls.forEach(URL.revokeObjectURL);urls=[];const stage=data.stage,won=data.offers.filter(o=>o.status==='WON');output.innerHTML=`<p><strong>${escapeHtml(stage?.name||'Exclusive re-signing not opened')}</strong> · ${escapeHtml(stage?.status||'Waiting')} ${stage?.deadlineAt?' · Deadline '+escapeHtml(new Date(stage.deadlineAt).toLocaleString()):''}</p><div class="admin-inline">${['open','extend','pause','resume','close','complete'].map(a=>'<button data-fa-action="'+a+'">'+({open:'Open next period',extend:'Extend 24 hours',pause:'Pause clock',resume:'Resume clock',close:'Close period',complete:'Complete period'}[a])+'</button>').join('')}</div><p>Score: 35% annual salary · 25% total value · 25% length · 15% age fit. Rankings use verified offer amounts; missing ages receive a neutral age factor.</p><div>${data.rankings.map(group=>'<details open><summary>'+escapeHtml(group.playerName)+'</summary>'+group.offers.map(o=>'<p><label><input type="checkbox" data-fa-approve="'+escapeHtml(o.id)+'"> '+escapeHtml(data.teams.find(t=>t.teamId===o.teamId)?.teamName||o.teamId)+' · '+o.score.toFixed(2)+' score · Priority '+o.priority+' · $'+o.contract.seasons[0].salary.toLocaleString()+' annually · '+o.contract.seasons.length+' years</label> <button data-fa-reject="'+escapeHtml(o.id)+'">Reject with reason</button></p>').join('')+'</details>').join('')}</div><button id="offseason-fa-prepare">Review selected approvals</button><div id="offseason-fa-confirmation"></div><h4>NBA 2K Transaction Report</h4><p>After all four periods, upload every report page and match the exact displayed contract for every approved signing. Resolve unexpected signings before final verification.</p><input id="offseason-fa-images" type="file" accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif" multiple><button id="offseason-fa-upload">Upload report photos</button><div>${(data.evidence?.images||[]).map(i=>'<details><summary>'+escapeHtml(i.filename)+' · '+escapeHtml(i.status)+'</summary><button data-fa-original="'+escapeHtml(i.imageId)+'">View photo</button><button data-fa-retry="'+escapeHtml(i.imageId)+'">Retry OCR</button><pre>'+escapeHtml(i.text||i.error||'')+'</pre>'+((i.proposals?.warnings||[]).map(w=>'<p>'+escapeHtml(w)+'</p>').join(''))+(i.proposals?.rows||[]).map(row=>'<p><strong>'+escapeHtml(row.name)+'</strong> → '+escapeHtml(row.playerCandidates.map(p=>p.name).join(' / ')||'Match player manually')+(row.teamId?' · '+escapeHtml(data.teams.find(t=>t.teamId===row.teamId)?.teamName||row.teamId):' · Match team manually')+' · '+row.contractYears+' years · $'+row.reportedTotal.toLocaleString()+' total'+row.flags.map(flag=>'<br>'+escapeHtml(flag)).join('')+'</p>').join('')+'</details>').join('')}</div><table><thead><tr><th>Signing</th><th>Team</th><th>Salary</th><th>Years</th><th>Type</th><th>Option</th></tr></thead><tbody>${won.map((o,i)=>'<tr><td>'+escapeHtml(o.playerId)+'</td><td>'+escapeHtml(data.teams.find(t=>t.teamId===o.teamId)?.teamName||o.teamId)+'</td>'+['salary','years','structure','option'].map(k=>'<td>'+field(k,i,'')+'</td>').join('')+'</tr>').join('')}</tbody></table><label><input id="offseason-fa-reviewed" type="checkbox"> I reviewed every report page, verified all approved signings, and resolved every unexpected signing.</label><button id="offseason-fa-verify">Review final reconciliation</button>`;}
 output.addEventListener('change',()=>output.querySelector('#offseason-fa-confirmation')?.replaceChildren());
 function confirm(preview,action,label){const target=output.querySelector('#offseason-fa-confirmation');target.textContent=label+'? ';const button=document.createElement('button');button.textContent='Confirm';button.addEventListener('click',async()=>{button.disabled=true;try{await post({action,token:preview.token});await load();showToast('Confirmed.');}catch(e){showToast(e.message);button.disabled=false;}});target.append(button);}
 output.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{
  if(b.dataset.faAction){await post({action:b.dataset.faAction,hours:24});await load();}
  else if(b.id==='offseason-fa-prepare'){const offerIds=[...output.querySelectorAll('[data-fa-approve]:checked')].map(i=>i.dataset.faApprove),p=await post({action:'prepare-approval',offerIds});confirm(p,'confirm-approval','Approve '+offerIds.length+' verified signings');}
  else if(b.dataset.faReject){const target=output.querySelector('#offseason-fa-confirmation');target.innerHTML='<label>Rejection reason<input id="offseason-fa-reason"></label>';const send=document.createElement('button');send.textContent='Confirm rejection';send.addEventListener('click',async()=>{try{await post({action:'reject',offerId:b.dataset.faReject,reason:target.querySelector('input').value});await load();}catch(e){showToast(e.message);}});target.append(send);}
  else if(b.id==='offseason-fa-upload'){for(const file of output.querySelector('#offseason-fa-images').files){const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});await post({action:'upload',filename:file.name,base64});}await load();}
  else if(b.dataset.faOriginal){const r=await fetch(endpoint+'?preview=1&imageId='+encodeURIComponent(b.dataset.faOriginal),{headers:{'x-leaguebuddy-admin-key':state.adminKey}});if(!r.ok)throw Error((await r.json()).error);const url=URL.createObjectURL(await r.blob());urls.push(url);const image=document.createElement('img');image.src=url;image.alt='Transaction Report photo preview';image.style.maxWidth='100%';b.closest('details').append(image);}
  else if(b.dataset.faRetry){await post({action:'retry',imageId:b.dataset.faRetry});await load();}
  else if(b.id==='offseason-fa-verify'){const won=data.offers.filter(o=>o.status==='WON'),rows=won.map((o,i)=>({offerId:o.id,playerId:o.playerId,teamId:o.teamId,details:Object.fromEntries(['salary','years','structure','option'].map(k=>[k,output.querySelector('[data-fa-contract="'+k+'"][data-fa-row="'+i+'"]').value]))}));const p=await post({action:'prepare-verification',rows,reviewedAllImages:output.querySelector('#offseason-fa-reviewed').checked});confirm(p,'confirm-verification','Verify '+p.rowCount+' NBA 2K signings');}
 }catch(e){showToast(e.message);}});
 document.querySelector('#offseason-fa-load').addEventListener('click',()=>load().catch(e=>showToast(e.message)));
})();

(() => {
 const output=document.querySelector('#news-review-output');let articles=[];
 const render=()=>{const status=document.querySelector('#news-review-status').value;output.innerHTML=articles.filter(a=>a.status===status).map(a=>`<details data-news-review="${escapeHtml(a.id)}"><summary>${escapeHtml(a.headline)}${a.revalidationRequired?' · SOURCE REVIEW REQUIRED':''}</summary><p>${escapeHtml(a.category)} · Season ${escapeHtml(a.seasonId)} · Week ${a.week}</p><pre>${escapeHtml(JSON.stringify(a.pendingSource?.facts||a.facts,null,2))}</pre><label>Headline<input data-news-edit="headline" value="${escapeHtml(a.headline)}"></label><label>Article<textarea data-news-edit="article" rows="8">${escapeHtml(a.article)}</textarea></label><label>Reason / correction notice<input data-news-edit="reason"></label><label><input data-news-edit="breaking" type="checkbox"${a.breaking?' checked':''}> Breaking news</label><label><input data-news-edit="featured" type="checkbox"${a.featured?' checked':''}> Feature / pin this story</label><div class="admin-inline">${(a.status==='PUBLISHED'?['correct']:['edit','regenerate','approve','reject']).map(action=>'<button data-news-review-action="'+action+'">'+({correct:'Save correction',edit:'Save draft',regenerate:'Regenerate from verified facts',approve:'Approve publication',reject:'Reject story'}[action])+'</button>').join('')}</div><p>${a.correctionNotice?escapeHtml(a.correctionNotice):''}</p><p>${a.revisions.length} retained revisions</p></details>`).join('')||'<p>No stories in this status.</p>';};
 async function load(){articles=(await adminRequestJson('/api/league/admin/news')).articles;render();}
 output.addEventListener('click',async e=>{const button=e.target.closest('[data-news-review-action]');if(!button)return;const card=button.closest('[data-news-review]'),action=button.dataset.newsReviewAction,body={id:card.dataset.newsReview,action};for(const key of ['headline','article','reason','breaking','featured']){const input=card.querySelector('[data-news-edit="'+key+'"]');body[key]=input.type==='checkbox'?input.checked:input.value;}button.disabled=true;try{await adminRequestJson('/api/league/admin/news',{method:'POST',body:JSON.stringify(body)});await load();showToast('News review saved.');}catch(e){showToast(e.message);button.disabled=false;}});
 document.querySelector('#news-review-load').addEventListener('click',()=>load().catch(e=>showToast(e.message)));document.querySelector('#news-review-status').addEventListener('change',render);
})();
(() => {
 const controls={q:document.querySelector('#news-search'),seasonId:document.querySelector('#news-season'),teamId:document.querySelector('#news-team'),category:document.querySelector('#news-category'),week:document.querySelector('#news-week'),phase:document.querySelector('#news-phase'),storyline:document.querySelector('#news-storyline'),sort:document.querySelector('#news-sort')};let busy=false,reload=false,searchTimer;
 const card=(a,hero=false)=>`<article class="summary-card${hero?' news-hero':''}">${a.players?.[0]?playerPortraitMarkup(a.players[0],'league-player-portrait'):''}<h3><button data-news-article="${escapeHtml(a.id)}">${escapeHtml(a.headline)}</button></h3><p>${escapeHtml(a.category)} · ${escapeHtml(new Date(a.publishedAt).toLocaleString())}</p>${hero?'<p>'+escapeHtml(a.article.split(/(?<=[.!?])\s/).slice(0,2).join(' '))+'</p>':''}${a.correctionNotice?'<p><strong>Correction:</strong> '+escapeHtml(a.correctionNotice)+'</p>':''}</article>`;
 const options=(select,entries,label)=>{const old=select.value;select.innerHTML='<option value="">'+label+'</option>'+entries.map(([id,name])=>'<option value="'+escapeHtml(String(id))+'">'+escapeHtml(name)+'</option>').join('');select.value=old;};
 async function load(){if(busy){reload=true;return;}busy=true;try{const query=new URLSearchParams(Object.entries(controls).filter(([,v])=>v.value).map(([k,v])=>[k,v.value])),data=await requestJson('/api/league/news?'+query);options(controls.seasonId,data.seasons.map(s=>[s,'Season '+s]),'All seasons');options(controls.teamId,data.teams.map(t=>[t.teamId,t.teamName]),'All teams');options(controls.category,data.categories.map(c=>[c,c]),'All categories');options(controls.storyline,(data.storylines||[]).map(s=>[s,s]),'All storylines');options(controls.week,Array.from({length:15},(_,i)=>[i+1,'Week '+(i+1)]),'All weeks');document.querySelector('#news-featured').innerHTML=data.featured.map((a,i)=>card(a,i===0)).join('');document.querySelector('#news-headlines').innerHTML=data.articles.map(a=>card(a)).join('')||'<p>No published stories match these filters.</p>';document.querySelector('#news-trending').innerHTML=data.trending.map(a=>'<p><button data-news-article="'+escapeHtml(a.id)+'">'+escapeHtml(a.headline)+'</button></p>').join('');document.querySelector('#news-status').textContent='Staff-approved reports · Search and archive filters update the full league feed.';}catch(e){document.querySelector('#news-status').textContent=e.message;}finally{busy=false;if(reload){reload=false;load();}}}
 async function article(id){const data=await requestJson('/api/league/news?id='+encodeURIComponent(id)),a=data.article,output=document.querySelector('#news-article');output.innerHTML='<article>'+card(a,false)+'<p>'+escapeHtml(a.article)+'</p><p>Season '+escapeHtml(a.seasonId)+' · Week '+a.week+' · '+escapeHtml(a.phase)+' · '+escapeHtml(a.storyline)+'</p>'+a.players.map(p=>'<button data-news-player="'+escapeHtml(p.playerId)+'">'+escapeHtml(p.name)+'</button>').join(' ')+a.teams.map(t=>'<button data-news-team="'+escapeHtml(t.teamId)+'">'+escapeHtml(t.teamName)+'</button>').join(' ')+'<h4>Verified statistics</h4><p>'+escapeHtml(a.statistics?`${a.statistics.PTS} PTS · ${a.statistics.REB} REB · ${a.statistics.AST} AST · ${a.statistics.STL} STL · ${a.statistics.BLK} BLK · ${a.statistics.FG} FG · ${a.statistics['3PT']} 3PT · ${a.statistics.FT} FT`:'See the verified league record.')+'</p><h4>Related stories</h4>'+data.related.map(a=>card(a)).join('')+'</article>';output.scrollIntoView({block:'start'});}
 document.querySelector('#news').addEventListener('click',e=>{const a=e.target.closest('[data-news-article]'),p=e.target.closest('[data-news-player]'),t=e.target.closest('[data-news-team]');const action=a?article(a.dataset.newsArticle):p?showPlayerDetail(p.dataset.newsPlayer):t?showTeamDetail(t.dataset.newsTeam):null;action?.catch(e=>showToast(e.message));});for(const [key,c] of Object.entries(controls))c.addEventListener(key==='q'?'input':'change',()=>{if(key==='q'){clearTimeout(searchTimer);searchTimer=setTimeout(load,300);}else load();});document.querySelector('#news-refresh').addEventListener('click',load);window.addEventListener('hashchange',()=>{if(location.hash==='#news')load();});if(location.hash==='#news')load();setInterval(()=>{if(location.hash==='#news'&&!document.hidden)load();},30000);
})();
(() => {
 let busy=false;
 const matchup=s=>escapeHtml(s.team1Name)+' vs '+escapeHtml(s.team2Name);
 function detail(s){const p=s.preview;return `<article class="summary-card"><h3>${matchup(s)}</h3><p>Week ${s.week} · Season ${escapeHtml(s.seasonId)} · ${escapeHtml(s.status)}</p><p>${p.teams.map(t=>escapeHtml(t.teamName)+' '+t.wins+'-'+t.losses).join(' · ')}</p><h4>🔥 Players to watch</h4>${p.playersToWatch.map(w=>'<p>'+playerPortraitMarkup(w.player||{name:w.name},'league-player-portrait')+'<button data-stream-player="'+escapeHtml(w.playerId)+'">'+escapeHtml(w.name)+'</button> · '+w.PPG.toFixed(1)+' PTS / '+w.RPG.toFixed(1)+' REB / '+w.APG.toFixed(1)+' AST</p>').join('')||'<p>No published player statistics yet.</p>'}<h4>📊 Game breakdown</h4><p>${escapeHtml(p.breakdown)}</p><h4>🔮 Predicted winner</h4><p>${escapeHtml(p.prediction?.teamName||'Unavailable')} · ${escapeHtml(p.prediction?.reason||'')}</p><p><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">📺 Watch live</a></p>${s.status==='FINAL'?'<p>Game completed</p>':''}${s.result?.scores?'<p>Final: '+Object.entries(s.result.scores).map(([teamId,score])=>escapeHtml(teamId===s.team1Id?s.team1Name:s.team2Name)+' '+score).join(' · ')+'</p>':''}</article>`;}
 async function load(){if(busy)return;busy=true;try{const data=await requestJson('/api/league/streams'),selected=new URL(location.href).searchParams.get('gameId');document.querySelector('#streams-games').innerHTML=data.streams.map(s=>'<article class="summary-card"><h3>'+matchup(s)+'</h3><p>Week '+s.week+' · '+escapeHtml(s.status)+'</p><button data-stream-game="'+escapeHtml(s.gameId)+'">Open game page</button> <a href="'+escapeHtml(s.url)+'" target="_blank" rel="noopener noreferrer">Watch live</a></article>').join('')||'<p>No submitted game streams yet.</p>';const game=data.streams.find(s=>s.gameId===selected);document.querySelector('#streams-game-detail').innerHTML=game?detail(game):selected?'<p>This stream has not been submitted or is unavailable.</p>':'';document.querySelector('#streams-status').textContent='The home team is required to stream. Either participating coach can post the link from the game thread.';}catch(e){document.querySelector('#streams-status').textContent=e.message;}finally{busy=false;}}
 document.querySelector('#streams').addEventListener('click',e=>{const game=e.target.closest('[data-stream-game]'),p=e.target.closest('[data-stream-player]');if(game){const url=new URL(location.href);url.searchParams.set('gameId',game.dataset.streamGame);url.hash='streams';history.pushState(null,'',url);load();}if(p)showPlayerDetail(p.dataset.streamPlayer).catch(e=>showToast(e.message));});document.querySelector('#streams-refresh').addEventListener('click',load);window.addEventListener('hashchange',()=>{if(location.hash==='#streams')load();});window.addEventListener('popstate',()=>{if(location.hash==='#streams')load();});if(location.hash==='#streams')load();setInterval(()=>{if(location.hash==='#streams'&&!document.hidden)load();},15000);
})();


(() => {
 const output=document.querySelector('#launch-practice-output');
 for(const [id,endpoint]of [['launch-readiness-load','launch-readiness'],['simulation-preview-load','simulation-preview']]){
  const button=document.getElementById(id);if(!button)continue;
  button.addEventListener('click',async()=>{button.disabled=true;try{output.textContent=JSON.stringify(await adminRequestJson('/api/league/admin/'+endpoint),null,2);}catch(error){output.textContent=error.message;}finally{button.disabled=false;}});
 }
})();
