import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import ffprobeStatic from "ffprobe-static";
import type { FastCheckResult, MediaCheckResult, PlaylistEntry } from "./types.js";

const USER_AGENT = "Mozilla/5.0 IPTV-Playlist-Updater/1.0";

// These Turkish direct/official CDN families are known to return a technically
// valid HLS stream while replacing the real television ad break with a static
// "Dijital Reklam Kuşağındasınız" slate. For our TV playlist that is not a
// healthy linear broadcast, even though HTTP/HLS validation succeeds.
const TURKEY_AD_SLATE_HOSTS = [
  /(^|\.)daioncdn\.net$/i,
  /(^|\.)ercdn\.net$/i,
  /(^|\.)medya\.trt\.com\.tr$/i
];

export function isForbiddenUrl(raw: string, options: { allowLivePath?: boolean } = {}): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol)) return true;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    if (/^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
    if (url.port === "8787") return true;
    if (!options.allowLivePath && /\/live\//i.test(url.pathname)) return true;
    return false;
  } catch {
    return true;
  }
}

export function isTurkeyAdSlateProneUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return TURKEY_AD_SLATE_HOSTS.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

export async function fastCheck(entry: PlaylistEntry): Promise<FastCheckResult> {
  const start = Date.now();
  if (isForbiddenUrl(entry.url, { allowLivePath: entry.allowLivePath })) return { ok: false, reason: "forbidden_url" };
  if (hasSensitiveHeaders(entry)) return { ok: false, reason: "sensitive_headers" };

  // For Turkish discovery we deliberately trust Volo (plus explicit manual
  // overrides). Other website adapters may still discover Turkish URLs for
  // diagnostics, but they are not allowed to publish them into the TV playlist.
  if (isTurkeyEntry(entry) && !isAllowedTurkeySource(entry)) {
    return { ok: false, reason: "turkey_non_volo_source" };
  }
  if (isTurkeyEntry(entry) && isTurkeyAdSlateProneUrl(entry.url)) {
    return { ok: false, reason: "turkey_ad_slate_prone_host" };
  }

  try {
    let response = await fetch(entry.url, {
      redirect: "follow",
      headers: requestHeaders(entry),
      signal: AbortSignal.timeout(10_000)
    });
    if (response.status === 403) {
      for (const headers of publicHeaderRetries(entry)) {
        response = await fetch(entry.url, {
          redirect: "follow",
          headers: { ...requestHeaders(entry), ...headers },
          signal: AbortSignal.timeout(10_000)
        });
        if (response.ok) {
          entry.headers = { ...entry.headers, ...headers };
          break;
        }
      }
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) return { ok: false, contentType, reason: `http_${response.status}` };
    if (isTurkeyEntry(entry) && isTurkeyAdSlateProneUrl(response.url)) {
      return { ok: false, contentType, reason: "turkey_ad_slate_prone_host" };
    }
    const bytes = new Uint8Array((await response.clone().arrayBuffer()).slice(0, 512 * 1024));
    const prefix = Buffer.from(bytes).toString("utf8", 0, Math.min(bytes.length, 2048)).trimStart();
    if (/^<!doctype html|^<html/i.test(prefix) || contentType.includes("text/html")) return { ok: false, contentType, reason: "html" };
    if (prefix.startsWith("#EXTM3U") || /\.m3u8(?:$|\?)/i.test(response.url)) return { ok: true, finalUrl: response.url, contentType, kind: "hls", latencyMs: Date.now() - start };
    if (prefix.includes("<MPD") || /\.mpd(?:$|\?)/i.test(response.url)) return { ok: true, finalUrl: response.url, contentType, kind: "dash", latencyMs: Date.now() - start };
    if (/video|mpegurl|octet-stream/i.test(contentType) && bytes.length > 0) return { ok: true, finalUrl: response.url, contentType, kind: "video", latencyMs: Date.now() - start };
    return { ok: false, contentType, reason: "unsupported_response" };
  } catch (err: any) {
    return { ok: false, reason: err?.name === "TimeoutError" ? "timeout" : "network_error" };
  }
}

export async function mediaCheck(entry: PlaylistEntry, fast: FastCheckResult): Promise<MediaCheckResult> {
  try {
    const sample = fast.kind === "hls"
      ? await sampleHls(fast.finalUrl ?? entry.url, entry)
      : await downloadSample(fast.finalUrl ?? entry.url, entry, 2 * 1024 * 1024);
    if (sample.length < 188) return { ok: false, hasVideo: false, hasAudio: false, bytesRead: sample.length, reason: "too_small" };
    const probe = await probeSample(sample);
    return { ok: probe.hasVideo, ...probe, bytesRead: sample.length };
  } catch (err: any) {
    return { ok: false, hasVideo: false, hasAudio: false, bytesRead: 0, reason: String(err?.message ?? err).slice(0, 120) };
  }
}

