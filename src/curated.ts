import fs from "node:fs";
import { loadSources, downloadSource } from "./downloader.js";
import { normalizeCountry, parseM3u } from "./parser.js";
import { fastCheck, isForbiddenUrl, mediaCheck } from "./validator.js";
import { isPublishableUrl, isDirectManifestUrl, MAX_PLAYLIST_BYTES } from "./playlistGuard.js";
import { yodaCdnCandidates } from "./sources/yodaCdn.js";
import { YODA_CATALOGUE, YODA_REGION_REASON, yodaRegionalEntries, overlayYodaRegional } from "./sources/yodaCatalogue.js";
import { azSixCandidates, AZ_SIX_IDS } from "./sources/azSixCandidates.js";
import { turkeyAlternativeCandidates } from "./sources/turkeyAlternatives.js";
import { officialLastResortCandidates } from "./sources/officialFallback.js";
import { normalizeBroadcaster, validCandidateIdentity, isKnownBrokenOnDevice, sourceTier } from "./sourcePolicy.js";
import { confirmLongerLivedStreams } from "./stability.js";
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
  "iptv-org-russian-language",
  "iptv-org-azerbaijan",
  "iptv-org-turkey"
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
    "canlitv-com", "canlitv-vin", "canlitv-date", "tvstream-az",
    "operativmm-az", "icanlive-az", "icanlive-tr", "icanlive-ru"
  ]));
  console.log("[WEB DISCOVERY]", JSON.stringify(web.statuses));
  const tvstream = await discoverTvstreamAz();
  console.log("[TVSTREAM DISCOVERY]", JSON.stringify({ attempted: tvstream.attempted, matched: tvstream.matched, reason: tvstream.reason }));
  const discovered = tagPriorityEntries([
    ...web.entries, ...tvstream.entries, ...yodaCdnCandidates(), ...azSixCandidates(),
    ...turkeyAlternativeCandidates(), ...sourceEntries, ...officialLastResortCandidates()
  ].map(normalizeBroadcaster), priorities)
    .filter((entry) => regionOf(entry) !== undefined)
    .filter((entry) => isPublishableUrl(entry.url) && isDirectManifestUrl(entry.url) && !isForbiddenUrl(entry.url, { allowLivePath: true }))
    .filter((entry) => !isMismatchedChannel(entry) && validCandidateIdentity(entry) && !isKnownBrokenOnDevice(entry))
    .sort((a, b) => candidateRank(b, regionOf(b)!) - candidateRank(a, regionOf(a)!));

  const seen = new Set<string>();
  const unique = discovered.filter((entry) => {
    const key = entry.url; // A URL cannot represent two different TV channels.
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log("[DISCOVERY] candidates=", discovered.length, "unique=", unique.length);

  // User explicitly wants Yoda Azerbaijan streams published without foreign-IP
  // HTTP, ffprobe or 65-second validation. Still require actual extracted M3U URLs.
  const yodaGeoOnly = yodaRegionalEntries(unique);
  console.log("[YODA AZ-ONLY]", JSON.stringify({ catalogued: YODA_CATALOGUE.length, found: yodaGeoOnly.length,
    names: yodaGeoOnly.map((e) => e.name) }));
  const verified: ValidatedEntry[] = [];
  let probed = 0;
  let fastPassed = 0;
  const reasons: Record<string, number> = {};
  const sixAttempts: Array<{ channelId: string; source: string; host: string; result: string }> = [];

  for (const region of ["AZ", "TR", "RU"] as const) {
    const ordered = unique.filter((entry) => regionOf(entry) === region &&
      entry.sourceName !== "yoda-az" && entry.sourceName !== "yoda-az-cdn")
      .sort((a, b) => candidateRank(b, region) - candidateRank(a, region));
    const scanLimit = Math.min(SCAN_LIMITS[region], ordered.length);
    console.log("[REGION]", region, "available=", ordered.length, "scanLimit=", scanLimit);
    for (let i = 0; i < scanLimit; i += BATCH) {
      const batch = ordered.slice(i, Math.min(i + BATCH, scanLimit));
      const results = await runPool(batch, CONCURRENCY, validate);
      for (let index = 0; index < results.length; index++) {
        const result = results[index]!;
        const entry = batch[index]!;
        if (entry.priorityId && AZ_SIX_IDS.has(entry.priorityId)) {
          sixAttempts.push({ channelId: entry.priorityId, source: entry.sourceName, host: new URL(entry.url).hostname,
            result: result.verified ? "first_video_probe_passed" : result.reason ?? "failed" });
        }
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
      // Every required channel must have its own candidates probed.
      const requiredHere = mandatory.filter((c) => regionOf({ country: c.country }) === region);
      const requiredFound = requiredHere.every((c) => verified.some((v) => v.priorityId === c.id));
      if (distinct >= GOALS[region] && requiredFound) break;
    }
  }

  // Never publish a fabricated or official fallback for a priority channel.
  // The 3-hour update must not overwrite the existing playlist when every website fails.
  if (![...web.entries, ...tvstream.entries].some((entry) => regionOf(entry) === "AZ" || regionOf(entry) === "TR")) {
    throw new Error("All AZ/TR web scrapers returned no regional streams; not replacing playlist");
  }
  const firstPass = ensureMandatory(selectRegionalPlaylist(verified).filter(isDisplayableChannel), verified, mandatory, 100, unique);
  const stable = await confirmLongerLivedStreams(firstPass.entries, verified, async (entry) => {
    const result = await validate(entry);
    return Boolean(result.verified);
  });
  const selected = overlayYodaRegional(stable.entries, yodaGeoOnly, 100);
  const present = new Set(selected.map((entry) => entry.priorityId).filter(Boolean));
  const required = {
    verifiedIds: mandatory.filter((c) => selected.some((e) => e.priorityId === c.id && e.fast.ok && e.media.ok)).map((c) => c.id),
    unverifiedIds: mandatory.filter((c) => selected.some((e) => e.priorityId === c.id && e.fast.reason === YODA_REGION_REASON)).map((c) => c.id),
    missingIds: mandatory.filter((c) => !present.has(c.id)).map((c) => c.id)
  };
  console.log("[STABILITY]", JSON.stringify({ attempted: stable.attempted, failed: stable.failed.length, switched: stable.switched.length, missingRequired: required.missingIds }));
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
  fs.writeFileSync("output/yoda-status.json", JSON.stringify({
    updatedAt: status.updatedAt,
    mode: "AZ_IP_ONLY_NO_GITHUB_VIDEO_CHECK",
    catalogued: YODA_CATALOGUE.length,
    entries: selected.filter((e) => e.fast.reason === YODA_REGION_REASON).map((e) => ({
      id: e.priorityId ?? e.tvgId ?? e.name, name: e.name, url: e.url, source: e.sourceName,
      page: e.candidateReferer, checkedOnGithub: false
    })),
    catalogue: YODA_CATALOGUE.map((station) => ({ id: station.id, name: station.name,
      published: selected.some((e) => e.fast.reason === YODA_REGION_REASON && (e.priorityId === station.id || e.tvgId === station.id)) }))
  }, null, 2) + "\n", "utf8");
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
        required.unverifiedIds.includes(channel.id) ? "YODA_AZERBAIJAN_IP_ONLY_GITHUB_CHECK_SKIPPED" : "NO_WEB_STREAM_FOUND",
      candidates: unique.filter((entry) => entry.priorityId === channel.id).length
    }))
  }, null, 2), "utf8");
  fs.writeFileSync("output/az-six-health.json", JSON.stringify({
    updatedAt: status.updatedAt,
    channels: [...AZ_SIX_IDS].map((id) => {
      const picked = selected.find((entry) => entry.priorityId === id);
      return { id, result: picked ? "second_video_probe_passed" : "no_verified_stream",
        selectedSource: picked?.sourceName, selectedHost: picked ? new URL(picked.url).hostname : undefined,
        attempted: sixAttempts.filter((entry) => entry.channelId === id) };
    })
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync("output/channel-health.json", JSON.stringify({
    updatedAt: status.updatedAt,
    published: selected.length,
    verifiedWorking: selected.length - required.unverifiedIds.length,
    mandatoryTotal: mandatory.length,
    mandatoryVerified: required.verifiedIds.length,
    mandatoryNeedsLocalTest: required.unverifiedIds,
    mandatoryMissing: required.missingIds,
    validation: "Non-Yoda candidates: HTTP/ffprobe video + 65s retest. Yoda AZ: bypassed geo-IP probing by user request.",
    stability: { attempts: stable.attempted, failed: stable.failed, switched: stable.switched },
    yodaAzWithoutGithubCheck: selected.filter((e) => e.fast.reason === YODA_REGION_REASON).length,
    selectedSources: selected.map((entry) => ({ id: entry.priorityId ?? entry.tvgId ?? entry.name, name: entry.name, source: entry.sourceName, urlHost: new URL(entry.url).hostname, sourceTier: sourceTier(entry) })),
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
  let ranking = (4 - sourceTier(entry)) * 100_000;
  if (entry.priorityId && AZ_SIX_IDS.has(entry.priorityId)) ranking += 600_000;
  if (entry.priorityId) ranking += 2500;
  if (region === "AZ" && entry.sourceName === "yoda-az") ranking += 30000;
  if (region === "AZ" && entry.sourceName === "yoda-az-cdn") ranking += 25000;
  if (region === "TR" && entry.sourceName === "community-turkey-candidate") ranking += 14000;
  if (region === "AZ" && entry.sourceName === "operativmm-az") ranking += 19000;
  if (region === "AZ" && entry.sourceName === "icanlive-az") ranking += 12000;
  if (region === "TR" && entry.sourceName === "icanlive-tr") ranking += 12000;
  if (region === "RU" && entry.sourceName === "icanlive-ru") ranking += 12000;
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
