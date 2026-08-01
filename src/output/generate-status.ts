import fs from "node:fs";
import path from "node:path";
import type { StreamCandidate, ValidationResult } from "../types.js";

export interface StatusReport {
  generatedAt: string;
  discoveryDurationMs: number;
  validationDurationMs: number;
  candidateCount: number;
  uniqueChannelCount: number;
  portableCount: number;
  headerRequiredCount: number;
  sessionBoundCount: number;
  expiringTokenCount: number;
  portableWithHeadersCount: number;
  localRelayRequiredCount: number;
  geoBlockedCount: number;
  temporarilyUnavailableCount: number;
  invalidCount: number;
  skippedAlternativeCount: number;
  perSourceStats: Record<
    string,
    {
      candidates: number;
      working: number;
      failed: number;
    }
  >;
  channels: Record<
    string,
    {
      channelId: string;
      channelName: string;
      country: string;
      category: string;
      preferredSource?: {
        sourceName: string;
        streamUrl: string;
        status: string;
        stability: string;
        latencyMs?: number;
        width?: number;
        height?: number;
        videoCodec?: string;
        audioCodec?: string;
        failureReason?: string;
        minimumRequiredHeaders?: string[];
      };
      allCandidates: Array<{
        sourceName: string;
        streamUrl: string;
        status: string;
        stability: string;
        consecutiveFailures: number;
        lastSuccessfulValidation?: string;
        failureReason?: string;
      }>;
    }
  >;
}

export function writeStatusReport(
  candidates: StreamCandidate[],
  validationResults: ValidationResult[],
  preferredStreams: ValidationResult[],
  discoveryDurationMs: number,
  validationDurationMs: number,
  outputDir: string
): StatusReport {
  const generatedAt = new Date().toISOString();

  // Metrics
  let portableCount = 0;
  let headerRequiredCount = 0;
  let sessionBoundCount = 0;
  let expiringTokenCount = 0;
  let portableWithHeadersCount = 0;
  let localRelayRequiredCount = 0;
  let geoBlockedCount = 0;
  let temporarilyUnavailableCount = 0;
  let invalidCount = 0;
  let skippedAlternativeCount = 0;

  for (const res of validationResults) {
    if (res.status === "portable") portableCount++;
    else if (res.status === "portable_with_headers") portableWithHeadersCount++;
    else if (res.status === "local_relay_required") localRelayRequiredCount++;
    else if (res.status === "header_required") headerRequiredCount++;
    else if (res.status === "session_bound") sessionBoundCount++;
    else if (res.status === "geo_blocked") geoBlockedCount++;
    else if (res.status === "temporarily_unavailable") temporarilyUnavailableCount++;
    else if (res.status === "not_checked_better_candidate_already_found") skippedAlternativeCount++;
    else if (res.status === "invalid") invalidCount++;

    if (res.stability === "short_lived" || res.stability === "refreshable_public") {
      expiringTokenCount++;
    }
  }

  // Per source stats
  const perSourceStats: StatusReport["perSourceStats"] = {};
  for (const cand of candidates) {
    if (!perSourceStats[cand.sourceName]) {
      perSourceStats[cand.sourceName] = { candidates: 0, working: 0, failed: 0 };
    }
    perSourceStats[cand.sourceName]!.candidates++;
  }

  for (const res of validationResults) {
    const stats = perSourceStats[res.sourceName];
    if (stats) {
      if (res.status === "portable" || res.status === "portable_with_headers") {
        stats.working++;
      } else {
        stats.failed++;
      }
    }
  }

  // Channels grouping
  const channels: StatusReport["channels"] = {};
  
  // Initialize from all validation results
  for (const res of validationResults) {
    if (!channels[res.channelId]) {
      channels[res.channelId] = {
        channelId: res.channelId,
        channelName: res.channelName,
        country: res.country,
        category: "general",
        allCandidates: []
      };
    }

    channels[res.channelId]!.allCandidates.push({
      sourceName: res.sourceName,
      streamUrl: res.streamUrl,
      status: res.status,
      stability: res.stability,
      consecutiveFailures: res.consecutiveFailures,
      lastSuccessfulValidation: res.lastSuccessfulValidation,
      failureReason: res.failureReason
    });
  }

  // Attach preferred source details
  for (const pref of preferredStreams) {
    const ch = channels[pref.channelId];
    if (ch) {
      ch.preferredSource = {
        sourceName: pref.sourceName,
        streamUrl: pref.streamUrl,
        status: pref.status,
        stability: pref.stability,
        latencyMs: pref.latencyMs,
        width: pref.width,
        height: pref.height,
        videoCodec: pref.videoCodec,
        audioCodec: pref.audioCodec,
        failureReason: pref.failureReason,
        minimumRequiredHeaders: pref.minimumRequiredHeaders
      };
    }
  }

  const report: StatusReport = {
    generatedAt,
    discoveryDurationMs,
    validationDurationMs,
    candidateCount: candidates.length,
    uniqueChannelCount: Object.keys(channels).length,
    portableCount,
    headerRequiredCount,
    sessionBoundCount,
    expiringTokenCount,
    portableWithHeadersCount,
    localRelayRequiredCount,
    geoBlockedCount,
    temporarilyUnavailableCount,
    invalidCount,
    skippedAlternativeCount,
    perSourceStats,
    channels
  };

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(path.join(outputDir, "status.json"), JSON.stringify(report, null, 2), "utf8");

  return report;
}
