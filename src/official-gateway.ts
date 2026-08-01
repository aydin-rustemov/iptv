import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import yaml from "yaml";
import pLimit from "p-limit";
import { OFFICIAL_CHANNELS_FILE, DEFAULT_CONFIG, RESOLVER_STATUS_FILE, RESOLVER_STATUS_HTML_FILE } from "./config.js";
import { getLanAddresses } from "./server/network-addresses.js";
import { validateCandidate } from "./validation/validate-stream.js";
import type { CountryCode, StreamCandidate, ValidationResult } from "./types.js";
import { fetchSafe, fetchTextSafe } from "./validation/fetch-manifest.js";
import { parseHlsManifest } from "./validation/parse-hls.js";

export type OfficialSourceType =
  | "streamlink_builtin"
  | "streamlink_custom"
  | "direct_hls_official"
  | "official_youtube"
  | "official_vk"
  | "official_ok"
  | "provider_required"
  | "unavailable";

export type ResolverStatus =
  | "healthy"
  | "slow_start"
  | "official_page_down"
  | "official_stream_down"
  | "plugin_unsupported"
  | "plugin_failed"
  | "provider_required"
  | "login_required"
  | "drm"
  | "geo_blocked"
  | "media_timeout"
  | "unavailable";

export interface OfficialSource {
  type: OfficialSourceType;
  page: string;
  priority: number;
}

export interface OfficialChannel {
  id: string;
  name: string;
  country: CountryCode;
  category: string;
  enabled: boolean;
  priority: number;
  sources: OfficialSource[];
}

export interface ResolverCheckResult {
  channelId: string;
  name: string;
  country: CountryCode;
  category: string;
  status: ResolverStatus;
  selectedSourceType?: OfficialSourceType;
  startupMs?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  resolution?: string;
  lastSuccessfulCheck?: string;
  failureCategory?: string;
  exactBlocker?: string;
  attemptedSource?: string;
  resolverMethod?: string;
  streamlinkPluginName?: string;
  processExitCode?: number | null;
  mediaBytesReceived?: number;
  infrastructureStatus?: ResolverInfrastructureStatus;
}

type ResolverInfrastructureStatus =
  | "ready"
  | "streamlink_not_installed"
  | "streamlink_launch_failed"
  | "ffmpeg_not_available"
  | "ffprobe_not_available"
  | "environment_misconfigured";

interface EnvironmentInfo {
  pythonExecutable: string | null;
  pythonVersion: string | null;
  streamlinkExecutable: string | null;
  streamlinkVersion: string | null;
  ffmpegExecutable: string | null;
  ffprobeExecutable: string | null;
  pluginDir: string;
  status: ResolverInfrastructureStatus;
  plugins?: string[];
  childProcessCheck?: boolean;
}

type ResolverProcess = ChildProcessByStdio<null, Readable, Readable>;

const activeProcesses = new Set<ResolverProcess>();
const healthCache = new Map<string, { expiresAt: number; result: ResolverCheckResult }>();
const COUNTRY_ORDER: Record<CountryCode, number> = { AZ: 0, TR: 1, RU: 2, OTHER: 3 };
const WORKING_BASELINE_FILE = path.resolve("data/working-baseline.json");

export function loadOfficialChannels(): OfficialChannel[] {
  const parsed = yaml.parse(fs.readFileSync(OFFICIAL_CHANNELS_FILE, "utf8")) as { channels: OfficialChannel[] };
  return parsed.channels
    .filter((channel) => channel.enabled)
    .map((channel) => ({ ...channel, name: repairMojibake(channel.name) }))
    .sort((a, b) => COUNTRY_ORDER[a.country] - COUNTRY_ORDER[b.country] || a.priority - b.priority);
}

export async function resolverInstall(): Promise<EnvironmentInfo> {
  fs.mkdirSync(path.resolve("resolver/plugins"), { recursive: true });
  fs.mkdirSync(path.resolve(".venv"), { recursive: true });
  fs.mkdirSync(DEFAULT_CONFIG.outputDir, { recursive: true });
  const info = await getEnvironmentInfo();
  fs.writeFileSync(path.resolve("output/resolver-environment.json"), JSON.stringify(info, null, 2), "utf8");
  console.log(`Streamlink executable: ${info.streamlinkExecutable ?? "not installed"}`);
  console.log(`Streamlink version: ${info.streamlinkVersion ?? "not installed"}`);
  console.log(`FFmpeg executable: ${info.ffmpegExecutable ?? "not found"}`);
  console.log(`FFprobe executable: ${info.ffprobeExecutable ?? "not found"}`);
  console.log(`Custom Streamlink plugin directory: ${info.pluginDir}`);
  console.log(`Environment status: ${info.status}`);
  return info;
}

