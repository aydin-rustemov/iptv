import fs from "node:fs";
import { chromium, type Request, type Response } from "playwright";
import { fastCheck, isForbiddenUrl, mediaCheck } from "./validator.js";
import type { FastCheckResult, MediaCheckResult, PlaylistEntry } from "./types.js";

const BASE_PAGE = "https://tv.canlitvvolo.com/arb-tv-az-izle/";
const PAGE_ORIGIN = "https://tv.canlitvvolo.com";
const TEST_PLAYLIST = "output/playlist-volo-test.m3u";
const STATUS_FILE = "output/volo-arb-status.json";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type FinalStatus =
  | "working_plain"
  | "working_with_public_headers"
  | "dns_failure"
  | "http_403"
  | "http_404"
  | "invalid_manifest"
  | "segment_failed"
  | "session_or_cookie_dependent"
  | "all_alternatives_failed";

interface PlayerJson {
  streamUrl?: string;
  playerType?: string;
  channelName?: string;
  iframeUrl?: string | null;
  customCode?: string | null;
  broadcastButtons?: unknown[];
  yayinNo?: number;
}

interface AlternativeStatus {
  yayin: number;
  pageUrl: string;
  apiEndpoint?: string;
  apiMethod?: string;
  channelName?: string;
  playerType?: string;
  iframeUrl?: string | null;
  customCodePresent?: boolean;
  broadcastButtons?: unknown[];
  streamHost?: string;
  streamUrl?: string;
  capturedManifestHeaders: string[];
  plainRequestResult: string;
  publicHeaderResult: string;
  manifestResult: string;
  segmentBytes: number;
  ffprobeResult: string;
  browserClosedRetest: string;
  finalStatus: FinalStatus;
}

interface VoloStatus {
  page: string;
  apiEndpoint?: string;
  apiMethod?: string;
  alternativesChecked: number;
  channelName?: string;
  playerType?: string;
  candidateHost?: string;
  plainRequestResult?: string;
  publicHeaderResult?: string;
  manifestResult?: string;
  segmentBytes?: number;
  ffprobeResult?: string;
  browserClosedRetest?: string;
  finalStatus: FinalStatus;
  alternatives: AlternativeStatus[];
}

async function main(): Promise<void> {
  fs.mkdirSync("output", { recursive: true });
  const alternatives: AlternativeStatus[] = [];
  for (const yayin of [1, 2, 3]) {
    alternatives.push(await testAlternative(yayin));
  }

  const winner = alternatives.find((item) => item.finalStatus === "working_plain" || item.finalStatus === "working_with_public_headers");
  const representative = winner ?? alternatives.find((item) => item.streamHost) ?? alternatives[0];
  writePlaylist(winner);
  const status: VoloStatus = {
    page: BASE_PAGE,
    apiEndpoint: representative?.apiEndpoint,
    apiMethod: representative?.apiMethod,
    alternativesChecked: alternatives.length,
    channelName: representative?.channelName,
    playerType: representative?.playerType,
    candidateHost: representative?.streamHost,
    plainRequestResult: representative?.plainRequestResult,
    publicHeaderResult: representative?.publicHeaderResult,
    manifestResult: representative?.manifestResult,
    segmentBytes: representative?.segmentBytes,
    ffprobeResult: representative?.ffprobeResult,
    browserClosedRetest: representative?.browserClosedRetest,
    finalStatus: winner?.finalStatus ?? summarizeFailure(alternatives),
    alternatives: alternatives.map(sanitizeAlternative)
  };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), "utf8");
  validatePlaylistFile();
  console.log(JSON.stringify(status, null, 2));
}

