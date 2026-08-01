import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { FastAdapter, FastDiscoveryRecord, FastDirectStatus } from "./types.js";

interface StreamlinkFastTarget {
  platform: string;
  market: string;
  channelName: string;
  channelOwner: string;
  officialPlatformPage: string;
}

const TARGETS: StreamlinkFastTarget[] = [
  {
    platform: "Pluto TV",
    market: "United States",
    channelName: "Pluto TV News",
    channelOwner: "Pluto TV",
    officialPlatformPage: "https://pluto.tv/live-tv/pluto-tv-news"
  },
  {
    platform: "Pluto TV",
    market: "United States",
    channelName: "Pluto TV Live Catalog",
    channelOwner: "Pluto TV",
    officialPlatformPage: "https://pluto.tv/us/live-tv"
  },
  {
    platform: "Samsung TV Plus",
    market: "United States",
    channelName: "Samsung TV Plus",
    channelOwner: "Samsung",
    officialPlatformPage: "https://www.samsungtvplus.com/"
  },
  {
    platform: "Rakuten TV",
    market: "United Kingdom",
    channelName: "Rakuten TV Live TV",
    channelOwner: "Rakuten",
    officialPlatformPage: "https://www.rakuten.tv/uk/live_channels"
  },
  {
    platform: "Tubi",
    market: "United States",
    channelName: "Tubi Live TV",
    channelOwner: "Tubi",
    officialPlatformPage: "https://tubitv.com/live"
  }
];

export class StreamlinkFastAdapter implements FastAdapter {
  platform = "streamlink-fast";
  markets = [...new Set(TARGETS.map((target) => target.market))];

  async discover(): Promise<FastDiscoveryRecord[]> {
    const rows: FastDiscoveryRecord[] = [];
    for (const target of TARGETS) {
      const resolved = await streamlinkUrl(target.officialPlatformPage).catch((err: Error) => ({ error: err.message }));
      if (typeof resolved === "string" && /^https?:\/\//i.test(resolved)) {
        rows.push({
          platform: target.platform,
          market: target.market,
          channelName: target.channelName,
          channelOwner: target.channelOwner,
          officialPlatformPage: target.officialPlatformPage,
          manifestCandidate: resolved,
          sessionRequired: hasSessionLikeParams(resolved),
          regionRequired: false,
          deviceRequired: hasDeviceLikeParams(resolved),
          directCompatibility: classifyCandidate(resolved),
          failureReason: undefined
        });
      } else {
        rows.push({
          platform: target.platform,
          market: target.market,
          channelName: target.channelName,
          channelOwner: target.channelOwner,
          officialPlatformPage: target.officialPlatformPage,
          sessionRequired: false,
          regionRequired: true,
          deviceRequired: false,
          directCompatibility: "invalid",
          failureReason: typeof resolved === "object" ? resolved.error : "No public manifest candidate resolved"
        });
      }
    }
    return rows;
  }
}

function classifyCandidate(url: string): FastDirectStatus {
  if (hasDeviceLikeParams(url)) return "device_bound";
  if (hasSessionLikeParams(url)) return "cookie_dependent";
  return "platform_direct";
}

function hasDeviceLikeParams(raw: string): boolean {
  try {
    const url = new URL(raw);
    return [...url.searchParams.keys()].some((key) => /device|client|session|sid/i.test(key));
  } catch {
    return false;
  }
}

function hasSessionLikeParams(raw: string): boolean {
  try {
    const url = new URL(raw);
    return [...url.searchParams.keys()].some((key) => /token|session|sid|device|client|user|auth/i.test(key));
  } catch {
    return false;
  }
}

function streamlinkUrl(page: string): Promise<string> {
  const exe = streamlinkExecutable();
  if (!exe) return Promise.reject(new Error("Streamlink executable not found"));
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ["--stream-url", page, "best"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("FAST platform discovery timeout"));
    }, 20_000);
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const url = stdout.split(/\r?\n/).find((line) => /^https?:\/\//i.test(line.trim()))?.trim();
      if (code === 0 && url) resolve(url);
      else reject(new Error(sanitize(stderr || stdout || `streamlink exited ${code}`)));
    });
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

function sanitize(value: string): string {
  return value
    .replace(/([?&](?:token|session|sid|device|client|auth|key)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/(cookie|authorization):[^\r\n]*/gi, "$1:<redacted>")
    .trim()
    .slice(0, 1000);
}