export async function resolverCheck(): Promise<void> {
  const info = await getEnvironmentInfo();
  const channels = loadOfficialChannels();
  console.log(`Configured channels: ${channels.length}`);
  console.log(`Streamlink executable: ${info.streamlinkExecutable ?? "not installed"}`);
  console.log(`Streamlink: ${info.streamlinkVersion ?? "not installed"}`);
  console.log(`FFmpeg: ${info.ffmpegExecutable ?? "not found"}`);
  console.log(`FFprobe: ${info.ffprobeExecutable ?? "not found"}`);
  console.log(`Available plugin count: ${info.plugins?.length ?? 0}`);
  console.log(`Custom plugin directory: ${info.pluginDir}`);
  console.log(`Child process startup/cleanup: ${info.childProcessCheck ? "ok" : "failed"}`);
  console.log(`Environment status: ${info.status}`);
}

export async function regressionWorking(): Promise<void> {
  const baseline = JSON.parse(fs.readFileSync(WORKING_BASELINE_FILE, "utf8")) as {
    channels: Array<{ name: string; id: string }>;
  };
  const publicBaseUrl = getPublicBaseUrl();
  const rows: string[] = [];
  let failed = false;
  for (const channel of baseline.channels) {
    const local = await verifyGatewayEndpointWithRetry(`http://localhost:${DEFAULT_CONFIG.serverPort}/live/${channel.id}`).catch((err: any) => ({
      ok: false,
      http: 0,
      contentType: "",
      bytes: 0,
      ffprobe: false,
      error: err?.message ?? String(err)
    }));
    const lan = await verifyGatewayEndpointWithRetry(`${publicBaseUrl}/live/${channel.id}`).catch((err: any) => ({
      ok: false,
      http: 0,
      contentType: "",
      bytes: 0,
      ffprobe: false,
      error: err?.message ?? String(err)
    }));
    const ok = local.ok && lan.ok;
    if (!ok) failed = true;
    rows.push(`${channel.name} | ${channel.id} | ${local.http} | ${local.contentType} | ${local.bytes} | ${local.ffprobe ? "pass" : "fail"} | ${lan.ok ? "pass" : "fail"} | ${ok ? "PASS" : "FAIL"}`);
    if (!ok) rows.push(`  local=${local.error ?? ""} lan=${lan.error ?? ""}`);
  }
  console.log("Channel | Canonical ID | HTTP | Content-Type | Bytes | FFprobe | LAN | Result");
  for (const row of rows) console.log(row);
  console.log("cacheUsed=false");
  if (failed) throw new Error("Working-channel regression failed");
}

export async function resolverScan(): Promise<ResolverCheckResult[]> {
  const info = await getEnvironmentInfo();
  if (info.status !== "ready") {
    throw new Error(`Resolver environment is not ready: ${info.status}`);
  }
  const channels = loadOfficialChannels();
  const limit = pLimit(3);
  const results = await Promise.all(channels.map((channel) => limit(() => checkOfficialChannel(channel))));
  writeResolverReports(results);
  return results;
}

export async function generateOfficialPlaylists(): Promise<ResolverCheckResult[]> {
  let results: ResolverCheckResult[];
  if (fs.existsSync(RESOLVER_STATUS_FILE)) {
    results = JSON.parse(fs.readFileSync(RESOLVER_STATUS_FILE, "utf8")).channels as ResolverCheckResult[];
  } else {
    results = await resolverScan();
  }
  writeOfficialPlaylists(results);
  return results;
}