async function sampleHls(url: string, entry: PlaylistEntry): Promise<Buffer> {
  const manifest = await fetchText(url, entry);
  const base = new URL(url);
  const variant = bestHlsUri(manifest) ?? firstSegmentUri(manifest);
  if (!variant) throw new Error("no_hls_uri");
  const nextUrl = new URL(variant, base).toString();
  if (bestHlsUri(manifest)) {
    const mediaManifest = await fetchText(nextUrl, entry);
    const segment = firstSegmentUri(mediaManifest);
    if (!segment) throw new Error("no_segment");
    return await downloadSample(new URL(segment, nextUrl).toString(), entry, 2 * 1024 * 1024);
  }
  return await downloadSample(nextUrl, entry, 2 * 1024 * 1024);
}

function bestHlsUri(manifest: string): string | undefined {
  const lines = manifest.split(/\r?\n/);
  let best: { score: number; uri: string } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
    const uri = lines.slice(i + 1).find((item) => item.trim() && !item.startsWith("#"))?.trim();
    if (!uri) continue;
    const bw = Number(line.match(/BANDWIDTH=(\d+)/)?.[1] ?? 0);
    const height = Number(line.match(/RESOLUTION=\d+x(\d+)/)?.[1] ?? 0);
    const score = height * 10_000 + bw;
    if (!best || score > best.score) best = { score, uri };
  }
  return best?.uri;
}

function firstSegmentUri(manifest: string): string | undefined {
  return manifest.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("#"));
}

async function fetchText(url: string, entry: PlaylistEntry): Promise<string> {
  if (isTurkeyEntry(entry) && isTurkeyAdSlateProneUrl(url)) throw new Error("turkey_ad_slate_prone_host");
  const response = await fetch(url, { headers: requestHeaders(entry), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`http_${response.status}`);
  if (isTurkeyEntry(entry) && isTurkeyAdSlateProneUrl(response.url)) throw new Error("turkey_ad_slate_prone_host");
  const text = await response.text();
  if (/^\s*</.test(text)) throw new Error("html");
  return text;
}

async function downloadSample(url: string, entry: PlaylistEntry, maxBytes: number): Promise<Buffer> {
  if (isForbiddenUrl(url, { allowLivePath: entry.allowLivePath })) throw new Error("forbidden_url");
  if (isTurkeyEntry(entry) && isTurkeyAdSlateProneUrl(url)) throw new Error("turkey_ad_slate_prone_host");
  const response = await fetch(url, {
    headers: { ...requestHeaders(entry), Range: `bytes=0-${maxBytes - 1}` },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok && response.status !== 206) throw new Error(`http_${response.status}`);
  if (isTurkeyEntry(entry) && isTurkeyAdSlateProneUrl(response.url)) throw new Error("turkey_ad_slate_prone_host");
  if (!response.body) throw new Error("no_body");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      total += chunk.length;
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function probeSample(sample: Buffer): Promise<Omit<MediaCheckResult, "ok" | "bytesRead" | "reason">> {
  const file = path.join(os.tmpdir(), `iptv-sample-${randomUUID()}.bin`);
  fs.writeFileSync(file, sample);
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobeStatic.path, ["-v", "error", "-print_format", "json", "-show_streams", file], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("ffprobe_timeout"));
    }, 15_000);
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.on("close", (code) => {
      clearTimeout(timeout);
      fs.rmSync(file, { force: true });
      if (code !== 0) {
        reject(new Error("ffprobe_failed"));
        return;
      }
      const parsed = JSON.parse(stdout || "{}") as { streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }> };
      const video = parsed.streams?.find((stream) => stream.codec_type === "video");
      const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
      resolve({
        hasVideo: Boolean(video),
        hasAudio: Boolean(audio),
        width: video?.width,
        height: video?.height,
        videoCodec: video?.codec_name,
        audioCodec: audio?.codec_name
      });
    });
  });
}

function requestHeaders(entry: PlaylistEntry): Record<string, string> {
  return { "User-Agent": USER_AGENT, ...entry.headers };
}

function publicHeaderRetries(entry: PlaylistEntry): Array<Record<string, string>> {
  const androidTv = "Mozilla/5.0 (Linux; Android 11; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const browser = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const referer = entry.headers["Referer"] ?? entry.candidateReferer;
  const sets: Array<Record<string, string>> = [
    { "User-Agent": androidTv },
    { "User-Agent": browser }
  ];
  if (referer) {
    sets.push(
      { Referer: referer },
      { "User-Agent": androidTv, Referer: referer },
      { "User-Agent": browser, Referer: referer }
    );
  }
  return sets;
}

function hasSensitiveHeaders(entry: PlaylistEntry): boolean {
  return Object.keys(entry.headers).some((key) => /cookie|authorization|password|token|key/i.test(key));
}

function isAllowedTurkeySource(entry: PlaylistEntry): boolean {
  if (!isTurkeyEntry(entry)) return true;
  if (entry.sourceName === "existing-playlist") return true;
  if (entry.sourceName.startsWith("canlitv-volo")) return true;
  if (entry.sourceName.startsWith("manual-")) return true;
  return false;
}

function isTurkeyEntry(entry: PlaylistEntry): boolean {
  const value = `${entry.priorityCountry ?? ""} ${entry.country ?? ""} ${entry.groupTitle ?? ""}`
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ü/g, "u");
  return value.includes("turkiye") || /(?:^|\s)tr(?:\s|$)/.test(value);
}
