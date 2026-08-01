import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import pLimit from "p-limit";
import { DEFAULT_CONFIG } from "../config.js";
import { loadOfficialChannels, type OfficialChannel, type OfficialSource } from "../official-gateway.js";
import { validateCandidate } from "../validation/validate-stream.js";
import type { CountryCode, StreamCandidate, ValidationResult } from "../types.js";

type DirectCompatibility =
  | "stable_direct"
  | "refreshable_direct"
  | "header_dependent"
  | "cookie_dependent"
  | "ip_bound"
  | "login_required"
  | "provider_required"
  | "drm"
  | "geo_blocked"
  | "unavailable";

interface DirectCandidate {
  channel: OfficialChannel;
  source: OfficialSource;
  mediaUrl: string;
  sourceType: "direct_hls_official" | "streamlink_url_only";
  discoveredAt: string;
}

interface DirectStatusEntry {
  channelId: string;
  channelName: string;
  country: CountryCode;
  category: string;
  officialPage: string;
  officialOwner: string;
  mediaUrlHash?: string;
  sourceType?: string;
  directCompatibility: DirectCompatibility;
  manifestStatus: "valid" | "invalid";
  segmentBytes: number;
  ffprobeResult: "valid" | "invalid";
  resolution?: string;
  audioCodec?: string;
  videoCodec?: string;
  firstCheckedAt?: string;
  secondCheckedAt?: string;
  expiresAtEstimate?: string;
  failureCategory?: string;
  playable: boolean;
}

const DATA_DIR = path.resolve("data");
const OUTPUT_DIR = DEFAULT_CONFIG.outputDir;
const DIRECT_CANDIDATES_FILE = path.join(DATA_DIR, "direct-candidates.private.json");
const DIRECT_STATUS_FILE = path.join(OUTPUT_DIR, "direct-status.json");
const DIRECT_STATUS_HTML_FILE = path.join(OUTPUT_DIR, "direct-status.html");
const DIRECT_HISTORY_FILE = path.join(DATA_DIR, "direct-health-history.json");

export async function directDiscover(): Promise<DirectCandidate[]> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const channels = loadOfficialChannels();
  const limit = pLimit(3);
  const candidates = (await Promise.all(channels.map((channel) => limit(() => discoverChannel(channel))))).flat();
  fs.writeFileSync(DIRECT_CANDIDATES_FILE, JSON.stringify(candidates.map(serializeCandidate), null, 2), "utf8");
  console.log(`Direct official candidates discovered: ${candidates.length}`);
  return candidates;
}

export async function directValidate(): Promise<DirectStatusEntry[]> {
  const candidates = readCandidates();
  const channelsWithCandidates = new Set(candidates.map((candidate) => candidate.channel.id));
  const missing = loadOfficialChannels()
    .filter((channel) => !channelsWithCandidates.has(channel.id))
    .map((channel) => unavailableEntry(channel, "No direct media candidate discovered"));
  const limit = pLimit(2);
  const validated = await Promise.all(candidates.map((candidate) => limit(() => validateDirectCandidate(candidate))));
  const byChannel = selectBestByChannel([...validated, ...missing]);
  const statuses = loadOfficialChannels().map((channel) => byChannel.get(channel.id) ?? unavailableEntry(channel, "No direct validation result"));
  writeDirectStatus(statuses);
  writeHistory(statuses);
  console.log(`Direct-compatible: ${statuses.filter((entry) => entry.playable).length}`);
  return statuses;
}

export async function directGenerate(): Promise<DirectStatusEntry[]> {
  const statuses = readStatuses();
  writeDirectPlaylists(statuses);
  console.log(`Generated output/playlist-direct.m3u (${statuses.filter((entry) => entry.playable).length} channels)`);
  return statuses;
}