export async function handleOfficialLive(req: IncomingMessage, res: ServerResponse, channelId: string): Promise<void> {
  const channel = loadOfficialChannels().find((item) => item.id === channelId);
  if (!channel) {
    res.statusCode = 404;
    res.end("Unknown channel");
    return;
  }

  const cached = healthCache.get(channelId);
  if (cached && cached.expiresAt > Date.now() && !["healthy", "slow_start"].includes(cached.result.status)) {
    res.statusCode = 503;
    res.end(cached.result.exactBlocker ?? cached.result.status);
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Content-Type", "video/mp2t");

  for (const source of sortedSources(channel)) {
    if (source.type === "provider_required" || source.type === "unavailable") continue;
    if (source.type === "direct_hls_official") {
      const result = await pipeDirectHls(source.page, res).catch((err: any) => err);
      if (!(result instanceof Error)) return;
      continue;
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      const proc = spawnStreamlink(source.page);
      if (!proc) break;
      activeProcesses.add(proc);
      const cleanup = () => {
        proc.kill("SIGTERM");
        activeProcesses.delete(proc);
      };
      req.once("close", cleanup);
      const started = await waitForFirstBytes(proc, res, 25_000).catch(() => false);
      if (started) {
        proc.stdout.pipe(res);
        proc.once("close", cleanup);
        return;
      }
      cleanup();
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const resolved = await resolveStaticMedia(source.page).catch(() => undefined);
    if (resolved?.url.includes(".m3u8")) {
      const result = await pipeDirectHls(resolved.url, res, resolved.referer ? { Referer: resolved.referer } : undefined).catch((err: any) => err);
      if (!(result instanceof Error)) return;
    }
  }

  res.statusCode = 503;
  res.end("No official source produced media bytes");
}

export function shutdownOfficialGateway(): void {
  for (const proc of activeProcesses) proc.kill("SIGTERM");
  activeProcesses.clear();
}

async function checkOfficialChannel(channel: OfficialChannel): Promise<ResolverCheckResult> {
  const provider = channel.sources.find((source) => source.type === "provider_required");
  if (provider) return baseResult(channel, "provider_required", provider.type, "Provider/region access required");

  let lastFailure: ResolverCheckResult | undefined;
  for (const source of sortedSources(channel)) {
    if (source.type === "unavailable") {
      lastFailure ??= baseResult(channel, "unavailable", source.type, "No official anonymous source configured", source);
      continue;
    }
    if (source.type === "direct_hls_official") {
      const start = Date.now();
      const candidate: StreamCandidate = {
        channelId: channel.id,
        channelName: channel.name,
        country: channel.country,
        category: channel.category,
        pageUrl: source.page,
        streamUrl: source.page,
        sourceName: "official",
        discoveryMethod: "html",
        discoveredAt: new Date().toISOString()
      };
      const validation = await validateCandidate(candidate, DEFAULT_CONFIG).catch((err: any) => err as Error);
      if (!(validation instanceof Error) && validation.status === "portable" && (validation.hasAudio || validation.hasVideo)) {
        return validationToResult(channel, source, validation, Date.now() - start);
      }
      const msg = validation instanceof Error ? validation.message : validation.failureReason;
      lastFailure = baseResult(channel, msg?.includes("timeout") ? "media_timeout" : "official_stream_down", source.type, msg ?? "Direct official stream failed", source);
      continue;
    }

    const result = await sampleStreamlinkSource(channel, source);
    if (result.status === "healthy" || result.status === "slow_start") return result;
    const staticResult = await sampleStaticOfficialSource(channel, source).catch((err: any) => ({
      ...baseResult(channel, classifyStreamlinkFailure(String(err?.message ?? err)), source.type, sanitizeLog(String(err?.message ?? err)), source),
      resolverMethod: `${source.type}:static-extractor`
    }) as ResolverCheckResult);
    if (staticResult.status === "healthy" || staticResult.status === "slow_start") return staticResult;
    lastFailure = result;
  }

  return lastFailure ?? baseResult(channel, "unavailable", channel.sources[0]?.type, "No official anonymous source produced media bytes");
}

function validationToResult(channel: OfficialChannel, source: OfficialSource, validation: ValidationResult, startupMs: number): ResolverCheckResult {
  return {
    channelId: channel.id,
    name: channel.name,
    country: channel.country,
    category: channel.category,
    status: startupMs > 5_000 ? "slow_start" : "healthy",
    selectedSourceType: source.type,
    startupMs,
    hasAudio: validation.hasAudio,
    hasVideo: validation.hasVideo,
    resolution: validation.width && validation.height ? `${validation.width}x${validation.height}` : undefined,
    lastSuccessfulCheck: new Date().toISOString(),
    attemptedSource: source.page,
    resolverMethod: source.type,
    mediaBytesReceived: validation.segmentSample?.bytesRead
  };
}

function baseResult(channel: OfficialChannel, status: ResolverStatus, sourceType?: OfficialSourceType, blocker?: string, source?: OfficialSource): ResolverCheckResult {
  return {
    channelId: channel.id,
    name: channel.name,
    country: channel.country,
    category: channel.category,
    status,
    selectedSourceType: sourceType,
    hasAudio: false,
    hasVideo: false,
    failureCategory: status,
    exactBlocker: blocker,
    attemptedSource: source?.page,
    resolverMethod: source?.type,
    mediaBytesReceived: 0
  };
}

async function sampleStreamlinkSource(channel: OfficialChannel, source: OfficialSource): Promise<ResolverCheckResult> {
  const start = Date.now();
  const proc = spawnStreamlink(source.page);
  if (!proc) return baseResult(channel, "plugin_failed", source.type, "Streamlink executable could not be launched", source);

  activeProcesses.add(proc);
  let stderr = "";
  let exitCode: number | null = null;
  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 12_000) stderr = stderr.slice(-12_000);
  });
  proc.once("close", (code) => {
    exitCode = code;
    activeProcesses.delete(proc);
  });

  try {
    const sample = await collectProcessSample(proc, 2 * 1024 * 1024, 25_000);
    const probe = await probeSample(sample.bytes);
    const startupMs = Date.now() - start;
    return {
      channelId: channel.id,
      name: channel.name,
      country: channel.country,
      category: channel.category,
      status: startupMs > 5_000 ? "slow_start" : "healthy",
      selectedSourceType: source.type,
      startupMs,
      hasAudio: probe.hasAudio,
      hasVideo: probe.hasVideo,
      resolution: probe.resolution,
      lastSuccessfulCheck: new Date().toISOString(),
      attemptedSource: source.page,
      resolverMethod: source.type,
      streamlinkPluginName: extractPluginName(stderr),
      processExitCode: exitCode,
      mediaBytesReceived: sample.bytes.length
    };
  } catch (err: any) {
    const startupMs = Date.now() - start;
    const message = sanitizeLog(`${err.message || err}\n${stderr}`);
    const status = classifyStreamlinkFailure(message);
    return {
      ...baseResult(channel, status, source.type, message, source),
      startupMs,
      streamlinkPluginName: extractPluginName(stderr),
      processExitCode: exitCode,
      mediaBytesReceived: 0
    };
  } finally {
    killProcess(proc);
  }
}

