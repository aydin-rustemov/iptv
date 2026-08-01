import fs from "node:fs";
import { isForbiddenUrl } from "./validator.js";

const playlist = fs.readFileSync("output/playlist.m3u", "utf8");
const status = JSON.parse(fs.readFileSync("output/status.json", "utf8")) as { published?: number };
const errors: string[] = [];

if (!playlist.startsWith("#EXTM3U")) errors.push("Playlist does not begin with #EXTM3U");

const ids = [...playlist.matchAll(/tvg-id="([^"]+)"/g)].map((match) => match[1]!);
const urls = [...playlist.matchAll(/^(https?:\/\/[^\r\n]+)/gm)].map((match) => match[1]!);
const extinfCount = (playlist.match(/^#EXTINF/gm) ?? []).length;

if (ids.length !== new Set(ids).size) errors.push("Duplicate channel ID exists");
if (urls.length !== new Set(urls.map((url) => url.toLowerCase())).size) errors.push("Duplicate stream URL exists");
if (urls.some(isForbiddenUrl)) errors.push("Private/local/gateway URL exists");
if (urls.some((url) => /\/live\//i.test(url) || /:8787/.test(url))) errors.push("Gateway URL exists");
if (extinfCount !== urls.length) errors.push("Malformed EXTINF exists");
if (extinfCount > 300) errors.push("Published count exceeds 300");
if (status.published !== extinfCount) errors.push("Published count disagrees with status");

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(`Audit passed. Published: ${extinfCount}`);
