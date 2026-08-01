import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import yaml from "yaml";
import { chromium } from "playwright";
import { DEFAULT_CONFIG } from "./config.js";
import type { CountryCode, PlaybackHeaders, StreamCandidate, ValidationResult } from "./types.js";
import { fetchTextSafe } from "./validation/fetch-manifest.js";
import { validateCandidate } from "./validation/validate-stream.js";
import { createSafeContext } from "./discovery/browser-utils.js";
import { captureMediaRequests, type CapturedRequest } from "./discovery/media-request-capture.js";
import { escapeMetadata } from "./output/generate-m3u.js";
import { YodaAdapter } from "./sources/yoda.js";
import { PublicIptvAdapter } from "./sources/public-iptv.js";

export const SHOOTOUT_IDS = new Set([
  "aztv",
  "arb",
  "xezer-tv",
  "trt-1",
  "kanal-d",
  "show-tv",
  "ntv-ru",
  "rossiya-24",
  "pyatyy-kanal"
]);

export type ShootoutClassification =
  | "stable_direct"
  | "stable_with_headers"
  | "refreshable_public"
  | "browser_bound"
  | "blocked"
  | "invalid";

export type ShootoutCell =
  | "PASS_DIRECT"
  | "PASS_HEADERS"
  | "PASS_REFRESHABLE"
  | "FAIL_403"
  | "FAIL_COOKIE"
  | "FAIL_SESSION"
  | "FAIL_NOT_FOUND"
  | "FAIL_MEDIA"
  | "NOT_TESTED";

interface ShootoutConfig {
  channels: ShootoutChannel[];
}

interface ShootoutChannel {
  id: string;
  name: string;
  country: CountryCode;
  aliases: string[];
  sources: ShootoutSource[];
}

interface ShootoutSource {
  group: string;
  site: string;
  pageUrl: string;
}

export interface ShootoutRecord {
  region: string;
  channelId: string;
  channel: string;
  sourceGroup: string;
  sourceSite: string;
  pageUrl: string;
  alternativeNumber?: string;
  discoveryMethod: string;
  streamType?: string;
  httpStatus?: number;
  manifestValid: boolean;
  segmentValid: boolean;
  ffprobeValid: boolean;
  videoCodec?: string;
  audioCodec?: string;
  resolution?: string;
  requiredHeaders: string[];
  cookiesRequired: boolean;
  authorizationRequired: boolean;
  firstUrl?: string;
  secondUrl?: string;
  repeatable: boolean;
  classification: ShootoutClassification;
  suitability: "m3u_ready" | "not_suitable";
  score: number;
  exactFailureReason?: string;
}

interface DiscoveryAttempt {
  pageUrl: string;
  alternativeNumber?: string;
  method: string;
  url?: string;
  headers?: PlaybackHeaders;
  requiredHeaderNames: string[];
  cookiesRequired: boolean;
  authorizationRequired: boolean;
  attemptError?: string;
}

export function acceptsShootoutChannel(channelId: string): boolean {
  return SHOOTOUT_IDS.has(channelId);
}

export function discoverVoloAlternatives(pageUrl: string, html: string): string[] {
  const urls = new Set<string>([pageUrl]);
  for (const match of html.matchAll(/[?&]yayin=([123])\b/gi)) {
    urls.add(new URL(`?yayin=${match[1]}`, pageUrl).toString());
  }
  for (const num of ["1", "2", "3"]) {
    if (html.toLocaleLowerCase("tr").includes(`yayin=${num}`)) {
      urls.add(new URL(`?yayin=${num}`, pageUrl).toString());
    }
  }
  return [...urls];
}

export function discoverIzleAlternatives(pageUrl: string, html: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>([pageUrl]);
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const url = new URL(href, pageUrl);
    if (url.origin !== new URL(pageUrl).origin) return;
    if (/\/[12]\/?$/i.test(url.pathname)) urls.add(url.toString());
  });
  return [...urls];
}