async function sampleStaticOfficialSource(channel: OfficialChannel, source: OfficialSource): Promise<ResolverCheckResult> {
  const start = Date.now();
  const resolved = await resolveStaticMedia(source.page);
  if (!resolved) {
    return baseResult(channel, "plugin_unsupported", source.type, "No public HLS/DASH URL found in official page or public iframe/script", source);
  }
  if (!resolved.url.includes(".m3u8")) {
    return baseResult(channel, "plugin_unsupported", source.type, "Static extractor found a non-HLS media reference that is not supported yet", source);
  }
  const candidate: StreamCandidate = {
    channelId: channel.id,
    channelName: channel.name,
    country: channel.country,
    category: channel.category,
    pageUrl: source.page,
    streamUrl: resolved.url,
    sourceName: "official-static",
    discoveryMethod: resolved.method,
    discoveredAt: new Date().toISOString(),
    metadata: {
      iframeUrl: resolved.evidenceUrl === source.page ? undefined : resolved.evidenceUrl,
      playbackHeaders: {
        referer: resolved.referer
      },
      requiredHeaderNames: resolved.referer ? ["Referer"] : []
    }
  };
  const validation = await validateCandidate(candidate, DEFAULT_CONFIG).catch((err: any) => err as Error);
  if (!(validation instanceof Error) && ["portable", "portable_with_headers"].includes(validation.status) && (validation.hasAudio || validation.hasVideo)) {
    return {
      ...validationToResult(channel, source, validation, Date.now() - start),
      selectedSourceType: source.type,
      resolverMethod: `${source.type}:static-extractor`,
      attemptedSource: source.page,
      mediaBytesReceived: validation.segmentSample?.bytesRead
    };
  }
  const msg = validation instanceof Error ? validation.message : validation.failureReason;
  return baseResult(channel, msg?.includes("timeout") ? "media_timeout" : "official_stream_down", source.type, msg ?? "Static official media validation failed", source);
}

function writeResolverReports(results: ResolverCheckResult[]): void {
  fs.mkdirSync(DEFAULT_CONFIG.outputDir, { recursive: true });
  const summary = summarize(results);
  fs.writeFileSync(RESOLVER_STATUS_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), summary, channels: results }, null, 2), "utf8");
  fs.writeFileSync(RESOLVER_STATUS_HTML_FILE, renderResolverHtml(results, summary), "utf8");
}

function writeOfficialPlaylists(results: ResolverCheckResult[]): void {
  const allChannels = loadOfficialChannels();
  const byId = new Map(results.map((result) => [result.channelId, result]));
  const healthy = results.filter((result) => result.status === "healthy" || result.status === "slow_start");
  writeM3u("playlist-diagnostic-all.m3u", allChannels, [
    "# WARNING: Diagnostic playlist. Many channels are unavailable and may return errors."
  ]);
  writeM3u("playlist-test-all.m3u", allChannels, [
    "# WARNING: Diagnostic playlist. Many channels are unavailable and may return errors.",
    "# Compatibility alias for playlist-diagnostic-all.m3u."
  ]);
  writeM3u("playlist-working.m3u", healthy.map((result) => allChannels.find((channel) => channel.id === result.channelId)!).filter(Boolean));
  writeM3u("playlist.m3u", healthy.map((result) => allChannels.find((channel) => channel.id === result.channelId)!).filter(Boolean));
  writeM3u("playlist-az.m3u", allChannels.filter((channel) => channel.country === "AZ" && ["healthy", "slow_start"].includes(byId.get(channel.id)?.status ?? "")));
  writeM3u("playlist-tr.m3u", allChannels.filter((channel) => channel.country === "TR" && ["healthy", "slow_start"].includes(byId.get(channel.id)?.status ?? "")));
  writeM3u("playlist-ru.m3u", allChannels.filter((channel) => channel.country === "RU" && ["healthy", "slow_start"].includes(byId.get(channel.id)?.status ?? "")));
}

