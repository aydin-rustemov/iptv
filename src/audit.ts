import fs from "node:fs";
import { isForbiddenUrl } from "./validator.js";

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

const entries = parsePlaylistEntries(playlist);
const ids = entries.map((entry) => entry.id).filter(Boolean);
const urls = entries.map((entry) => entry.url);
const extinfCount = (playlist.match(/^#EXTINF/gm) ?? []).length;

if (extinfCount !== entries.length) errors.push("Malformed EXTINF entry exists");
if (status.published !== extinfCount) errors.push("Published count disagrees with status");
if (ids.length !== new Set(ids).size) errors.push("Duplicate channel ID exists");
if (urls.length !== new Set(urls.map(normalizeUrl)).size) errors.push("Duplicate stream URL exists");
if (urls.some((url) => isForbiddenUrl(url, { allowLivePath: true }))) errors.push("Private/local/gateway URL exists");
if (/^#EXTHTTP:.*(?:cookie|authorization)|[|&](?:cookie|authorization)=|bearer\s+[a-z0-9._-]+/im.test(playlist)) errors.push("Account credential or Authorization header exists");
if (/widevine|playready|license|drm/i.test(playlist)) errors.push("DRM/license URL exists");

// Locked manual channels are a user-controlled contract. They must appear once,
// keep the exact configured URL, and must not be shadowed by a scraped duplicate.
for (const locked of (manualConfig.channels ?? []).filter((channel) => channel.locked && channel.url)) {
  const exact = entries.filter((entry) => entry.id === locked.id);
  if (exact.length !== 1) {
    errors.push(`Locked channel ${locked.name} must exist exactly once as tvg-id=${locked.id}`);
    continue;
  }
  if (normalizeUrl(exact[0]!.url) !== normalizeUrl(locked.url!)) {
    errors.push(`Locked channel ${locked.name} URL changed from manual configuration`);
  }

  const sameChannel = entries.filter((entry) =>
    countryKey(entry.group) === countryKey(locked.group) &&
    simplifiedName(entry.name) === simplifiedName(locked.name)
  );
  if (sameChannel.length !== 1) {
    errors.push(`Locked channel ${locked.name} has a duplicate/shadow entry`);
  }
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

function simplifiedName(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ıİ]/g, "i")
    .replace(/[əƏ]/g, "e")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u")
    .replace(/\b(?:canli|live|izle|seyret|yayin|yayini|hd|fhd|fullhd|full hd)\b/g, " ")
    .replace(/\btv\b$/g, "")
    .replace(/[^a-z0-9а-яё]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
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