export function extractIframeUrls(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $("iframe[src], iframe[data-src]").each((_, el) => {
    const raw = $(el).attr("src") || $(el).attr("data-src");
    if (!raw) return;
    try {
      urls.add(new URL(raw, baseUrl).toString());
    } catch {
      // ignore malformed iframe
    }
  });
  return [...urls];
}

export function extractMediaUrlsFromHtml(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  const attrs = ["src", "data-src", "data-stream", "data-video", "data-hls", "data-url"];
  for (const attr of attrs) {
    $(`[${attr}]`).each((_, el) => addMaybeMediaUrl($(el).attr(attr), baseUrl, urls));
  }
  const mediaRegex = /https?:\/\/[^"'\\\s<>]+?(?:\.m3u8|\.mpd)(?:\?[^"'\\\s<>]*)?/gi;
  for (const match of html.matchAll(mediaRegex)) addMaybeMediaUrl(match[0], baseUrl, urls);
  return [...urls];
}

export function classifyShootoutResult(
  first?: ValidationResult,
  second?: ValidationResult,
  firstHeaders: string[] = [],
  secondHeaders: string[] = []
): ShootoutClassification {
  const bestFailure = `${first?.failureReason ?? ""} ${second?.failureReason ?? ""}`.toLowerCase();
  if (bestFailure.includes("403")) return "blocked";
  if (!first || !second) return "invalid";
  if (first.status === "session_bound" || second.status === "session_bound") return "browser_bound";
  if (first.status === "local_relay_required" || second.status === "local_relay_required") return "browser_bound";
  if (!isValidationPlayable(first) || !isValidationPlayable(second)) return "invalid";
  const headers = new Set([...firstHeaders, ...secondHeaders].map((h) => h.toLowerCase()));
  if (first.streamUrl !== second.streamUrl) return "refreshable_public";
  if (headers.has("referer") || headers.has("user-agent")) return "stable_with_headers";
  return "stable_direct";
}

export function scoreShootoutSource(input: {
  independentlyPlayable: boolean;
  requiredHeaders: string[];
  stableUrl: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  https: boolean;
  startupMs?: number;
  multipleQualities: boolean;
  shortLivedToken: boolean;
  browserBound: boolean;
  cookieOrAuthorization: boolean;
  http403: boolean;
}): number {
  let score = 0;
  if (input.independentlyPlayable) score += 40;
  if (input.requiredHeaders.length === 0) score += 20;
  if (input.stableUrl) score += 15;
  if (input.hasVideo && input.hasAudio) score += 10;
  if (input.https) score += 5;
  if ((input.startupMs ?? Number.POSITIVE_INFINITY) < 5000) score += 5;
  if (input.multipleQualities) score += 5;
  const required = new Set(input.requiredHeaders.map((h) => h.toLowerCase()));
  if (required.has("referer")) score -= 20;
  if (required.has("origin")) score -= 25;
  if (input.shortLivedToken) score -= 40;
  if (input.browserBound) score -= 50;
  if (input.cookieOrAuthorization) score -= 100;
  if (input.http403) score -= 100;
  return score;
}

export function cellForRecord(record?: ShootoutRecord): ShootoutCell {
  if (!record) return "NOT_TESTED";
  if (record.classification === "stable_direct") return "PASS_DIRECT";
  if (record.classification === "stable_with_headers") return "PASS_HEADERS";
  if (record.classification === "refreshable_public") return "PASS_REFRESHABLE";
  if (record.authorizationRequired || record.cookiesRequired) return record.authorizationRequired ? "FAIL_COOKIE" : "FAIL_COOKIE";
  if (record.exactFailureReason?.includes("403") || record.httpStatus === 403) return "FAIL_403";
  if (record.classification === "browser_bound") return "FAIL_SESSION";
  if (record.exactFailureReason?.includes("404") || record.httpStatus === 404) return "FAIL_NOT_FOUND";
  return "FAIL_MEDIA";
}

export function decideRegionalPrimary(records: ShootoutRecord[], sourceGroups: string[]): string {
  const passCounts = sourceGroups.map((source) => ({
    source,
    count: records.filter((r) => r.sourceGroup === source && r.suitability === "m3u_ready").length
  }));
  const winner = passCounts.sort((a, b) => b.count - a.count || sourceGroups.indexOf(a.source) - sourceGroups.indexOf(b.source))[0];
  if (winner && winner.count >= 2) return winner.source;
  return "mixed per-channel";
}

export async function runShootout(): Promise<void> {
  const config = readShootoutConfig(path.resolve("data/source-shootout.yml"));
  const outputDir = DEFAULT_CONFIG.outputDir;
  const records: ShootoutRecord[] = [];

  for (const channel of config.channels) {
    if (!acceptsShootoutChannel(channel.id)) continue;
    for (const source of channel.sources) {
      console.log(`Shootout: ${channel.name} via ${source.group} (${source.site})`);
      const sourceRecords = source.pageUrl === "yoda-public-iptv"
        ? await testFallbackDiscovery(channel, source)
        : await testSourcePage(channel, source);
      records.push(...sourceRecords);
    }
  }

  const selected = selectShootoutPlaylist(records);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "shootout-report.json"), JSON.stringify(buildShootoutReport(records, selected), null, 2), "utf8");
  fs.writeFileSync(path.join(outputDir, "shootout-report.html"), renderShootoutHtml(records, selected), "utf8");
  fs.writeFileSync(path.join(outputDir, "playlist-shootout.m3u"), renderShootoutPlaylist(selected), "utf8");
  printShootoutTables(records);
}

