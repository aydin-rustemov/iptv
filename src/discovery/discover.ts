import fs from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import type { AppConfig, StreamCandidate, AdapterRunStatus } from "../types.js";
import { DEFAULT_CONFIG, CANDIDATES_FILE, DATA_DIR } from "../config.js";
import type { SourceAdapter, AdapterResult } from "../sources/source-adapter.js";
import { getPredefinedChannels } from "./normalize-channel.js";

// Import all adapters
import { YodaAdapter } from "../sources/yoda.js";
import { CanlitvComAdapter } from "../sources/canlitv-com.js";
import { PublicIptvAdapter } from "../sources/public-iptv.js";
import { CanlitvMeAdapter } from "../sources/canlitv-me.js";
import { CanlitvWatchAdapter } from "../sources/canlitv-watch.js";
import { IptvOrgAdapter } from "../sources/iptv-org.js";
import { IptvCatAdapter } from "../sources/iptv-cat.js";
import { M3u8PlayerRussiaAdapter } from "../sources/m3u8-player-russia.js";
import { RussianDiscoveryAdapter } from "../sources/russian-discovery.js";

export interface CandidateSelectionReport {
  sourceQuotaDropped: number;
  countryQuotaDropped: number;
  globalQuotaDropped: number;
  duplicateUrlDropped: number;
  duplicateChannelSourceDropped: number;
}

const AZ_PRIORITY_IDS = new Set([
  "aztv",
  "ictimai-tv",
  "xezer-tv",
  "atv-az",
  "arb",
  "arb24",
  "space-tv",
  "real-tv",
  "baku-tv",
  "cbc",
  "cbc-sport",
  "idman-tv",
  "medeniyyet-tv",
  "mtv-az",
  "dunya-tv",
  "kanal-s",
  "naxcivan-tv"
]);

const RU_PRIORITY_NAMES = [
  "нтв",
  "пятый канал",
  "россия 24",
  "россия к",
  "отр",
  "тв центр",
  "рбк",
  "звезда",
  "мир",
  "москва 24",
  "пятница",
  "тнт",
  "стс",
  "рен тв",
  "карусель"
];

const SOURCE_LIMITS: Record<string, number> = {
  yoda: 20,
  "canlitv-com": 100,
  "public-iptv": 30,
  "iptv-org": 50,
  "iptv-cat": 20,
  "m3u8-player-russia": 20,
  "russian-discovery": 20,
  other: 15
};

const COUNTRY_TARGETS: Record<string, number> = {
  AZ: 35,
  TR: 40,
  RU: 45,
  OTHER: 10
};

export async function runDiscovery(config: AppConfig = DEFAULT_CONFIG): Promise<StreamCandidate[]> {
  const startTime = Date.now();
  console.log("Starting IPTV candidate discovery...");

  if (!config.legacyDiscoveryEnabled && isDefaultLegacyAdapterRequest(config.enabledAdapters)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(path.dirname(CANDIDATES_FILE), { recursive: true });
    fs.writeFileSync(CANDIDATES_FILE, JSON.stringify([], null, 2), "utf8");
    console.log("Legacy aggregation discovery is disabled by default. No candidates were discovered.");
    return [];
  }

  const allAdapters: SourceAdapter[] = [
    new YodaAdapter(),
    new CanlitvComAdapter(),
    new PublicIptvAdapter(),
    new CanlitvMeAdapter(),
    new CanlitvWatchAdapter(),
    new IptvOrgAdapter(),
    new IptvCatAdapter(),
    new M3u8PlayerRussiaAdapter(),
    new RussianDiscoveryAdapter()
  ];

  // Filter adapters by enabled config
  const enabledAdapters = allAdapters.filter((adapter) =>
    config.enabledAdapters.includes(adapter.name)
  );

  const limit = pLimit(config.concurrencyDiscovery);
  const adapterPromises = enabledAdapters.map((adapter) =>
    limit(async () => {
      console.log(`Running adapter: ${adapter.name}...`);
      try {
        const res = await adapter.discover(config);
        console.log(
          `Adapter ${adapter.name} finished: status=${res.status}, candidates=${res.candidates.length}`
        );
        return res;
      } catch (err: any) {
        console.error(`Adapter ${adapter.name} threw uncaught error:`, err);
        const failedResult: AdapterResult = {
          sourceName: adapter.name,
          status: "failed" as AdapterRunStatus,
          pagesVisited: 0,
          candidates: [],
          browserUsed: false,
          durationMs: 0,
          warnings: [err.message],
          errorCategory: "uncaught_adapter_error"
        };
        return failedResult;
      }
    })
  );

  const adapterResults = await Promise.all(adapterPromises);

  // Collect candidates
  let discoveredCandidates: StreamCandidate[] = [];
  const reports = [];

  for (const res of adapterResults) {
    discoveredCandidates.push(...res.candidates);

    const uniqueChannels = new Set(res.candidates.map((c) => c.channelId)).size;
    reports.push({
      sourceName: res.sourceName,
      status: res.status,
      pagesVisited: res.pagesVisited,
      candidatesFound: res.candidates.length,
      uniqueChannelsFound: uniqueChannels,
      browserUsed: res.browserUsed,
      durationMs: res.durationMs,
      warnings: res.warnings,
      errorCategory: res.errorCategory,
      diagnostics: res.diagnostics
    });
  }

  // Include candidates from channels.yml if they have streamUrl configured (seeding)
  const predefined = getPredefinedChannels();
  const seedCandidates: StreamCandidate[] = [];
  for (const ch of predefined) {
    if (ch.enabled && (ch as any).streamUrl) {
      seedCandidates.push({
        channelId: ch.id,
        channelName: ch.name,
        country: ch.country,
        category: ch.category,
        pageUrl: ch.officialPage ?? "",
        streamUrl: (ch as any).streamUrl,
        sourceName: "predefined",
        discoveryMethod: "html",
        discoveredAt: new Date().toISOString()
      });
    }
  }

  const allowedCountries = new Set(config.countries.map((country) => country.toUpperCase()));
  const countryFilteredCandidates = [...seedCandidates, ...discoveredCandidates].filter((candidate) =>
    allowedCountries.size === 0 || allowedCountries.has(candidate.country.toUpperCase())
  );

  const { candidates: finalCandidates, report: selectionReport } = selectCandidatesWithQuotas(
    countryFilteredCandidates,
    config.maxTotalCandidates
  );

  // Write outputs
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(CANDIDATES_FILE, JSON.stringify(finalCandidates, null, 2), "utf8");

  const outputDir = config.outputDir;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(outputDir, "source-report.json"),
    JSON.stringify({ adapters: reports, candidateSelection: selectionReport }, null, 2),
    "utf8"
  );

  console.log(
    `Discovery finished in ${((Date.now() - startTime) / 1000).toFixed(2)}s. Total candidates: ${finalCandidates.length}`
  );

  return finalCandidates;
}

