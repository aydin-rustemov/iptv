import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { chromium, type Browser } from "playwright";
import {
  MediaRegistry, PLAYER_UA, allowedUpstream, channelById,
  manifestForGateway, matchesChannel, rewriteHls, tokenExpiryMs, type YodaChannel
} from "./hls.js";
import { YODA_CATALOGUE } from "../sources/yodaCatalogue.js";

// Deploy ONLY on the user's own Azerbaijan connection. This is a player-side
// local-origin gateway, not a public CDN or an unauthenticated open proxy.
const HOST = process.env.AZ_GATEWAY_HOST ?? "127.0.0.1";
const PORT = Number(process.env.AZ_GATEWAY_PORT ?? 8787);
const BASE = process.env.AZ_GATEWAY_BASE_URL;
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error("Invalid gateway port");
if (BASE && !/^https?:\/\/[a-z0-9.:[\]-]+(?::\d+)?\/?$/i.test(BASE))
  throw new Error("AZ_GATEWAY_BASE_URL must be plain HTTP(S) origin, without paths or credentials");

interface CachedUrl { url: string; expires: number; page: string }
const cache = new Map<string, CachedUrl>();
const pending = new Map<string, Promise<CachedUrl>>();
const media = new MediaRegistry();
let browserPromise: Promise<Browser> | undefined;
const stats = new Map<string, { lastSuccess?: string; lastError?: string }>();
function getBrowser(): Promise<Browser> {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true }).catch(e => {
    browserPromise = undefined;
    throw e;
  });
  return browserPromise;
}

