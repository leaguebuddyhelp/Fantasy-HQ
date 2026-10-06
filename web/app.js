window.localStorage.removeItem("leaguebuddyAdminKey");

const state = {
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

function closeMobileNavigation(restoreFocus = false) {
  elements.primaryNav.dataset.open = "false";
  elements.mobileNavToggle.setAttribute("aria-expanded", "false");
  if (restoreFocus) elements.mobileNavToggle.focus();
}

elements.mobileNavToggle.addEventListener("click", () => {
  const open = elements.mobileNavToggle.getAttribute("aria-expanded") !== "true";
  elements.mobileNavToggle.setAttribute("aria-expanded", String(open));
  elements.primaryNav.dataset.open = String(open);
});
elements.primaryNav.addEventListener("click", event => {
  if (event.target.closest("a")) closeMobileNavigation();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && elements.mobileNavToggle.getAttribute("aria-expanded") === "true") closeMobileNavigation(true);
});
document.addEventListener("click", event => {
  if (elements.mobileNavToggle.getAttribute("aria-expanded") === "true" && !event.target.closest(".site-header")) closeMobileNavigation();
});
window.addEventListener("resize", () => {
  if (window.innerWidth > 820) closeMobileNavigation();
});

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
  elements.classSwitcher.innerHTML = classLabels().map((label) => {
    const active = label === state.classLabel;
    return `<button type="button" role="tab" class="${active ? "active" : ""}" data-class="${escapeHtml(label)}" aria-selected="${active}">${escapeHtml(shortClassLabel(label))}<small>Draft class</small></button>`;
  }).join("");
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
    if (state.playerTeam === "free-agents" ? Boolean(player.teamId) : state.playerTeam && player.teamId !== state.playerTeam) return false;
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
    return matchesTeam && matchesConference && matchesSearch;
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
  elements.leagueStatsStatus.textContent = `${state.leagueStats.length} players · Official regular-season games only${warningCount ? ` · ${warningCount} invalid game-stat rows excluded` : ''}`;
}

