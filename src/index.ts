import fs from "node:fs";
import { loadSources, downloadSource, updateSourceStats } from "./downloader.js";
import { normalizeCountry, parseM3u } from "./parser.js";
import { fastCheck, mediaCheck } from "./validator.js";
import { dedupe, preselect, score } from "./selector.js";
import { countBy, writePlaylist, writeStatus } from "./generator.js";
import type { FastCheckResult, MediaCheckResult, PlaylistEntry, PriorityChannel, StatusOutput, ValidatedEntry } from "./types.js";
import { addTargetedPriorityCandidates, buildMissingPriorityDetails, buildPriorityStatuses, loadPriorityChannels, normalizeName, tagPriorityEntries, writeMissingPriority, writeMissingPriorityDetails } from "./priority.js";
import { discoverCanliTvAz } from "./sources/canlitvAz.js";
import { discoverWebAggregators } from "./sources/webAggregators.js";
import { forcedPublishedOverrides, loadManualOverrides, manualOverrideCandidates } from "./manualOverrides.js";

const FAST_CONCURRENCY = Number(process.env["IPTV_FAST_CONCURRENCY"] ?? 30);
const MEDIA_CONCURRENCY = Number(process.env["IPTV_MEDIA_CONCURRENCY"] ?? 12);
const PLAYLIST_FILE = "output/playlist.m3u";

interface ValidationBatch {
  validated: ValidatedEntry[];
  fastResults: Map<PlaylistEntry, FastCheckResult>;
  mediaResults: Map<PlaylistEntry, MediaCheckResult>;
}

interface MaintenanceStats {
  previous: number;
  preserved: number;
  replaced: number;
  removed: number;
  added: number;
  published: number;
}

async function main(): Promise<void> {
  const legacyM3uSourcesEnabled = process.env["IPTV_LEGACY_M3U_SOURCES"] === "1";
  const sources = legacyM3uSourcesEnabled ? loadSources() : [];
  if (!legacyM3uSourcesEnabled) console.log("[M3U SOURCES] Third-party playlist sources are disabled; using website discovery + manual overrides.");

  const officialPageDiscoveryEnabled = process.env["IPTV_OFFICIAL_PAGES"] === "1";
  const priorities = loadPriorityChannels().map((priority) =>
    officialPageDiscoveryEnabled ? priority : { ...priority, officialPages: [] }
  );
  const manualOverrides = loadManualOverrides();
  const lockedEntries = forcedPublishedOverrides(manualOverrides);

  const currentEntries = tagExistingEntries(readCurrentPlaylist(), priorities);
  console.log(`[CURRENT] ${currentEntries.length} channels loaded from ${PLAYLIST_FILE}.`);
  console.log(`[LOCKED] ${lockedEntries.length} user-confirmed static channels will be preserved exactly.`);

  const downloaded: Array<{ source: (typeof sources)[number]; text: string }> = [];
  const sourceFailures: Array<{ source: string; error: string }> = [];
  const downloadResults = await Promise.allSettled(
    sources.map(async (source) => ({ source, text: await downloadSource(source) }))
  );

  for (let i = 0; i < downloadResults.length; i++) {
    const result = downloadResults[i]!;
    const source = sources[i]!;
    if (result.status === "fulfilled") {
      downloaded.push(result.value);
    } else {
      const error = errorMessage(result.reason);
      sourceFailures.push({ source: source.name, error });
      console.warn(`[M3U SOURCE FAILED] ${source.name}: ${error}`);
    }
  }

  const parsedBySource = downloaded.map(({ source, text }) => ({
    source,
    entries: parseM3u(text, source.name)
  }));

  const canliTv = await safeDiscoverCanliTvAz(shouldRunFullCanliTvDiscovery());
  const webAggregators = await discoverWebAggregators();

  const discoveredBase = tagPriorityEntries([
    ...parsedBySource.flatMap((item) => item.entries),
    ...manualOverrideCandidates(manualOverrides),
    ...canliTv.entries,
    ...webAggregators.entries
  ], priorities);

  const targeted = await addTargetedPriorityCandidates(discoveredBase, priorities);
  const { entries: uniqueDiscovered, duplicatesRemoved } = dedupe(targeted.entries);
  const discoveryCandidates = preselect(uniqueDiscovered);

  // Existing playlist links are checked independently. Locked manual channels are
  // handled separately and never depend on GitHub runner validation because some
  // providers are geo/network sensitive even though the user confirmed them on TV.
  const currentValidation = await validateEntries(currentEntries, true, true);
  const discoveryValidation = await validateEntries(discoveryCandidates, false, false);

  const maintenance = reconcilePlaylist(
    currentEntries,
    currentValidation.validated,
    discoveryValidation.validated,
    lockedEntries
  );
  const selected = maintenance.entries;
  const maintenanceStats = maintenance.stats;

  const allCandidates = dedupe([...currentEntries, ...uniqueDiscovered, ...lockedEntries]).entries;
  const allValidated = dedupeValidated([...lockedEntries, ...currentValidation.validated, ...discoveryValidation.validated]);
  const combinedFastResults = mergeMaps(currentValidation.fastResults, discoveryValidation.fastResults);
  const combinedMediaResults = mergeMaps(currentValidation.mediaResults, discoveryValidation.mediaResults);

  const priorityChannels = buildPriorityStatuses(priorities, allCandidates, allValidated, selected);
  const discoverySourceCount = sources.length + webAggregators.statuses.length + 1;
  const missingDetails = buildMissingPriorityDetails(
    priorityChannels,
    priorities,
    allCandidates,
    combinedFastResults,
    combinedMediaResults,
    discoverySourceCount,
    targeted.officialPagesChecked,
    targeted.officialSocialAccountsChecked
  );

  if (fs.existsSync(PLAYLIST_FILE)) fs.copyFileSync(PLAYLIST_FILE, "output/playlist.previous.m3u");
  writePlaylist(selected);
  writeMissingPriority(priorityChannels);
  writeMissingPriorityDetails(missingDetails);

  updateSourceStats(parsedBySource.map(({ source, entries: sourceEntries }) => ({
    name: source.name,
    parsedEntries: sourceEntries.length,
    workingPriorityCandidates: selected.filter((entry) => entry.sourceName === source.name && entry.priorityId).length
  })));

  const status: StatusOutput = {
    updatedAt: new Date().toISOString(),
    sources: discoverySourceCount,
    downloadedEntries: targeted.entries.length,
    uniqueCandidates: uniqueDiscovered.length,
    fastCheckPassed: currentValidation.validated.length + discoveryValidation.validated.length,
    mediaCheckPassed: allValidated.length,
    published: selected.length,
    failed: (currentEntries.length - currentValidation.validated.length) + (discoveryCandidates.length - discoveryValidation.validated.length),
    duplicatesRemoved,
    countryCounts: countBy(selected, (entry) => entry.country),
    categoryCounts: countBy(selected, (entry) => entry.category),
    degraded: false,
    priorityChannels
  };

  writeChannelHealth(selected, allValidated, {
    maintenance: maintenanceStats,
    lockedStaticChannels: lockedEntries.map((entry) => ({ id: entry.tvgId, name: entry.name, url: entry.url })),
    canliTv: canliTv.status,
    webAggregators: webAggregators.statuses,
    m3uSourceFailures: sourceFailures
  });
  writeStatus(status);

  console.log(`[MAINTENANCE] preserved=${maintenanceStats.preserved} replaced=${maintenanceStats.replaced} removed=${maintenanceStats.removed} added=${maintenanceStats.added} published=${maintenanceStats.published}`);
  console.log(JSON.stringify(status, null, 2));
}

