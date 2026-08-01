import fs from "node:fs";
import pLimit from "p-limit";
import { runDiscovery } from "./discovery/discover.js";
import { validateCandidate } from "./validation/validate-stream.js";
import { deduplicateCandidates } from "./output/deduplicate.js";
import { compareValidationResults } from "./output/rank-sources.js";
import { writePlaylists } from "./output/generate-m3u.js";
import { writeStatusReport } from "./output/generate-status.js";
import type { StatusReport } from "./output/generate-status.js";
import { writeDashboard } from "./output/generate-dashboard.js";
import { startLocalServer } from "./server/local-server.js";
import { runShootout } from "./shootout.js";
import { runArbCheck, writeArbPlaylist } from "./arb-live.js";
import { generateOfficialPlaylists, regressionWorking, resolverCheck, resolverInstall, resolverScan } from "./official-gateway.js";
import { directAudit, directDiscover, directGenerate, directUpdate, directValidate } from "./direct/index.js";
import {
  DEFAULT_CONFIG,
  CANDIDATES_FILE,
  DATA_DIR,
  VALIDATION_RESULTS_FILE,
  VALIDATION_CACHE_FILE,
  CHANNEL_OVERRIDES_FILE
} from "./config.js";
import type { AppConfig, CountryCode, StreamCandidate, ValidationResult, ChannelOverride } from "./types.js";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "scan";
  const config = getRuntimeConfig(args.slice(1));

  switch (command) {
    case "discover":
      await doDiscover(config);
      break;
    case "check":
      await doCheck(config);
      break;
    case "generate":
      await doGenerate(config, 0, 0);
      break;
    case "scan": {
      const discStart = Date.now();
      await doDiscover(config);
      const discDuration = Date.now() - discStart;

      const checkStart = Date.now();
      await doCheck(config);
      const checkDuration = Date.now() - checkStart;

      await doGenerate(config, discDuration, checkDuration);
      break;
    }
    case "serve":
      doServe(config);
      break;
    case "debug:channel":
      await doDebugChannel(args.slice(1).join(" "));
      break;
    case "shootout":
      await runShootout();
      break;
    case "arb-check":
      await doArbCheck(config);
      break;
    case "resolver-install":
      await resolverInstall();
      break;
    case "resolver-check":
      await resolverCheck();
      break;
    case "resolver-scan":
      await resolverScan();
      break;
    case "playlist":
      await generateOfficialPlaylists();
      break;
    case "regression-working":
      await regressionWorking();
      break;
    case "direct:discover":
      await directDiscover();
      break;
    case "direct:validate":
      await directValidate();
      break;
    case "direct:generate":
      await directGenerate();
      break;
    case "direct:audit":
      await directAudit();
      break;
    case "direct:update":
      await directUpdate();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log("Usage: npm run [discover|check|generate|scan|serve|debug:channel|shootout|arb-check|direct:update]");
      process.exit(1);
  }
}

async function doDiscover(config: AppConfig): Promise<StreamCandidate[]> {
  return await runDiscovery(config);
}

async function doCheck(config: AppConfig): Promise<ValidationResult[]> {
  console.log("Starting stream checks...");
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(CANDIDATES_FILE)) {
    console.error(`Candidates file not found at ${CANDIDATES_FILE}. Please run discover first.`);
    return [];
  }

  const candidatesRaw = fs.readFileSync(CANDIDATES_FILE, "utf8");
  const candidates: StreamCandidate[] = JSON.parse(candidatesRaw);

  // Load cache
  let cache: Record<string, ValidationResult> = {};
  if (fs.existsSync(VALIDATION_CACHE_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(VALIDATION_CACHE_FILE, "utf8"));
    } catch {
      console.warn("Could not parse validation cache file, ignoring.");
    }
  }

  const limit = pLimit(config.concurrencyValidation);
  const total = candidates.length;
  let finished = 0;

  const orderedGroups = groupCandidatesForPriorityValidation(candidates);
  const promises = orderedGroups.map((group) =>
    limit(async () => {
      const groupResults: ValidationResult[] = [];
      for (let index = 0; index < group.length; index++) {
        const cand = group[index]!;
        if (groupResults.some((res) => res.status === "portable" && res.stability === "stable")) {
          groupResults.push(createSkippedValidationResult(cand));
          finished++;
          continue;
        }
        const res = await validateCandidate(cand, config, cache[cand.streamUrl]);
        groupResults.push(res);
        finished++;
        if (finished % 10 === 0 || finished === total) {
          console.log(`Checked ${finished}/${total} streams...`);
        }
      }
      return groupResults;
    })
  );

  const results = (await Promise.all(promises)).flat();

  // Save results
  fs.writeFileSync(VALIDATION_RESULTS_FILE, JSON.stringify(results, null, 2), "utf8");

  // Update and save cache
  const newCache: Record<string, ValidationResult> = {};
  for (const r of results) {
    newCache[r.streamUrl] = r;
  }
  fs.writeFileSync(VALIDATION_CACHE_FILE, JSON.stringify(newCache, null, 2), "utf8");

  console.log(`Validation finished. Saved results to ${VALIDATION_RESULTS_FILE}`);
  return results;
}

