export const SELECTORS = {
  currentTeams: {
    teamLinks: "a[href]",
  },
  teamPage: {
    rosterLinks: "a.player-name",
  },
  playerPage: {
    title: "h1",
    ratingBadges: ".badge, .pill, .attribute-box, .rating-box, [class*='rating'], [class*='badge']",
    infoRows: "p, li, div, span, td, th",
    images: "img",
  },
} as const;

export const BASE_URL = "https://www.2kratings.com";
export const CURRENT_TEAMS_URL = `${BASE_URL}/current-teams`;
export const FREE_AGENCY_URL = `${BASE_URL}/teams/free-agency`;
export const DATA_ROOT = "data/2kratings";
export const PLAYERS_OUTPUT_PATH = `${DATA_ROOT}/players/current.json`;
export const ROSTERS_DIR = `${DATA_ROOT}/rosters`;
export const FREE_AGENCY_DIR = `${DATA_ROOT}/free-agency`;
export const CHECKPOINT_PATH = `${DATA_ROOT}/checkpoints/scrape-checkpoint.json`;
export const FAILURE_LOG_PATH = `${DATA_ROOT}/logs/failures.json`;
export const IMAGE_DIR = `${DATA_ROOT}/images`;
export const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
export const NAVIGATION_TIMEOUT_MS = 45_000;
export const REQUEST_DELAY_MS = 1200;
export const MAX_RETRIES = 3;
export const TEAM_CONCURRENCY = 1;
export const PLAYER_CONCURRENCY = 2;