async function testAlternative(yayin: number): Promise<AlternativeStatus> {
  const pageUrl = `${BASE_PAGE}?yayin=${yayin}`;
  const capturedJson: Array<{ url: string; method: string; json: PlayerJson }> = [];
  const capturedHeaders = new Map<string, Record<string, string>>();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    serviceWorkers: "block",
    userAgent: USER_AGENT
  });
  const page = await context.newPage();
  page.on("request", (request) => {
    if (isMediaLike(request.url())) capturedHeaders.set(request.url(), collectPublicHeaders(request));
  });
  page.on("response", async (response) => {
    await maybeCaptureJson(response, capturedJson);
  });

  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForTimeout(8_000);
  } catch {
    // Validation below records the absence of a usable player response.
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  const player = latestPlayerJson(capturedJson);
  const streamUrl = player?.json.streamUrl;
  const headerNames = [...new Set([...capturedHeaders.values()].flatMap((headers) => Object.keys(headers)))];
  const base: AlternativeStatus = {
    yayin,
    pageUrl,
    apiEndpoint: player?.url,
    apiMethod: player?.method,
    channelName: player?.json.channelName,
    playerType: player?.json.playerType,
    iframeUrl: player?.json.iframeUrl ?? null,
    customCodePresent: Boolean(player?.json.customCode),
    broadcastButtons: player?.json.broadcastButtons,
    streamHost: streamUrl ? safeHost(streamUrl) : undefined,
    streamUrl,
    capturedManifestHeaders: headerNames,
    plainRequestResult: "not_tested",
    publicHeaderResult: "not_tested",
    manifestResult: "not_tested",
    segmentBytes: 0,
    ffprobeResult: "not_tested",
    browserClosedRetest: "not_tested",
    finalStatus: "all_alternatives_failed"
  };

  if (!streamUrl) return { ...base, plainRequestResult: "no_stream_url", finalStatus: "all_alternatives_failed" };
  if (isForbiddenUrl(streamUrl, { allowLivePath: true })) return { ...base, plainRequestResult: "forbidden_url", finalStatus: "all_alternatives_failed" };

  const plain = await validateStream(streamUrl, {});
  if (plain.ok) {
    const retest = await validateStream(streamUrl, {});
    return resultFromValidation(base, plain, retest, "working_plain");
  }
  base.plainRequestResult = validationLabel(plain.fast, plain.media);

  const playlistHeaders = {
    "User-Agent": USER_AGENT,
    Referer: PAGE_ORIGIN + "/"
  };
  const fullPublicHeaders = {
    ...playlistHeaders,
    Origin: PAGE_ORIGIN
  };
  const withHeaders = await validateStream(streamUrl, playlistHeaders);
  if (withHeaders.ok) {
    const retest = await validateStream(streamUrl, playlistHeaders);
    return resultFromValidation(base, withHeaders, retest, "working_with_public_headers");
  }
  const withOrigin = await validateStream(streamUrl, fullPublicHeaders);

  return {
    ...base,
    publicHeaderResult: withOrigin.ok ? "origin_required_not_m3u_compatible" : validationLabel(withHeaders.fast, withHeaders.media),
    manifestResult: (withOrigin.ok || withHeaders.fast?.ok) ? "valid_manifest" : validationLabel(withHeaders.fast, undefined),
    segmentBytes: withOrigin.media?.bytesRead ?? withHeaders.media?.bytesRead ?? 0,
    ffprobeResult: withOrigin.media?.ok ? "video_detected" : (withHeaders.media?.reason ?? "not_tested"),
    browserClosedRetest: "not_tested",
    finalStatus: withOrigin.ok ? "session_or_cookie_dependent" : classifyFailure(withHeaders.fast, withHeaders.media)
  };
}

async function maybeCaptureJson(response: Response, captured: Array<{ url: string; method: string; json: PlayerJson }>): Promise<void> {
  try {
    const contentType = response.headers()["content-type"] ?? "";
    if (!contentType.includes("json") && !/api|ajax|player|stream|yayin|broadcast/i.test(response.url())) return;
    const parsed = await response.json() as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (isPlayerJson(item)) captured.push({ url: response.url(), method: response.request().method(), json: item });
    }
  } catch {
    // Non-JSON or already-consumed response.
  }
}

function isPlayerJson(value: unknown): value is PlayerJson {
  return Boolean(value && typeof value === "object" && ("streamUrl" in value || "playerType" in value || "broadcastButtons" in value));
}

function latestPlayerJson(captured: Array<{ url: string; method: string; json: PlayerJson }>): { url: string; method: string; json: PlayerJson } | undefined {
  return [...captured].reverse().find((item) => item.json.streamUrl);
}

async function validateStream(url: string, headers: Record<string, string>): Promise<{ ok: boolean; fast?: FastCheckResult; media?: MediaCheckResult }> {
  const entry: PlaylistEntry = {
    sourceName: "volo-arb-test",
    tvgId: "arb-volo-test",
    tvgName: "ARB - Volo Test",
    groupTitle: "VOLO Test",
    country: "VOLO Test",
    category: "General",
    name: "ARB - Volo Test",
    url,
    headers,
    allowLivePath: true
  };
  const fast = await fastCheck(entry);
  if (!fast.ok) return { ok: false, fast };
  const media = await mediaCheck(entry, fast);
  return { ok: media.ok, fast, media };
}

