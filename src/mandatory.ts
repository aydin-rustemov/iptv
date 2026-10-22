import fs from "node:fs";
import { isPublishableUrl } from "./playlistGuard.js";
import { isDisplayableChannel } from "./generator.js";
import type { PlaylistEntry, ValidatedEntry } from "./types.js";

export interface MandatoryChannel {
  id: string;
  name: string;
  country: "Azərbaycan" | "Türkiyə";
  urls: string[];
}

export interface MandatoryResult {
  entries: ValidatedEntry[];
  verifiedIds: string[];
  unverifiedIds: string[];
}

export function loadMandatoryChannels(file = "config/mandatory-channels.json"): MandatoryChannel[] {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { channels: MandatoryChannel[] };
  const ids = new Set<string>();
  for (const channel of parsed.channels) {
    if (ids.has(channel.id)) throw new Error("Duplicate mandatory channel: " + channel.id);
    if (!channel.urls.some((url) => isPublishableUrl(url))) throw new Error("Missing candidate URL for " + channel.name);
    ids.add(channel.id);
  }
  return parsed.channels;
}

export function mandatoryCandidates(channels: MandatoryChannel[]): PlaylistEntry[] {
  return channels.flatMap((channel, index) =>
    channel.urls.filter((url) => isPublishableUrl(url)).map((url) => ({
      sourceName: "mandatory-candidate",
      tvgId: channel.id,
      tvgName: channel.name,
      name: channel.name,
      country: channel.country,
      category: "General",
      groupTitle: channel.country,
      url,
      headers: {},
      priorityId: channel.id,
      priorityName: channel.name,
      priorityCountry: channel.country,
      priorityOrder: index + 1,
      allowLivePath: true
    }))
  );
}

// A user-requested mandatory channel stays visible even if the GitHub runner
// cannot reach a geo-restricted stream. It is NEVER counted as verified.
export function ensureMandatory(
  selectedVerified: ValidatedEntry[],
  allVerified: ValidatedEntry[],
  channels: MandatoryChannel[],
  maximum = 100
): MandatoryResult {
  const output = [...selectedVerified];
  const verifiedIds: string[] = [];
  const unverifiedIds: string[] = [];
  const mandatoryIds = new Set(channels.map((channel) => channel.id));

  for (const channel of channels) {
    const verified = allVerified
      .filter((entry) => entry.priorityId === channel.id && entry.fast.ok && entry.media.ok && entry.media.hasVideo)
      .sort((a, b) => b.score - a.score);
    let existing = output.find((entry) => entry.priorityId === channel.id && entry.fast.ok && entry.media.ok);
    if (!existing) {
      const chosen = verified.find((entry) => !output.some((item) => item.url === entry.url));
      if (chosen) {
        output.push(chosen);
        existing = chosen;
      }
    }
    if (existing) {
      verifiedIds.push(channel.id);
      continue;
    }
    const fallback = channel.urls.find((url) => isPublishableUrl(url) && !output.some((entry) => entry.url === url));
    if (!fallback) throw new Error("No unique fallback URL for mandatory channel " + channel.name);
    const warning: ValidatedEntry = {
      sourceName: "mandatory-unverified",
      name: channel.name,
      tvgName: channel.name,
      tvgId: channel.id,
      country: channel.country,
      category: "General",
      groupTitle: channel.country + " — Yoxlanmamış (yerli yoxla)",
      url: fallback,
      headers: {},
      normalizedUrl: fallback,
      priorityId: channel.id,
      priorityOrder: channels.indexOf(channel) + 1,
      score: -1,
      fast: { ok: false, reason: "not_verified_from_github" },
      media: { ok: false, hasVideo: false, hasAudio: false, bytesRead: 0, reason: "not_verified_from_github" }
    };
    if (!isDisplayableChannel(warning)) throw new Error("Unpublishable mandatory fallback: " + channel.name);
    output.push(warning);
    unverifiedIds.push(channel.id);
  }

  // Never discard one of the 18 explicitly required channels to make room for
  // a lower-priority regional channel. Preserve verified streams otherwise.
  while (output.length > maximum) {
    let i = output.length - 1;
    while (i >= 0 && mandatoryIds.has(output[i]!.priorityId ?? "")) i--;
    if (i < 0) throw new Error("Mandatory channels exceed playlist capacity");
    output.splice(i, 1);
  }

  return { entries: output, verifiedIds, unverifiedIds };
}