function isDefaultLegacyAdapterRequest(enabledAdapters: string[]): boolean {
  return enabledAdapters.length === DEFAULT_CONFIG.enabledAdapters.length &&
    enabledAdapters.every((adapter) => DEFAULT_CONFIG.enabledAdapters.includes(adapter));
}

export function selectCandidatesWithQuotas(
  candidates: StreamCandidate[],
  maxTotalCandidates: number
): { candidates: StreamCandidate[]; report: CandidateSelectionReport } {
  const report: CandidateSelectionReport = {
    sourceQuotaDropped: 0,
    countryQuotaDropped: 0,
    globalQuotaDropped: 0,
    duplicateUrlDropped: 0,
    duplicateChannelSourceDropped: 0
  };

  const unique: StreamCandidate[] = [];
  const seenUrls = new Set<string>();
  const seenChannelSource = new Set<string>();
  for (const candidate of candidates) {
    const normalizedUrl = normalizeUrlForSelection(candidate.streamUrl);
    const channelSourceKey = `${candidate.channelId}|${candidate.sourceName}|${normalizedUrl}`;
    if (seenUrls.has(normalizedUrl)) {
      report.duplicateUrlDropped++;
      continue;
    }
    if (seenChannelSource.has(channelSourceKey)) {
      report.duplicateChannelSourceDropped++;
      continue;
    }
    seenUrls.add(normalizedUrl);
    seenChannelSource.add(channelSourceKey);
    unique.push(candidate);
  }

  const sourceCounts = new Map<string, number>();
  const sourceLimited: StreamCandidate[] = [];
  for (const candidate of sortCandidatesForSelection(unique)) {
    const limit = SOURCE_LIMITS[candidate.sourceName] ?? SOURCE_LIMITS.other ?? 15;
    const count = sourceCounts.get(candidate.sourceName) ?? 0;
    if (count >= limit) {
      report.sourceQuotaDropped++;
      continue;
    }
    sourceCounts.set(candidate.sourceName, count + 1);
    sourceLimited.push(candidate);
  }

  const countryCounts = new Map<string, number>();
  const selected: StreamCandidate[] = [];
  const deferred: StreamCandidate[] = [];
  for (const candidate of sourceLimited) {
    const target = COUNTRY_TARGETS[candidate.country] ?? COUNTRY_TARGETS.OTHER ?? 10;
    const count = countryCounts.get(candidate.country) ?? 0;
    if (count >= target && !isAzerbaijaniPriority(candidate)) {
      report.countryQuotaDropped++;
      deferred.push(candidate);
      continue;
    }
    countryCounts.set(candidate.country, count + 1);
    selected.push(candidate);
  }

  const sorted = sortCandidatesForSelection([...selected, ...deferred]);
  if (sorted.length > maxTotalCandidates) {
    report.globalQuotaDropped = sorted.length - maxTotalCandidates;
  }

  return {
    candidates: sorted.slice(0, maxTotalCandidates),
    report
  };
}

export function sortCandidatesForSelection(candidates: StreamCandidate[]): StreamCandidate[] {
  return [...candidates].sort((a, b) => {
    const rankDiff = getCandidateSelectionRank(a) - getCandidateSelectionRank(b);
    if (rankDiff !== 0) return rankDiff;
    const sourceDiff = a.sourceName.localeCompare(b.sourceName);
    if (sourceDiff !== 0) return sourceDiff;
    const channelDiff = a.channelId.localeCompare(b.channelId);
    if (channelDiff !== 0) return channelDiff;
    return a.streamUrl.localeCompare(b.streamUrl);
  });
}

function getCandidateSelectionRank(candidate: StreamCandidate): number {
  if (isAzerbaijaniPriority(candidate)) return 1;
  if (candidate.country === "AZ") return 2;
  if (candidate.country === "TR") return 3;
  if (candidate.country === "RU" && isRussianPriority(candidate)) return 4;
  if (candidate.country === "RU") return 5;
  return 6;
}

function isAzerbaijaniPriority(candidate: StreamCandidate): boolean {
  return candidate.country === "AZ" && AZ_PRIORITY_IDS.has(candidate.channelId);
}

function isRussianPriority(candidate: StreamCandidate): boolean {
  const name = candidate.channelName.toLocaleLowerCase("ru");
  return RU_PRIORITY_NAMES.some((priority) => name.includes(priority));
}

function normalizeUrlForSelection(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const param of ["utm_source", "utm_medium", "utm_campaign", "tracking"]) {
      url.searchParams.delete(param);
    }
    return url.toString().toLowerCase();
  } catch {
    return rawUrl.toLowerCase();
  }
}