async function validateEntries(entries: PlaylistEntry[], retryAll: boolean, preserveOriginalHeaders: boolean): Promise<ValidationBatch> {
  const fastResults = new Map<PlaylistEntry, FastCheckResult>();
  const mediaResults = new Map<PlaylistEntry, MediaCheckResult>();
  const probes = new Map<PlaylistEntry, PlaylistEntry>();

  await runPool(entries, FAST_CONCURRENCY, async (entry) => {
    const probe = cloneEntry(entry);
    probes.set(entry, probe);
    fastResults.set(entry, await checkFastWithRetry(probe, retryAll || Boolean(entry.priorityId)));
  });

  const fastPassed = entries.filter((entry) => fastResults.get(entry)?.ok);
  await runPool(fastPassed, MEDIA_CONCURRENCY, async (entry) => {
    const probe = probes.get(entry)!;
    mediaResults.set(entry, await checkMediaWithRetry(probe, fastResults.get(entry)!, retryAll || Boolean(entry.priorityId)));
  });

  const validated = fastPassed.flatMap((entry) => {
    const media = mediaResults.get(entry);
    const fast = fastResults.get(entry)!;
    if (!media?.ok) return [];
    const probe = probes.get(entry)!;
    const base = preserveOriginalHeaders ? entry : probe;
    return [{
      ...base,
      headers: { ...base.headers },
      normalizedUrl: normalizeUrl(base.url),
      fast,
      media,
      score: score(base, media, fast.latencyMs)
    } satisfies ValidatedEntry];
  });

  return { validated, fastResults, mediaResults };
}

