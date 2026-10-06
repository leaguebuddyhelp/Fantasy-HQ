import fs from "node:fs";
import path from "node:path";

import { load } from "cheerio";
import { Browser, BrowserContext, chromium, Page, Response } from "playwright";

import {
  CHECKPOINT_PATH,
  CURRENT_TEAMS_URL,
  DATA_ROOT,
  FAILURE_LOG_PATH,
  FREE_AGENCY_DIR,
  FREE_AGENCY_URL,
  IMAGE_DIR,
  MAX_RETRIES,
  NAVIGATION_TIMEOUT_MS,
  PLAYER_CONCURRENCY,
  PLAYERS_OUTPUT_PATH,
  REQUEST_DELAY_MS,
  ROSTERS_DIR,
  SELECTORS,
  TEAM_CONCURRENCY,
  USER_AGENT,
} from "./selectors";
import type {
  CheckpointData,
  PlayerRecord,
  RosterPlayerLink,
  ScrapePayload,
  ScrapeFailure,
  ScrapeOptions,
  TeamLink,
  TeamRosterPayload,
} from "./types";
import {
  absolutizeUrl,
  canonicalPlayerUrl,
  ensureDir,
  extractSlug,
  findLabelValue,
  maybeNull,
  parseFeetInches,
  parseInteger,
  pickBestPortrait,
  readJsonFile,
  sleep,
  slugify,
  writeJsonFile,
} from "./utils";

const defaultCheckpoint: CheckpointData = {
  scrapedAt: "",
  completedTeamSlugs: [],
  completedPlayerUrls: [],
  players: [],
  failures: [],
};

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const executing = new Set<Promise<void>>();

  for (const item of items) {
    const task = worker(item)
      .catch(() => {})
      .finally(() => {
        executing.delete(task);
      });
    executing.add(task);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
}

function parseArgs(argv: string[]): ScrapeOptions {
  const options: ScrapeOptions = { resume: false, player: null, team: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--resume") options.resume = true;
    else if (arg === "--player") options.player = argv[index + 1] || null;
    else if (arg === "--team") options.team = argv[index + 1] || null;
  }
  return options;
}

function makeFailure(scope: ScrapeFailure["scope"], target: string, error: unknown): ScrapeFailure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    scope,
    target,
    message,
    at: new Date().toISOString(),
  };
}

function parseMetricInParens(value: string | null, unit: "cm" | "kg"): number | null {
  if (!value) return null;
  const match = value.match(new RegExp(`\\((\\d+)\\s*${unit}\\)`, "i"));
  return match ? Number(match[1]) : null;
}

function findValueInText(bodyText: string, labels: string[]): string | null {
  for (const label of labels) {
    const match = bodyText.match(new RegExp(`(?:^|\\n)\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^\\n]+)`, "i"));
    const value = maybeNull(match?.[1] ?? null);
    if (value) return value;
  }
  return null;
}

function getRosterDate(scrapedAt: string): string {
  return scrapedAt.slice(0, 10);
}

function sortPlayersByOverall(players: PlayerRecord[]): PlayerRecord[] {
  return players.slice().sort((left, right) => {
    const leftOverall = left.overall ?? -1;
    const rightOverall = right.overall ?? -1;
    if (rightOverall !== leftOverall) return rightOverall - leftOverall;
    return left.name.localeCompare(right.name);
  });
}

const FREE_AGENCY_TEAM: TeamLink = {
  name: "Free Agency",
  slug: "free-agency",
  url: FREE_AGENCY_URL,
};

class TwoKRatingsScraper {
  private browser: Browser | null = null;

  private context: BrowserContext | null = null;

  private readonly checkpoint: CheckpointData;

  private readonly options: ScrapeOptions;

  constructor(options: ScrapeOptions) {
    this.options = options;
    this.checkpoint = options.resume ? readJsonFile(CHECKPOINT_PATH, defaultCheckpoint) : structuredClone(defaultCheckpoint);
  }

