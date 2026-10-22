import fs from "node:fs";
import { loadSources, downloadSource } from "./downloader.js";
import { normalizeCountry, parseM3u } from "./parser.js";
import { fastCheck, isForbiddenUrl, mediaCheck } from "./validator.js";
import { isPublishableUrl, isDirectManifestUrl, MAX_PLAYLIST_BYTES } from "./playlistGuard.js";
import { yodaCdnCandidates } from "./sources/yodaCdn.js";
import { discoverWebAggregators } from "./sources/webAggregators.js";
import { discoverTvstreamAz } from "./sources/tvstreamAz.js";
import { loadPriorityChannels, buildPriorityStatuses, tagPriorityEntries, writeMissingPriority } from "./priority.js";
import { countBy, isDisplayableChannel, writePlaylist, writeStatus } from "./generator.js";
import { regionOf, selectRegionalPlaylist, uniqueVerified, type Region } from "./regional.js";
import { score } from "./selector.js";
import { isMismatchedChannel } from "./channelMatchGuard.js";
import { ensureMandatory, loadMandatoryChannels } from "./mandatory.js";
import type { PlaylistEntry, StatusOutput, ValidatedEntry } from "./types.js";

const SOURCE_NAMES = new Set([
  "iptv-org-russia",
  "iptv-org-russian-language"
]);
const SCAN_LIMITS: Record<Region, number> = { AZ: 160, TR: 400, RU: 280 };
const GOALS: Record<Region, number> = { AZ: 35, TR: 60, RU: 20 };
const BATCH = 40;
const CONCURRENCY = 12;

async function main(): Promise<void> {
  const sources = loadSources().filter((source) => SOURCE_NAMES.has(source.name));
  if (!sources.length) throw new Error("Russian fallback source is missing");
  const priorities = loadPriorityChannels();
  const mandatory = loadMandatoryChannels();
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

  // Azerbaijan and Turkey: exclusively scrape the user-selected third-party TV sites.
  // Official channel pages, priority-direct and manual CDN overrides are NEVER sources.
  const web = await discoverWebAggregators(new Set([
    "yoda-az", "canlitv-volo", "canlitv-video", "canlitv-me", "canlitv-watch",
    "canlitv-com", "canlitv-vin", "canlitv-date", "tvstream-az"
  ]));
  console.log("[WEB DISCOVERY]", JSON.stringify(web.statuses));
  const tvstream = await discoverTvstreamAz();
  console.log("[TVSTREAM DISCOVERY]", JSON.stringify({ attempted: tvstream.attempted, matched: tvstream.matched, reason: tvstream.reason }));
  const discovered = tagPriorityEntries([...web.entries, ...tvstream.entries, ...yodaCdnCandidates(), ...sourceEntries.filter((entry) => regionOf(entry) === "RU")], priorities)
    .filter((entry) => regionOf(entry) !== undefined)
    .filter((entry) => isPublishableUrl(entry.url) && isDirectManifestUrl(entry.url) && !isForbiddenUrl(entry.url, { allowLivePath: true }))
    .filter((entry) => !isMismatchedChannel(entry))
    .sort((a, b) => candidateRank(b, regionOf(b)!) - candidateRank(a, regionOf(a)!));

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

  // Never publish a fabricated or official fallback for a priority channel.
  // The 3-hour update must not overwrite the existing playlist when every website fails.
  if (![...web.entries, ...tvstream.entries].some((entry) => regionOf(entry) === "AZ" || regionOf(entry) === "TR")) {
    throw new Error("All AZ/TR web scrapers returned no regional streams; not replacing playlist");
  }
  const required = ensureMandatory(selectRegionalPlaylist(verified).filter(isDisplayableChannel), verified, mandatory, 100, unique);
  const selected = required.entries;
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
    sources: sourcesLoaded.length + web.statuses.filter((x) => x.ok).length,
    downloadedEntries: discovered.length,
    uniqueCandidates: unique.length,
    fastCheckPassed: fastPassed,
    mediaCheckPassed: verified.length,
    published: selected.length,
    failed: probed - verified.length,
    duplicatesRemoved: discovered.length - unique.length,
    countryCounts: countBy(selected, (entry) => normalizeCountry(entry.country)),
    categoryCounts: countBy(selected, (entry) => entry.category),
    degraded: selected.length < 80 || required.unverifiedIds.length > 0 || required.missingIds.length > 0,
    priorityChannels: prioritiesStatus
  };
  writeStatus(status);
  writeMissingPriority(prioritiesStatus);
  fs.writeFileSync("output/missing-priority-details.json", "[]\n", "utf8");
  fs.writeFileSync("output/mandatory-health.json", JSON.stringify({
    updatedAt: status.updatedAt,
    total: mandatory.length,
    verified: required.verifiedIds,
    needsLocalTest: required.unverifiedIds,
    missingNoWebStream: required.missingIds,
    details: mandatory.map((channel) => ({
      name: channel.name,
      country: channel.country,
      id: channel.id,
      status: required.verifiedIds.includes(channel.id) ? "video_verified_on_github" :
        required.unverifiedIds.includes(channel.id) ? "WEB_LINK_NOT_VERIFIED_TEST_IN_AZERBAIJAN" : "NO_WEB_STREAM_FOUND",
      candidates: unique.filter((entry) => entry.priorityId === channel.id).length
    }))
  }, null, 2), "utf8");
  fs.writeFileSync("output/channel-health.json", JSON.stringify({
    updatedAt: status.updatedAt,
    published: selected.length,
    verifiedWorking: selected.length - required.unverifiedIds.length,
    mandatoryTotal: mandatory.length,
    mandatoryVerified: required.verifiedIds.length,
    mandatoryNeedsLocalTest: required.unverifiedIds,
    mandatoryMissing: required.missingIds,
    validation: "HTTP manifest + video segment ffprobe; no forced/unchecked channels",
    countryCounts: status.countryCounts,
    candidatesScanned: probed,
    candidatesWithVideo: verified.length,
    rejected: reasons,
    sourcesLoaded,
    sourceErrors: errors,
    webSources: web.statuses,
    tvstream: { attempted: tvstream.attempted, matched: tvstream.matched, reason: tvstream.reason }
  }, null, 2), "utf8");
  console.log("[PUBLISHED]", JSON.stringify({ published: selected.length, countryCounts: status.countryCounts, mandatoryVerified: required.verifiedIds, mandatoryNeedsLocalTest: required.unverifiedIds, mandatoryMissing: required.missingIds, failures: reasons, sourceErrors: errors }));
}

function candidateRank(entry: PlaylistEntry, region: Region): number {
  let ranking = 0;
  if (entry.priorityId) ranking += 2500;
  if (region === "AZ" && entry.sourceName === "yoda-az") ranking += 30000;
  if (region === "AZ" && entry.sourceName === "yoda-az-cdn") ranking += 25000;
  if (entry.sourceName === "canlitv-volo") ranking += 15000;
  if (entry.sourceName.startsWith("canlitv-") || entry.sourceName === "tvstream-az") ranking += 5000;
  if (region === "RU" && entry.sourceName === "iptv-org-russia") ranking += 1000;
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
