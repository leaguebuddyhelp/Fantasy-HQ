export type Nullable<T> = T | null;

export interface ContractSeason {
  season: string;
  salary: Nullable<number>;
  option: 'PLAYER' | 'TEAM' | null;
}
export interface PlayerContract {
  source: 'basketball-reference';
  sourceUrl: string;
  playerUrl: string;
  fetchedAt: string;
  currency: 'USD';
  seasons: ContractSeason[];
  guaranteedTotal: Nullable<number>;
}
export interface PayrollSnapshot {
  sourceUrl: string;
  fetchedAt: string;
  seasons: string[];
  players: { name: string; contract: PlayerContract }[];
  teamTotals: ContractSeason[];
  status: 'CURRENT' | 'STALE';
  error?: string;
  unmatchedRosterPlayers?: string[];
}

export interface PlayerRecord {
  name: string;
  overall: Nullable<number>;
  nationality: Nullable<string>;
  team: Nullable<string>;
  jerseyNumber: Nullable<number>;
  position1: Nullable<string>;
  position2: Nullable<string>;
  archetype: Nullable<string>;
  height: Nullable<string>;
  heightCm: Nullable<number>;
  weightLbs: Nullable<number>;
  wingspan: Nullable<string>;
  yearsInNBA: Nullable<number>;
  birthdate: Nullable<string>;
  priorToNBA: Nullable<string>;
  profileUrl: string;
  imageUrl: Nullable<string>;
  contract?: PlayerContract;
}

export interface TeamLink {
  name: string;
  slug: string;
  url: string;
}

export interface RosterPlayerLink {
  name: string;
  slug: string;
  team: string;
  teamSlug: string;
  url: string;
}

export interface CheckpointData {
  scrapedAt: string;
  completedTeamSlugs: string[];
  completedPlayerUrls: string[];
  players: PlayerRecord[];
  failures: ScrapeFailure[];
  teamPayrolls?: Record<string, PayrollSnapshot>;
}

export interface ScrapeFailure {
  scope: "team" | "player" | "image" | "setup" | "contract";
  target: string;
  message: string;
  at: string;
}

export interface ScrapeOptions {
  team?: string | null;
  player?: string | null;
  resume?: boolean;
}

export interface ScrapePayload {
  scrapedAt: string;
  playerCount: number;
  players: PlayerRecord[];
}

export interface TeamRosterPayload extends ScrapePayload {
  payroll?: PayrollSnapshot;
  rosterDate: string;
  team: {
    name: string;
    slug: string;
    url: string;
  };
}