  async run(): Promise<ScrapePayload> {
    ensureDir(DATA_ROOT);
    ensureDir(IMAGE_DIR);
    ensureDir(ROSTERS_DIR);
    ensureDir(FREE_AGENCY_DIR);

    await this.start();
    try {
      if (this.options.player && !this.options.team) {
        const record = await this.scrapePlayer({
          name: this.options.player,
          slug: slugify(this.options.player),
          team: "",
          teamSlug: "",
          url: absolutizeUrl(`/${this.options.player}`),
        });

        this.checkpoint.players = [record];
        this.checkpoint.completedPlayerUrls = [canonicalPlayerUrl(record.profileUrl)];
        this.persistCheckpoint();

        const payload: ScrapePayload = {
          scrapedAt: new Date().toISOString(),
          playerCount: 1,
          players: [record],
        };
        writeJsonFile(PLAYERS_OUTPUT_PATH, payload);
        writeJsonFile(FAILURE_LOG_PATH, this.checkpoint.failures);
        return payload;
      }

      const teams = await this.discoverTeams();
      const filteredTeams = this.filterTeams(teams);
      await runWithConcurrency(filteredTeams, TEAM_CONCURRENCY, async (team) => {
        if (this.checkpoint.completedTeamSlugs.includes(team.slug) && !this.options.player) return;
        await this.scrapeTeam(team);
        if (!this.options.player && !this.checkpoint.completedTeamSlugs.includes(team.slug)) {
          this.checkpoint.completedTeamSlugs.push(team.slug);
          this.persistCheckpoint();
        }
      });

      const payload: ScrapePayload = {
        scrapedAt: new Date().toISOString(),
        playerCount: this.checkpoint.players.length,
        players: sortPlayersByOverall(this.checkpoint.players),
      };

      writeJsonFile(PLAYERS_OUTPUT_PATH, payload);
      writeJsonFile(FAILURE_LOG_PATH, this.checkpoint.failures);
      await this.writeRosterOutputs(filteredTeams, payload);
      this.checkpoint.scrapedAt = payload.scrapedAt;
      this.persistCheckpoint();
      return payload;
    } finally {
      await this.stop();
    }
  }

