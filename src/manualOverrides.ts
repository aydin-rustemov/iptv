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
  forcePublish?: boolean;
  staticUrl?: boolean;
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
      category: categoryFor(override),
      name: override.name,
      url,
      headers: {},
      priorityId: priorityIdFor(override),
      priorityName: override.name,
      priorityCountry: countryName(override.country),
      priorityCategory: priorityCategoryFor(override),
      priorityOrder: priorityOrderFor(override)
    }];
  });
}

export function forcedPublishedOverrides(overrides: ManualOverride[]): ValidatedEntry[] {
  return overrides
    .filter((override) => override.locked && override.url && (override.forcePublish || override.allowPublishWhenGithubRunnerCannotValidate))
    .map((override) => ({
      sourceName: "manual-locked",
      tvgId: override.id,
      tvgName: override.name,
      groupTitle: override.group,
      country: countryName(override.country),
      category: categoryFor(override),
      name: override.name,
      url: override.url!,
      headers: {},
      priorityId: priorityIdFor(override),
      priorityName: override.name,
      priorityCountry: countryName(override.country),
      priorityCategory: priorityCategoryFor(override),
      priorityOrder: priorityOrderFor(override),
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

function priorityIdFor(override: ManualOverride): string {
  if (override.id === "arb-az") return "arb";
  if (override.id === "space-tv-az") return "space-tv";
  if (override.id === "real-tv-az") return "real-tv";
  if (override.id === "idman-tv-az") return "idman-tv";
  if (override.id === "el-tv-az") return "el-tv";
  if (override.id === "cbc-sport-az") return "cbc-sport";
  return override.id;
}

function priorityOrderFor(override: ManualOverride): number {
  if (override.id === "atv-az") return 3;
  if (override.id === "arb-az") return 5;
  if (override.id === "space-tv-az") return 7;
  if (override.id === "real-tv-az") return 8;
  if (override.id === "apa-tv-az") return 9;
  if (override.id === "cbc-sport-az") return 12;
  if (override.id === "idman-tv-az") return 13;
  if (override.id === "el-tv-az") return 20;
  return Number.MAX_SAFE_INTEGER;
}

function priorityCategoryFor(override: ManualOverride): string {
  if (override.id === "real-tv-az" || override.id === "apa-tv-az") return "news";
  if (override.id === "cbc-sport-az") return "sports";
  if (override.id === "idman-tv-az") return "sports";
  if (override.id === "el-tv-az") return "regional";
  return "general";
}

function categoryFor(override: ManualOverride): string {
  if (override.id === "real-tv-az" || override.id === "apa-tv-az") return "News";
  if (override.id === "cbc-sport-az") return "Sports";
  if (override.id === "idman-tv-az") return "Sports";
  if (override.id === "el-tv-az") return "Other";
  return "General";
}
