import fs from "node:fs";
import { loadSources, downloadSource, updateSourceStats } from "./downloader.js";
import { parseM3u } from "./parser.js";
import { fastCheck, mediaCheck } from "./validator.js";
import { dedupe, preselect, score, select } from "./selector.js";
import { countBy, writePlaylist, writeStatus } from "./generator.js";
import type { FastCheckResult, MediaCheckResult, PlaylistEntry, StatusOutput, ValidatedEntry } from "./types.js";
import { addTargetedPriorityCandidates, buildMissingPriorityDetails, buildPriorityStatuses, loadPriorityChannels, tagPriorityEntries, writeMissingPriority, writeMissingPriorityDetails } from "./priority.js";

const FAST_CONCURRENCY = Number(process.env["IPTV_FAST_CONCURRENCY"] ?? 30);
const MEDIA_CONCURRENCY = Number(process.env["IPTV_MEDIA_CONCURRENCY"] ?? 5);

async function main(): Promise<void> {
  const sources = loadSources();
  const priorities = loadPriorityChannels();
  const downloaded = await Promise.all(sources.map(async (source) => ({ source, text: await downloadSource(source) })));
  const parsedBySource = downloaded.map(({ source, text }) => ({ source, entries: parseM3u(text, source.name) }));
  const parsedEntries = tagPriorityEntries(parsedBySource.flatMap((item) => item.entries), priorities);
  const targeted = await addTargetedPriorityCandidates(parsedEntries, priorities);
  const entries = targeted.entries;
  const { entries: uniqueEntries, duplicatesRemoved } = dedupe(entries);
  const candidates = preselect(uniqueEntries);

  const fastResults = new Map<PlaylistEntry, FastCheckResult>();
  await runPool(candidates, FAST_CONCURRENCY, async (entry) => {
    fastResults.set(entry, await fastCheck(entry));
  });
  const fastPassed = candidates.filter((entry) => fastResults.get(entry)?.ok);

  const mediaResults = new Map<PlaylistEntry, MediaCheckResult>();
  await runPool(fastPassed, MEDIA_CONCURRENCY, async (entry) => {
    mediaResults.set(entry, await mediaCheck(entry, fastResults.get(entry)!));
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

  const selected = select(validated, 300, priorities);
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
