import type { PlaylistEntry, ValidatedEntry } from "./types.js";
import { normalizeCategory, normalizeCountry } from "./parser.js";

export function dedupe(entries: PlaylistEntry[]): { entries: PlaylistEntry[]; duplicatesRemoved: number } {
  const seenUrls = new Set<string>();
  const seenChannels = new Set<string>();
  const unique: PlaylistEntry[] = [];
  for (const entry of entries) {
    const urlKey = normalizeUrl(entry.url);
    const channelKey = `${entry.tvgId || ""}|${entry.name.toLocaleLowerCase()}|${normalizeCountry(entry.country ?? entry.groupTitle)}`;
    if (seenUrls.has(urlKey) || seenChannels.has(channelKey)) continue;
    seenUrls.add(urlKey);
    seenChannels.add(channelKey);
    unique.push({ ...entry, country: normalizeCountry(entry.country ?? entry.groupTitle), category: normalizeCategory(entry.category ?? entry.groupTitle) });
  }
  return { entries: unique, duplicatesRemoved: entries.length - unique.length };
}

export function preselect(entries: PlaylistEntry[], max = Number(process.env["IPTV_MAX_CANDIDATES"] ?? 1200)): PlaylistEntry[] {
  const allowed = [...entries].filter(isAllowed).sort((a, b) => baseScore(b) - baseScore(a) || a.name.localeCompare(b.name));
  const priority = allowed.filter((entry) => ["Azərbaycan", "Türkiyə", "Rusiya"].includes(entry.country ?? ""));
  const other = allowed.filter((entry) => !["Azərbaycan", "Türkiyə", "Rusiya"].includes(entry.country ?? ""));
  return [...priority.slice(0, Math.floor(max * 0.45)), ...other.slice(0, Math.ceil(max * 0.55))];
}

export function select(validated: ValidatedEntry[], max = 300): ValidatedEntry[] {
  const byCountry = (country: string) => validated.filter((entry) => entry.country === country).sort(compareValidated);
  const selected: ValidatedEntry[] = [];
  const add = (items: ValidatedEntry[], limit: number) => {
    for (const item of items) {
      if (selected.length >= max || selected.includes(item)) continue;
      if (selected.filter((entry) => entry.country === item.country).length >= limit) continue;
      selected.push(item);
    }
  };
  add(byCountry("Azərbaycan"), 999);
  add(byCountry("Türkiyə"), 70);
  add(byCountry("Rusiya"), 70);
  for (const item of validated.filter((entry) => !selected.includes(entry) && !["Türkiyə", "Rusiya"].includes(entry.country ?? "")).sort(compareValidated)) {
    if (selected.length >= max) break;
    selected.push(item);
  }
  return selected.sort(compareOutput);
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
  if (entry.country === "Azərbaycan") value += 30;
  if (entry.country === "Türkiyə") value += 25;
  if (entry.country === "Rusiya") value += 25;
  if (entry.url.startsWith("https://")) value += 20;
  else value -= 20;
  if (entry.tvgLogo) value += 8;
  if (entry.tvgId) value += 5;
  if (entry.country && entry.country !== "Beynəlxalq") value += 5;
  return value;
}

function isAllowed(entry: PlaylistEntry): boolean {
  const haystack = `${entry.name} ${entry.groupTitle ?? ""} ${entry.category ?? ""}`.toLowerCase();
  if (/adult|xxx|nsfw|radio|webcam|camera|event|test/.test(haystack)) return false;
  if (/\.(mp4|mkv|avi)(?:$|\?)/i.test(entry.url)) return false;
  return true;
}

function compareValidated(a: ValidatedEntry, b: ValidatedEntry): number {
  return b.score - a.score || a.name.localeCompare(b.name) || a.url.localeCompare(b.url);
}

function compareOutput(a: ValidatedEntry, b: ValidatedEntry): number {
  const country = countryRank(a.country) - countryRank(b.country);
  if (country !== 0) return country;
  const category = categoryRank(a.category) - categoryRank(b.category);
  if (category !== 0) return category;
  return b.score - a.score || a.name.localeCompare(b.name);
}

function countryRank(country?: string): number {
  if (country === "Azərbaycan") return 0;
  if (country === "Türkiyə") return 1;
  if (country === "Rusiya") return 2;
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
