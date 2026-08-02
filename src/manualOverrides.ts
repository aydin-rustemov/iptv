import fs from "node:fs";
import type { PlaylistEntry, ValidatedEntry } from "./types.js";

interface ManualOverrideConfig {
  channels?: ManualOverride[];
}

export interface ManualOverride {
  id: string;
  name: string;
  country: string;
  group: string;
  url?: string;
  fallbackUrl?: string;
  locked?: boolean;
  neverReplace?: boolean;
  neverRemove?: boolean;
  allowPublishWhenGithubRunnerCannotValidate?: boolean;
  useWhenCurrentPrimaryFails?: boolean;
  preferOfficialDirectUrl?: boolean;
  neverDiscardFallback?: boolean;
  userConfirmedWorking?: boolean;
  userConfirmedWorkingInAzerbaijan?: boolean;
}

export function loadManualOverrides(file = "config/manual-channel-overrides.json"): ManualOverride[] {
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ManualOverrideConfig;
  return parsed.channels ?? [];
}

export function manualOverrideCandidates(overrides: ManualOverride[]): PlaylistEntry[] {
  return overrides.flatMap((override) => {
    const url = override.url ?? override.fallbackUrl;
    if (!url) return [];
    return [{
      sourceName: override.locked ? "manual-locked" : "manual-fallback",
      tvgId: override.id,
      tvgName: override.name,
      groupTitle: override.group,
      country: countryName(override.country),
      category: "General",
      name: override.name,
      url,
      headers: {},
      priorityId: override.id,
      priorityName: override.name,
      priorityCountry: countryName(override.country),
      priorityCategory: "general",
      priorityOrder: override.id === "cbc-sport-az" ? 11 : 3
    }];
  });
}

export function forcedPublishedOverrides(overrides: ManualOverride[]): ValidatedEntry[] {
  return overrides
    .filter((override) => override.locked && override.url && override.allowPublishWhenGithubRunnerCannotValidate)
    .map((override) => ({
      sourceName: "manual-locked",
      tvgId: override.id,
      tvgName: override.name,
      groupTitle: override.group,
      country: countryName(override.country),
      category: "Sports",
      name: override.name,
      url: override.url!,
      headers: {},
      priorityId: override.id,
      priorityName: override.name,
      priorityCountry: countryName(override.country),
      priorityCategory: "sports",
      priorityOrder: 11,
      normalizedUrl: override.url!.toLowerCase(),
      score: 10000,
      fast: {
        ok: true,
        finalUrl: override.url,
        contentType: "application/vnd.apple.mpegurl",
        kind: "hls",
        latencyMs: 0,
        reason: "manual_locked_user_confirmed"
      },
      media: {
        ok: true,
        hasVideo: true,
        hasAudio: true,
        bytesRead: 0,
        reason: "manual_locked_user_confirmed"
      }
    }));
}

function countryName(code: string): string {
  if (code === "AZ") return "Azərbaycan";
  if (code === "TR") return "Türkiyə";
  if (code === "RU") return "Rusiya";
  return code;
}
