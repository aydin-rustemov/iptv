import fs from "node:fs";
import { isPublishableUrl } from "./playlistGuard.js";
import { isDisplayableChannel } from "./generator.js";
import { isTurkeyAdSlateProneUrl } from "./validator.js";
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
  const ids = new Set<string>();
  for (const channel of parsed.channels) {
    if (ids.has(channel.id)) throw new Error("Duplicate mandatory channel: " + channel.id);
    ids.add(channel.id);
  }
  return parsed.channels;
}

// Retained for legacy clients, not used by the scheduled web-only generator.
// The configuration contains channel identities, NOT fabricated direct URLs.
export function mandatoryCandidates(channels: MandatoryChannel[]): PlaylistEntry[] {
  return channels.flatMap((channel) => (channel.urls ?? []).filter(isPublishableUrl).map((url) => ({
    sourceName: "mandatory-candidate",
    tvgId: channel.id, tvgName: channel.name, name: channel.name,
    country: channel.country, groupTitle: channel.country, category: "General",
    url, headers: {}, priorityId: channel.id
  })));
}

export function ensureMandatory(
  selectedVerified: ValidatedEntry[],
  allVerified: ValidatedEntry[],
  channels: MandatoryChannel[],
  maximum = 100,
  scrapedCandidates: PlaylistEntry[] = []
): MandatoryResult {
  const output = [...selectedVerified];
  const verifiedIds: string[] = [];
  const unverifiedIds: string[] = [];
  const missingIds: string[] = [];
  const mandatoryIds = new Set(channels.map((channel) => channel.id));

  for (const [index, channel] of channels.entries()) {
    const verified = allVerified.filter((entry) =>
      entry.priorityId === channel.id && entry.fast.ok && entry.media.ok && entry.media.hasVideo);
    let existing = output.find((entry) => entry.priorityId === channel.id && entry.fast.ok && entry.media.ok);
    if (!existing) {
      const chosen = verified.sort((a, b) => b.score - a.score)
        .find((entry) => !output.some((item) => item.url === entry.url));
      if (chosen) {
        output.push(chosen);
        existing = chosen;
      }
    }
    if (existing) {
      verifiedIds.push(channel.id);
      continue;
    }

    // Only use links genuinely discovered in the third-party player/network.
    // The previous official CDN URLs are NEVER a fallback in this mode.
    const candidate = scrapedCandidates
      .filter((entry) => entry.priorityId === channel.id &&
        entry.sourceName.startsWith("canlitv-") || entry.priorityId === channel.id &&
        entry.sourceName === "tvstream-az")
      .filter((entry) => isPublishableUrl(entry.url) &&
        !isTurkeyAdSlateProneUrl(entry.url) &&
        !output.some((item) => item.url === entry.url))
      .sort((a, b) => Number(b.sourceName === "canlitv-volo") - Number(a.sourceName === "canlitv-volo"))[0];
    if (!candidate) {
      missingIds.push(channel.id);
      continue;
    }

    const warning: ValidatedEntry = {
      ...candidate,
      sourceName: "web-unverified",
      tvgId: channel.id,
      name: channel.name,
      tvgName: channel.name,
      country: channel.country,
      groupTitle: channel.country + " — Yoxlanmamış (yerli yoxla)",
      priorityId: channel.id,
      priorityOrder: index + 1,
      normalizedUrl: candidate.url,
      score: -1,
      fast: { ok: false, reason: "web_candidate_not_verified_by_github" },
      media: { ok: false, hasVideo: false, hasAudio: false, bytesRead: 0, reason: "web_candidate_not_verified_by_github" }
    };
    if (!isDisplayableChannel(warning)) {
      missingIds.push(channel.id);
      continue;
    }
    output.push(warning);
    unverifiedIds.push(channel.id);
  }

  while (output.length > maximum) {
    let i = output.length - 1;
    while (i >= 0 && mandatoryIds.has(output[i]!.priorityId ?? "")) i--;
    if (i < 0) throw new Error("Mandatory channels exceed playlist capacity");
    output.splice(i, 1);
  }
  return { entries: output, verifiedIds, unverifiedIds, missingIds };
}