function writeM3u(fileName: string, channels: OfficialChannel[], comments: string[] = []): void {
  const publicBaseUrl = getPublicBaseUrl();
  let text = "#EXTM3U\n";
  for (const comment of comments) text += `${comment}\n`;
  for (const channel of channels) {
    text += `#EXTINF:-1 tvg-id="${channel.id}" group-title="${groupTitleFixed(channel.country)}",${channel.name}\n`;
    text += `${publicBaseUrl}/live/${channel.id}\n`;
  }
  fs.writeFileSync(path.join(DEFAULT_CONFIG.outputDir, fileName), text, "utf8");
}

function renderResolverHtml(results: ResolverCheckResult[], summary: Record<string, number>): string {
  const rows = results.map((r) => `<tr><td>${r.country}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.category)}</td><td>${r.status}</td><td>${r.selectedSourceType ?? ""}</td><td>${r.startupMs ?? ""}</td><td>${r.hasAudio}</td><td>${r.hasVideo}</td><td>${r.resolution ?? ""}</td><td>${r.lastSuccessfulCheck ?? ""}</td><td>${escapeHtml(r.exactBlocker ?? "")}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Official IPTV Resolver Status</title><style>body{font-family:Arial,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px}th{background:#f3f3f3}.notice{background:#fff8d9;border:1px solid #e2c85d;padding:10px;margin:12px 0}</style></head><body><h1>Official IPTV Resolver Status</h1><div class="notice">Use playlist-working.m3u for TV. Diagnostic-all contains unresolved channels.</div><p>Configured: ${results.length} Healthy: ${summary.healthy ?? 0} Slow: ${summary.slow_start ?? 0} Unavailable: ${summary.unavailable ?? 0} Provider required: ${summary.provider_required ?? 0}</p><table><thead><tr><th>Country</th><th>Channel</th><th>Category</th><th>Status</th><th>Source</th><th>Startup</th><th>Audio</th><th>Video</th><th>Resolution</th><th>Last success</th><th>Blocker</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function summarize(results: ResolverCheckResult[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const result of results) summary[result.status] = (summary[result.status] ?? 0) + 1;
  return summary;
}

async function pipeDirectHls(url: string, res: ServerResponse, headers: Record<string, string> = {}): Promise<void> {
  const abort = new AbortController();
  res.once("close", () => abort.abort());
  let mediaUrl = url;
  const seen = new Set<string>();
  while (!abort.signal.aborted) {
    const manifest = await fetchSafe(mediaUrl, {
      timeoutMs: DEFAULT_CONFIG.manifestTimeoutMs,
      limitBytes: 2 * 1024 * 1024,
      headers
    });
    const parsed = parseHlsManifest(manifest.body.toString("utf8"), manifest.finalUrl);
    if (parsed.isMaster) {
      const variant = parsed.variants.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
      if (!variant) throw new Error("Official HLS master has no variants");
      mediaUrl = variant.url;
      continue;
    }
    const fresh = parsed.segments.filter((segment) => !seen.has(segment.url));
    for (const segment of fresh) {
      if (abort.signal.aborted) return;
      seen.add(segment.url);
      const body = await fetchSafe(segment.url, {
        timeoutMs: DEFAULT_CONFIG.segmentTimeoutMs,
        limitBytes: 16 * 1024 * 1024,
        headers
      });
      if (!res.write(body.body)) await new Promise((resolve) => res.once("drain", resolve));
      if (seen.size > 200) for (const old of [...seen].slice(0, 50)) seen.delete(old);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

function spawnStreamlink(page: string): ResolverProcess | undefined {
  const exe = streamlinkExecutable();
  if (!exe) return undefined;
  const args = [
    "--stdout",
    "--default-stream",
    "best",
    "--plugin-dirs",
    path.resolve("resolver/plugins"),
    page
  ];
  return spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"] });
}

function streamlinkExecutable(): string | undefined {
  const candidates = [
    process.env["IPTV_STREAMLINK_PATH"],
    firstWhere("streamlink.exe"),
    path.join(process.env["LOCALAPPDATA"] ?? "", "Programs/Streamlink/bin/streamlink.exe"),
    path.join(process.env["ProgramFiles"] ?? "", "Streamlink/bin/streamlink.exe"),
    path.join(process.env["ProgramFiles(x86)"] ?? "", "Streamlink/bin/streamlink.exe"),
    path.resolve(".venv/Scripts/streamlink.exe")
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function waitForFirstBytes(proc: ResolverProcess, res: ServerResponse, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    proc.stdout.once("data", (chunk: Buffer) => {
      clearTimeout(timeout);
      res.write(chunk);
      resolve(true);
    });
    proc.once("exit", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

async function getEnvironmentInfo(): Promise<EnvironmentInfo> {
  const pythonExecutable = fs.existsSync(path.resolve(".venv/Scripts/python.exe")) ? path.resolve(".venv/Scripts/python.exe") : null;
  const streamlinkExecutablePath = streamlinkExecutable() ?? null;
  const pluginsText = streamlinkExecutablePath ? await runVersion(streamlinkExecutablePath, ["--plugins"]) : undefined;
  const plugins = parsePluginList(pluginsText ?? "");
  const ffmpegExecutable = findFfmpeg(streamlinkExecutablePath);
  const ffprobeExecutable = findFfprobe();
  const childProcessCheck = streamlinkExecutablePath ? await checkChildProcess(streamlinkExecutablePath) : false;
  const status = environmentStatus(streamlinkExecutablePath, ffmpegExecutable, ffprobeExecutable, childProcessCheck);
  return {
    pythonExecutable,
    pythonVersion: pythonExecutable ? (await runVersion(pythonExecutable, ["--version"])) ?? null : null,
    streamlinkExecutable: streamlinkExecutablePath,
    streamlinkVersion: streamlinkExecutablePath ? (await runVersion(streamlinkExecutablePath, ["--version"])) ?? null : null,
    ffmpegExecutable,
    ffprobeExecutable,
    pluginDir: path.resolve("resolver/plugins"),
    status,
    plugins,
    childProcessCheck
  };
}

function findFfmpeg(streamlinkPath: string | null): string | null {
  const streamlinkRoot = streamlinkPath ? path.resolve(path.dirname(streamlinkPath), "..") : undefined;
  const candidates = [
    process.env["IPTV_FFMPEG_PATH"],
    streamlinkRoot ? path.join(streamlinkRoot, "ffmpeg/ffmpeg.exe") : undefined,
    firstWhere("ffmpeg.exe")
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function findFfprobe(): string | null {
  const candidates = [
    process.env["IPTV_FFPROBE_PATH"],
    path.resolve("node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe"),
    path.resolve("node_modules/ffprobe-static/bin/win32/ia32/ffprobe.exe"),
    firstWhere("ffprobe.exe")
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function environmentStatus(streamlinkPath: string | null, ffmpegPath: string | null, ffprobePath: string | null, childProcessCheck: boolean): ResolverInfrastructureStatus {
  if (!streamlinkPath) return "streamlink_not_installed";
  if (!childProcessCheck) return "streamlink_launch_failed";
  if (!ffmpegPath) return "ffmpeg_not_available";
  if (!ffprobePath) return "ffprobe_not_available";
  return "ready";
}

function firstWhere(command: string): string | undefined {
  const result = spawnSync("where.exe", [command], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function parsePluginList(text: string): string[] {
  const prefix = "Available plugins:";
  const body = text.includes(prefix) ? text.slice(text.indexOf(prefix) + prefix.length) : text;
  return body.split(",").map((plugin) => plugin.trim()).filter(Boolean);
}

async function checkChildProcess(command: string): Promise<boolean> {
  const version = await runVersion(command, ["--version"]);
  return Boolean(version?.startsWith("streamlink "));
}

function runVersion(command: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    child.on("error", () => resolve(undefined));
    child.on("close", () => resolve(output.trim() || undefined));
  });
}

function collectProcessSample(proc: ResolverProcess, maxBytes: number, timeoutMs: number): Promise<{ bytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("media_timeout: no media bytes before startup timeout"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      proc.stdout.off("data", onData);
      proc.off("exit", onExit);
      proc.off("error", onError);
    };
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= maxBytes) {
        cleanup();
        resolve({ bytes: Buffer.concat(chunks, total) });
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      if (total > 0) resolve({ bytes: Buffer.concat(chunks, total) });
      else reject(new Error(`streamlink exited before media bytes; code=${code ?? "unknown"}`));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    proc.stdout.on("data", onData);
    proc.once("exit", onExit);
    proc.once("error", onError);
  });
}

async function probeSample(bytes: Buffer): Promise<{ hasAudio: boolean; hasVideo: boolean; resolution?: string }> {
  const ffprobe = findFfprobe();
  if (!ffprobe) throw new Error("ffprobe_not_available");
  const samplePath = path.join(os.tmpdir(), `iptv-streamlink-sample-${randomUUID()}.ts`);
  fs.writeFileSync(samplePath, bytes);
  try {
    const output = await runProcess(ffprobe, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      samplePath
    ], 12_000);
    const parsed = JSON.parse(output || "{}") as { streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
    const video = parsed.streams?.find((stream) => stream.codec_type === "video");
    const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
    if (!video && !audio) throw new Error("ffprobe did not detect audio or video");
    return {
      hasAudio: Boolean(audio),
      hasVideo: Boolean(video),
      resolution: video?.width && video.height ? `${video.width}x${video.height}` : undefined
    };
  } finally {
    fs.rmSync(samplePath, { force: true });
  }
}

async function verifyGatewayEndpoint(url: string): Promise<{ ok: boolean; http: number; contentType: string; bytes: number; ffprobe: boolean; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      return { ok: false, http: response.status, contentType, bytes: 0, ffprobe: false, error: `HTTP ${response.status}` };
    }
    if (/html|json/i.test(contentType)) {
      return { ok: false, http: response.status, contentType, bytes: 0, ffprobe: false, error: `Unexpected content-type ${contentType}` };
    }
    if (!response.body) {
      return { ok: false, http: response.status, contentType, bytes: 0, ffprobe: false, error: "No response body" };
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      while (total < 1024 * 1024) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const chunk = Buffer.from(value);
        chunks.push(chunk);
        total += chunk.length;
      }
    } finally {
      reader.releaseLock();
      controller.abort();
    }
    const sample = Buffer.concat(chunks, total);
    if (sample.length < 4096) {
      return { ok: false, http: response.status, contentType, bytes: sample.length, ffprobe: false, error: "Less than 4096 media bytes" };
    }
    const probe = await probeSample(sample).then((result) => result.hasAudio || result.hasVideo).catch(() => false);
    return { ok: probe, http: response.status, contentType, bytes: sample.length, ffprobe: probe, error: probe ? undefined : "ffprobe failed" };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function verifyGatewayEndpointWithRetry(url: string): Promise<{ ok: boolean; http: number; contentType: string; bytes: number; ffprobe: boolean; error?: string }> {
  let last = await verifyGatewayEndpoint(url);
  if (last.ok) return last;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const retry = await verifyGatewayEndpoint(url);
  return retry.ok ? retry : { ...retry, error: `${last.error ?? "first attempt failed"}; retry: ${retry.error ?? "failed"}` };
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
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(sanitizeLog(stderr || `process exited with code ${code}`)));
    });
  });
}

function classifyStreamlinkFailure(message: string): ResolverStatus {
  const lower = message.toLowerCase();
  if (lower.includes("no plugin can handle url") || lower.includes("no plugin")) return "plugin_unsupported";
  if (lower.includes("unsupported url")) return "plugin_unsupported";
  if (lower.includes("403") || lower.includes("forbidden")) return "official_stream_down";
  if (lower.includes("404") || lower.includes("not found")) return "official_page_down";
  if (lower.includes("login") || lower.includes("auth")) return "login_required";
  if (lower.includes("drm")) return "drm";
  if (lower.includes("geo") || lower.includes("region")) return "geo_blocked";
  if (lower.includes("timeout") || lower.includes("timed out")) return "media_timeout";
  if (lower.includes("streamlink exited before media bytes")) return "official_stream_down";
  return "plugin_failed";
}

interface StaticMediaResolution {
  url: string;
  evidenceUrl: string;
  referer?: string;
  method: StreamCandidate["discoveryMethod"];
}

async function resolveStaticMedia(pageUrl: string): Promise<StaticMediaResolution | undefined> {
  if (!pageUrl) return undefined;
  const visited = new Set<string>();
  return resolveStaticMediaFromPage(pageUrl, pageUrl, visited, 0);
}

async function resolveStaticMediaFromPage(pageUrl: string, referer: string, visited: Set<string>, depth: number): Promise<StaticMediaResolution | undefined> {
  if (visited.has(pageUrl) || depth > 2) return undefined;
  visited.add(pageUrl);
  const page = await fetchTextSafe(pageUrl, {
    timeoutMs: DEFAULT_CONFIG.manifestTimeoutMs,
    limitBytes: 2 * 1024 * 1024,
    headers: { Referer: referer }
  });
  const direct = extractMediaUrl(page.text, page.finalUrl);
  if (direct) return { url: direct, evidenceUrl: page.finalUrl, referer: page.finalUrl, method: "html" };

  const iframeUrls = extractAttributeUrls(page.text, page.finalUrl, ["iframe"], ["src", "data-src"]).slice(0, 5);
  for (const iframeUrl of iframeUrls) {
    const nested = await resolveStaticMediaFromPage(iframeUrl, page.finalUrl, visited, depth + 1).catch(() => undefined);
    if (nested) return { ...nested, method: "iframe" };
  }

  const scriptUrls = extractAttributeUrls(page.text, page.finalUrl, ["script"], ["src"]).slice(0, 8);
  for (const scriptUrl of scriptUrls) {
    const script = await fetchTextSafe(scriptUrl, {
      timeoutMs: DEFAULT_CONFIG.manifestTimeoutMs,
      limitBytes: 1024 * 1024,
      headers: { Referer: page.finalUrl }
    }).catch(() => undefined);
    if (!script) continue;
    const media = extractMediaUrl(script.text, script.finalUrl);
    if (media) return { url: media, evidenceUrl: script.finalUrl, referer: page.finalUrl, method: "embedded-script" };
  }

  return undefined;
}

function extractMediaUrl(text: string, baseUrl: string): string | undefined {
  const decoded = text.replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const absolute = decoded.match(/https?:\/\/[^"'\\<>\s]+?\.(?:m3u8|mpd)(?:\?[^"'\\<>\s]*)?/i);
  if (absolute) return stripTrailingPunctuation(absolute[0]);
  const relative = decoded.match(/["']([^"']+?\.(?:m3u8|mpd)(?:\?[^"']*)?)["']/i);
  if (relative?.[1]) return new URL(stripTrailingPunctuation(relative[1]), baseUrl).toString();
  return undefined;
}

function extractAttributeUrls(text: string, baseUrl: string, tags: string[], attributes: string[]): string[] {
  const urls: string[] = [];
  for (const tag of tags) {
    const tagRegex = new RegExp(`<${tag}\\b[^>]*>`, "gi");
    const matches = text.matchAll(tagRegex);
    for (const match of matches) {
      const fragment = match[0];
      for (const attr of attributes) {
        const attrMatch = fragment.match(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i"));
        if (!attrMatch?.[1]) continue;
        const value = attrMatch[1].trim();
        if (!value || value.startsWith("data:") || value.startsWith("javascript:")) continue;
        urls.push(new URL(value, baseUrl).toString());
      }
    }
  }
  return [...new Set(urls)];
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[),.;]+$/g, "");
}

function extractPluginName(stderr: string): string | undefined {
  const match = stderr.match(/plugin\s+([a-z0-9_]+)/i) ?? stderr.match(/\[cli\]\[info\]\s+Found matching plugin\s+([a-z0-9_]+)/i);
  return match?.[1];
}

function sanitizeLog(value: string): string {
  return value
    .replace(/(cookie|authorization|proxy-authorization):[^\r\n]*/gi, "$1:<redacted>")
    .replace(/([?&](?:token|hash|sig|signature|auth|key)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/https?:\/\/[^\s]+/gi, (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return "<url>";
      }
    })
    .trim()
    .slice(0, 2000);
}

function killProcess(proc: ResolverProcess): void {
  if (!proc.killed) proc.kill("SIGTERM");
  activeProcesses.delete(proc);
}

function sortedSources(channel: OfficialChannel): OfficialSource[] {
  return [...channel.sources].sort((a, b) => a.priority - b.priority);
}

function getPublicBaseUrl(): string {
  const configured = process.env["IPTV_PUBLIC_BASE_URL"] ?? readSavedPublicBaseUrl();
  if (!configured) {
    throw new Error("IPTV_PUBLIC_BASE_URL is required for playlist generation. See .env.example.");
  }
  const parsed = new URL(configured);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("IPTV_PUBLIC_BASE_URL must use http or https");
  }
  const host = parsed.hostname;
  const localHosts = new Set(["localhost", "127.0.0.1"]);
  if (!localHosts.has(host)) {
    const addresses = getLanAddresses();
    if (!addresses.includes(host)) {
      throw new Error(`Configured IPTV_PUBLIC_BASE_URL host ${host} is not assigned to this machine. Current LAN addresses: ${addresses.join(", ") || "none"}`);
    }
  }
  return configured.replace(/\/+$/g, "");
}

function readSavedPublicBaseUrl(): string | undefined {
  try {
    const baseline = JSON.parse(fs.readFileSync(WORKING_BASELINE_FILE, "utf8")) as { publicBaseUrl?: string };
    return baseline.publicBaseUrl;
  } catch {
    return undefined;
  }
}

function groupTitle(country: CountryCode): string {
  if (country === "AZ") return "Azərbaycan";
  if (country === "TR") return "Türkiye";
  if (country === "RU") return "Россия";
  return "Provider Required";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]!));
}

void groupTitle;

function groupTitleFixed(country: CountryCode): string {
  if (country === "AZ") return "Az\u0259rbaycan";
  if (country === "TR") return "T\u00fcrkiy\u0259";
  if (country === "RU") return "Rusiya";
  return "Provider Required";
}

function repairMojibake(value: string): string {
  if (!/[ÃÄÅÐÑÉ]/.test(value)) return value;
  const bytes: number[] = [];
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    const win1252 = WINDOWS_1252_REVERSE.get(code);
    if (code <= 0xff) bytes.push(code);
    else if (win1252 !== undefined) bytes.push(win1252);
    else return value;
  }
  const decoded = Buffer.from(bytes).toString("utf8");
  return decoded.includes("\ufffd") ? value : decoded;
}

const WINDOWS_1252_REVERSE = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f]
]);
