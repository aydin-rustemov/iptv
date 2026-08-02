import fs from "node:fs";
import { loadSources, downloadSource, updateSourceStats } from "./downloader.js";
import { parseM3u } from "./parser.js";
import { fastCheck, mediaCheck } from "./validator.js";
import { dedupe, preselect, score, select } from "./selector.js";
import { countBy, writePlaylist, writeStatus } from "./generator.js";
import type { FastCheckResult, MediaCheckResult, PlaylistEntry, StatusOutput, ValidatedEntry } from "./types.js";
import { addTargetedPriorityCandidates, buildMissingPriorityDetails, buildPriorityStatuses, loadPriorityChannels, tagPriorityEntries, writeMissingPriority, writeMissingPriorityDetails } from "./priority.js";
import { discoverCanliTvAz } from "./sources/canlitvAz.js";
import { forcedPublishedOverrides, loadManualOverrides, manualOverrideCandidates } from "./manualOverrides.js";

const FAST_CONCURRENCY = Number(process.env["IPTV_FAST_CONCURRENCY"] ?? 30);
const MEDIA_CONCURRENCY = Number(process.env["IPTV_MEDIA_CONCURRENCY"] ?? 5);

async function main(): Promise<void> {
  const sources = loadSources();
  const priorities = loadPriorityChannels();
  const manualOverrides = loadManualOverrides();
  const downloaded = await Promise.all(sources.map(async (source) => ({ source, text: await downloadSource(source) })));
  const parsedBySource = downloaded.map(({ source, text }) => ({ source, entries: parseM3u(text, source.name) }));
  const canliTv = await discoverCanliTvAz({ full: shouldRunFullCanliTvDiscovery() });
  const parsedEntries = tagPriorityEntries([
    ...parsedBySource.flatMap((item) => item.entries),
    ...manualOverrideCandidates(manualOverrides),
    ...canliTv.entries
  ], priorities);
  const targeted = await addTargetedPriorityCandidates(parsedEntries, priorities);
  const entries = targeted.entries;
  const { entries: uniqueEntries, duplicatesRemoved } = dedupe(entries);
  const candidates = preselect(uniqueEntries);

  const fastResults = new Map<PlaylistEntry, FastCheckResult>();
  await runPool(candidates, FAST_CONCURRENCY, async (entry) => {
    fastResults.set(entry, await checkFastWithRetry(entry));
  });
  const fastPassed = candidates.filter((entry) => fastResults.get(entry)?.ok);

  const mediaResults = new Map<PlaylistEntry, MediaCheckResult>();
  await runPool(fastPassed, MEDIA_CONCURRENCY, async (entry) => {
    mediaResults.set(entry, await checkMediaWithRetry(entry, fastResults.get(entry)!));
  });

  const validated: ValidatedEntry[] = fastPassed.flatMap((entry) => {
    const media = mediaResults.get(entry);
    const fast = fastResults.get(entry)!;
    if (!media?.ok) return [];
    return [{
      ...entry,
      normalizedUrl: normalizeUrl(entry.url),
      fast,
      media,
      score: score(entry, media, fast.latencyMs)
    }];
  });

  const forced = forcedPublishedOverrides(manualOverrides);
  const unverifiedFallbacks = unverifiedCanliTvFallbacks(uniqueEntries, validated, forced);
  const selected = select([...forced, ...validated, ...unverifiedFallbacks], Number.MAX_SAFE_INTEGER, priorities);
  const priorityChannels = buildPriorityStatuses(priorities, uniqueEntries, validated, selected);
  const missingDetails = buildMissingPriorityDetails(priorityChannels, priorities, uniqueEntries, fastResults, mediaResults, sources.length, targeted.officialPagesChecked, targeted.officialSocialAccountsChecked);
  const previousCount = countPreviousPlaylist();
  const degraded = shouldKeepPrevious(previousCount, selected.length);
  if (!degraded) {
    if (fs.existsSync("output/playlist.m3u")) fs.copyFileSync("output/playlist.m3u", "output/playlist.previous.m3u");
    writePlaylist(selected);
    writeMissingPriority(priorityChannels);
    writeMissingPriorityDetails(missingDetails);
  }
  updateSourceStats(parsedBySource.map(({ source, entries: sourceEntries }) => ({
    name: source.name,
    parsedEntries: sourceEntries.length,
    workingPriorityCandidates: selected.filter((entry) => entry.sourceName === source.name && entry.priorityId).length
  })));

  const status: StatusOutput = {
    updatedAt: new Date().toISOString(),
    sources: sources.length,
    downloadedEntries: entries.length,
    uniqueCandidates: uniqueEntries.length,
    fastCheckPassed: fastPassed.length,
    mediaCheckPassed: validated.length,
    published: degraded ? previousCount : selected.length,
    failed: candidates.length - validated.length,
    duplicatesRemoved,
    countryCounts: countBy(degraded ? [] : selected, (entry) => entry.country),
    categoryCounts: countBy(degraded ? [] : selected, (entry) => entry.category),
    degraded,
    priorityChannels
  };
  writeChannelHealth(selected, validated, canliTv.status);
  writeStatus(status);
  console.log(JSON.stringify(status, null, 2));
  if (degraded) process.exitCode = 2;
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++]!;
      await worker(item);
    }
  }));
}