async function doGenerate(config: AppConfig, discDurationMs: number, checkDurationMs: number) {
  console.log("Generating outputs...");
  if (!fs.existsSync(VALIDATION_RESULTS_FILE)) {
    console.error(`Validation results file not found at ${VALIDATION_RESULTS_FILE}. Please run check first.`);
    return;
  }
  if (!fs.existsSync(CANDIDATES_FILE)) {
    console.error(`Candidates file not found at ${CANDIDATES_FILE}. Please run discover first.`);
    return;
  }

  const resultsRaw = fs.readFileSync(VALIDATION_RESULTS_FILE, "utf8");
  const validationResults: ValidationResult[] = JSON.parse(resultsRaw);

  const candidatesRaw = fs.readFileSync(CANDIDATES_FILE, "utf8");
  const candidates: StreamCandidate[] = JSON.parse(candidatesRaw);

  // Load manual overrides
  let overrides: ChannelOverride[] = [];
  if (fs.existsSync(CHANNEL_OVERRIDES_FILE)) {
    try {
      const raw = fs.readFileSync(CHANNEL_OVERRIDES_FILE, "utf8");
      const parsed = JSON.parse(raw);
      overrides = parsed.overrides || [];
    } catch {
      console.warn("Failed to load channel-overrides.json. Ignoring overrides.");
    }
  }

  // Apply overrides to validation results
  const overriddenResults = validationResults.map((res) => {
    const over = overrides.find((o) => o.id === res.channelId);
    if (!over) return res;

    const modified = { ...res };
    if (over.name) modified.channelName = over.name;
    if (over.country) modified.country = over.country;
    if (over.category) modified.category = over.category;
    if (over.enabled === false) {
      modified.status = "invalid";
      modified.failureReason = "Disabled by overrides";
    }
    if (over.blockUrls && over.blockUrls.includes(res.streamUrl)) {
      modified.status = "invalid";
      modified.failureReason = "Blocked by overrides URL blocklist";
    }
    return modified;
  });

  // 1. Group candidates by normalized channel ID
  const grouped = deduplicateCandidates(candidates);

  // 2. Select preferred sources by sorting validation results for each group
  const preferredStreams: ValidationResult[] = [];

  for (const group of grouped) {
    // Find all validated options for this channel
    const options = overriddenResults.filter((r) => r.channelId === group.channelId);
    if (options.length === 0) continue;

    // Sort options to pick the best source
    options.sort(compareValidationResults);
    const best = options[0];
    if (best) {
      // Respect overrides preference
      const over = overrides.find((o) => o.id === group.channelId);
      if (over?.preferSource) {
        const preferredOption = options.find((o) => o.sourceName === over.preferSource);
        if (preferredOption && preferredOption.status === "portable") {
          preferredStreams.push(preferredOption);
          continue;
        }
      }
      preferredStreams.push(best);
    }
  }

  // Generate M3Us
  const { stableCount, mainCount, experimentalCount } = writePlaylists(preferredStreams, config.outputDir);

  // Generate Status
  const statusReport = writeStatusReport(
    candidates,
    overriddenResults,
    preferredStreams,
    discDurationMs,
    checkDurationMs,
    config.outputDir
  );

  // Generate Dashboard
  writeDashboard(statusReport, config.outputDir);

  console.log(`Generated playlist-stable.m3u (${stableCount} channels)`);
  console.log(`Generated playlist.m3u (${mainCount} channels)`);
  console.log(`Generated playlist-experimental.m3u (${experimentalCount} channels)`);
  console.log(`Generated index.html dashboard.`);

  // Print priority Azerbaijani channels table
  printPriorityChannelsTable(statusReport);
}