  private async start(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1440, height: 2200 },
    });
    this.context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    this.context.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);
  }

  private async stop(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }

  private persistCheckpoint(): void {
    writeJsonFile(CHECKPOINT_PATH, this.checkpoint);
  }

  private async writeRosterOutputs(teams: TeamLink[], payload: ScrapePayload): Promise<void> {
    const rosterDate = getRosterDate(payload.scrapedAt);

    for (const team of teams) {
      const teamPlayers = sortPlayersByOverall(
        payload.players.filter((player) => canonicalPlayerUrl(player.profileUrl) && this.playerBelongsToTeam(player, team)),
      );
      if (!teamPlayers.length) continue;

      const rosterPayload: TeamRosterPayload = {
        scrapedAt: payload.scrapedAt,
        rosterDate,
        team: {
          name: team.name,
          slug: team.slug,
          url: team.url,
        },
        playerCount: teamPlayers.length,
        players: teamPlayers,
      };

      writeJsonFile(this.teamRosterPath(team.slug, rosterDate), rosterPayload);
    }
  }

  private playerBelongsToTeam(player: PlayerRecord, team: TeamLink): boolean {
    const playerTeam = slugify(player.team || "");
    const teamSlug = slugify(team.slug);
    const teamName = slugify(team.name);
    if (team.slug === FREE_AGENCY_TEAM.slug) {
      return playerTeam === "free-agency" || playerTeam === "free-agent" || playerTeam === "free-agents";
    }
    return playerTeam === teamSlug || playerTeam.startsWith(`${teamSlug}-`) || playerTeam === teamName || playerTeam.startsWith(`${teamName}-`);
  }

  private teamRosterPath(teamSlug: string, rosterDate: string): string {
    if (teamSlug === FREE_AGENCY_TEAM.slug) {
      return path.join(FREE_AGENCY_DIR, rosterDate, `${teamSlug}.json`);
    }
    return path.join(ROSTERS_DIR, rosterDate, `${teamSlug}.json`);
  }

  private filterTeams(teams: TeamLink[]): TeamLink[] {
    if (!this.options.team) return teams;
    const target = slugify(this.options.team);
    return teams.filter((team) => team.slug === target || slugify(team.name) === target);
  }

  private async createPage(): Promise<Page> {
    if (!this.context) throw new Error("Browser context is not initialized.");
    return this.context.newPage();
  }

  private async navigate(page: Page, url: string): Promise<Response | null> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
        await sleep(REQUEST_DELAY_MS);
        return response;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_RETRIES) {
          await sleep(REQUEST_DELAY_MS * attempt);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async withPage<T>(callback: (page: Page) => Promise<T>): Promise<T> {
    const page = await this.createPage();
    try {
      return await callback(page);
    } finally {
      await page.close();
    }
  }

  private async discoverTeams(): Promise<TeamLink[]> {
    return this.withPage(async (page) => {
      await this.navigate(page, CURRENT_TEAMS_URL);
      const html = await page.content();
      const $ = load(html);
      const teams = new Map<string, TeamLink>();

      $(SELECTORS.currentTeams.teamLinks).each((_, element) => {
        const href = $(element).attr("href");
        const name = maybeNull($(element).text());
        if (!href || !name) return;

        const absoluteUrl = absolutizeUrl(href);
        const url = new URL(absoluteUrl);
        if (!url.pathname.startsWith("/teams/")) return;
        const slug = url.pathname.split("/").filter(Boolean).pop();
        if (!slug || slug === "current-teams") return;
        teams.set(slug, { name, slug, url: absoluteUrl });
      });

      teams.set(FREE_AGENCY_TEAM.slug, FREE_AGENCY_TEAM);

      return [...teams.values()].sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  private async scrapeTeam(team: TeamLink): Promise<void> {
    try {
      const players = await this.discoverRoster(team);
      const filteredPlayers = this.filterPlayers(players);
      await runWithConcurrency(filteredPlayers, PLAYER_CONCURRENCY, async (player) => {
        const canonicalUrl = canonicalPlayerUrl(player.url);
        if (this.checkpoint.completedPlayerUrls.includes(canonicalUrl)) return;

        try {
          const record = await this.scrapePlayer(player);
          if (!this.checkpoint.players.some((existing) => canonicalPlayerUrl(existing.profileUrl) === canonicalUrl)) {
            this.checkpoint.players.push(record);
          }
          this.checkpoint.completedPlayerUrls.push(canonicalUrl);
          this.persistCheckpoint();
        } catch (error) {
          this.checkpoint.failures.push(makeFailure("player", canonicalUrl, error));
          this.persistCheckpoint();
        }
      });
    } catch (error) {
      this.checkpoint.failures.push(makeFailure("team", team.url, error));
      this.persistCheckpoint();
    }
  }

  private filterPlayers(players: RosterPlayerLink[]): RosterPlayerLink[] {
    if (!this.options.player) return players;
    const target = slugify(this.options.player);
    return players.filter((player) => player.slug === target || slugify(player.name) === target);
  }

  private async discoverRoster(team: TeamLink): Promise<RosterPlayerLink[]> {
    return this.withPage(async (page) => {
      await this.navigate(page, team.url);
      const html = await page.content();
      const $ = load(html);
      const players = new Map<string, RosterPlayerLink>();

      $(SELECTORS.teamPage.rosterLinks).each((_, element) => {
        const href = $(element).attr("href");
        const text = maybeNull($(element).text());
        if (!href || !text) return;

        const absoluteUrl = absolutizeUrl(href);
        const url = new URL(absoluteUrl);
        const segments = url.pathname.split("/").filter(Boolean);
        if (segments.length !== 1) return;
        const slug = segments[0];
        if (!slug || slug === "current-teams") return;
        if (slug.startsWith("nba-2k")) return;
        if (slug === team.slug) return;
        if (text.length < 4) return;
        if (!/\s/.test(text)) return;
        if (text.toLowerCase().includes("2k")) return;

        players.set(canonicalPlayerUrl(absoluteUrl), {
          name: text,
          slug: extractSlug(absoluteUrl),
          team: team.name,
          teamSlug: team.slug,
          url: absoluteUrl,
        });
      });

      return [...players.values()].sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  private async scrapePlayer(player: RosterPlayerLink): Promise<PlayerRecord> {
    return this.withPage(async (page) => {
      await this.navigate(page, player.url);
      const html = await page.content();
      const bodyText = await page.locator("body").innerText();
      const titleText = await page.title();
      const $ = load(html);

      const name = maybeNull($(SELECTORS.playerPage.title).first().text()) || player.name;
      const profileUrl = canonicalPlayerUrl(page.url());

      const pageText = bodyText.replace(/\s+/g, " ").trim();
      const overall = this.extractOverall($, pageText, bodyText);
      const team = findValueInText(bodyText, ["Team"]) || this.findValue(html, ["Team"]) || player.team;
      const nationality = findValueInText(bodyText, ["Nationality", "Country"]) || this.findValue(html, ["Nationality", "Country"]);
      const jerseyNumber = parseInteger(findValueInText(bodyText, ["Jersey Number", "Jersey"]) || this.findValue(html, ["Jersey Number", "Jersey"]));
      const positionText = findValueInText(bodyText, ["Position", "Primary Position"]) || this.findValue(html, ["Position", "Primary Position"]) || this.extractPositionFromTitle(titleText);
      const [position1, position2] = this.parsePositions(positionText, findValueInText(bodyText, ["Secondary Position"]) || this.findValue(html, ["Secondary Position"]));
      const archetype = findValueInText(bodyText, ["Archetype"]) || this.findValue(html, ["Archetype"]);
      const heightRaw = findValueInText(bodyText, ["Height"]) || this.findValue(html, ["Height"]);
      const weightRaw = findValueInText(bodyText, ["Weight", "Weight (lbs)", "Weight Lbs"]) || this.findValue(html, ["Weight", "Weight (lbs)", "Weight Lbs"]);
      const wingspanRaw = findValueInText(bodyText, ["Wingspan"]) || this.findValue(html, ["Wingspan"]);
      const height = parseFeetInches(heightRaw);
      const heightCm = parseInteger(findValueInText(bodyText, ["Height (cm)", "Height Cm"]) || this.findValue(html, ["Height (cm)", "Height Cm"])) ?? parseMetricInParens(heightRaw, "cm");
      const weightLbs = parseInteger(weightRaw);
      const wingspan = parseFeetInches(wingspanRaw);
      const yearsInNBA = parseInteger(findValueInText(bodyText, ["Year(s) in the NBA", "Years in NBA", "Years Pro"]) || this.findValue(html, ["Year(s) in the NBA", "Years in NBA", "Years Pro"]));
      const birthdate = findValueInText(bodyText, ["Birthdate", "Born"]) || this.findValue(html, ["Birthdate", "Born"]);
      const priorToNBA = findValueInText(bodyText, ["Prior to NBA", "College", "From"]) || this.findValue(html, ["Prior to NBA", "College", "From"]);
      const imageUrl = await this.extractPortraitUrl(page, $, player.slug);

      if (imageUrl) {
        try {
          await this.downloadImage(imageUrl, player.slug);
        } catch (error) {
          this.checkpoint.failures.push(makeFailure("image", imageUrl, error));
        }
      }

      return {
        name,
        overall,
        nationality,
        team,
        jerseyNumber,
        position1,
        position2,
        archetype,
        height,
        heightCm,
        weightLbs,
        wingspan,
        yearsInNBA,
        birthdate,
        priorToNBA,
        profileUrl,
        imageUrl,
      };
    });
  }

  private extractOverall($: ReturnType<typeof load>, pageText: string, bodyText: string): number | null {
    const titleBlock = $("h1, h2, .badge, .pill, .rating").slice(0, 12).text();
    const combined = `${titleBlock}\n${bodyText}\n${pageText}`;
    const matches = [
      combined.match(/\b(\d{2})\s*OVR\b/i),
      combined.match(/\bOVR\s*(\d{2})\b/i),
      combined.match(/\b(\d{2})\s*OVERALL\b/i),
      combined.match(/\bRating is\s+(\d{2})\b/i),
      combined.match(/\bNBA 2K\d+\s+(\d{2})\b/i),
    ].filter(Boolean) as RegExpMatchArray[];
    return matches.length ? Number(matches[0][1]) : null;
  }

  private findValue(html: string, labels: string[]): string | null {
    for (const label of labels) {
      const result = maybeNull(findLabelValue(html, label));
      if (result) return result;
    }
    return null;
  }

  private extractPositionFromTitle(title: string): string | null {
    const match = title.match(/\b(PG|SG|SF|PF|C)(?:\/(PG|SG|SF|PF|C))?\b/);
    return match ? match[0] : null;
  }

  private parsePositions(primary: string | null, secondary: string | null): [string | null, string | null] {
    const tokens = [primary, secondary]
      .filter(Boolean)
      .flatMap((value) => String(value).split(/[\/,]/))
      .map((value) => value.trim().toUpperCase())
      .filter((value) => ["PG", "SG", "SF", "PF", "C"].includes(value));

    return [tokens[0] || null, tokens[1] || null];
  }

  private async extractPortraitUrl(page: Page, $: ReturnType<typeof load>, playerSlug: string): Promise<string | null> {
    const profilePhotoUrl = await page.locator(".profile-photo").first().evaluate((image) => {
      if (!(image instanceof HTMLImageElement)) return "";
      return image.getAttribute("src")
        || image.getAttribute("data-src")
        || image.getAttribute("data-lazy-src")
        || image.currentSrc
        || "";
    }).catch(() => "");

    const htmlCandidates = $(SELECTORS.playerPage.images).toArray()
      .map((image) => $(image).attr("src"))
      .filter(Boolean)
      .map((src) => absolutizeUrl(src as string));

    const liveCandidates = await page.locator("img").evaluateAll((images) =>
      images
        .map((image) =>
          image.getAttribute("src")
          || image.getAttribute("data-src")
          || image.getAttribute("data-lazy-src")
          || (image instanceof HTMLImageElement ? image.currentSrc : "")
          || "",
        )
        .filter(Boolean),
    );

    const candidates = [...new Set([
      ...[profilePhotoUrl].filter(Boolean).map((url) => absolutizeUrl(url)),
      ...htmlCandidates,
      ...liveCandidates.map((url) => absolutizeUrl(url)),
    ])];
    return pickBestPortrait(candidates, playerSlug);
  }

  private async downloadImage(url: string, playerSlug: string): Promise<void> {
    if (!this.context) throw new Error("Browser context is not initialized.");
    const response = await this.context.request.get(url, {
      headers: { referer: CURRENT_TEAMS_URL },
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    if (!response.ok()) {
      throw new Error(`Image download failed with status ${response.status()}`);
    }

    const extension = this.extensionFor(url, response.headers()["content-type"]);
    const filePath = path.join(IMAGE_DIR, `${playerSlug}.${extension}`);
    const buffer = Buffer.from(await response.body());
    fs.writeFileSync(filePath, buffer);
  }

  private extensionFor(url: string, contentType?: string): string {
    const urlExtension = path.extname(new URL(url).pathname).replace(/^\./, "").trim();
    if (urlExtension) return urlExtension;
    if (!contentType) return "bin";
    if (contentType.includes("png")) return "png";
    if (contentType.includes("jpeg")) return "jpg";
    if (contentType.includes("webp")) return "webp";
    return "bin";
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const scraper = new TwoKRatingsScraper(options);
  const result = await scraper.run();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