export async function directAudit(): Promise<void> {
  const statuses = readStatuses();
  const text = fs.readFileSync(path.join(OUTPUT_DIR, "playlist-direct.m3u"), "utf8");
  const ids = [...text.matchAll(/tvg-id="([^"]+)"/g)].map((match) => match[1]!);
  const urls = [...text.matchAll(/^(https?:\/\/[^\r\n]+)/gm)].map((match) => match[1]!);
  const errors: string[] = [];
  if (!text.startsWith("#EXTM3U")) errors.push("playlist-direct.m3u does not begin with #EXTM3U");
  const privateUrls = urls.filter(isForbiddenOperationalUrl);
  if (privateUrls.length > 0) errors.push(`Private/local/gateway URLs found: ${privateUrls.length}`);
  if (new Set(ids).size !== ids.length) errors.push("Duplicate tvg-id values found");
  const duplicateUrls = urls.filter((url, index) => urls.indexOf(url) !== index);
  if (duplicateUrls.length > 0) errors.push(`Duplicate media URLs found: ${new Set(duplicateUrls).size}`);
  const playableIds = new Set(statuses.filter((entry) => entry.playable).map((entry) => entry.channelId));
  const unvalidated = ids.filter((id) => !playableIds.has(id));
  if (unvalidated.length > 0) errors.push(`Playlist includes unvalidated channels: ${unvalidated.join(", ")}`);
  if (!countryOrderIsValid(ids)) errors.push("Country ordering is wrong");
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    throw new Error("Direct playlist audit failed");
  }
  console.log(`Private URLs: 0`);
  console.log(`Gateway URLs: 0`);
  console.log(`Duplicate IDs: 0`);
  console.log(`Duplicate media URLs: 0`);
  console.log(`Direct playlist entries: ${ids.length}`);
}

export async function directUpdate(): Promise<void> {
  await directDiscover();
  await directValidate();
  await directGenerate();
  await directAudit();
  const statuses = readStatuses();
  const playable = statuses.filter((entry) => entry.playable);
  console.log(`Stable direct: ${playable.filter((entry) => entry.directCompatibility === "stable_direct").length}`);
  console.log(`Refreshable direct: ${playable.filter((entry) => entry.directCompatibility === "refreshable_direct").length}`);
  console.log(`Total directly playable: ${playable.length}`);
}

async function discoverChannel(channel: OfficialChannel): Promise<DirectCandidate[]> {
  const results: DirectCandidate[] = [];
  for (const source of [...channel.sources].sort((a, b) => a.priority - b.priority)) {
    if (source.type === "provider_required" || source.type === "unavailable" || !source.page) continue;
    if (source.type === "direct_hls_official") {
      results.push({
        channel,
        source,
        mediaUrl: source.page,
        sourceType: "direct_hls_official",
        discoveredAt: new Date().toISOString()
      });
      continue;
    }
    const resolved = await resolveWithStreamlink(source.page).catch(() => undefined);
    if (resolved) {
      results.push({
        channel,
        source,
        mediaUrl: resolved,
        sourceType: "streamlink_url_only",
        discoveredAt: new Date().toISOString()
      });
    }
  }
  return dedupeCandidates(results);
}

