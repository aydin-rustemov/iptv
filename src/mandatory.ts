import fs from "node:fs";
import { isPublishableUrl, isDirectManifestUrl } from "./playlistGuard.js";
import { isDisplayableChannel } from "./generator.js";
import { isMismatchedChannel } from "./channelMatchGuard.js";
import type { PlaylistEntry, ValidatedEntry } from "./types.js";

export interface MandatoryChannel {
  id: string;
  name: string;
  country: "Azərbaycan" | "Türkiyə";
  urls?: string[];
}
export interface MandatoryResult {
  entries: ValidatedEntry[];
  verifiedIds: string[];
  unverifiedIds: string[];
  missingIds: string[];
}
export function loadMandatoryChannels(file = "config/mandatory-channels.json"): MandatoryChannel[] {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { channels: MandatoryChannel[] };
  const seen = new Set<string>();
  for (const channel of parsed.channels) {
    if (seen.has(channel.id)) throw Error("Duplicate mandatory channel: " + channel.id);
    seen.add(channel.id);
  }
  return parsed.channels;
}
export function mandatoryCandidates(channels: MandatoryChannel[]): PlaylistEntry[] {
  return channels.flatMap((channel) => (channel.urls ?? []).filter(isPublishableUrl).map((url) => ({
    sourceName: "mandatory-candidate", tvgId: channel.id, tvgName: channel.name,
    name: channel.name, country: channel.country, groupTitle: channel.country,
    category: "General", url, headers: {}, priorityId: channel.id
  })));
}

// Never insert an unverified Turkish URL: an HLS viewer page or Alanya TV under
// the name ATV is worse than a missing channel. For Azerbaijan the user prefers
// Yoda: display known Yoda M3U candidates by their NORMAL names, reporting any
// CI geo-blocking in mandatory-health.json, NOT a warning in the channel name.
export function ensureMandatory(
  selectedVerified: ValidatedEntry[],
  allVerified: ValidatedEntry[],
  channels: MandatoryChannel[],
  maximum = 100,
  scrapedCandidates: PlaylistEntry[] = []
): MandatoryResult {
  const output = [...selectedVerified].filter((entry) =>
    entry.fast.ok && entry.media.ok && entry.media.hasVideo &&
    isDirectManifestUrl(entry.url) && !isMismatchedChannel(entry));
  const verifiedIds: string[] = [];
  const unverifiedIds: string[] = [];
  const missingIds: string[] = [];
  const mandatoryIds = new Set(channels.map((channel) => channel.id));

  for (const [index, channel] of channels.entries()) {
    let existing = output.find((entry) => entry.priorityId === channel.id);
    if (!existing) {
      const candidates = allVerified
        .filter((entry) => entry.priorityId === channel.id &&
          entry.fast.ok && entry.media.ok && entry.media.hasVideo &&
          isDirectManifestUrl(entry.url) && !isMismatchedChannel(entry))
        .sort((a, b) => b.score - a.score);
      const good = candidates.find((entry) => !output.some((item) => item.url === entry.url));
      if (good) {
        output.push(good);
        existing = good;
      }
    }
    if (existing) {
      verifiedIds.push(channel.id);
      continue;
    }

    // Only Azerbaijan may have a visible, clean-name Yoda CDN fallback.
    // Its technical status remains explicitly unverified in machine-readable
    // health reports, not falsely counted as video-verified.
    const fallback = channel.country === "Azərbaycan"
      ? scrapedCandidates.find((entry) => entry.priorityId === channel.id &&
          (entry.sourceName === "yoda-az" || entry.sourceName === "yoda-az-cdn") &&
          /(^|\.)yodacdn\.net$/i.test(new URL(entry.url).hostname) &&
          isDirectManifestUrl(entry.url) && !isMismatchedChannel(entry) &&
          !output.some((item) => item.url === entry.url))
      : undefined;
    if (!fallback) {
      missingIds.push(channel.id);
      continue;
    }
    const selected: ValidatedEntry = {
      ...fallback,
      name: channel.name, tvgName: channel.name, tvgId: channel.id,
      country: channel.country, groupTitle: channel.country,
      priorityId: channel.id, priorityOrder: index + 1,
      normalizedUrl: fallback.url, score: -1,
      fast: { ok: false, reason: "geo_or_unverified_yoda_cdn" },
      media: { ok: false, hasVideo: false, hasAudio: false, bytesRead: 0,
        reason: "geo_or_unverified_yoda_cdn" }
    };
    if (!isDisplayableChannel(selected)) {
      missingIds.push(channel.id);
      continue;
    }
    output.push(selected);
    unverifiedIds.push(channel.id);
  }

  while (output.length > maximum) {
    let i = output.length - 1;
    while (i >= 0 && mandatoryIds.has(output[i]!.priorityId ?? "")) i--;
    if (i < 0) throw Error("Required channels exceed capacity");
    output.splice(i, 1);
  }
  return { entries: output, verifiedIds, unverifiedIds, missingIds };
}
