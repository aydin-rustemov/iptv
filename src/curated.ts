import fs from "node:fs";
import { loadSources, downloadSource } from "./downloader.js";
import { normalizeCountry, parseM3u } from "./parser.js";
import { fastCheck, isForbiddenUrl, mediaCheck } from "./validator.js";
import { isPublishableUrl, MAX_PLAYLIST_BYTES } from "./playlistGuard.js";
import { manualOverrideCandidates, loadManualOverrides } from "./manualOverrides.js";
import { loadPriorityChannels, buildPriorityStatuses, tagPriorityEntries, writeMissingPriority } from "./priority.js";
import { countBy, isDisplayableChannel, writePlaylist, writeStatus } from "./generator.js";
import { regionOf, selectRegionalPlaylist, uniqueVerified, type Region } from "./regional.js";
import { score } from "./selector.js";
import type { PlaylistEntry, PriorityChannel, StatusOutput, ValidatedEntry } from "./types.js";

const SOURCE_NAMES = new Set([
  "iptv-org-azerbaijan",
  "iptv-org-turkey",
  "iptv-org-russia",
  "iptv-org-azerbaijani-language",
  "iptv-org-turkish-language",
  "iptv-org-russian-language"
]);
const SCAN_LIMITS: Record<Region, number> = { AZ: 160, TR: 400, RU: 280 };
const GOALS: Record<Region, number> = { AZ: 35, TR: 60, RU: 20 };
const BATCH = 40;
const CONCURRENCY = 12;