async function resolveWithStreamlink(page: string): Promise<string | undefined> {
  const exe = streamlinkExecutable();
  if (!exe) return undefined;
  const output = await runProcess(exe, [
    "--stream-url",
    "--plugin-dirs",
    path.resolve("resolver/plugins"),
    page,
    "best"
  ], 25_000).catch(() => "");
  const url = output.split(/\r?\n/).map((line) => line.trim()).find((line) => /^https?:\/\//i.test(line));
  return url;
}

async function validateDirectCandidate(candidate: DirectCandidate): Promise<DirectStatusEntry> {
  if (isForbiddenOperationalUrl(candidate.mediaUrl)) {
    return failedEntry(candidate, "unavailable", "forbidden_operational_url");
  }
  const first = await validateCandidate(toStreamCandidate(candidate), DEFAULT_CONFIG);
  if (!isDirectPass(first)) return validationFailure(candidate, first);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  const second = await validateCandidate(toStreamCandidate(candidate), DEFAULT_CONFIG, first);
  if (!isDirectPass(second)) return validationFailure(candidate, second, first.checkedAt);
  const compatibility = hasTokenLikeQuery(candidate.mediaUrl) ? "refreshable_direct" : "stable_direct";
  return {
    channelId: candidate.channel.id,
    channelName: candidate.channel.name,
    country: candidate.channel.country,
    category: candidate.channel.category,
    officialPage: candidate.source.page,
    officialOwner: officialOwner(candidate.source.page),
    mediaUrlHash: hashUrl(candidate.mediaUrl),
    sourceType: candidate.sourceType,
    directCompatibility: compatibility,
    manifestStatus: "valid",
    segmentBytes: second.segmentSample?.bytesRead ?? 0,
    ffprobeResult: "valid",
    resolution: second.width && second.height ? `${second.width}x${second.height}` : undefined,
    audioCodec: second.audioCodec,
    videoCodec: second.videoCodec,
    firstCheckedAt: first.checkedAt,
    secondCheckedAt: second.checkedAt,
    failureCategory: undefined,
    playable: true
  };
}

function isDirectPass(result: ValidationResult): boolean {
  return result.status === "portable" && result.manifestValid && result.segmentValid && result.probeValid && result.hasVideo;
}

function validationFailure(candidate: DirectCandidate, result: ValidationResult, firstCheckedAt?: string): DirectStatusEntry {
  let compatibility: DirectCompatibility = "unavailable";
  if (result.status === "portable_with_headers" || result.status === "header_required" || result.status === "local_relay_required") compatibility = "header_dependent";
  if (result.status === "session_bound") compatibility = "cookie_dependent";
  if (result.status === "geo_blocked") compatibility = "geo_blocked";
  if (result.status === "drm_or_encrypted") compatibility = "drm";
  return {
    channelId: candidate.channel.id,
    channelName: candidate.channel.name,
    country: candidate.channel.country,
    category: candidate.channel.category,
    officialPage: candidate.source.page,
    officialOwner: officialOwner(candidate.source.page),
    mediaUrlHash: hashUrl(candidate.mediaUrl),
    sourceType: candidate.sourceType,
    directCompatibility: compatibility,
    manifestStatus: result.manifestValid ? "valid" : "invalid",
    segmentBytes: result.segmentSample?.bytesRead ?? 0,
    ffprobeResult: result.probeValid ? "valid" : "invalid",
    resolution: result.width && result.height ? `${result.width}x${result.height}` : undefined,
    audioCodec: result.audioCodec,
    videoCodec: result.videoCodec,
    firstCheckedAt,
    secondCheckedAt: result.checkedAt,
    failureCategory: result.failureCategory ?? result.failureReason ?? result.status,
    playable: false
  };
}

function failedEntry(candidate: DirectCandidate, compatibility: DirectCompatibility, failureCategory: string): DirectStatusEntry {
  return {
    channelId: candidate.channel.id,
    channelName: candidate.channel.name,
    country: candidate.channel.country,
    category: candidate.channel.category,
    officialPage: candidate.source.page,
    officialOwner: officialOwner(candidate.source.page),
    mediaUrlHash: hashUrl(candidate.mediaUrl),
    sourceType: candidate.sourceType,
    directCompatibility: compatibility,
    manifestStatus: "invalid",
    segmentBytes: 0,
    ffprobeResult: "invalid",
    failureCategory,
    playable: false
  };
}

function unavailableEntry(channel: OfficialChannel, failureCategory: string): DirectStatusEntry {
  const provider = channel.sources.find((source) => source.type === "provider_required");
  return {
    channelId: channel.id,
    channelName: channel.name,
    country: channel.country,
    category: channel.category,
    officialPage: provider?.page ?? "",
    officialOwner: provider ? "provider" : "unknown",
    directCompatibility: provider ? "provider_required" : "unavailable",
    manifestStatus: "invalid",
    segmentBytes: 0,
    ffprobeResult: "invalid",
    failureCategory,
    playable: false
  };
}

function toStreamCandidate(candidate: DirectCandidate): StreamCandidate {
  return {
    channelId: candidate.channel.id,
    channelName: candidate.channel.name,
    country: candidate.channel.country,
    category: candidate.channel.category,
    pageUrl: candidate.source.page,
    streamUrl: candidate.mediaUrl,
    sourceName: `direct:${candidate.sourceType}`,
    discoveryMethod: candidate.source.type === "direct_hls_official" ? "html" : "embedded-script",
    discoveredAt: candidate.discoveredAt
  };
}

function writeDirectStatus(statuses: DirectStatusEntry[]): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const summary = summarize(statuses);
  fs.writeFileSync(DIRECT_STATUS_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), summary, channels: statuses }, null, 2), "utf8");
  fs.writeFileSync(DIRECT_STATUS_HTML_FILE, renderStatusHtml(statuses, summary), "utf8");
}

