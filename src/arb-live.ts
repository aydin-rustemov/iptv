import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Writable } from "node:stream";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { DEFAULT_CONFIG } from "./config.js";
import { getLanAddresses } from "./server/network-addresses.js";
import { captureMediaRequests } from "./discovery/media-request-capture.js";
import { fetchSafe, fetchTextSafe } from "./validation/fetch-manifest.js";
import { parseHlsManifest } from "./validation/parse-hls.js";

const ARB_PAGE_URL = "https://www.arbtv.az/az/pages/live";
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const STARTUP_TIMEOUT_MS = 25_000;
const CHECK_SAMPLE_BYTES = 256 * 1024;

interface ArbResolvedStream {
  streamUrl: string;
  streamType: "HLS" | "DASH";
  headers: Record<string, string>;
  requiredPageContext: string[];
  browser?: Browser;
  context?: BrowserContext;
  startupMs: number;
}

interface ArbCheckResult {
  ok: boolean;
  resolverMethod: string;
  streamType?: string;
  requiredPageContext: string[];
  bytesReceived: number;
  startupMs: number;
  failure?: string;
}

let activeAbort: AbortController | null = null;
let activeStarting = false;

export function writeArbPlaylist(outputDir = DEFAULT_CONFIG.outputDir, port = DEFAULT_CONFIG.serverPort): string {
  const lanIp = chooseArbLanAddress(getLanAddresses());
  const playlistUrl = `http://${lanIp}:${port}/live/arb`;
  const content = `#EXTM3U\n#EXTINF:-1 tvg-id="arb" tvg-name="ARB" group-title="Azərbaycan",ARB\n${playlistUrl}\n`;
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "playlist-arb.m3u"), content, "utf8");
  return playlistUrl;
}

function chooseArbLanAddress(addresses: string[]): string {
  return addresses.find((address) => address.startsWith("192.168.1.")) ?? addresses[0] ?? "127.0.0.1";
}

export async function handleArbLive(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "text/plain");
    res.end("405 Method Not Allowed");
    return;
  }

  if (activeStarting || activeAbort) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain");
    res.end("ARB stream is already active or starting");
    return;
  }

  activeStarting = true;
  const abort = new AbortController();
  activeAbort = abort;
  const stop = () => abort.abort();
  req.on("close", stop);

  res.statusCode = 200;
  res.setHeader("Content-Type", "video/mp2t");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Access-Control-Allow-Origin", "*");

  let resolved: ArbResolvedStream | undefined;
  try {
    const streamPromise = (async () => {
      resolved = await resolveArbOfficialStream(abort.signal);
      activeStarting = false;
      await pipeHlsToWritable(resolved, res, abort.signal);
    })();

    await withTimeout(streamPromise, STARTUP_TIMEOUT_MS, "ARB media did not start before timeout");
  } catch (err: any) {
    if (!res.headersSent) {
      res.statusCode = err?.message?.includes("timeout") ? 504 : 503;
      res.setHeader("Content-Type", "text/plain");
      res.end(sanitizeLogMessage(err?.message ?? "ARB stream failed"));
    } else {
      res.destroy(err);
    }
  } finally {
    activeStarting = false;
    activeAbort = null;
    req.off("close", stop);
    await resolved?.context?.close().catch(() => undefined);
    await resolved?.browser?.close().catch(() => undefined);
  }
}

