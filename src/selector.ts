import type { PlaylistEntry, PriorityChannel, ValidatedEntry } from "./types.js";
import { normalizeCategory, normalizeCountry } from "./parser.js";
import { priorityIdFor } from "./priority.js";

export function dedupe(entries: PlaylistEntry[]): { entries: PlaylistEntry[]; duplicatesRemoved: number } {
  const byUrl = new Map<string, PlaylistEntry>();
  for (const entry of entries) {
    const urlKey = normalizeUrl(entry.url);
    const normalized = { ...entry, country: normalizeCountry(entry.country ?? entry.groupTitle), category: normalizeCategory(entry.category ?? entry.groupTitle) };
    const existing = byUrl.get(urlKey);
    if (!existing || (!existing.priorityId && normalized.priorityId)) byUrl.set(urlKey, normalized);
  }
  const unique = [...byUrl.values()];
  return { entries: unique, duplicatesRemoved: entries.length - unique.length };
}

export function preselect(entries: PlaylistEntry[], max = Number(process.env["IPTV_MAX_CANDIDATES"] ?? 2500)): PlaylistEntry[] {
  const allowed = [...entries].filter(isAllowed).sort((a, b) => baseScore(b) - baseScore(a) || a.name.localeCompare(b.name));
  const priorityCandidates = allowed.filter((entry) => entry.priorityId);
  const priorityKeys = new Set(priorityCandidates.map((entry) => normalizeUrl(entry.url)));
  const remainingAllowed = allowed.filter((entry) => !priorityKeys.has(normalizeUrl(entry.url)));
  const regional = remainingAllowed.filter((entry) => outputCountryRank(entry) <= 2);
  const other = remainingAllowed.filter((entry) => outputCountryRank(entry) > 2);
  return [...priorityCandidates, ...regional.slice(0, Math.floor(max * 0.6)), ...other.slice(0, Math.ceil(max * 0.4))];
}

export function select(validated: ValidatedEntry[], max = Number.MAX_SAFE_INTEGER, priorities: PriorityChannel[] = []): ValidatedEntry[] {
  const selected: ValidatedEntry[] = [];
  const usedUrls = new Set<string>();
  const usedIds = new Set<string>();
  const addOne = (item: ValidatedEntry): boolean => {
    const id = outputId(item);
    const url = normalizeUrl(item.url);
    if (selected.length >= max || usedUrls.has(url) || usedIds.has(id)) return false;
    selected.push(item);
    usedUrls.add(url);
    usedIds.add(id);
    return true;
  };
  const add = (items: ValidatedEntry[]) => {
    for (const item of items) {
      if (selected.length >= max) break;
      addOne(item);
    }
  };

  for (const priority of priorities) {
    const best = validated
      .filter((entry) => priorityIdFor(entry) === priority.id)
      .sort(compareValidated)[0];
    if (best) addOne(best);
  }

  add(validated.filter((entry) => outputCountryRank(entry) === 0).sort(compareValidated));
  add(validated.filter((entry) => outputCountryRank(entry) === 1).sort(compareValidated));
  add(validated.filter((entry) => outputCountryRank(entry) === 2).sort(compareValidated));
  add(validated.filter((entry) => outputCountryRank(entry) > 2).sort(compareValidated));
  return selected.sort((a, b) => compareOutput(a, b, priorities));
}

export function score(entry: PlaylistEntry, media?: { width?: number; height?: number }, latencyMs?: number): number {
  let value = baseScore(entry);
  if (media?.height && media.height >= 1080) value += 15;
  else if (media?.height && media.height >= 720) value += 12;
  if ((latencyMs ?? 9999) < 3000) value += 10;
  return value;
}

function baseScore(entry: PlaylistEntry): number {
  let value = 0;
  if (outputCountryRank(entry) === 0) value += 30;
  if (outputCountryRank(entry) === 1) value += 25;
  if (outputCountryRank(entry) === 2) value += 25;
  if (entry.sourceName === "manual-locked") value += 10000;
  if (entry.sourceName === "manual-fallback") value += 500;
  if (entry.sourceName === "canlitv-az" || entry.sourceName === "canlitv-az-unverified") value -= 100;
  if (entry.url.startsWith("https://")) value += 20;
  else value -= 20;
  if (entry.tvgLogo) value += 8;
  if (entry.tvgId) value += 5;
  if (outputCountryRank(entry) <= 2) value += 5;
  return value;
}

function isAllowed(entry: PlaylistEntry): boolean {
  const haystack = `${entry.name} ${entry.tvgId ?? ""} ${entry.tvgName ?? ""} ${entry.groupTitle ?? ""} ${entry.category ?? ""}`.toLocaleLowerCase("tr");
  if (/adult|xxx|nsfw|radio|webcam|camera|event|test|dublaj|vod|movie|movies|series|filim|film/.test(haystack)) return false;
  if (/\.(mp4|mkv|avi)(?:$|\?)/i.test(entry.url)) return false;
  return true;
}

function compareValidated(a: ValidatedEntry, b: ValidatedEntry): number {
  return b.score - a.score || a.name.localeCompare(b.name) || a.url.localeCompare(b.url);
}

function compareOutput(a: ValidatedEntry, b: ValidatedEntry, priorities: PriorityChannel[]): number {
  const country = outputCountryRank(a) - outputCountryRank(b);
  if (country !== 0) return country;
  const unverified = unverifiedRank(a) - unverifiedRank(b);
  if (unverified !== 0) return unverified;
  const priority = priorityRank(a, priorities) - priorityRank(b, priorities);
  if (priority !== 0) return priority;
  const category = categoryRank(a.category) - categoryRank(b.category);
  if (category !== 0) return category;
  return b.score - a.score || a.name.localeCompare(b.name);
}

function priorityRank(entry: ValidatedEntry, priorities: PriorityChannel[]): number {
  if (!entry.priorityId) return Number.MAX_SAFE_INTEGER;
  const priority = priorities.find((item) => item.id === entry.priorityId);
  return priority?.priority ?? entry.priorityOrder ?? Number.MAX_SAFE_INTEGER;
}

function unverifiedRank(entry: ValidatedEntry): number {
  return entry.sourceName === "canlitv-az-unverified" ? 1 : 0;
}

function outputCountryRank(entry: PlaylistEntry): number {
  return Math.min(countryRank(entry.country), countryRank(entry.groupTitle));
}

function countryRank(country?: string): number {
  const normalized = (country ?? "")
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0259\u018f]/g, "e")
    .replace(/[\u0131\u0130]/g, "i")
    .replace(/[\u00fc\u00dc]/g, "u");
  if (/azerbaycan|^az$/.test(normalized)) return 0;
  if (/turkiye|^tr$/.test(normalized)) return 1;
  if (/rusiya|^ru$/.test(normalized)) return 2;
  return 3;
}

function categoryRank(category?: string): number {
  return ["General", "News", "Sports", "Documentary", "Children", "Movies", "Music", "Culture", "Education", "Other"].indexOf(category ?? "Other");
}

function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of ["utm_source", "utm_medium", "utm_campaign"]) url.searchParams.delete(key);
    return url.toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function outputId(entry: PlaylistEntry): string {
  return entry.priorityId ?? entry.tvgId ?? entry.name.toLocaleLowerCase("tr");
}
