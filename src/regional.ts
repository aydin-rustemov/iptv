import { normalizeCountry } from "./parser.js";
import type { PlaylistEntry, ValidatedEntry } from "./types.js";

export const REGIONAL_LIMITS = { total: 100, az: 35, tr: 60, ru: 20 } as const;

export type Region = "AZ" | "TR" | "RU";

export function regionOf(entry: Pick<PlaylistEntry, "priorityCountry" | "country" | "groupTitle">): Region | undefined {
  const country = normalizeCountry(entry.priorityCountry || entry.country || entry.groupTitle);
  if (country === "Azərbaycan") return "AZ";
  if (country === "Türkiyə") return "TR";
  if (country === "Rusiya") return "RU";
  return undefined;
}

function channelIdentity(entry: PlaylistEntry): string {
  const name = (entry.priorityId || entry.tvgName || entry.name)
    .toLocaleLowerCase("tr").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[əƏ]/g, "e").replace(/[ıİ]/g, "i")
    .replace(/\b(?:hd|fhd|fullhd|live|canli|canlı|1080p|720p)\b/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
  return regionOf(entry) + ":" + name;
}

function hostReliability(entry: ValidatedEntry): number {
  let score = entry.score;
  if (regionOf(entry) === "AZ" && entry.sourceName === "yoda-az") score += 50000;
  if (regionOf(entry) === "AZ" && entry.sourceName === "tvstream-az") score += 15000;
  if (entry.priorityId) score += 1000;
  if (entry.sourceName === "manual-locked" || entry.sourceName === "manual-fallback") score += 200;
  if (/iptv-org-(?:azerbaijan|turkey|russia)/.test(entry.sourceName)) score += 100;
  if (entry.headers["Referer"] || entry.headers["User-Agent"]) score -= 90;
  if (entry.url.includes("?")) score -= 20;
  return score;
}

export function uniqueVerified(entries: ValidatedEntry[], region: Region): ValidatedEntry[] {
  const takenNames = new Set<string>();
  const takenUrls = new Set<string>();
  return entries
    .filter((entry) => regionOf(entry) === region && entry.fast.ok && entry.media.ok && entry.media.hasVideo)
    .sort((a, b) => hostReliability(b) - hostReliability(a))
    .filter((entry) => {
      const name = channelIdentity(entry);
      const url = entry.url;
      if (takenNames.has(name) || takenUrls.has(url)) return false;
      takenNames.add(name);
      takenUrls.add(url);
      return true;
    });
}

export function selectRegionalPlaylist(entries: ValidatedEntry[]): ValidatedEntry[] {
  const az = uniqueVerified(entries, "AZ").slice(0, REGIONAL_LIMITS.az);
  const ruAvailable = uniqueVerified(entries, "RU");
  const trAvailable = uniqueVerified(entries, "TR");

  // Reserve 50-60 Turkish and 15-20 Russian channels when enough are verified.
  // More Azerbaijani channels take priority while keeping a 100-channel ceiling.
  const ruTarget = Math.min(20, Math.max(15, REGIONAL_LIMITS.total - az.length - 55));
  const ru = ruAvailable.slice(0, ruTarget);
  const tr = trAvailable.slice(0, Math.min(REGIONAL_LIMITS.tr, REGIONAL_LIMITS.total - az.length - ru.length));

  // Fill spare places first with RU (up to 20), then TR (up to 60).
  let remaining = REGIONAL_LIMITS.total - az.length - tr.length - ru.length;
  const extraRu = ruAvailable.slice(ru.length, ru.length + Math.min(20 - ru.length, remaining));
  remaining -= extraRu.length;
  const extraTr = trAvailable.slice(tr.length, tr.length + Math.min(60 - tr.length, remaining));

  return [...az, ...tr, ...extraTr, ...ru, ...extraRu].slice(0, REGIONAL_LIMITS.total);
}