export async function runArbCheck(): Promise<ArbCheckResult> {
  const abort = new AbortController();
  let resolved: ArbResolvedStream | undefined;
  const started = Date.now();
  try {
    resolved = await resolveArbOfficialStream(abort.signal);
    const sink = new BoundedSampleSink(CHECK_SAMPLE_BYTES, abort);
    await withTimeout(pipeHlsToWritable(resolved, sink, abort.signal), STARTUP_TIMEOUT_MS, "ARB media did not start before timeout");
    return {
      ok: sink.bytesReceived > 0,
      resolverMethod: "official-page-script-hls",
      streamType: resolved.streamType,
      requiredPageContext: resolved.requiredPageContext,
      bytesReceived: sink.bytesReceived,
      startupMs: Date.now() - started
    };
  } catch (err: any) {
    return {
      ok: false,
      resolverMethod: "official-page-script-hls",
      streamType: resolved?.streamType,
      requiredPageContext: resolved?.requiredPageContext ?? [],
      bytesReceived: 0,
      startupMs: Date.now() - started,
      failure: sanitizeLogMessage(err?.message ?? "ARB check failed")
    };
  } finally {
    abort.abort();
    await resolved?.context?.close().catch(() => undefined);
    await resolved?.browser?.close().catch(() => undefined);
  }
}

export async function shutdownArbLive(): Promise<void> {
  activeAbort?.abort();
  activeAbort = null;
  activeStarting = false;
}

