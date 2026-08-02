import fs from "node:fs";
import { isForbiddenUrl } from "./validator.js";
import type { PriorityChannel, PriorityChannelStatus } from "./types.js";

const playlist = fs.readFileSync("output/playlist.m3u", "utf8");
const status = JSON.parse(readJsonText("output/status.json")) as { published?: number; priorityChannels?: PriorityChannelStatus[] };
const priorityConfig = JSON.parse(readJsonText("config/priority-channels.json")) as { channels: PriorityChannel[] };
const missingPriority = fs.existsSync("output/missing-priority-channels.json")
  ? JSON.parse(fs.readFileSync("output/missing-priority-channels.json", "utf8")) as PriorityChannelStatus[]
  : [];
const errors: string[] = [];

if (!playlist.startsWith("#EXTM3U")) errors.push("Playlist does not begin with #EXTM3U");

const ids = [...playlist.matchAll(/tvg-id="([^"]+)"/g)].map((match) => match[1]!);
const urls = [...playlist.matchAll(/^(https?:\/\/[^\r\n]+)/gm)].map((match) => match[1]!);
const extinfCount = (playlist.match(/^#EXTINF/gm) ?? []).length;

if (ids.length !== new Set(ids).size) errors.push("Duplicate channel ID exists");
if (urls.length !== new Set(urls.map((url) => url.toLowerCase())).size) errors.push("Duplicate stream URL exists");
if (urls.some((url) => isForbiddenUrl(url))) errors.push("Private/local/gateway URL exists");
if (urls.some((url) => /\/live\//i.test(url) || /:8787/.test(url))) errors.push("Gateway URL exists");
if (extinfCount !== urls.length) errors.push("Malformed EXTINF exists");
if (extinfCount > 300) errors.push("Published count exceeds 300");
if (status.published !== extinfCount) errors.push("Published count disagrees with status");
if (!status.priorityChannels?.some((channel) => channel.id === "yaban-tv")) errors.push("Yaban TV is not checked and reported");
if (!missingPriority.some((channel) => channel.id === "yaban-tv") && !ids.includes("yaban-tv")) errors.push("Yaban TV missing result is not reported");

const groups = [...playlist.matchAll(/group-title="([^"]+)"/g)].map((match) => match[1]!);
if (groups[0] !== "Azərbaycan") errors.push("Azerbaijan does not appear first");
const firstTurkey = groups.findIndex((group) => group.startsWith("Türkiyə"));
const firstRussia = groups.findIndex((group) => group.startsWith("Rusiya"));
const lastAzerbaijan = lastIndex(groups, (group) => group === "Azərbaycan");
const lastTurkey = lastIndex(groups, (group) => group.startsWith("Türkiyə"));
if (firstTurkey >= 0 && firstTurkey <= lastAzerbaijan) errors.push("Turkey does not appear after Azerbaijan");
if (firstRussia >= 0 && firstTurkey >= 0 && firstRussia <= lastTurkey) errors.push("Russia does not appear after Turkey");
if (!priorityOrderIsValid(ids, priorityConfig.channels)) errors.push("Priority channels do not preserve configured order");

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

function lastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i]!)) return i;
  }
  return -1;
}

function priorityOrderIsValid(ids: string[], priorities: PriorityChannel[]): boolean {
  const priorityRanks = new Map(priorities.map((priority) => [priority.id, priority.priority]));
  const ranks = ids.flatMap((id) => priorityRanks.has(id) ? [priorityRanks.get(id)!] : []);
  return ranks.every((rank, index) => index === 0 || rank > ranks[index - 1]!);
}

function readJsonText(file: string): string {
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}
