export type Nullable<T> = T | null;

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
}

export interface ScrapeFailure {
  scope: "team" | "player" | "image" | "setup";
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
  rosterDate: string;
  team: {
    name: string;
    slug: string;
    url: string;
  };
}