function reconcilePlaylist(
  currentEntries: PlaylistEntry[],
  currentValidated: ValidatedEntry[],
  discoveredValidated: ValidatedEntry[],
  lockedEntries: ValidatedEntry[]
): { entries: ValidatedEntry[]; stats: MaintenanceStats } {
  const currentWorkingByUrl = new Map(currentValidated.map((entry) => [normalizeUrl(entry.url), entry]));
  const discovered = [...discoveredValidated].sort((a, b) => replacementScore(b) - replacementScore(a) || b.score - a.score);
  const usedUrls = new Set<string>();
  const usedKeys = new Set<string>();
  const output: ValidatedEntry[] = [];
  let preserved = 0;
  let replaced = 0;
  let removed = 0;
  let added = 0;

  // Locked entries are matched against the existing playlist first. If a scraper
  // previously replaced one of them, restore the exact user-provided URL in the
  // same logical channel slot. These entries are never replaced or removed.
  for (const current of currentEntries) {
    const locked = findMatchingEntry(current, lockedEntries);
    if (locked) {
      if (!usedUrls.has(normalizeUrl(locked.url))) {
        output.push(locked);
        markUsed(locked, usedUrls, usedKeys);
        if (normalizeUrl(current.url) === normalizeUrl(locked.url)) {
          preserved++;
          console.log(`[LOCKED PRESERVED] ${displayName(locked)}: ${safeHost(locked.url)}`);
        } else {
          replaced++;
          console.log(`[LOCKED RESTORED] ${displayName(locked)}: ${safeHost(current.url)} -> ${safeHost(locked.url)}`);
        }
      }
      continue;
    }

    const working = currentWorkingByUrl.get(normalizeUrl(current.url));
    if (working) {
      output.push(working);
      markUsed(working, usedUrls, usedKeys);
      preserved++;
      continue;
    }

    const replacement = findReplacement(current, discovered, usedUrls);
    if (replacement) {
      const patched = keepChannelMetadata(current, replacement);
      output.push(patched);
      markUsed(patched, usedUrls, usedKeys);
      usedUrls.add(normalizeUrl(replacement.url));
      replaced++;
      console.log(`[REPLACED] ${displayName(current)}: ${safeHost(current.url)} -> ${safeHost(replacement.url)} (${replacement.sourceName})`);
    } else {
      removed++;
      console.warn(`[REMOVED BROKEN] ${displayName(current)}: ${safeHost(current.url)}`);
    }
  }

  // A locked channel may be completely absent from the current playlist. Add it
  // back unconditionally, still using the exact manual URL.
  for (const locked of lockedEntries) {
    if (usedUrls.has(normalizeUrl(locked.url))) continue;
    output.push(locked);
    markUsed(locked, usedUrls, usedKeys);
    added++;
    console.log(`[LOCKED ADDED] ${displayName(locked)}: ${safeHost(locked.url)}`);
  }

  for (const candidate of discovered) {
    if (usedUrls.has(normalizeUrl(candidate.url))) continue;
    const keys = channelKeys(candidate);
    if (keys.some((key) => usedKeys.has(key))) continue;
    output.push(candidate);
    markUsed(candidate, usedUrls, usedKeys);
    added++;
    console.log(`[ADDED NEW] ${displayName(candidate)} (${candidate.sourceName})`);
  }

  return {
    entries: output,
    stats: {
      previous: currentEntries.length,
      preserved,
      replaced,
      removed,
      added,
      published: output.length
    }
  };
}

function findMatchingEntry(current: PlaylistEntry, candidates: ValidatedEntry[]): ValidatedEntry | undefined {
  const currentKeys = new Set(channelKeys(current));
  return candidates.find((candidate) => channelKeys(candidate).some((key) => currentKeys.has(key)));
}

function findReplacement(current: PlaylistEntry, candidates: ValidatedEntry[], usedUrls: Set<string>): ValidatedEntry | undefined {
  const currentKeys = new Set(channelKeys(current));
  return candidates
    .filter((candidate) => !usedUrls.has(normalizeUrl(candidate.url)))
    .filter((candidate) => channelKeys(candidate).some((key) => currentKeys.has(key)))
    .sort((a, b) => replacementScore(b, current) - replacementScore(a, current) || b.score - a.score)[0];
}

function replacementScore(candidate: ValidatedEntry, current?: PlaylistEntry): number {
  let value = candidate.score;
  const country = normalizedCountry(current ?? candidate);
  if (country === "Türkiyə" && candidate.sourceName === "canlitv-volo") value += 2000;
  else if (candidate.sourceName.startsWith("canlitv-") || candidate.sourceName.includes("web")) value += 400;
  if (candidate.headers["Referer"] || candidate.headers["User-Agent"]) value -= 50;
  return value;
}