function writeHistory(statuses: DirectStatusEntry[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const history = fs.existsSync(DIRECT_HISTORY_FILE) ? JSON.parse(fs.readFileSync(DIRECT_HISTORY_FILE, "utf8")) as Record<string, unknown[]> : {};
  for (const status of statuses) {
    const rows = Array.isArray(history[status.channelId]) ? history[status.channelId] as unknown[] : [];
    rows.push({
      checkedAt: new Date().toISOString(),
      playable: status.playable,
      compatibility: status.directCompatibility,
      mediaUrlHash: status.mediaUrlHash,
      failureCategory: status.failureCategory
    });
    history[status.channelId] = rows.slice(-20);
  }
  fs.writeFileSync(DIRECT_HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");
}

function writeDirectPlaylists(statuses: DirectStatusEntry[]): void {
  const channels = loadOfficialChannels();
  const candidateById = new Map(readCandidates().map((candidate) => [candidate.channel.id, candidate]));
  const playableIds = new Set(statuses.filter((entry) => entry.playable).map((entry) => entry.channelId));
  const playableChannels = channels.filter((channel) => playableIds.has(channel.id) && candidateById.has(channel.id));
  writePlaylist("playlist-direct.m3u", playableChannels, candidateById);
  writePlaylist("playlist-direct-az.m3u", playableChannels.filter((channel) => channel.country === "AZ"), candidateById);
  writePlaylist("playlist-direct-tr.m3u", playableChannels.filter((channel) => channel.country === "TR"), candidateById);
  writePlaylist("playlist-direct-ru.m3u", playableChannels.filter((channel) => channel.country === "RU"), candidateById);
  writePlaylist("playlist-direct-international.m3u", playableChannels.filter((channel) => channel.country === "OTHER"), candidateById);
  writeDeprecatedGatewayPlaylists();
}

function writePlaylist(fileName: string, channels: OfficialChannel[], candidateById: Map<string, DirectCandidate>): void {
  let text = "#EXTM3U\n";
  for (const channel of channels) {
    const candidate = candidateById.get(channel.id);
    if (!candidate) continue;
    if (isForbiddenOperationalUrl(candidate.mediaUrl)) throw new Error(`Forbidden URL for ${channel.id}`);
    text += `#EXTINF:-1 tvg-id="${escapeM3u(channel.id)}" tvg-name="${escapeM3u(channel.name)}" group-title="${escapeM3u(groupTitle(channel.country))}",${channel.name}\n`;
    text += `${candidate.mediaUrl}\n`;
  }
  assertNoForbiddenOperationalUrls(text);
  fs.writeFileSync(path.join(OUTPUT_DIR, fileName), text, "utf8");
}

function writeDeprecatedGatewayPlaylists(): void {
  const text = [
    "#EXTM3U",
    "# DEPRECATED: local-gateway playlists are not operational.",
    "# Use output/playlist-direct.m3u or the GitHub raw playlist-direct.m3u URL.",
    ""
  ].join("\n");
  for (const fileName of [
    "playlist-working.m3u",
    "playlist.m3u",
    "playlist-test-all.m3u",
    "playlist-diagnostic-all.m3u",
    "playlist-az.m3u",
    "playlist-tr.m3u",
    "playlist-ru.m3u"
  ]) {
    fs.writeFileSync(path.join(OUTPUT_DIR, fileName), text, "utf8");
  }
}

function readCandidates(): DirectCandidate[] {
  const raw = JSON.parse(fs.readFileSync(DIRECT_CANDIDATES_FILE, "utf8")) as Array<{
    channelId: string;
    sourcePriority: number;
    mediaUrl: string;
    sourceType: "direct_hls_official" | "streamlink_url_only";
    discoveredAt: string;
  }>;
  const channels = new Map(loadOfficialChannels().map((channel) => [channel.id, channel]));
  return raw.flatMap((item) => {
    const channel = channels.get(item.channelId);
    const source = channel?.sources.find((candidateSource) => candidateSource.priority === item.sourcePriority);
    return channel && source ? [{ channel, source, mediaUrl: item.mediaUrl, sourceType: item.sourceType, discoveredAt: item.discoveredAt }] : [];
  });
}

function readStatuses(): DirectStatusEntry[] {
  const parsed = JSON.parse(fs.readFileSync(DIRECT_STATUS_FILE, "utf8")) as { channels: DirectStatusEntry[] };
  return parsed.channels;
}

function serializeCandidate(candidate: DirectCandidate): Record<string, unknown> {
  return {
    channelId: candidate.channel.id,
    sourcePriority: candidate.source.priority,
    mediaUrl: candidate.mediaUrl,
    sourceType: candidate.sourceType,
    discoveredAt: candidate.discoveredAt
  };
}

function selectBestByChannel(entries: DirectStatusEntry[]): Map<string, DirectStatusEntry> {
  const byId = new Map<string, DirectStatusEntry>();
  for (const entry of entries) {
    const current = byId.get(entry.channelId);
    if (!current || scoreEntry(entry) > scoreEntry(current)) byId.set(entry.channelId, entry);
  }
  return byId;
}

function scoreEntry(entry: DirectStatusEntry): number {
  if (entry.directCompatibility === "stable_direct") return 100;
  if (entry.directCompatibility === "refreshable_direct") return 90;
  if (entry.directCompatibility === "provider_required") return -10;
  return entry.playable ? 50 : 0;
}

function summarize(statuses: DirectStatusEntry[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const status of statuses) summary[status.directCompatibility] = (summary[status.directCompatibility] ?? 0) + 1;
  summary.playable = statuses.filter((status) => status.playable).length;
  return summary;
}

function renderStatusHtml(statuses: DirectStatusEntry[], summary: Record<string, number>): string {
  const rows = statuses.map((entry) => `<tr><td>${entry.country}</td><td>${escapeHtml(entry.channelName)}</td><td>${entry.directCompatibility}</td><td>${entry.playable}</td><td>${entry.resolution ?? ""}</td><td>${entry.segmentBytes}</td><td>${escapeHtml(entry.failureCategory ?? "")}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Direct Official IPTV Status</title><style>body{font-family:Arial,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px}th{background:#f3f3f3}</style></head><body><h1>Direct Official IPTV Status</h1><p>Operational playlist: output/playlist-direct.m3u. No local server is required.</p><p>Playable: ${summary.playable ?? 0} Stable direct: ${summary.stable_direct ?? 0} Refreshable direct: ${summary.refreshable_direct ?? 0}</p><table><thead><tr><th>Country</th><th>Channel</th><th>Compatibility</th><th>Playable</th><th>Resolution</th><th>Segment bytes</th><th>Failure</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function countryOrderIsValid(ids: string[]): boolean {
  const channels = new Map(loadOfficialChannels().map((channel) => [channel.id, channel]));
  const ranks = ids.map((id) => countryRank(channels.get(id)?.country ?? "OTHER"));
  return ranks.every((rank, index) => index === 0 || rank >= ranks[index - 1]!);
}

function countryRank(country: CountryCode): number {
  return country === "AZ" ? 0 : country === "TR" ? 1 : country === "RU" ? 2 : 3;
}

function groupTitle(country: CountryCode): string {
  if (country === "AZ") return "Azərbaycan";
  if (country === "TR") return "Türkiyə";
  if (country === "RU") return "Rusiya";
  return "Beynəlxalq";
}

function officialOwner(page: string): string {
  try {
    return new URL(page).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function dedupeCandidates(candidates: DirectCandidate[]): DirectCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.channel.id}|${candidate.mediaUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function streamlinkExecutable(): string | undefined {
  const candidates = [
    process.env["IPTV_STREAMLINK_PATH"],
    firstWhere("streamlink.exe"),
    path.join(process.env["LOCALAPPDATA"] ?? "", "Programs/Streamlink/bin/streamlink.exe"),
    path.join(process.env["ProgramFiles"] ?? "", "Streamlink/bin/streamlink.exe"),
    path.join(process.env["ProgramFiles(x86)"] ?? "", "Streamlink/bin/streamlink.exe")
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function firstWhere(command: string): string | undefined {
  const result = spawnSync("where.exe", [command], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("process timeout"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(sanitizeLog(stderr || `process exited with ${code}`)));
    });
  });
}

function assertNoForbiddenOperationalUrls(text: string): void {
  const urls = [...text.matchAll(/https?:\/\/[^\s]+/g)].map((match) => match[0]!);
  const bad = urls.filter(isForbiddenOperationalUrl);
  if (bad.length > 0) throw new Error(`Forbidden operational URL found: ${bad[0]}`);
}

function isForbiddenOperationalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^10\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
    if (url.port === "8787") return true;
    if (/\/live\/[a-z0-9-]+/i.test(url.pathname)) return true;
    if (/proxy|relay/i.test(url.pathname)) return true;
    return false;
  } catch {
    return true;
  }
}

function hasTokenLikeQuery(raw: string): boolean {
  try {
    const url = new URL(raw);
    return [...url.searchParams.keys()].some((key) => /token|sig|signature|hash|auth|expires|expire|hdnts|hdnea/i.test(key));
  } catch {
    return false;
  }
}

function hashUrl(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function escapeM3u(value: string): string {
  return value.replace(/"/g, "'");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]!));
}

function sanitizeLog(value: string): string {
  return value
    .replace(/(cookie|authorization|proxy-authorization):[^\r\n]*/gi, "$1:<redacted>")
    .replace(/([?&](?:token|hash|sig|signature|auth|key)=)[^&\s]+/gi, "$1<redacted>")
    .slice(0, 1000);
}