function resultFromValidation(base: AlternativeStatus, validation: { fast?: FastCheckResult; media?: MediaCheckResult }, retest: { ok: boolean; fast?: FastCheckResult; media?: MediaCheckResult }, finalStatus: FinalStatus): AlternativeStatus {
  return {
    ...base,
    plainRequestResult: finalStatus === "working_plain" ? "working" : base.plainRequestResult,
    publicHeaderResult: finalStatus === "working_with_public_headers" ? "working" : base.publicHeaderResult,
    manifestResult: validation.fast?.ok ? "valid_manifest" : validation.fast?.reason ?? "manifest_failed",
    segmentBytes: validation.media?.bytesRead ?? 0,
    ffprobeResult: validation.media?.ok ? "video_detected" : validation.media?.reason ?? "ffprobe_failed",
    browserClosedRetest: retest.ok ? "passed" : validationLabel(retest.fast, retest.media),
    finalStatus: retest.ok ? finalStatus : "session_or_cookie_dependent"
  };
}

function writePlaylist(winner?: AlternativeStatus): void {
  let text = "#EXTM3U\n";
  const streamUrl = winner?.streamUrl;
  if (winner && streamUrl) {
    text += '#EXTINF:-1 tvg-id="arb-volo-test" tvg-name="ARB - Volo Test" group-title="VOLO Test",ARB - Volo Test\n';
    if (winner.finalStatus === "working_with_public_headers") {
      text += `#EXTVLCOPT:http-user-agent=${USER_AGENT}\n`;
      text += `#EXTVLCOPT:http-referrer=${PAGE_ORIGIN}/\n`;
    }
    text += `${streamUrl}\n`;
  }
  fs.writeFileSync(TEST_PLAYLIST, text, "utf8");
}

function validatePlaylistFile(): void {
  const text = fs.readFileSync(TEST_PLAYLIST, "utf8");
  if (!text.startsWith("#EXTM3U")) throw new Error("test playlist malformed");
  const urls = text.split(/\r?\n/).filter((line) => /^https?:\/\//.test(line));
  if (urls.some((url) => isForbiddenUrl(url, { allowLivePath: true }))) throw new Error("test playlist contains private or gateway URL");
  if ((text.match(/^#EXTINF/gm) ?? []).length > 1) throw new Error("test playlist contains more than one channel");
}

function sanitizeAlternative(alternative: AlternativeStatus): AlternativeStatus {
  const { streamUrl: _streamUrl, ...safe } = alternative;
  return safe;
}

function summarizeFailure(alternatives: AlternativeStatus[]): FinalStatus {
  if (alternatives.some((item) => item.finalStatus === "dns_failure")) return "dns_failure";
  if (alternatives.some((item) => item.finalStatus === "http_403")) return "http_403";
  if (alternatives.some((item) => item.finalStatus === "http_404")) return "http_404";
  if (alternatives.some((item) => item.finalStatus === "session_or_cookie_dependent")) return "session_or_cookie_dependent";
  return "all_alternatives_failed";
}

function classifyFailure(fast?: FastCheckResult, media?: MediaCheckResult): FinalStatus {
  const reason = media?.reason ?? fast?.reason ?? "";
  if (/network/.test(reason)) return "dns_failure";
  if (/http_403/.test(reason)) return "http_403";
  if (/http_404/.test(reason)) return "http_404";
  if (/html|unsupported|hls|manifest/.test(reason)) return "invalid_manifest";
  if (/segment|no_hls_uri|no_segment|too_small/.test(reason)) return "segment_failed";
  return "all_alternatives_failed";
}

function validationLabel(fast?: FastCheckResult, media?: MediaCheckResult): string {
  if (!fast) return "not_tested";
  if (!fast.ok) return fast.reason ?? "fast_check_failed";
  if (!media) return "manifest_ok_media_not_tested";
  if (!media.ok) return media.reason ?? "media_check_failed";
  return "working";
}

function collectPublicHeaders(request: Request): Record<string, string> {
  const headers = request.headers();
  const safe: Record<string, string> = {};
  if (headers["user-agent"]) safe["User-Agent"] = headers["user-agent"];
  if (headers["referer"]) safe["Referer"] = headers["referer"];
  if (headers["origin"]) safe["Origin"] = headers["origin"];
  return safe;
}

function isMediaLike(url: string): boolean {
  return /\.(m3u8|mpd)(?:$|\?)/i.test(url) || /manifest|playlist|master/i.test(url);
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return "invalid-url";
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