async function loadLeagueStats(force = false) {
  if (state.leagueStatsLoading || (state.leagueStatsLoaded && !force)) { if (state.leagueStatsLoaded) renderLeagueStats(); return; }
  state.leagueStatsLoading = true;
  elements.leagueStatsStatus.textContent = 'Loading official player statistics…';
  try {
    const payload = await requestJson('/api/league/stats');
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
    state.statsGameLogs.set(playerId, await requestJson(`/api/league/stats/players/${encodeURIComponent(playerId)}/games`));
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
  elements.teamStatsStatus.textContent = `${teams.length} teams · Official regular-season games only${warnings ? ` · ${warnings} invalid team-stat rows excluded` : ''}`;
}

async function loadTeamStats(force = false) {
  if (state.teamStatsLoading || (state.teamStatsLoaded && !force)) { if (state.teamStatsLoaded) renderTeamStats(); return; }
  state.teamStatsLoading = true;
  elements.teamStatsStatus.textContent = 'Loading official team statistics…';
  try {
    const payload = await requestJson('/api/league/team-stats');
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
  try { state.teamGameLogs.set(teamId, await requestJson(`/api/league/team-stats/${encodeURIComponent(teamId)}/games`)); }
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
  if (!state.playerDetailCache.has(playerId)) {
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
          <h3>Roster</h3>
          <div class="detail-list">
            ${(team.roster || []).map((entry) => `
              <button type="button" class="detail-list-row" data-dialog-player="${escapeHtml(entry.player.playerId)}">
                <span>${escapeHtml(entry.player.name)}</span>
                <small>${escapeHtml(positionLabel(entry))} · ${escapeHtml(entry.jerseyNumber ?? "--")} · ${escapeHtml(entry.player.overall ?? "—")} OVR</small>
                <small>Age ${entry.player.age ?? "—"} · Trade Value ${Number(entry.player.tradeValue || 1).toLocaleString("en-US")}</small>
                <small>${escapeHtml(seasonStatLine(entry.seasonStats))}</small>
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

function readonlyPlayerFacts(player) {
  return `
    <div class="league-facts">
      ${fact("Team", player.teamName)}
      ${fact("OVR", player.overall)}
      ${fact("Age", player.age)}
      ${fact("Trade Value", Number(player.tradeValue || 1).toLocaleString("en-US"))}
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
    </div>`;
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
              <td><strong>${escapeHtml(entry.player.name)}</strong><small>${escapeHtml(entry.player.nationality || "N/A")}</small><small>Age ${escapeHtml(entry.player.age ?? "—")} · Trade Value ${Number(entry.player.tradeValue || 1).toLocaleString("en-US")}</small><small>${escapeHtml(seasonStatLine(entry.seasonStats))}</small></td>
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
  const matchedEntry = state.boards.flatMap((board) => board.classes)
    .find((item) => item.file === selection || item.label === selection);
  state.classLabel = labels.includes(selection) ? selection : matchedEntry?.label || labels[0];
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
  url.searchParams.set("class", state.classLabel);
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

elements.classSwitcher.addEventListener("click", (event) => {
  const button = event.target.closest("[data-class]");
  if (!button || button.dataset.class === state.classLabel) return;
  closeProfile(false);
  loadDraftClass(button.dataset.class);
});

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

elements.validatePreseasonButton.addEventListener("click", async () => {
  try {
    setPanelMessage(elements.preseasonValidationOutput, "Running preseason validation…");
    await runPreseasonValidation();
  } catch (error) {
    setPanelMessage(elements.preseasonValidationOutput, error.message);
  }
});

elements.startSeasonButton.addEventListener("click", async () => {
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
  if (event.target.closest("[data-cancel-start-season]")) {
    elements.preseasonValidationOutput.innerHTML = '<p class="inline-status">Season start cancelled.</p>';
    elements.startSeasonButton.focus();
    return;
  }
  const confirmButton = event.target.closest("[data-confirm-start-season]");
  if (!confirmButton) return;
  try {
    confirmButton.disabled = true;
    setPanelMessage(elements.preseasonValidationOutput, 'Checking readiness and starting the season…');
    await startRegularSeason();
    await loadAdminWorkflow();
  } catch (error) {
    setPanelMessage(elements.preseasonValidationOutput, error.message);
  } finally { elements.startSeasonButton.disabled = false; }
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
  const draftClass = url.searchParams.get("class");
  if (draftClass !== state.classLabel) {
    await loadDraftClass(draftClass);
    return;
  }
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

async function refreshStandings() {
  const label = document.querySelector('#standings-week'), container = document.querySelector('#standings-tables');
  try {
    const data = await requestJson('/api/league/standings');
    label.textContent = `${data.currentWeek ? 'Week ' + data.currentWeek : 'Season not started'} · ${data.countedGames} official games`;
    container.innerHTML = ['East', 'West'].map(conference => `<section class="admin-panel"><h3>${conference === 'East' ? 'EASTERN' : 'WESTERN'} CONFERENCE</h3><div class="standings-scroll"><table class="standings-table"><thead><tr>${['Rank', 'Team', 'GP', 'W', 'L', 'PCT', 'PF', 'PA', 'DIFF'].map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${data.conferences[conference].map(team => `<tr><td>${team.rank}</td><td><button type="button" data-standings-team="${escapeHtml(team.teamId)}">${teamLogoMarkup(team.teamName)}${escapeHtml(team.teamName)}</button></td>${['GP', 'W', 'L', 'PCT', 'PF', 'PA', 'DIFF'].map(k => `<td>${k === 'PCT' ? team.PCT.toFixed(3).replace(/^0\./, '.') : k === 'DIFF' && team.DIFF > 0 ? '+' + team.DIFF : team[k]}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`).join('');
  } catch (error) { label.textContent = error.message; container.replaceChildren(); }
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
  if (elements.rosterTeamSelect.value) await loadRosterManager().catch(error => setPanelMessage(elements.rosterManager, error.message));
}
const commissionerName = document.querySelector('#admin-operator');
commissionerName.value = sessionStorage.getItem('leaguebuddyReviewOperator') || '';
commissionerName.addEventListener('input', () => sessionStorage.setItem('leaguebuddyReviewOperator', commissionerName.value));
elements.adminKey.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); elements.adminKeySave.click(); } });
elements.rosterTeamSelect.addEventListener('change', () => loadRosterManager().catch(error => setPanelMessage(elements.rosterManager, error.message)));
