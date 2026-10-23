import { sourceTier, isKnownBrokenOnDevice, validCandidateIdentity } from "./sourcePolicy.js";
import { isMismatchedChannel } from "./channelMatchGuard.js";
import type { ValidatedEntry } from "./types.js";

export interface StabilityReport {
  entries: ValidatedEntry[];
  failed: Array<{ channel: string; source: string; reason: string }>;
  switched: Array<{ channel: string; from: string; to: string }>;
  attempted: number;
}

function channelKey(entry: ValidatedEntry): string {
  const country = entry.country || "";
  const name = (entry.priorityId ?? entry.tvgId ?? entry.tvgName ?? entry.name)
    .normalize("NFKD").toLocaleLowerCase("tr")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
  return country + ":" + name;
}

function eligible(entry: ValidatedEntry): boolean {
  return entry.fast.ok && entry.media.ok && entry.media.hasVideo &&
    validCandidateIdentity(entry) && !isMismatchedChannel(entry) &&
    !isKnownBrokenOnDevice(entry) && entry.sourceName !== "web-unverified";
}

export function orderedFallbacks(entries: ValidatedEntry[]): ValidatedEntry[] {
  return [...entries].filter(eligible).sort((a, b) =>
    sourceTier(a) - sourceTier(b) || b.score - a.score);
}

/** Each channel is reprobed after 65s, and next independent candidate is tried on failure.
 * This validates refreshability, NOT visual broadcaster identity or uninterrupted TV.
 * Tests can pass delayMs=0 and a mock probe, while the job uses real HLS probes.
 */
export async function confirmLongerLivedStreams(
  selected: ValidatedEntry[],
  allVerified: ValidatedEntry[],
  probe: (entry: ValidatedEntry) => Promise<boolean>,
  delayMs = 65_000,
  parallelism = 8
): Promise<StabilityReport> {
  if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));

  const pool = orderedFallbacks(allVerified);
  const results = await runPool(selected, parallelism, async (initial) => {
    const options = orderedFallbacks(
      pool.filter((candidate) => channelKey(candidate) === channelKey(initial))
    );
    const errors: StabilityReport["failed"] = [];
    for (const candidate of options) {
      try {
        if (await probe({ ...candidate, headers: { ...candidate.headers } })) {
          return { initial, good: candidate, errors, attempted: errors.length + 1 };
        }
        errors.push({ channel: initial.name, source: candidate.sourceName, reason: "second_probe_failed" });
      } catch (error) {
        errors.push({ channel: initial.name, source: candidate.sourceName,
          reason: error instanceof Error ? error.message.slice(0, 120) : "second_probe_error" });
      }
    }
    return { initial, good: undefined, errors, attempted: errors.length };
  });

  const published: ValidatedEntry[] = [];
  const used = new Set<string>();
  const failed: StabilityReport["failed"] = [];
  const switched: StabilityReport["switched"] = [];
  for (const result of results) {
    failed.push(...result.errors);
    if (!result.good) continue;
    if (used.has(result.good.url)) continue;
    used.add(result.good.url);
    published.push(result.good);
    if (result.good.url !== result.initial.url) {
      switched.push({ channel: result.initial.name, from: result.initial.sourceName, to: result.good.sourceName });
    }
  }
  return { entries: published, failed, switched,
    attempted: results.reduce((sum, result) => sum + result.attempted, 0) };
}

async function runPool<T, R>(items: T[], concurrency: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const ix = i++;
      out[ix] = await job(items[ix]!);
    }
  }));
  return out;
}
