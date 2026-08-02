import fs from "node:fs";
import { isForbiddenUrl } from "./validator.js";
import type { PriorityChannel, PriorityChannelStatus } from "./types.js";

const CBC_SPORT_URL = "https://cbcsports-live.lg.mncdn.com/cbcsports_live/cbcsports/chunklist.m3u8";
const ATV_FALLBACK_URL = "https://lives.atv.az:5443/ATV_TV_STREAM/streams/atvcanli.m3u8";

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
if (/yoda/i.test(playlist) && /(?:ip|ua|exp|jti|token|signature|sig)=/i.test(playlist)) errors.push("Yoda short-lived token URL exists");
if (/^#EXTHTTP:.*(?:cookie|authorization)|[|&](?:cookie|authorization)=|bearer\s+[a-z0-9._-]+/im.test(playlist)) errors.push("Account credential or Authorization header exists");
if (/widevine|playready|license|drm/i.test(playlist)) errors.push("DRM/license URL exists");
if (/dublaj|izle film|webcam|ufc event|canl[ıi]\s+ma[cç]|\bvs\b/i.test(playlist)) errors.push("Movie/VOD/radio/webcam/event entry exists");

if (!countryOrderIsValid(groups)) errors.push("Country order is not Azerbaijan, Turkey, Russia, other");
if (!priorityOrderIsValid(priorityIdsOutsideUnverifiedBlocks(playlist), priorityConfig.channels)) errors.push("Priority channels do not preserve configured order");
if (!unverifiedEntriesAreMarked(playlist)) errors.push("Unverified fallback entries are not warning-marked and grouped");

for (const priority of status.priorityChannels ?? []) {
  if (priority.status === "working" && !ids.includes(priority.id)) {
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
  const blocks = text.split(/^#EXTINF/m).slice(1).map((block) => `#EXTINF${block}`);
  return blocks.every((block) => {
    const isUnverifiedGroup = /Yoxlan|YoxlanÄ/i.test(block);
    if (!isUnverifiedGroup) return true;
    return /^#EXTINF[^\n]+,⚠ /m.test(block);
  });
}

function readJsonText(file: string): string {
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}
