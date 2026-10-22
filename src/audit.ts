import fs from "node:fs";
import { isForbiddenUrl, isTurkeyAdSlateProneUrl } from "./validator.js";
import { isPublishableUrl, MAX_PLAYLIST_BYTES } from "./playlistGuard.js";

const playlist = fs.readFileSync("output/playlist.m3u", "utf8");
const status = JSON.parse(readJsonText("output/status.json")) as { published?: number };
const manualConfig = JSON.parse(readJsonText("config/manual-channel-overrides.json")) as {
  channels?: Array<{
    id: string;
    name: string;
    country: string;
    group: string;
    url?: string;
    locked?: boolean;
    neverReplace?: boolean;
    neverRemove?: boolean;
  }>;
};
const errors: string[] = [];
const warnings: string[] = [];

if (!playlist.startsWith("#EXTM3U")) errors.push("Playlist does not begin with #EXTM3U");
if (Buffer.byteLength(playlist, "utf8") > MAX_PLAYLIST_BYTES) errors.push("Playlist exceeds 8 MiB");
if (playlist.split(/\r?\n/).some((line) => Buffer.byteLength(line, "utf8") > 8192)) errors.push("Oversized M3U line exists");

const entries = parsePlaylistEntries(playlist);
const ids = entries.map((entry) => entry.id).filter(Boolean);
const urls = entries.map((entry) => entry.url);
const extinfCount = (playlist.match(/^#EXTINF/gm) ?? []).length;

if (extinfCount !== entries.length) errors.push("Malformed EXTINF entry exists");
if (entries.length === 0) errors.push("Playlist has no channels");
if (urls.some((url) => !isPublishableUrl(url))) errors.push("Oversized, invalid or soon-expiring stream URL exists");
if (status.published !== extinfCount) errors.push("Published count disagrees with status");
const mandatory = JSON.parse(readJsonText("config/mandatory-channels.json")) as { channels: Array<{ id: string; name: string }> };
const unverifiedIds = new Set<string>(JSON.parse(readJsonText("output/mandatory-health.json")).needsLocalTest as string[]);
for (const channel of mandatory.channels) {
  const matching = entries.filter((entry) => entry.id === channel.id);
  if (matching.length !== 1) errors.push("Required TV channel missing or duplicated: " + channel.name);
  if (unverifiedIds.has(channel.id) && !/Yoxlanmamış/i.test(matching[0]?.group ?? "")) errors.push("Missing unverified warning for: " + channel.name);
}

if (ids.length !== new Set(ids).size) errors.push("Duplicate channel ID exists");
if (urls.length !== new Set(urls.map(normalizeUrl)).size) errors.push("Duplicate stream URL exists");
if (urls.some((url) => isForbiddenUrl(url, { allowLivePath: true }))) errors.push("Private/local/gateway URL exists");
if (/^#EXTHTTP:.*(?:cookie|authorization)|[|&](?:cookie|authorization)=|bearer\s+[a-z0-9._-]+/im.test(playlist)) errors.push("Account credential or Authorization header exists");
if (/widevine|playready|license|drm/i.test(playlist)) errors.push("DRM/license URL exists");

// Turkish direct CDN streams from these families may be technically playable but
// replace the real television ad break with a static digital-ad slate. Such a
// stream is not acceptable for the final TV playlist.
for (const entry of entries) {
  if (countryKey(entry.group) === "TR" && !/Yoxlanmamış/i.test(entry.group) && isTurkeyAdSlateProneUrl(entry.url)) {
    errors.push(`Turkish ad-slate-prone stream is still published: ${entry.name}`);
  }
}

// Formerly locked channels are now only candidates. Never require a stream
// to be published if it failed live video validation.
for (const configured of (manualConfig.channels ?? []).filter((channel) => channel.locked)) {
  const matching = entries.filter((entry) => entry.id === configured.id);
  if (matching.length > 1) errors.push(`Duplicate manually configured channel: ${configured.name}`);
}

// Tokenized URLs are not a CI failure by themselves. The update job validates
// every existing stream. If such a URL has expired it is replaced or removed;
// if it still works it is intentionally left untouched. Locked manual URLs are
// exempt because the user explicitly controls them.
const lockedUrls = new Set(
  (manualConfig.channels ?? [])
    .filter((channel) => channel.locked && channel.url)
    .map((channel) => normalizeUrl(channel.url!))
);
for (const entry of entries) {
  if (lockedUrls.has(normalizeUrl(entry.url))) continue;
  if (/yoda/i.test(entry.url) && /(?:ip|ua|exp|jti|token|signature|sig)=/i.test(entry.url)) {
    warnings.push(`Short-lived-looking Yoda URL is currently published: ${entry.name}`);
  }
}

for (const warning of warnings) console.warn(`[AUDIT WARNING] ${warning}`);

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(`Audit passed. Published: ${extinfCount}. Locked: ${lockedUrls.size}. Warnings: ${warnings.length}`);

interface M3uEntry {
  id: string;
  name: string;
  group: string;
  url: string;
}

function parsePlaylistEntries(text: string): M3uEntry[] {
  const entries: M3uEntry[] = [];
  let current: Omit<M3uEntry, "url"> | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF")) {
      current = {
        id: line.match(/tvg-id="([^"]+)"/)?.[1] ?? "",
        group: line.match(/group-title="([^"]+)"/)?.[1] ?? "",
        name: line.split(",").slice(1).join(",").trim()
      };
      continue;
    }
    if (current && /^https?:\/\//i.test(line)) {
      entries.push({ ...current, url: line.split("|", 1)[0]!.trim() });
      current = undefined;
    }
  }
  return entries;
}

function countryKey(value: string): string {
  const normalized = value
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[əƏ]/g, "e")
    .replace(/[ıİ]/g, "i")
    .replace(/[üÜ]/g, "u");
  if (normalized.includes("azerbaycan")) return "AZ";
  if (normalized.includes("turkiye")) return "TR";
  if (normalized.includes("rusiya")) return "RU";
  return normalized;
}

function normalizeUrl(raw: string): string {
  try {
    return new URL(raw).toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function readJsonText(file: string): string {
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}