function readShootoutConfig(filePath: string): ShootoutConfig {
  const parsed = yaml.parse(fs.readFileSync(filePath, "utf8")) as ShootoutConfig;
  if (parsed.channels.length !== 9) throw new Error("Shootout config must contain exactly nine channels");
  for (const channel of parsed.channels) {
    if (!acceptsShootoutChannel(channel.id)) throw new Error(`Unexpected shootout channel: ${channel.id}`);
  }
  return parsed;
}

async function testSourcePage(channel: ShootoutChannel, source: ShootoutSource): Promise<ShootoutRecord[]> {
  const pageUrls = await getSourcePageAlternatives(channel, source);
  const records: ShootoutRecord[] = [];
  for (const pageUrl of pageUrls) {
    const first = await discoverAndValidatePage(channel, source, pageUrl);
    await new Promise((resolve) => setTimeout(resolve, 10000));
    const second = await discoverAndValidatePage(channel, source, pageUrl);
    records.push(buildRecord(channel, source, pageUrl, first, second));
  }
  return records;
}

async function testFallbackDiscovery(channel: ShootoutChannel, source: ShootoutSource): Promise<ShootoutRecord[]> {
  try {
    const fallbackConfig = {
      ...DEFAULT_CONFIG,
      enabledAdapters: ["yoda", "public-iptv"],
      countries: [channel.country],
      maxTotalCandidates: 20,
      maxSourcePages: 5
    };
    const adapterResults = await Promise.all([
      new YodaAdapter().discover(fallbackConfig),
      new PublicIptvAdapter().discover(fallbackConfig)
    ]);
    const candidates = adapterResults.flatMap((result) => result.candidates);
    const matching = candidates.filter((c) => c.channelId === channel.id).slice(0, 3);
    const records: ShootoutRecord[] = [];
    for (const candidate of matching) {
      const firstValidation = await validateCandidate(candidate, DEFAULT_CONFIG);
      await new Promise((resolve) => setTimeout(resolve, 10000));
      const secondValidation = await validateCandidate(candidate, DEFAULT_CONFIG);
      const attempt: DiscoveryAttempt = {
        pageUrl: source.pageUrl,
        method: "fallback-adapter",
        url: candidate.streamUrl,
        headers: candidate.metadata?.playbackHeaders as PlaybackHeaders | undefined,
        requiredHeaderNames: candidate.metadata?.requiredHeaderNames ?? [],
        cookiesRequired: candidate.metadata?.requiredHeaderNames?.includes("cookie") ?? false,
        authorizationRequired: candidate.metadata?.requiredHeaderNames?.includes("authorization") ?? false
      };
      records.push(buildRecord(channel, source, source.pageUrl, { attempt, validation: firstValidation }, { attempt, validation: secondValidation }));
    }
    if (records.length > 0) return records;
  } catch (err: any) {
    return [failedRecord(channel, source, source.pageUrl, err.message)];
  }
  return [failedRecord(channel, source, source.pageUrl, "No matching fallback candidate discovered")];
}

