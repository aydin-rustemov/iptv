import fs from "node:fs";
import { isForbiddenUrl } from "./validator.js";
import type { PriorityChannel, PriorityChannelStatus } from "./types.js";

const CBC_SPORT_URL = "https://cbcsports-live.lg.mncdn.com/cbcsports_live/cbcsports/chunklist.m3u8";
const ATV_FALLBACK_URL = "https://lives.atv.az:5443/ATV_TV_STREAM/streams/atvcanli.m3u8";
const ARB_STATIC_URL = "https://str.yodacdn.net/arb/tracks-v1a1/mono.ts.m3u8";
const SPACE_STATIC_URL = "https://str.yodacdn.net/space/tracks-v1a1/mono.ts.m3u8";
const REAL_TV_STATIC_URL = "https://str.yodacdn.net/real/tracks-v1a1/mono.ts.m3u8";
const APA_TV_STATIC_URL = "https://str.yodacdn.net/apatv/tracks-v1a1/mono.ts.m3u8";
const IDMAN_TV_STATIC_URL = "https://str.yodacdn.net/idmantele/tracks-v3a1/mono.ts.m3u8";
const EL_TV_STATIC_URL = "https://str.yodacdn.net/eltv/tracks-v1a1/mono.ts.m3u8";

const playlist = fs.readFileSync("output/playlist.m3u", "utf8");
const status = JSON.parse(readJsonText("output/status.json")) as { published?: number; priorityChannels?: PriorityChannelStatus[] };
const priorityConfig = JSON.parse(readJsonText("config/priority-channels.json")) as { channels: PriorityChannel[] };
const manualOverrides = readJsonText("config/manual-channel-overrides.json");
const missingPriority = fs.existsSync("output/missing-priority-channels.json")
  ? JSON.parse(fs.readFileSync("output/missing-priority-channels.json", "utf8")) as PriorityChannelStatus[]
  : [];
const errors: string[] = [];

if (!playlist.startsWith("#EXTM3U")) errors.push("Playlist does not begin with #EXTM3U");