async function discover(channel: YodaChannel): Promise<CachedUrl> {
  const browser = await getBrowser();
  for (const slug of channel.slugs) {
    const site = "https://yoda.az/tv/" + slug + "/";
    const context = await browser.newContext({
      serviceWorkers: "block", userAgent: PLAYER_UA,
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "Accept-Language": "az-AZ,az;q=0.9,en;q=0.8" }
    });
    const found = new Set<string>();
    const page = await context.newPage();
    page.on("request", request => {
      const url = request.url();
      if (/\.m3u8(?:\?|$)/i.test(url) && matchesChannel(url, channel)) found.add(url);
    });
    page.on("response", response => {
      const url = response.url();
      if (/\.m3u8(?:\?|$)/i.test(url) && response.status() < 400 &&
          matchesChannel(url, channel)) found.add(url);
    });
    try {
      await page.goto(site, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.locator("video").first().evaluate((video: HTMLVideoElement) => {
        void video.play().catch(() => undefined);
      }, { timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(5_000);
    } catch {
      // Some Yoda pages have an incomplete HTML load despite playing media.
      // Only captured channel-matched M3U8 URLs count as successful discovery.
    } finally {
      await context.close();
    }
    const candidate = [...found]
      .filter(allowedUpstream)
      .sort((a, b) => Number(b.includes("token=")) - Number(a.includes("token=")))[0];
    if (!candidate) continue;
    const result: CachedUrl = {
      url: candidate, expires: Math.min(tokenExpiryMs(candidate), Date.now() + 25 * 60_000),
      page: site
    };
    if (result.expires > Date.now() + 20_000) {
      stats.set(channel.id, { ...stats.get(channel.id), lastSuccess: new Date().toISOString(), lastError: undefined });
      return result;
    }
  }
  const message = "No fresh, channel-matched Yoda HLS link found using Azerbaijan-side browser";
  stats.set(channel.id, { ...stats.get(channel.id), lastError: message });
  throw new Error(message);
}

async function resolveStream(channel: YodaChannel, fresh = false): Promise<CachedUrl> {
  const cached = cache.get(channel.id);
  if (!fresh && cached && cached.expires > Date.now() + 75_000) return cached;
  const inFlight = pending.get(channel.id);
  if (inFlight) return inFlight;
  const task = discover(channel).then(result => {
    cache.set(channel.id, result);
    return result;
  }).finally(() => pending.delete(channel.id));
  pending.set(channel.id, task);
  return task;
}

async function upstreamGet(raw: string, referer: string, range?: string): Promise<Response> {
  if (!allowedUpstream(raw)) throw new Error("Blocked upstream host");
  const headers: Record<string,string> = {
    "User-Agent": PLAYER_UA,
    "Origin": "https://yoda.az",
    "Referer": referer,
    "Accept": "*/*"
  };
  if (range) headers.Range = range;
  const res = await fetch(raw, { method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(25_000) });
  if (res.status >= 300 && res.status < 400) {
    const target = new URL(res.headers.get("location") ?? "", raw).toString();
    if (!allowedUpstream(target)) throw new Error("Blocked upstream redirect");
    return upstreamGet(target, referer, range);
  }
  return res;
}

function originFor(req: IncomingMessage): string {
  if (BASE) return BASE.replace(/\/$/, "");
  const host = req.headers.host ?? "";
  if (!/^(?:[a-z\d.-]+|\[[a-f\d:]+\])(?::\d+)?$/i.test(host))
    throw new Error("Invalid HTTP Host");
  return "http://" + host;
}

function output(res: ServerResponse, status: number, data: string, contentType = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*" });
  res.end(data);
}

async function proxyHls(res: ServerResponse, raw: string, channelId: string, referer: string,
                        gatewayBase: string, range?: string): Promise<number> {
  const upstream = await upstreamGet(raw, referer, range);
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel();
    return upstream.status;
  }
  const isManifest = new URL(raw).pathname.toLowerCase().endsWith(".m3u8") ||
    /mpegurl/i.test(upstream.headers.get("content-type") ?? "");
  if (isManifest) {
    const text = await upstream.text();
    if (!text.trimStart().startsWith("#EXTM3U")) return 502;
    const rewritten = rewriteHls(text, raw, channelId, gatewayBase, media);
    output(res, 200, rewritten, "application/vnd.apple.mpegurl; charset=utf-8");
    return 200;
  }
  res.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    ...(upstream.headers.get("content-range") ? { "Content-Range": upstream.headers.get("content-range")! } : {})
  });
  Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
  return 200;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") { output(res, 405, "GET only"); return; }
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/health") {
    output(res, 200, JSON.stringify({
      mode: "AZ-local-Yoda",
      channels: YODA_CATALOGUE.length,
      localAccessOnly: HOST === "127.0.0.1",
      cached: cache.size,
      status: Object.fromEntries(stats)
    }, null, 2), "application/json; charset=utf-8");
    return;
  }
  if (path === "/playlist.m3u") {
    output(res, 200, manifestForGateway(YODA_CATALOGUE, originFor(req)), "audio/x-mpegurl; charset=utf-8");
    return;
  }
  const live = /^\/live\/([a-z\d-]+)\/index\.m3u8$/.exec(path);
  if (live) {
    const channel = channelById(live[1]!);
    if (!channel) { output(res, 404, "Unknown channel"); return; }
    let source = await resolveStream(channel);
    let status = await proxyHls(res, source.url, channel.id, source.page, originFor(req));
    if ((status === 401 || status === 403 || status === 410) && !res.headersSent) {
      cache.delete(channel.id);
      source = await resolveStream(channel, true);
      status = await proxyHls(res, source.url, channel.id, source.page, originFor(req));
    }
    if (status !== 200 && !res.headersSent) output(res, 502, "Yoda upstream unavailable (HTTP " + status + ")");
    return;
  }
  const segment = /^\/media\/([a-f\d-]{36})$/.exec(path);
  if (segment) {
    const reference = media.lookup(segment[1]!);
    if (!reference) { output(res, 410, "Expired media reference; refresh the channel"); return; }
    const channel = channelById(reference.channelId);
    if (!channel) { output(res, 404, "Unknown channel"); return; }
    const site = cache.get(channel.id)?.page ?? "https://yoda.az/tv/" + channel.slugs[0] + "/";
    const status = await proxyHls(res, reference.url, reference.channelId, site,
      originFor(req), req.headers.range);
    if (status !== 200 && !res.headersSent) output(res, 502, "Yoda media unavailable (HTTP " + status + ")");
    return;
  }
  output(res, 404, "Use /playlist.m3u or /health");
}

const server = http.createServer((req, res) => {
  void handle(req, res).catch(error => {
    const message = error instanceof Error ? error.message : "unknown failure";
    console.error("[AZ-GATEWAY]", req.url?.split("?")[0], message);
    if (!res.headersSent) output(res, 502, "Upstream unavailable; see gateway logs");
    else res.destroy();
  });
});
server.listen(PORT, HOST, () => {
  console.log("[AZ-GATEWAY] http://" + HOST + ":" + PORT + "/playlist.m3u");
  console.log("[AZ-GATEWAY] Place this service on the same Azerbaijan internet connection as the IPTV player.");
});
async function shutdown(): Promise<void> {
  server.close();
  const browser = await browserPromise?.catch(() => undefined);
  await browser?.close();
}
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