async function checkFastWithRetry(entry: PlaylistEntry): Promise<FastCheckResult> {
  const first = await fastCheck(entry);
  if (first.ok || !entry.priorityId) return first;
  return await fastCheck(entry);
}

async function checkMediaWithRetry(entry: PlaylistEntry, fast: FastCheckResult): Promise<MediaCheckResult> {
  const first = await mediaCheck(entry, fast);
  if (first.ok || !entry.priorityId) return first;
  const second = await mediaCheck(entry, fast);
  if (second.ok) return second;
  return await mediaCheck(entry, fast);
}

function shouldKeepPrevious(previousCount: number, nextCount: number): boolean {
  if (previousCount === 0) return false;
  if (nextCount >= 200) return false;
  if (nextCount >= 100 && previousCount < 200) return false;
  if (nextCount < 100 && previousCount < 100) return false;
  return true;
}

function countPreviousPlaylist(): number {
  try {
    return (fs.readFileSync("output/playlist.m3u", "utf8").match(/^#EXTINF/gm) ?? []).length;
  } catch {
    return 0;
  }
}

function shouldRunFullCanliTvDiscovery(): boolean {
  if (process.env["IPTV_CANLITV_FULL"] === "1") return true;
  try {
    const status = JSON.parse(fs.readFileSync("output/canlitv-status.json", "utf8")) as { updatedAt?: string };
    if (!status.updatedAt) return true;
    return Date.now() - Date.parse(status.updatedAt) > 24 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

function unverifiedCanliTvFallbacks(entries: PlaylistEntry[], validated: ValidatedEntry[], forced: ValidatedEntry[]): ValidatedEntry[] {
  const publishedIds = new Set([...validated, ...forced].map((entry) => entry.priorityId ?? entry.tvgId ?? entry.name));
  return entries
    .filter((entry) => entry.sourceName === "canlitv-az-unverified")
    .filter((entry) => !publishedIds.has(entry.priorityId ?? entry.tvgId ?? entry.name))
    .map((entry) => ({
      ...entry,
      name: entry.name.startsWith("⚠ ") ? entry.name : `⚠ ${entry.name}`,
      tvgName: (entry.tvgName ?? entry.name).startsWith("⚠ ") ? entry.tvgName : `⚠ ${entry.tvgName ?? entry.name}`,
      groupTitle: fallbackGroup(entry.country),
      normalizedUrl: normalizeUrl(entry.url),
      score: -1000,
      fast: { ok: true, finalUrl: entry.url, kind: "hls", reason: "unverified_canlitv_fallback" },
      media: { ok: false, hasVideo: false, hasAudio: false, bytesRead: 0, reason: "unverified_canlitv_fallback" }
    }));
}

function fallbackGroup(country?: string): string {
  if (country === "Azərbaycan" || country === "AzÉ™rbaycan" || country === "AzÃ‰â„¢rbaycan") return "Azərbaycan — Yoxlanılmamış";
  if (country === "Türkiyə" || country === "TÃ¼rkiyÉ™" || country === "TÃƒÂ¼rkiyÃ‰â„¢") return "Türkiyə — Yoxlanılmamış";
  if (country === "Rusiya") return "Rusiya — Yoxlanılmamış";
  return `${country ?? "Beynəlxalq"} — Yoxlanılmamış`;
}

function writeChannelHealth(selected: ValidatedEntry[], validated: ValidatedEntry[], canliTv: unknown): void {
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync("output/channel-health.json", JSON.stringify({
    updatedAt: new Date().toISOString(),
    published: selected.length,
    verifiedWorking: validated.length,
    unverifiedCanliTvFallbacks: selected.filter((entry) => entry.sourceName === "canlitv-az-unverified").length,
    canliTv
  }, null, 2), "utf8");
}

function normalizeUrl(raw: string): string {
  try {
    return new URL(raw).toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
