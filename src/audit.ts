import fs from "node:fs";
import { isForbiddenUrl, isTurkeyAdSlateProneUrl } from "./validator.js";
import { isPublishableUrl, isDirectManifestUrl, MAX_PLAYLIST_BYTES } from "./playlistGuard.js";
import { isMismatchedChannel } from "./channelMatchGuard.js";
import { isAdvertisingStream, validCandidateIdentity } from "./sourcePolicy.js";
import { isOfficialShowTvStream } from "./sources/showTvOfficial.js";

const playlist = fs.readFileSync("output/playlist.m3u", "utf8");
const status = JSON.parse(readJsonText("output/status.json")) as { published?: number; manualAzPlaylist?: boolean };
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
const showTvSource = fs.existsSync("output/showtv-source-status.json")
  ? JSON.parse(readJsonText("output/showtv-source-status.json")) as {status:string;url?:string;networkStatus?:number;page?:string}
  : undefined;
function officialShowTvCaptured(entry: {id:string;url:string}): boolean {
  return entry.id === "show-tv" && Boolean(showTvSource?.status === "official_hls_captured" &&
    showTvSource.networkStatus === 200 && showTvSource.page === "https://www.showtv.com.tr/canli-yayin" &&
    showTvSource.url === entry.url && isOfficialShowTvStream(entry.url));
}
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
if (entries.some((entry) => !isPublishableUrl(entry.url) && !officialShowTvCaptured(entry))) errors.push("Oversized, invalid or soon-expiring stream URL exists");
if (entries.some((entry) => !isDirectManifestUrl(entry.url) && !officialShowTvCaptured(entry))) errors.push("HTML/web HLS player link in playlist");
if (urls.some(isAdvertisingStream)) errors.push("Advertising HLS stream masquerading as a TV channel");
if (entries.some((entry) => /yoxlanmamış|⚠/i.test(entry.name + " " + entry.group))) errors.push("Diagnostic warning leaked into TV channel label");
if (status.published !== extinfCount) errors.push("Published count disagrees with status");
const mandatory = JSON.parse(readJsonText("config/mandatory-channels.json")) as { channels: Array<{ id: string; name: string }> };
const mandatoryHealth = JSON.parse(readJsonText("output/mandatory-health.json")) as { needsLocalTest: string[]; missingNoWebStream: string[] };
const unverifiedIds = new Set(mandatoryHealth.needsLocalTest);
const manualAzEntries = status.manualAzPlaylist
  ? parsePlaylistEntries(fs.readFileSync("output/azerbaijan-manual.m3u", "utf8"))
  : [];
const yodaReport = status.manualAzPlaylist
  ? { entries: [] as Array<{ id: string; name: string; url: string; source: string; checkedOnGithub: boolean }> }
  : JSON.parse(readJsonText("output/yoda-status.json")) as {
      entries: Array<{ id: string; name: string; url: string; source: string; checkedOnGithub: boolean }>
    };
const yodaRegionalUrls = new Set(yodaReport.entries
  .filter((row) => (row.source === "yoda-az" || row.source === "yoda-az-cdn") &&
    row.checkedOnGithub === false)
  .map((row) => row.id + "|" + row.url));
const missingIds = new Set(mandatoryHealth.missingNoWebStream);
for (const channel of mandatory.channels) {
  const matching = entries.filter((entry) => entry.id === channel.id);
  if (missingIds.has(channel.id)) {
    if (matching.length) errors.push("Missing web channel must not have an invented link: " + channel.name);
    warnings.push("No discovered web stream for mandatory channel: " + channel.name);
    continue;
  }
  if (matching.length !== 1) errors.push("Required TV channel missing or duplicated: " + channel.name);
  if (unverifiedIds.has(channel.id)) {
    const chosen = matching[0];
    const isOfficialShow = chosen && officialShowTvCaptured(chosen) && chosen.group === "Türkiyə";
    const isManualAz = status.manualAzPlaylist && manualAzEntries.some((entry) =>
      entry.id === channel.id && chosen && entry.url === chosen.url);
    if (!isOfficialShow && (!chosen || !chosen.group.startsWith("Azərbaycan") ||
        (!isManualAz && !yodaRegionalUrls.has(channel.id + "|" + chosen.url)))) {
      errors.push("AZ channel lacks Yoda/manual provenance: " + channel.name);
    }
  }
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
  const inspected = { sourceName: "audit", name: entry.name, tvgName: entry.name, url: entry.url, country: countryKey(entry.group) === "TR" ? "Türkiyə" : countryKey(entry.group) === "RU" ? "Rusiya" : "Azərbaycan", priorityId: entry.id, headers: {} };
  if (isMismatchedChannel(inspected) || !validCandidateIdentity(inspected)) errors.push("Wrong broadcaster URL or country for channel: " + entry.name);
  if (countryKey(entry.group) === "TR" && !/Yoxlanmamış/i.test(entry.group) && isTurkeyAdSlateProneUrl(entry.url) && !officialShowTvCaptured(entry)) {
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