async function getSourcePageAlternatives(channel: ShootoutChannel, source: ShootoutSource): Promise<string[]> {
  if (source.pageUrl.startsWith("discover:")) {
    return discoverCatalogPage(source.pageUrl, channel);
  }
  try {
    const html = (await fetchTextSafe(source.pageUrl, { timeoutMs: 12000, limitBytes: 2 * 1024 * 1024 })).text;
    if (source.group === "VoloTV") return discoverVoloAlternatives(source.pageUrl, html);
    if (source.group === "izle.cc") return discoverIzleAlternatives(source.pageUrl, html);
  } catch {
    // still test configured page
  }
  return [source.pageUrl];
}

async function discoverCatalogPage(pageUrl: string, channel: ShootoutChannel): Promise<string[]> {
  if (pageUrl === "discover:show-tv") {
    const catalog = "https://tv.canlitvvolo.com/";
    try {
      const html = (await fetchTextSafe(catalog, { timeoutMs: 12000, limitBytes: 2 * 1024 * 1024 })).text;
      const $ = cheerio.load(html);
      const found = new Set<string>();
      $("a[href]").each((_, el) => {
        const text = $(el).text().toLocaleLowerCase("tr");
        const href = $(el).attr("href");
        if (!href || !channel.aliases.some((alias) => text.includes(alias.toLocaleLowerCase("tr")))) return;
        found.add(new URL(href, catalog).toString());
      });
      if (found.size > 0) return [...found];
    } catch {
      // Catalog access can be blocked; still test the common public slug as a normal source page.
    }
    return ["https://tv.canlitvvolo.com/show-tv-canli-izle/"];
  }
  return [];
}

async function discoverAndValidatePage(
  channel: ShootoutChannel,
  source: ShootoutSource,
  pageUrl: string
): Promise<{ attempt: DiscoveryAttempt; validation?: ValidationResult }> {
  const attempt = await discoverPageAttempt(channel, source, pageUrl);
  if (!attempt.url) return { attempt };
  const candidate = attemptToCandidate(channel, source, attempt);
  const validation = await validateCandidate(candidate, DEFAULT_CONFIG);
  return { attempt, validation };
}

async function discoverPageAttempt(channel: ShootoutChannel, source: ShootoutSource, pageUrl: string): Promise<DiscoveryAttempt> {
  try {
    const staticAttempt = await staticDiscovery(channel, source, pageUrl, 0);
    if (staticAttempt.url) return staticAttempt;
  } catch (err: any) {
    return baseAttempt(pageUrl, "static-html", err.message);
  }
  return browserDiscovery(channel, source, pageUrl);
}

async function staticDiscovery(_channel: ShootoutChannel, _source: ShootoutSource, pageUrl: string, depth: number): Promise<DiscoveryAttempt> {
  const html = (await fetchTextSafe(pageUrl, { timeoutMs: 12000, limitBytes: 2 * 1024 * 1024 })).text;
  const mediaUrls = extractMediaUrlsFromHtml(html, pageUrl);
  if (mediaUrls[0]) return { ...baseAttempt(pageUrl, depth === 0 ? "static-html" : "public-iframe"), url: mediaUrls[0], requiredHeaderNames: [] };
  if (depth >= 2) return baseAttempt(pageUrl, "public-iframe", "No media URL found at iframe depth limit");
  for (const iframeUrl of extractIframeUrls(html, pageUrl)) {
    const child = await staticDiscovery(_channel, _source, iframeUrl, depth + 1);
    if (child.url) return child;
  }
  return baseAttempt(pageUrl, depth === 0 ? "static-html" : "public-iframe", "No static media or iframe media found");
}

