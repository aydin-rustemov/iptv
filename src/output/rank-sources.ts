import type { ValidationResult } from "../types.js";

export function getRankTier(res: ValidationResult): number {
  // Tier 1: Direct official broadcaster stream
  if (res.sourceName === "predefined") {
    return 1;
  }

  if (res.sourceName === "canlitv-com" && res.status === "portable" && res.stability === "stable") {
    return 1;
  }

  if (res.sourceName === "canlitv-com" && res.status === "portable_with_headers") {
    return 3;
  }

  // Tier 2: Stable direct CDN HLS
  const isCdn = res.streamUrl.includes("cdn") || res.streamUrl.includes("str.");
  if (res.status === "portable" && res.stability === "stable" && isCdn) {
    return 2;
  }

  // Tier 3: Stable third-party portable HLS
  if (res.status === "portable" && res.stability === "stable") {
    return 3;
  }

  // Tier 4: Header-compatible stream
  if (res.status === "header_required" || res.status === "portable_with_headers") {
    return 4;
  }

  // Tier 5: Tokenized stream (refreshable_public)
  if (res.stability === "refreshable_public") {
    return 5;
  }

  // Tier 6: Session-bound stream
  if (res.status === "session_bound") {
    return 6;
  }

  return 10; // Worst/invalid
}

export function compareValidationResults(a: ValidationResult, b: ValidationResult): number {
  const tierA = getRankTier(a);
  const tierB = getRankTier(b);
  if (tierA !== tierB) {
    return tierA - tierB;
  }

  // Prefer fewer consecutive failures (reliability)
  if (a.consecutiveFailures !== b.consecutiveFailures) {
    return a.consecutiveFailures - b.consecutiveFailures;
  }

  // Prefer both video and audio present
  const aBoth = a.hasVideo && a.hasAudio;
  const bBoth = b.hasVideo && b.hasAudio;
  if (aBoth !== bBoth) {
    return aBoth ? -1 : 1;
  }

  // Prefer HTTPS over HTTP
  const aHttps = a.streamUrl.startsWith("https:");
  const bHttps = b.streamUrl.startsWith("https:");
  if (aHttps !== bHttps) {
    return aHttps ? -1 : 1;
  }

  // Prefer lower latency (faster startup)
  const latencyA = a.latencyMs ?? 99999;
  const latencyB = b.latencyMs ?? 99999;
  if (latencyA !== latencyB) {
    return latencyA - latencyB;
  }

  return 0;
}