function keepChannelMetadata(current: PlaylistEntry, replacement: ValidatedEntry): ValidatedEntry {
  return {
    ...replacement,
    tvgId: current.tvgId ?? replacement.tvgId,
    tvgName: current.tvgName ?? current.name,
    tvgLogo: current.tvgLogo ?? replacement.tvgLogo,
    groupTitle: current.groupTitle ?? replacement.groupTitle,
    country: current.country ?? replacement.country,
    category: current.category ?? replacement.category,
    name: current.name,
    priorityId: current.priorityId ?? replacement.priorityId,
    priorityName: current.priorityName ?? replacement.priorityName,
    priorityCountry: current.priorityCountry ?? replacement.priorityCountry,
    priorityCategory: current.priorityCategory ?? replacement.priorityCategory,
    priorityOrder: current.priorityOrder ?? replacement.priorityOrder
  };
}

function channelKeys(entry: PlaylistEntry): string[] {
  const keys = new Set<string>();
  const country = normalizedCountry(entry);
  if (entry.priorityId) keys.add(`p:${entry.priorityId.toLocaleLowerCase("tr")}`);
  if (entry.tvgId) keys.add(`id:${entry.tvgId.toLocaleLowerCase("tr")}`);
  for (const raw of [entry.tvgName, entry.name]) {
    const name = simplifiedName(raw ?? "");
    if (!name) continue;
    keys.add(`n:${country}:${name}`);
  }
  return [...keys];
}

function simplifiedName(value: string): string {
  return normalizeName(value)
    .replace(/\b(?:canli|live|izle|seyret|yayin|yayini|hd|fhd|fullhd|full hd)\b/g, " ")
    .replace(/\btv\b$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedCountry(entry: PlaylistEntry): string {
  return normalizeCountry(entry.priorityCountry ?? entry.country ?? entry.groupTitle);
}

function markUsed(entry: PlaylistEntry, urls: Set<string>, keys: Set<string>): void {
  urls.add(normalizeUrl(entry.url));
  for (const key of channelKeys(entry)) keys.add(key);
}

function tagExistingEntries(entries: PlaylistEntry[], priorities: PriorityChannel[]): PlaylistEntry[] {
  return entries.map((entry) => {
    const tagged = tagPriorityEntries([entry], priorities)[0] ?? entry;
    return {
      ...tagged,
      tvgId: entry.tvgId,
      tvgName: entry.tvgName,
      tvgLogo: entry.tvgLogo,
      groupTitle: entry.groupTitle,
      country: entry.country || tagged.country,
      category: entry.category || tagged.category,
      name: entry.name,
      url: entry.url,
      headers: { ...entry.headers }
    };
  });
}

function readCurrentPlaylist(): PlaylistEntry[] {
  try {
    return parseM3u(fs.readFileSync(PLAYLIST_FILE, "utf8"), "existing-playlist");
  } catch {
    return [];
  }
}

function dedupeValidated(entries: ValidatedEntry[]): ValidatedEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = normalizeUrl(entry.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cloneEntry(entry: PlaylistEntry): PlaylistEntry {
  return { ...entry, headers: { ...entry.headers } };
}

async function safeDiscoverCanliTvAz(full: boolean): Promise<{ entries: PlaylistEntry[]; status: unknown }> {
  try {
    return await discoverCanliTvAz({ full });
  } catch (err) {
    const error = errorMessage(err);
    console.warn(`[WEB SOURCE FAILED] canlitv-az: ${error}`);
    return {
      entries: [],
      status: {
        updatedAt: new Date().toISOString(),
        source: "canlitv-az",
        ok: false,
        error
      }
    };
  }
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

async function checkFastWithRetry(entry: PlaylistEntry, retry: boolean): Promise<FastCheckResult> {
  const first = await fastCheck(entry);
  if (first.ok || !retry) return first;
  return await fastCheck(entry);
}

async function checkMediaWithRetry(entry: PlaylistEntry, fast: FastCheckResult, retry: boolean): Promise<MediaCheckResult> {
  const first = await mediaCheck(entry, fast);
  if (first.ok || !retry) return first;
  const secondFast = await fastCheck(entry);
  if (!secondFast.ok) return first;
  return await mediaCheck(entry, secondFast);
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

function writeChannelHealth(selected: ValidatedEntry[], validated: ValidatedEntry[], discovery: unknown): void {
  fs.mkdirSync("output", { recursive: true });
  fs.writeFileSync("output/channel-health.json", JSON.stringify({
    updatedAt: new Date().toISOString(),
    published: selected.length,
    verifiedWorking: validated.length,
    discovery
  }, null, 2), "utf8");
}

function mergeMaps<K, V>(a: Map<K, V>, b: Map<K, V>): Map<K, V> {
  return new Map([...a, ...b]);
}

function displayName(entry: PlaylistEntry): string {
  return entry.tvgName ?? entry.name;
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
}

function normalizeUrl(raw: string): string {
  try {
    return new URL(raw).toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string } }).cause;
    return cause?.code ? `${cause.code}: ${err.message}` : err.message;
  }
  return String(err);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});