const ids = [...playlist.matchAll(/tvg-id="([^"]+)"/g)].map((match) => match[1]!);
const urls = [...playlist.matchAll(/^(https?:\/\/[^\r\n|]+)/gm)].map((match) => match[1]!);
const extinfCount = (playlist.match(/^#EXTINF/gm) ?? []).length;
const groups = playlist.split(/\r?\n/).flatMap((line) => {
  if (!line.startsWith("#EXTINF")) return [];
  const match = line.match(/group-title="([^"]+)"/);
  return match?.[1] ? [match[1]] : [];
});
const entries = parsePlaylistEntries(playlist);

if (ids.length !== new Set(ids).size) errors.push("Duplicate channel ID exists");
if (urls.length !== new Set(urls.map((url) => url.toLowerCase())).size) errors.push("Duplicate stream URL exists");
if (urls.some((url) => isForbiddenUrl(url, { allowLivePath: true }))) errors.push("Private/local/gateway URL exists");
if (urls.some((url) => /localhost|127\.0\.0\.1|:8787|192\.168\.|^https?:\/\/10\.|^https?:\/\/172\.(1[6-9]|2\d|3[01])\./i.test(url))) errors.push("Local gateway URL exists");
if (extinfCount !== urls.length) errors.push("Malformed EXTINF exists");
if (status.published !== extinfCount) errors.push("Published count disagrees with status");
if (!status.priorityChannels?.some((channel) => channel.id === "yaban-tv")) errors.push("Yaban TV is not checked and reported");
if (!missingPriority.some((channel) => channel.id === "yaban-tv") && !ids.includes("yaban-tv")) errors.push("Yaban TV missing result is not reported");
if (!playlist.includes(CBC_SPORT_URL)) errors.push("CBC Sport exact locked URL is missing");
if (!manualOverrides.includes(ATV_FALLBACK_URL)) errors.push("ATV official fallback is not configured");
if (!playlist.includes(ARB_STATIC_URL)) errors.push("ARB exact locked URL is missing");
if (!playlist.includes(SPACE_STATIC_URL)) errors.push("Space TV exact locked URL is missing");
if (!playlist.includes(REAL_TV_STATIC_URL)) errors.push("Real TV exact locked URL is missing");
if (!playlist.includes(APA_TV_STATIC_URL)) errors.push("APA TV exact locked URL is missing");
if (!playlist.includes(IDMAN_TV_STATIC_URL)) errors.push("İdman TV exact locked URL is missing");
if (!playlist.includes(EL_TV_STATIC_URL)) errors.push("EL TV exact locked URL is missing");
if (lockedStaticUrls().some((url) => /[?&]token=/i.test(url))) errors.push("A locked Azerbaijan static URL contains token parameter");
if (lockedStaticUrls().some((url) => !manualOverrides.includes(url))) errors.push("A locked Azerbaijan static override is not configured");
if (/yoda/i.test(playlist) && /(?:ip|ua|exp|jti|token|signature|sig)=/i.test(playlist)) errors.push("Yoda short-lived token URL exists");
if (/^#EXTHTTP:.*(?:cookie|authorization)|[|&](?:cookie|authorization)=|bearer\s+[a-z0-9._-]+/im.test(playlist)) errors.push("Account credential or Authorization header exists");
if (/widevine|playready|license|drm/i.test(playlist)) errors.push("DRM/license URL exists");
if (/dublaj|izle film|webcam|ufc event|canl[ıi]\s+ma[cç]|\bvs\b/i.test(playlist)) errors.push("Movie/VOD/radio/webcam/event entry exists");

if (!countryOrderIsValid(groups)) errors.push("Country order is not Azerbaijan, Turkey, Russia, other");
if (!lockedAzerbaijanOrderIsValid(entries) || !lockedAzerbaijanStaticOrderIsValid(entries)) errors.push("Locked Azerbaijan static channel ordering is invalid");
if (entries.filter((entry) => entry.id === "arb-az").length !== 1) errors.push("Exactly one canonical ARB entry must exist");
if (entries.filter((entry) => entry.id === "space-tv-az").length !== 1) errors.push("Exactly one canonical Space TV entry must exist");
if (entries.filter((entry) => entry.id === "real-tv-az").length !== 1) errors.push("Exactly one canonical Real TV entry must exist");
if (entries.filter((entry) => entry.id === "apa-tv-az").length !== 1) errors.push("Exactly one canonical APA TV entry must exist");
if (entries.filter((entry) => entry.id === "idman-tv-az").length !== 1) errors.push("Exactly one canonical İdman TV entry must exist");
if (entries.filter((entry) => entry.id === "el-tv-az").length !== 1) errors.push("Exactly one canonical EL TV entry must exist");
if (entries.some((entry) => entry.id === "arb-az" && entry.url !== ARB_STATIC_URL)) errors.push("ARB was replaced by a non-static source");
if (entries.some((entry) => entry.id === "space-tv-az" && entry.url !== SPACE_STATIC_URL)) errors.push("Space TV was replaced by a non-static source");
if (entries.some((entry) => entry.id === "real-tv-az" && entry.url !== REAL_TV_STATIC_URL)) errors.push("Real TV was replaced by a non-static source");
if (entries.some((entry) => entry.id === "apa-tv-az" && entry.url !== APA_TV_STATIC_URL)) errors.push("APA TV was replaced by a non-static source");
if (entries.some((entry) => entry.id === "idman-tv-az" && entry.url !== IDMAN_TV_STATIC_URL)) errors.push("İdman TV was replaced by a non-static source");
if (entries.some((entry) => entry.id === "el-tv-az" && entry.url !== EL_TV_STATIC_URL)) errors.push("EL TV was replaced by a non-static source");
if (!priorityOrderIsValid(priorityIdsOutsideUnverifiedBlocks(playlist), priorityConfig.channels)) errors.push("Priority channels do not preserve configured order");
if (!unverifiedEntriesAreMarked(playlist)) errors.push("Unverified fallback entries are not warning-marked and grouped");

for (const priority of status.priorityChannels ?? []) {
  if (priority.status === "working" && !ids.includes(publishedIdForPriority(priority.id))) {
    errors.push(`Priority channel ${priority.name} was working but omitted`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(`Audit passed. Published: ${extinfCount}`);

function countryOrderIsValid(items: string[]): boolean {
  const ranks = items.map(groupRank).filter((rank, index, all) => index === 0 || rank !== all[index - 1]);
  return ranks.every((rank, index) => index === 0 || rank >= ranks[index - 1]!);
}

interface M3uEntry {
  id: string;
  name: string;
  group: string;
  url: string;
}

function parsePlaylistEntries(text: string): M3uEntry[] {
  const entries: M3uEntry[] = [];
  let current: Omit<M3uEntry, "url"> | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#EXTINF")) {
      current = {
        id: line.match(/tvg-id="([^"]+)"/)?.[1] ?? "",
        group: line.match(/group-title="([^"]+)"/)?.[1] ?? "",
        name: line.split(",").slice(1).join(",").trim()
      };
    } else if (current && /^https?:\/\//i.test(line)) {
      entries.push({ ...current, url: line.trim() });
      current = undefined;
    }
  }
  return entries;
}

function lockedAzerbaijanOrderIsValid(entries: M3uEntry[]): boolean {
  const index = (id: string) => entries.findIndex((entry) => entry.id === id);
  const turkeyStart = entries.findIndex((entry) => groupRank(entry.group) === 1);
  const arb = index("arb-az");
  const arb24 = entries.findIndex((entry) => /^arb24?$|arb\s*24/i.test(entry.id) || /^ARB24$/i.test(entry.name));
  const space = index("space-tv-az");
  if (arb < 0 || space < 0) return false;
  if (turkeyStart >= 0 && (arb > turkeyStart || space > turkeyStart)) return false;
  if (entries[arb]?.group !== "Azərbaycan" || entries[space]?.group !== "Azərbaycan") return false;
  if (ARB_STATIC_URL.includes("?token=") || SPACE_STATIC_URL.includes("?token=")) return false;
  if (arb24 >= 0) return arb < arb24 && arb24 < space;
  return arb < space;
}

function lockedAzerbaijanStaticOrderIsValid(entries: M3uEntry[]): boolean {
  const index = (id: string) => entries.findIndex((entry) => entry.id === id);
  const turkeyStart = entries.findIndex((entry) => groupRank(entry.group) === 1);
  const arb = index("arb-az");
  const arb24 = entries.findIndex((entry) => /^arb24?$|arb\s*24/i.test(entry.id) || /^ARB24$/i.test(entry.name));
  const space = index("space-tv-az");
  const real = index("real-tv-az");
  const apa = index("apa-tv-az");
  const cbcSport = index("cbc-sport-az");
  const idman = index("idman-tv-az");
  const el = index("el-tv-az");
  const required = [arb, space, real, apa, idman, el];
  if (required.some((item) => item < 0)) return false;
  if (turkeyStart >= 0 && required.some((item) => item > turkeyStart)) return false;
  if (required.some((item) => groupRank(entries[item]!.group) !== 0)) return false;
  if (!/X.*b.*r/i.test(entries[real]!.group) || !/X.*b.*r/i.test(entries[apa]!.group)) return false;
  if (!/dman/i.test(entries[idman]!.group)) return false;
  if (!/Dig.*r|Diger/i.test(entries[el]!.group)) return false;
  const coreOrder = arb24 >= 0 ? arb < arb24 && arb24 < space : arb < space;
  const newsOrder = space < real && real < apa;
  const sportOrder = cbcSport < 0 ? apa < idman : cbcSport < idman;
  return coreOrder && newsOrder && sportOrder;
}

function lockedStaticUrls(): string[] {
  return [
    ARB_STATIC_URL,
    SPACE_STATIC_URL,
    REAL_TV_STATIC_URL,
    APA_TV_STATIC_URL,
    IDMAN_TV_STATIC_URL,
    EL_TV_STATIC_URL
  ];
}

function groupRank(group: string): number {
  const normalized = group
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0259\u018f]/g, "e")
    .replace(/[\u0131\u0130]/g, "i")
    .replace(/[\u00fc\u00dc]/g, "u");
  if (/azerbaycan|^az$/i.test(normalized)) return 0;
  if (/turkiye|^tr$/i.test(normalized)) return 1;
  if (/rusiya/i.test(normalized)) return 2;
  return 3;
}

