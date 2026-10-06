import fs from "node:fs";
import path from "node:path";
import { load } from "cheerio";

import { BASE_URL } from "./selectors";

export function ensureDir(directory: string): void {
  fs.mkdirSync(directory, { recursive: true });
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function slugify(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function absolutizeUrl(input: string): string {
  if (!input) return input;
  return new URL(input, BASE_URL).toString();
}

export function canonicalPlayerUrl(url: string): string {
  const next = new URL(absolutizeUrl(url));
  next.hash = "";
  next.search = "";
  return next.toString().replace(/\/+$/, "");
}

export function extractSlug(url: string): string {
  const pathname = new URL(absolutizeUrl(url)).pathname.replace(/\/+$/, "");
  return pathname.split("/").filter(Boolean).pop() || "";
}

export function parseFeetInches(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/(\d+)\s*'\s*(\d{1,2})/);
  if (!match) return null;
  const feet = Number(match[1]);
  const inches = Number(match[2]);
  if (Number.isNaN(feet) || Number.isNaN(inches)) return null;
  const normalizedFeet = feet + Math.floor(inches / 12);
  const normalizedInches = inches % 12;
  return `${normalizedFeet}'${normalizedInches}"`;
}

export function parseInteger(value: string | null): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/-?\d+/);
  return match ? Number(match[0]) : null;
}

export function parseNumber(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return normalized ? Number(normalized[0]) : null;
}

export function maybeNull(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (["n/a", "na", "-", "--"].includes(normalized.toLowerCase())) return null;
  return normalized;
}

export function findLabelValue(html: string, label: string): string | null {
  const $ = load(html);
  const matcher = label.toLowerCase();

  const nodes = $(["p", "li", "div", "span", "td", "th", "strong", "b"].join(","));
  for (const node of nodes.toArray()) {
    const text = $(node).text().replace(/\s+/g, " ").trim();
    if (!text) continue;
    const lowered = text.toLowerCase();
    if (!lowered.startsWith(matcher)) continue;

    const direct = text.replace(new RegExp(`^${label}\\s*:?\\s*`, "i"), "").trim();
    if (direct) return direct;

    const next = $(node).next();
    const nextText = next.text().replace(/\s+/g, " ").trim();
    if (nextText) return nextText;
  }

  return null;
}

export function pickBestPortrait(imageUrls: string[], playerSlug: string): string | null {
  const normalizedSlug = slugify(playerSlug);
  const filtered = imageUrls.filter((url) => {
    const lowered = url.toLowerCase();
    if (lowered.includes("flag")) return false;
    if (lowered.includes("logo")) return false;
    if (lowered.includes("icon")) return false;
    if (lowered.includes("advert")) return false;
    if (lowered.includes("/1x1.")) return false;
    return lowered.includes(normalizedSlug) || lowered.includes("-2k-rating") || lowered.includes("/players/") || lowered.includes("/player/");
  });

  const sorted = filtered.sort((a, b) => {
    const aScore = (a.toLowerCase().includes("-2k-rating") ? 10 : 0) + (a.toLowerCase().endsWith(".png") ? 3 : 0);
    const bScore = (b.toLowerCase().includes("-2k-rating") ? 10 : 0) + (b.toLowerCase().endsWith(".png") ? 3 : 0);
    return bScore - aScore;
  });

  return sorted[0] || filtered[0] || imageUrls[0] || null;
}