async function resolveArbOfficialStream(signal: AbortSignal): Promise<ArbResolvedStream> {
  const started = Date.now();
  let staticFailure = "";
  const staticResolved = await resolveArbFromOfficialScript(started).catch((err: any) => {
    staticFailure = sanitizeLogMessage(err?.message ?? "static resolver failed");
    return undefined;
  });
  if (staticResolved) return staticResolved;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    serviceWorkers: "block",
    userAgent: DEFAULT_UA,
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  try {
    const captured = await captureMediaRequests(page, async () => {
      await page.goto(ARB_PAGE_URL, { waitUntil: "domcontentloaded", timeout: DEFAULT_CONFIG.browserTimeoutMs });
      await page.waitForTimeout(DEFAULT_CONFIG.browserCaptureTimeMs);
    });
    if (signal.aborted) throw new Error("ARB resolve aborted");

    const media = captured
      .filter((item) => /\.m3u8(?:[?#]|$)|\.mpd(?:[?#]|$)|master|manifest|playlist/i.test(item.url))
      .sort((a, b) => mediaRank(a.url) - mediaRank(b.url))[0];
    if (!media) throw new Error(`No official ARB HLS/DASH media request captured; static resolver: ${staticFailure || "not attempted"}`);

    const cookies = await context.cookies([ARB_PAGE_URL, media.url]);
    const cookieHeader = cookies.length > 0 ? cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") : undefined;
    const headers: Record<string, string> = {
      "User-Agent": media.playbackHeaders.userAgent ?? DEFAULT_UA,
      Referer: media.playbackHeaders.referer ?? ARB_PAGE_URL
    };
    if (media.playbackHeaders.origin) headers.Origin = media.playbackHeaders.origin;
    if (cookieHeader) headers.Cookie = cookieHeader;

    const requiredPageContext = [
      ...(headers.Referer ? ["Referer"] : []),
      ...(headers.Origin ? ["Origin"] : []),
      ...(cookieHeader ? ["temporary anonymous cookies"] : [])
    ];

    return {
      streamUrl: media.url,
      streamType: media.url.toLowerCase().includes(".mpd") ? "DASH" : "HLS",
      headers,
      requiredPageContext,
      browser,
      context,
      startupMs: Date.now() - started
    };
  } catch (err) {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    throw err;
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function resolveArbFromOfficialScript(started: number): Promise<ArbResolvedStream> {
  const page = await fetchTextSafe(ARB_PAGE_URL, {
    timeoutMs: 15_000,
    limitBytes: 2 * 1024 * 1024
  });
  const scriptUrls = [...page.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
    .map((match) => new URL(match[1]!, page.finalUrl).toString())
    .filter((url) => new URL(url).hostname.endsWith("arbtv.az"));
  if (!scriptUrls.includes("http://arbtv.az/arb.js")) {
    scriptUrls.push("http://arbtv.az/arb.js");
  }
  for (const scriptUrl of scriptUrls) {
    const script = await fetchTextSafe(scriptUrl, {
      timeoutMs: 15_000,
      limitBytes: 512 * 1024
    }).catch(() => undefined);
    if (!script) continue;
    const mediaUrl = extractHlsUrlFromScript(script.text);
    if (!mediaUrl) continue;
    return {
      streamUrl: mediaUrl,
      streamType: "HLS",
      headers: {
        "User-Agent": DEFAULT_UA,
        Referer: ARB_PAGE_URL
      },
      requiredPageContext: ["Referer"],
      startupMs: Date.now() - started
    };
  }
  throw new Error("Official ARB scripts did not expose HLS media");
}

function extractHlsUrlFromScript(scriptText: string): string | undefined {
  const match = scriptText.match(/https?:\/\/.*?\.m3u8(?:\?[^"'\\\s<>]*)?/i)?.[0];
  return match?.replace(/\\+$/g, "");
}

async function pipeHlsToWritable(resolved: ArbResolvedStream, writable: Writable, signal: AbortSignal): Promise<void> {
  if (resolved.streamType !== "HLS") {
    throw new Error("ARB resolver captured DASH, but this proof currently pipes only HLS media");
  }

  const seen = new Set<string>();
  let mediaPlaylistUrl = resolved.streamUrl;
  let initWrittenFor: string | undefined;

  while (!signal.aborted) {
    const masterRes = await fetchSafe(mediaPlaylistUrl, {
      headers: resolved.headers,
      timeoutMs: DEFAULT_CONFIG.manifestTimeoutMs,
      limitBytes: 2 * 1024 * 1024
    });
    const masterText = masterRes.body.toString("utf8");
    const parsed = parseHlsManifest(masterText, masterRes.finalUrl);
    if (parsed.isMaster) {
      const variant = parsed.variants.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
      if (!variant) throw new Error("Official ARB master playlist has no variants");
      mediaPlaylistUrl = variant.url;
      continue;
    }

    if (parsed.mapUrl && initWrittenFor !== parsed.mapUrl) {
      const init = await fetchSafe(parsed.mapUrl, {
        headers: resolved.headers,
        timeoutMs: DEFAULT_CONFIG.segmentTimeoutMs,
        limitBytes: 2 * 1024 * 1024
      });
      await writeChunk(writable, init.body, signal);
      initWrittenFor = parsed.mapUrl;
    }

    const freshSegments = parsed.segments.filter((segment) => !seen.has(segment.url));
    for (const segment of freshSegments) {
      if (signal.aborted) break;
      seen.add(segment.url);
      const segmentRes = await fetchSafe(segment.url, {
        headers: resolved.headers,
        timeoutMs: DEFAULT_CONFIG.segmentTimeoutMs,
        limitBytes: 16 * 1024 * 1024
      });
      await writeChunk(writable, segmentRes.body, signal);
      if (seen.size > 200) {
        for (const old of [...seen].slice(0, 50)) seen.delete(old);
      }
    }

    await wait(1500, signal);
  }
}

function mediaRank(url: string): number {
  const lower = url.toLowerCase();
  if (lower.includes("master")) return 0;
  if (lower.includes("playlist")) return 1;
  if (lower.includes(".m3u8")) return 2;
  if (lower.includes(".mpd")) return 3;
  return 4;
}

async function writeChunk(writable: Writable, chunk: Buffer, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    writable.once("error", onError);
    const done = () => {
      writable.off("error", onError);
      resolve();
    };
    if (writable.write(chunk)) done();
    else writable.once("drain", done);
  });
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (err) => {
        clearTimeout(timeout);
        reject(err);
      }
    );
  });
}

function sanitizeLogMessage(message: string): string {
  return message.replace(/([?&](?:token|hash|sig|signature|key|auth)=)[^&\s]+/gi, "$1<redacted>");
}

class BoundedSampleSink extends Writable {
  bytesReceived = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly abort: AbortController
  ) {
    super();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.bytesReceived += chunk.length;
    if (this.bytesReceived >= this.maxBytes) {
      this.abort.abort();
    }
    callback();
  }
}