async function main(): Promise<void> {
  const sources = loadSources().filter((source) => SOURCE_NAMES.has(source.name));
  if (sources.length < 3) throw new Error("Regional M3U sources are missing");
  const priorities = loadPriorityChannels();
  const errors: string[] = [];
  const sourcesLoaded: string[] = [];
  const downloaded = await Promise.allSettled(sources.map(async (source) => ({
    source,
    entries: parseM3u(await downloadSource(source), source.name)
  })));
  const sourceEntries: PlaylistEntry[] = [];
  for (let i = 0; i < downloaded.length; i++) {
    const result = downloaded[i]!;
    if (result.status === "fulfilled") {
      sourceEntries.push(...result.value.entries);
      sourcesLoaded.push(result.value.source.name);
      console.log("[SOURCE]", result.value.source.name, result.value.entries.length);
    } else {
      const msg = sources[i]!.name + ": " + String(result.reason);
      errors.push(msg);
      console.warn("[SOURCE FAILED]", msg);
    }
  }

  // Overrides and published URLs are candidates only; none may bypass video validation.
  const overrides = manualOverrideCandidates(loadManualOverrides());
  const direct = directCandidates(priorities);
  const discovered = tagPriorityEntries([...overrides, ...direct, ...sourceEntries], priorities)
    .filter((entry) => regionOf(entry) !== undefined)
    .filter((entry) => isPublishableUrl(entry.url) && !isForbiddenUrl(entry.url, { allowLivePath: true }));

  const seen = new Set<string>();
  const unique = discovered.filter((entry) => {
    const key = regionOf(entry) + "|" + entry.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log("[DISCOVERY] candidates=", discovered.length, "unique=", unique.length);

  const verified: ValidatedEntry[] = [];
  let probed = 0;
  let fastPassed = 0;
  const reasons: Record<string, number> = {};

  for (const region of ["AZ", "TR", "RU"] as const) {
    const ordered = unique.filter((entry) => regionOf(entry) === region)
      .sort((a, b) => candidateRank(b, region) - candidateRank(a, region));
    const scanLimit = Math.min(SCAN_LIMITS[region], ordered.length);
    console.log("[REGION]", region, "available=", ordered.length, "scanLimit=", scanLimit);
    for (let i = 0; i < scanLimit; i += BATCH) {
      const batch = ordered.slice(i, Math.min(i + BATCH, scanLimit));
      const results = await runPool(batch, CONCURRENCY, validate);
      for (const result of results) {
        probed++;
        if (result.fastPassed) fastPassed++;
        if (result.verified) verified.push(result.verified);
        else {
          const reason = result.reason || "unknown";
          reasons[reason] = (reasons[reason] ?? 0) + 1;
        }
      }
      const distinct = uniqueVerified(verified, region).length;
      console.log("[PROGRESS]", region, "tested=", Math.min(i + BATCH, scanLimit), "uniqueWorking=", distinct);
      if (distinct >= GOALS[region]) break;
    }
  }

  const selected = selectRegionalPlaylist(verified).filter(isDisplayableChannel);
  if (selected.length === 0) {
    throw new Error("No streams passed real video validation; preserving previous playlist");
  }

  const playlist = "output/playlist.m3u";
  const previous = "output/playlist.previous.m3u";
  const oldPlaylistIsCompact = fs.existsSync(playlist) && fs.statSync(playlist).size <= MAX_PLAYLIST_BYTES;
  if (oldPlaylistIsCompact) {
    fs.copyFileSync(playlist, previous);
  }
  writePlaylist(selected, playlist);
  if (!oldPlaylistIsCompact) writePlaylist(selected, previous);

  const prioritiesStatus = buildPriorityStatuses(priorities, unique, verified, selected);
  const status: StatusOutput = {
    updatedAt: new Date().toISOString(),
    sources: sourcesLoaded.length,
    downloadedEntries: discovered.length,
    uniqueCandidates: unique.length,
    fastCheckPassed: fastPassed,
    mediaCheckPassed: verified.length,
    published: selected.length,
    failed: probed - verified.length,
    duplicatesRemoved: discovered.length - unique.length,
    countryCounts: countBy(selected, (entry) => normalizeCountry(entry.country)),
    categoryCounts: countBy(selected, (entry) => entry.category),
    degraded: selected.length < 80,
    priorityChannels: prioritiesStatus
  };
  writeStatus(status);
  writeMissingPriority(prioritiesStatus);
  fs.writeFileSync("output/missing-priority-details.json", "[]\n", "utf8");
  fs.writeFileSync("output/channel-health.json", JSON.stringify({
    updatedAt: status.updatedAt,
    published: selected.length,
    verifiedWorking: selected.length,
    validation: "HTTP manifest + video segment ffprobe; no forced/unchecked channels",
    countryCounts: status.countryCounts,
    candidatesScanned: probed,
    candidatesWithVideo: verified.length,
    rejected: reasons,
    sourcesLoaded,
    sourceErrors: errors
  }, null, 2), "utf8");
  console.log("[PUBLISHED]", JSON.stringify({ published: selected.length, countryCounts: status.countryCounts, failures: reasons, sourceErrors: errors }));
}

function directCandidates(priorities: PriorityChannel[]): PlaylistEntry[] {
  return priorities.flatMap((priority) => (priority.directCandidates ?? []).map((url) => ({
    sourceName: "priority-direct",
    tvgId: priority.id,
    tvgName: priority.name,
    groupTitle: priority.country,
    country: priority.country,
    category: priority.category,
    name: priority.name,
    url,
    headers: {},
    priorityId: priority.id,
    priorityName: priority.name,
    priorityCountry: priority.country,
    priorityCategory: priority.category,
    priorityOrder: priority.priority,
    allowLivePath: true
  })));
}

function candidateRank(entry: PlaylistEntry, region: Region): number {
  let ranking = 0;
  if (entry.priorityId) ranking += 2500;
  if (entry.sourceName.startsWith("manual-")) ranking += 3500;
  if (entry.sourceName === "priority-direct") ranking += 3000;
  const regionalName = region === "AZ" ? "azerbaijan" : region === "TR" ? "turkey" : "russia";
  if (entry.sourceName === "iptv-org-" + regionalName) ranking += 1000;
  if (entry.headers["Referer"] || entry.headers["User-Agent"]) ranking -= 200;
  if (entry.url.includes("?")) ranking -= 50;
  return ranking - entry.url.length / 100;
}

async function validate(entry: PlaylistEntry): Promise<{ fastPassed: boolean; verified?: ValidatedEntry; reason?: string }> {
  const probe = { ...entry, headers: { ...entry.headers }, allowLivePath: true };
  try {
    const fast = await fastCheck(probe);
    if (!fast.ok) return { fastPassed: false, reason: fast.reason ?? "fast_failed" };
    const media = await mediaCheck(probe, fast);
    if (!media.ok || !media.hasVideo) return { fastPassed: true, reason: media.reason ?? "no_video" };
    return {
      fastPassed: true,
      verified: {
        ...probe,
        normalizedUrl: probe.url,
        fast,
        media,
        score: score(probe, media, fast.latencyMs)
      }
    };
  } catch (err) {
    return { fastPassed: false, reason: String(err).slice(0, 80) };
  }
}

async function runPool<T, R>(items: T[], concurrency: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (index < items.length) {
      const id = index++;
      result[id] = await job(items[id]!);
    }
  }));
  return result;
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exitCode = 1;
});
