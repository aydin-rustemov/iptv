import type { StreamCandidate } from "../types.js";

export interface ChannelGroup {
  channelId: string;
  channelName: string;
  country: string;
  category: string;
  candidates: StreamCandidate[];
}

export function cleanUrlForDeduplication(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    // Remove transient query parameters commonly used for tracking/session
    const stripParams = [
      "token",
      "auth",
      "expires",
      "expiry",
      "exp",
      "sig",
      "signature",
      "hdnts",
      "hdnea",
      "id",
      "uid",
      "session",
      "tracking",
      "utm_source",
      "utm_medium",
      "utm_campaign"
    ];
    for (const p of stripParams) {
      url.searchParams.delete(p);
    }
    return url.toString().toLowerCase();
  } catch {
    return urlStr.toLowerCase();
  }
}

export function deduplicateCandidates(
  candidates: StreamCandidate[]
): ChannelGroup[] {
  const groups = new Map<string, ChannelGroup>();

  for (const cand of candidates) {
    let group = groups.get(cand.channelId);
    if (!group) {
      group = {
        channelId: cand.channelId,
        channelName: cand.channelName,
        country: cand.country,
        category: cand.category || "general",
        candidates: []
      };
      groups.set(cand.channelId, group);
    }

    // Check if we already have this stream URL (or a normalized version of it)
    const normalizedUrl = cleanUrlForDeduplication(cand.streamUrl);
    const isDuplicate = group.candidates.some(
      (c) =>
        c.streamUrl === cand.streamUrl ||
        cleanUrlForDeduplication(c.streamUrl) === normalizedUrl
    );

    if (!isDuplicate) {
      group.candidates.push(cand);
    }
  }

  return Array.from(groups.values());
}