function doServe(config: AppConfig) {
  startLocalServer(config.serverPort, config.outputDir);
}

async function doArbCheck(config: AppConfig): Promise<void> {
  writeArbPlaylist(config.outputDir, config.serverPort);
  console.log("Resolving ARB from official page...");
  const result = await runArbCheck();
  console.log(`Resolver method: ${result.resolverMethod}`);
  console.log(`Captured stream type: ${result.streamType ?? "unknown"}`);
  console.log(`Required page context: ${result.requiredPageContext.length ? result.requiredPageContext.join(", ") : "none"}`);
  console.log(`Media bytes received: ${result.bytesReceived}`);
  console.log(`Startup time: ${result.startupMs} ms`);
  if (result.ok) {
    console.log("ARB check: passed");
  } else {
    console.log(`ARB check: failed${result.failure ? ` (${result.failure})` : ""}`);
    process.exitCode = 1;
  }
}

async function doDebugChannel(query: string): Promise<void> {
  const wanted = query.trim();
  if (!wanted) {
    console.error("Usage: npm run debug:channel -- \"AzTV\"");
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(CANDIDATES_FILE)) {
    console.error(`Candidates file not found at ${CANDIDATES_FILE}. Run discover or scan first.`);
    process.exitCode = 1;
    return;
  }
  const candidates: StreamCandidate[] = JSON.parse(fs.readFileSync(CANDIDATES_FILE, "utf8"));
  const matches = candidates.filter((candidate) => candidateMatchesQuery(candidate, wanted));
  console.log(`Debug channel: ${wanted}`);
  console.log(`Candidates matched: ${matches.length}`);
  for (const candidate of matches) {
    console.log(
      JSON.stringify({
        channelId: candidate.channelId,
        channelName: candidate.channelName,
        sourceName: candidate.sourceName,
        pageUrl: candidate.pageUrl,
        streamUrl: sanitizeUrl(candidate.streamUrl),
        discoveryMethod: candidate.discoveryMethod,
        metadata: sanitizeMetadata(candidate.metadata)
      })
    );
    const result = await validateCandidate(candidate, DEFAULT_CONFIG);
    console.log(
      JSON.stringify({
        status: result.status,
        stability: result.stability,
        failureCategory: result.failureCategory,
        failureReason: result.failureReason,
        manifestValid: result.manifestValid,
        mediaPlaylistValid: result.mediaPlaylistValid,
        segmentValid: result.segmentValid,
        segmentSample: result.segmentSample,
        probeValid: result.probeValid,
        hasVideo: result.hasVideo,
        hasAudio: result.hasAudio,
        resolution: result.width && result.height ? `${result.width}x${result.height}` : undefined
      })
    );
  }
}

function printPriorityChannelsTable(report: StatusReport) {
  const priorityList = [
    "xezer-tv",
    "arb",
    "arb24",
    "atv-az",
    "aztv",
    "ictimai-tv",
    "space-tv",
    "real-tv",
    "baku-tv",
    "cbc-sport"
  ];

  console.log("\n==========================================================================================");
  console.log("                  PRIORITY AZERBAIJANI CHANNELS SCAN RESULTS");
  console.log("==========================================================================================");
  console.log(
    "Channel".padEnd(20) +
      " | Candidates | " +
      "Best Source".padEnd(15) +
      " | " +
      "Status".padEnd(15) +
      " | " +
      "Stability".padEnd(18) +
      " | " +
      "Resolution".padEnd(12) +
      " | " +
      "Failure Reason"
  );
  console.log("------------------------------------------------------------------------------------------");

  for (const pid of priorityList) {
    const ch = report.channels[pid];
    if (!ch) {
      console.log(`${pid.padEnd(20)} | 0          | None            | unavailable     | unknown            | N/A          | Not discovered`);
      continue;
    }

    const candsCount = ch.allCandidates.length;
    const pref = ch.preferredSource;
    const bestSource = pref ? pref.sourceName : "None";
    const status = pref ? pref.status : "unavailable";
    const stability = pref ? pref.stability : "unknown";
    const resText = pref && pref.width ? `${pref.width}x${pref.height}` : "N/A";
    const reason = pref && pref.failureReason ? pref.failureReason : "";

    console.log(
      `${ch.channelName.substring(0, 20).padEnd(20)} | ` +
        `${candsCount.toString().padEnd(10)} | ` +
        `${bestSource.padEnd(15)} | ` +
        `${status.padEnd(15)} | ` +
        `${stability.padEnd(18)} | ` +
        `${resText.padEnd(12)} | ` +
        `${reason}`
    );
  }
  console.log("==========================================================================================\n");
}