async function browserDiscovery(_channel: ShootoutChannel, source: ShootoutSource, pageUrl: string): Promise<DiscoveryAttempt> {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const allowedDomains = allowedDomainsFor(pageUrl, source);
    const context = await createSafeContext(browser, allowedDomains);
    const page = await context.newPage();
    try {
      const captured = await captureMediaRequests(page, async () => {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: DEFAULT_CONFIG.browserTimeoutMs });
        await page.waitForTimeout(DEFAULT_CONFIG.browserCaptureTimeMs);
      });
      const selected = selectCapturedMedia(captured);
      if (!selected) return baseAttempt(pageUrl, "browser-network", "No media request captured");
      return capturedToAttempt(pageUrl, selected);
    } finally {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  } catch (err: any) {
    return baseAttempt(pageUrl, "browser-network", err.message);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

function selectCapturedMedia(captured: CapturedRequest[]): CapturedRequest | undefined {
  return captured
    .filter((request) => /\.m3u8(?:[?#]|$)|\.mpd(?:[?#]|$)|manifest|playlist|master/i.test(request.url))
    .sort((a, b) => mediaPreference(a.url) - mediaPreference(b.url))[0];
}

function mediaPreference(url: string): number {
  const lower = url.toLowerCase();
  if (lower.includes("master")) return 0;
  if (lower.includes("playlist")) return 1;
  if (lower.includes(".m3u8")) return 2;
  if (lower.includes(".mpd")) return 3;
  return 4;
}

function capturedToAttempt(pageUrl: string, request: CapturedRequest): DiscoveryAttempt {
  const requiredHeaderNames = request.headersPresent.customHeaders;
  return {
    pageUrl,
    method: "browser-network",
    url: request.url,
    headers: request.playbackHeaders,
    requiredHeaderNames,
    cookiesRequired: request.headersPresent.cookie,
    authorizationRequired: request.headersPresent.authorization
  };
}

function attemptToCandidate(channel: ShootoutChannel, source: ShootoutSource, attempt: DiscoveryAttempt): StreamCandidate {
  return {
    channelId: channel.id,
    channelName: channel.name,
    country: channel.country,
    category: "general",
    pageUrl: attempt.pageUrl,
    streamUrl: attempt.url!,
    sourceName: source.site,
    discoveryMethod: attempt.method === "browser-network" ? "browser-network" : attempt.method === "public-iframe" ? "iframe" : "html",
    discoveredAt: new Date().toISOString(),
    metadata: {
      playbackHeaders: attempt.headers,
      requiredHeaderNames: attempt.requiredHeaderNames
    }
  };
}

function buildRecord(
  channel: ShootoutChannel,
  source: ShootoutSource,
  pageUrl: string,
  first: { attempt: DiscoveryAttempt; validation?: ValidationResult },
  second?: { attempt: DiscoveryAttempt; validation?: ValidationResult }
): ShootoutRecord {
  const requiredHeaders = [...new Set([...(first.attempt.requiredHeaderNames ?? []), ...(second?.attempt.requiredHeaderNames ?? [])])];
  const classification = classifyShootoutResult(first.validation, second?.validation, first.attempt.requiredHeaderNames, second?.attempt.requiredHeaderNames);
  const playable = ["stable_direct", "stable_with_headers", "refreshable_public"].includes(classification);
  const hasOrigin = requiredHeaders.some((h) => h.toLowerCase() === "origin");
  const cookiesRequired = first.attempt.cookiesRequired || !!second?.attempt.cookiesRequired;
  const authorizationRequired = first.attempt.authorizationRequired || !!second?.attempt.authorizationRequired;
  const browserBound = classification === "browser_bound" || cookiesRequired || authorizationRequired || hasOrigin;
  const validation = first.validation ?? second?.validation;
  const score = scoreShootoutSource({
    independentlyPlayable: playable,
    requiredHeaders,
    stableUrl: !!first.validation && !!second?.validation && first.validation.streamUrl === second.validation.streamUrl,
    hasVideo: !!validation?.hasVideo,
    hasAudio: !!validation?.hasAudio,
    https: (first.validation?.streamUrl ?? first.attempt.url ?? "").startsWith("https://"),
    startupMs: validation?.latencyMs,
    multipleQualities: false,
    shortLivedToken: validation?.stability === "short_lived",
    browserBound,
    cookieOrAuthorization: cookiesRequired || authorizationRequired,
    http403: `${first.validation?.failureReason ?? ""} ${second?.validation?.failureReason ?? ""}`.includes("403")
  });
  return {
    region: channel.country,
    channelId: channel.id,
    channel: channel.name,
    sourceGroup: source.group,
    sourceSite: source.site,
    pageUrl,
    alternativeNumber: getAlternativeNumber(pageUrl),
    discoveryMethod: first.attempt.method,
    streamType: first.attempt.url?.includes(".mpd") ? "DASH" : first.attempt.url ? "HLS" : undefined,
    httpStatus: statusFromFailure(first.validation?.failureReason ?? second?.validation?.failureReason),
    manifestValid: !!validation?.manifestValid,
    segmentValid: !!validation?.segmentValid,
    ffprobeValid: !!validation?.probeValid,
    videoCodec: validation?.videoCodec,
    audioCodec: validation?.audioCodec,
    resolution: validation?.width && validation.height ? `${validation.width}x${validation.height}` : undefined,
    requiredHeaders,
    cookiesRequired,
    authorizationRequired,
    firstUrl: first.validation?.streamUrl ?? first.attempt.url,
    secondUrl: second?.validation?.streamUrl ?? second?.attempt.url,
    repeatable: !!first.validation && !!second?.validation && (first.validation.streamUrl === second.validation.streamUrl || playable),
    classification,
    suitability: playable && !browserBound ? "m3u_ready" : "not_suitable",
    score,
    exactFailureReason: first.validation?.failureReason ?? second?.validation?.failureReason ?? first.attempt.attemptError
  };
}

function failedRecord(channel: ShootoutChannel, source: ShootoutSource, pageUrl: string, reason: string): ShootoutRecord {
  return {
    region: channel.country,
    channelId: channel.id,
    channel: channel.name,
    sourceGroup: source.group,
    sourceSite: source.site,
    pageUrl,
    discoveryMethod: "none",
    manifestValid: false,
    segmentValid: false,
    ffprobeValid: false,
    requiredHeaders: [],
    cookiesRequired: false,
    authorizationRequired: false,
    repeatable: false,
    classification: reason.includes("403") ? "blocked" : "invalid",
    suitability: "not_suitable",
    score: reason.includes("403") ? -100 : 0,
    exactFailureReason: reason
  };
}

function baseAttempt(pageUrl: string, method: string, error?: string): DiscoveryAttempt {
  return {
    pageUrl,
    method,
    requiredHeaderNames: [],
    cookiesRequired: false,
    authorizationRequired: false,
    attemptError: error
  };
}

function isValidationPlayable(result: ValidationResult): boolean {
  return result.manifestValid && result.segmentValid && result.probeValid && (result.status === "portable" || result.status === "portable_with_headers");
}

function allowedDomainsFor(pageUrl: string, source: ShootoutSource): string[] {
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  const domains = [host, "jwpcdn.com", "jwplayer.com", "cloudfront.net", "akamaized.net", "cdnvideo.ru", "yodacdn.net"];
  if (source.group === "Smotrim.ru") domains.push("vgtrk.com", "smotrim.ru");
  if (source.group === "NTV.ru") domains.push("ntv.ru");
  return domains;
}

function addMaybeMediaUrl(raw: string | undefined, baseUrl: string, urls: Set<string>): void {
  if (!raw) return;
  if (!/\.(m3u8|mpd)(?:[?#]|$)/i.test(raw)) return;
  try {
    urls.add(new URL(raw, baseUrl).toString());
  } catch {
    // ignore malformed media URL
  }
}

function statusFromFailure(reason?: string): number | undefined {
  const match = reason?.match(/HTTP Error (\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function getAlternativeNumber(pageUrl: string): string | undefined {
  const url = new URL(pageUrl);
  return url.searchParams.get("yayin") ?? url.pathname.match(/\/([123])\/?$/)?.[1];
}

function selectShootoutPlaylist(records: ShootoutRecord[]): ShootoutRecord[] {
  const selected: ShootoutRecord[] = [];
  for (const id of SHOOTOUT_IDS) {
    const best = records
      .filter((record) => record.channelId === id && record.suitability === "m3u_ready")
      .sort((a, b) => b.score - a.score)[0];
    if (best) selected.push(best);
  }
  return selected.slice(0, 9);
}

function buildShootoutReport(records: ShootoutRecord[], selected: ShootoutRecord[]) {
  return {
    generatedAt: new Date().toISOString(),
    channelsTested: [...SHOOTOUT_IDS],
    records,
    selected,
    regionalPrimary: {
      AZ: decideRegionalPrimary(records.filter((r) => r.region === "AZ"), ["VoloTV", "Official", "Fallback"]),
      TR: decideRegionalPrimary(records.filter((r) => r.region === "TR"), ["izle.cc", "VoloTV", "Official"]),
      RU: decideRegionalPrimary(records.filter((r) => r.region === "RU"), ["Smotrim.ru", "NTV.ru", "Third-party"])
    }
  };
}

function renderShootoutHtml(records: ShootoutRecord[], selected: ShootoutRecord[]): string {
  const rows = records.map((r) => `<tr><td>${escapeHtml(r.region)}</td><td>${escapeHtml(r.channel)}</td><td>${escapeHtml(r.sourceGroup)}</td><td>${escapeHtml(r.sourceSite)}</td><td>${escapeHtml(cellForRecord(r))}</td><td>${escapeHtml(r.classification)}</td><td>${r.score}</td><td>${escapeHtml(r.resolution ?? "")}</td><td>${escapeHtml(r.requiredHeaders.join(", "))}</td><td>${escapeHtml(r.exactFailureReason ?? "")}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>IPTV Source Shootout</title><style>body{font-family:Arial,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px}th{background:#f4f4f4;text-align:left}</style></head><body><h1>IPTV Source Shootout</h1><p>Selected playlist channels: ${selected.length}</p><table><thead><tr><th>Region</th><th>Channel</th><th>Group</th><th>Site</th><th>Cell</th><th>Class</th><th>Score</th><th>Resolution</th><th>Headers</th><th>Failure</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function renderShootoutPlaylist(selected: ShootoutRecord[]): string {
  let content = "#EXTM3U\n";
  for (const record of selected) {
    content += `#EXTINF:-1 tvg-id="${escapeMetadata(record.channelId)}" tvg-name="${escapeMetadata(record.channel)}" group-title="${escapeMetadata(record.region)}",${escapeMetadata(record.channel)}\n`;
    if (record.requiredHeaders.includes("user-agent")) content += "#EXTVLCOPT:http-user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\n";
    if (record.requiredHeaders.includes("referer") && record.pageUrl) content += `#EXTVLCOPT:http-referrer=${record.pageUrl}\n`;
    content += `${record.secondUrl ?? record.firstUrl}\n`;
  }
  return content;
}

function printShootoutTables(records: ShootoutRecord[]): void {
  printRegion("AZERBAIJAN", ["AzTV", "ARB", "Xəzər TV"], ["VoloTV", "Official", "Fallback"], records);
  printRegion("TURKEY", ["TRT 1", "Kanal D", "Show TV"], ["izle.cc", "VoloTV", "Official"], records);
  printRegion("RUSSIA", ["НТВ", "Россия 24", "Пятый канал"], ["Smotrim.ru", "NTV.ru", "Third-party"], records);
}

function printRegion(title: string, channels: string[], groups: string[], records: ShootoutRecord[]): void {
  console.log(`\n${title}`);
  console.log(`Channel | ${groups.join(" | ")} | Winner`);
  for (const channel of channels) {
    const channelRecords = records.filter((r) => r.channel === channel);
    const cells = groups.map((group) => cellForRecord(channelRecords.filter((r) => r.sourceGroup === group).sort((a, b) => b.score - a.score)[0]));
    const winner = channelRecords.filter((r) => r.suitability === "m3u_ready").sort((a, b) => b.score - a.score)[0]?.sourceGroup ?? "None";
    console.log(`${channel} | ${cells.join(" | ")} | ${winner}`);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]!));
}
