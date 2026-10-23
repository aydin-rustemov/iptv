import type { PlaylistEntry, ValidatedEntry } from "../types.js";
import { isDirectManifestUrl } from "../playlistGuard.js";
import { isMismatchedChannel } from "../channelMatchGuard.js";
import { isAdvertisingStream, validCandidateIdentity } from "../sourcePolicy.js";

// Channel identities come from Yoda's public TV catalogue, not from video EPG titles.
// Slugs below are discovery hints only; no M3U URL is constructed from a guessed slug.
export const YODA_CATALOGUE: ReadonlyArray<{ id: string; name: string; slugs: string[] }> = [
  { id: "aztv", name: "AzTV", slugs: ["aztv", "azertv"] },
  { id: "xezer-tv", name: "Xəzər TV", slugs: ["xazartv", "xezer"] },
  { id: "ictimai-tv", name: "İctimai TV", slugs: ["ictimaitele", "ictimai"] },
  { id: "baku-tv", name: "Baku TV", slugs: ["bakutv"] },
  { id: "idman-tv", name: "İdman TV", slugs: ["idman"] },
  { id: "biznes-tv", name: "Biznes TV", slugs: ["biznestv"] },
  { id: "naxcivan-tv", name: "Naxçıvan TV", slugs: ["naxtv"] },
  { id: "real-tv", name: "Real TV", slugs: ["realtv", "real"] },
  { id: "qafqaz-tv", name: "Qafqaz TV", slugs: ["qafqaz", "qafqaztv"] },
  { id: "atv-az", name: "ATV Azərbaycan", slugs: ["atv"] },
  { id: "arb24", name: "ARB24", slugs: ["arb24"] },
  { id: "apa-tv", name: "APA TV", slugs: ["apatv"] },
  { id: "haber-global", name: "Haber Global", slugs: ["haberglobal"] },
  { id: "tmb-tv", name: "TMB TV", slugs: ["tmb"] },
  { id: "tmb-az", name: "TMB Azərbaycan", slugs: ["tmbaz", "tmbazerbaycan"] },
  { id: "arb", name: "ARB", slugs: ["arb"] },
  { id: "kanal-s", name: "Kanal S", slugs: ["kanals"] },
  { id: "kanal-35", name: "Kanal 35", slugs: ["kanal35"] },
  { id: "eltv", name: "ELTV", slugs: ["eltv"] },
  { id: "arb-gunes", name: "ARB Günəş", slugs: ["arbgunes", "arbguneshtv"] },
  { id: "cbc", name: "CBC", slugs: ["cbc"] },
  { id: "medeniyyet-tv", name: "Mədəniyyət TV", slugs: ["medeniyyet", "medeniyyettele"] },
  { id: "space-tv", name: "Space TV", slugs: ["space", "spacetv"] },
  { id: "vostok-tv", name: "Vostok TV", slugs: ["vostok", "vostoktv"] },
  { id: "show-plus-tv", name: "Show Plus TV", slugs: ["showplus", "showplustv"] },
  { id: "mtv-az", name: "MTV Azerbaijan", slugs: ["mtv", "mtvazerbaijan"] },
  { id: "sh-tv", name: "SH TV", slugs: ["shtv"] },
  { id: "vip-hd", name: "VIP HD", slugs: ["viphd"] },
  { id: "dunya-tv", name: "Dünya TV", slugs: ["dunyatv"] }
];

const CHANNEL_BY_SLUG = new Map(YODA_CATALOGUE.flatMap((station) => station.slugs.map(slug => [slug, station] as const)));

export function yodaChannelFromPage(pageUrl: string): { id: string; name: string } | undefined {
  try {
    const u = new URL(pageUrl);
    if (u.hostname !== "yoda.az" && u.hostname !== "www.yoda.az") return undefined;
    const path = u.pathname.split("/").filter(Boolean);
    if (path[0] !== "tv" || !path[1]) return undefined;
    return CHANNEL_BY_SLUG.get(path[1].toLowerCase());
  } catch { return undefined; }
}

export const YODA_REGION_REASON = "yoda_azerbaijan_only_skip_github_geo_probe";

export function yodaRegionalEntries(entries: PlaylistEntry[]): ValidatedEntry[] {
  const urlTaken = new Set<string>();
  const stationTaken = new Set<string>();
  const out: ValidatedEntry[] = [];
  for (const original of entries) {
    if (original.sourceName !== "yoda-az" && original.sourceName !== "yoda-az-cdn") continue;
    if (original.country !== "Azərbaycan" || !isDirectManifestUrl(original.url) ||
        isAdvertisingStream(original.url) || isMismatchedChannel(original) ||
        !validCandidateIdentity(original)) continue;
    // Do not create generic "TV" or "Yoda" entries and never label ARB Günəş as ARB.
    if (/^(?:tv|yoda|azərbaycan|kanallar|player)$/i.test(original.name.trim())) continue;
    const id = original.priorityId ?? original.tvgId ?? original.name;
    if (stationTaken.has(id) || urlTaken.has(original.url)) continue;
    stationTaken.add(id);
    urlTaken.add(original.url);
    out.push({
      ...original,
      normalizedUrl: original.url, score: -1,
      fast: { ok: false, reason: YODA_REGION_REASON },
      media: { ok: false, hasVideo: false, hasAudio: false, bytesRead: 0, reason: YODA_REGION_REASON }
    });
  }
  return out;
}

function stationKey(e: ValidatedEntry): string {
  const n = (e.priorityId || e.tvgId || e.tvgName || e.name)
    .toLocaleLowerCase("tr").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[əƏ]/g, "e")
    .replace(/[^a-z0-9а-яё]+/gi, "");
  return (e.country || "") + ":" + n;
}

// Always prefer a real discovered Yoda URL for Azerbaijani stations over a
// CI-verified non-Yoda stream. Never let the 100-channel global ceiling remove
// a Yoda station; trim non-Yoda extras instead.
export function overlayYodaRegional(
  existing: ValidatedEntry[], yoda: ValidatedEntry[], maximum = 100
): ValidatedEntry[] {
  const out: ValidatedEntry[] = [];
  const keys = new Set<string>();
  const urls = new Set<string>();
  for (const item of [...yoda, ...existing]) {
    const key = stationKey(item);
    if (keys.has(key) || urls.has(item.url)) continue;
    keys.add(key); urls.add(item.url); out.push(item);
  }
  if (out.length <= maximum) return out;
  const fixed = out.filter(e => e.fast.reason === YODA_REGION_REASON);
  const others = out.filter(e => e.fast.reason !== YODA_REGION_REASON);
  return [...fixed, ...others.slice(0, Math.max(0, maximum - fixed.length))];
}