function groupCandidatesForPriorityValidation(candidates: StreamCandidate[]): StreamCandidate[][] {
  const groups = new Map<string, StreamCandidate[]>();
  for (const candidate of [...candidates].sort(compareCandidatesForValidation)) {
    const group = groups.get(candidate.channelId) ?? [];
    group.push(candidate);
    groups.set(candidate.channelId, group);
  }
  return [...groups.values()].sort((a, b) => compareCandidatesForValidation(a[0]!, b[0]!));
}

function compareCandidatesForValidation(a: StreamCandidate, b: StreamCandidate): number {
  const rankDiff = getValidationPriorityRank(a) - getValidationPriorityRank(b);
  if (rankDiff !== 0) return rankDiff;
  const sourceDiff = sourceValidationRank(a.sourceName) - sourceValidationRank(b.sourceName);
  if (sourceDiff !== 0) return sourceDiff;
  return a.channelName.localeCompare(b.channelName);
}

function getValidationPriorityRank(candidate: StreamCandidate): number {
  const azPriority = new Set(["xezer-tv", "arb", "arb24", "atv-az", "aztv", "ictimai-tv", "space-tv", "real-tv", "baku-tv", "cbc-sport"]);
  if (candidate.country === "AZ" && azPriority.has(candidate.channelId)) return 1;
  if (candidate.country === "AZ") return 2;
  if (candidate.country === "TR") return 3;
  if (candidate.country === "RU" && isRussianPriorityName(candidate.channelName)) return 4;
  if (candidate.country === "RU") return 5;
  return 6;
}

function sourceValidationRank(sourceName: string): number {
  const order = ["canlitv-com", "public-iptv", "yoda", "iptv-org"];
  const index = order.indexOf(sourceName);
  return index === -1 ? 100 : index;
}

function isRussianPriorityName(name: string): boolean {
  const lower = name.toLocaleLowerCase("ru");
  return ["нтв", "пятый канал", "россия 24", "россия к", "отр", "тв центр", "рбк", "звезда", "мир", "москва 24", "пятница", "тнт", "стс", "рен тв", "карусель"].some((item) =>
    lower.includes(item)
  );
}

function createSkippedValidationResult(candidate: StreamCandidate): ValidationResult {
  return {
    channelId: candidate.channelId,
    channelName: candidate.channelName,
    country: candidate.country,
    category: candidate.category,
    streamUrl: candidate.streamUrl,
    sourceName: candidate.sourceName,
    status: "not_checked_better_candidate_already_found",
    stability: "unknown",
    checkedAt: new Date().toISOString(),
    failureReason: "not_checked_better_candidate_already_found",
    manifestValid: false,
    mediaPlaylistValid: false,
    segmentValid: false,
    probeValid: false,
    hasVideo: false,
    hasAudio: false,
    consecutiveFailures: 0
  };
}

function candidateMatchesQuery(candidate: StreamCandidate, query: string): boolean {
  const lower = query.toLocaleLowerCase("az");
  return (
    candidate.channelId.toLocaleLowerCase("az").includes(lower) ||
    candidate.channelName.toLocaleLowerCase("az").includes(lower)
  );
}

function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of ["token", "auth", "signature", "sig", "hdnts", "hdnea", "key", "pass"]) {
      if (url.searchParams.has(key)) url.searchParams.set(key, "<redacted>");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function sanitizeMetadata(metadata: StreamCandidate["metadata"]): StreamCandidate["metadata"] {
  if (!metadata) return undefined;
  return {
    ...metadata,
    cookie: undefined,
    authorization: undefined
  };
}

function getRuntimeConfig(args: string[]): AppConfig {
  const config: AppConfig = { ...DEFAULT_CONFIG };
  for (const arg of args) {
    if (arg.startsWith("--sources=")) {
      config.enabledAdapters = arg
        .slice("--sources=".length)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (arg.startsWith("--countries=")) {
      config.countries = arg
        .slice("--countries=".length)
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter((item): item is CountryCode => ["AZ", "TR", "RU", "OTHER"].includes(item));
    }
  }
  return config;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