function priorityIdsOutsideUnverifiedBlocks(text: string): string[] {
  return text.split(/^#EXTINF/m).slice(1).flatMap((block) => {
    const full = `#EXTINF${block}`;
    if (/Yoxlan|YoxlanÄ/i.test(full)) return [];
    const match = full.match(/tvg-id="([^"]+)"/);
    return match?.[1] ? [match[1]] : [];
  });
}

function priorityOrderIsValid(ids: string[], priorities: PriorityChannel[]): boolean {
  const priorityRanks = new Map(priorities.map((priority) => [priority.id, priority.priority]));
  const ranks = ids.flatMap((id) => priorityRanks.has(id) ? [priorityRanks.get(id)!] : []);
  return ranks.every((rank, index) => index === 0 || rank > ranks[index - 1]!);
}

function unverifiedEntriesAreMarked(text: string): boolean {
  return parsePlaylistEntries(text).every((entry) => {
    const isUnverifiedGroup = /Yoxlan|YoxlanÄ/i.test(entry.group);
    if (!isUnverifiedGroup) return true;
    return entry.name.startsWith("⚠") || entry.name.startsWith("âš ");
  });
}

function publishedIdForPriority(priorityId: string): string {
  if (priorityId === "arb") return "arb-az";
  if (priorityId === "space-tv") return "space-tv-az";
  if (priorityId === "real-tv") return "real-tv-az";
  if (priorityId === "idman-tv") return "idman-tv-az";
  if (priorityId === "el-tv") return "el-tv-az";
  if (priorityId === "cbc-sport") return "cbc-sport-az";
  return priorityId;
}

function readJsonText(file: string): string {
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}
