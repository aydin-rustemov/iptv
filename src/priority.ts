import fs from "node:fs";
import type { FastCheckResult, MediaCheckResult, MissingPriorityDetail, PlaylistEntry, PriorityChannel, PriorityChannelStatus, PrioritySocialCheck, ValidatedEntry } from "./types.js";
import { normalizeCountry } from "./parser.js";
import { isForbiddenUrl } from "./validator.js";

interface PriorityConfig {
  channels: PriorityChannel[];
}

const socialChecks = new Map<string, PrioritySocialCheck[]>();

export function loadPriorityChannels(file = "config/priority-channels.json"): PriorityChannel[] {
  const config = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as PriorityConfig;
  return [...config.channels].sort((a, b) => a.priority - b.priority);
}

export function tagPriorityEntries(entries: PlaylistEntry[], priorities: PriorityChannel[]): PlaylistEntry[] {
  return entries.map((entry) => {
    const match = matchPriority(entry, priorities);
    if (!match) return entry;
    return {
      ...entry,
      priorityId: match.id,
      priorityName: match.name,
      priorityCountry: match.country,
      priorityCategory: match.category,
      priorityOrder: match.priority,
      country: match.country,
      category: categoryName(match.category),
      name: match.name,
      tvgName: match.name,
      tvgId: match.id
    };
  });
}

export function buildPriorityStatuses(
  priorities: PriorityChannel[],
  candidates: PlaylistEntry[],
  validated: ValidatedEntry[],
  selected: ValidatedEntry[]
): PriorityChannelStatus[] {
  return priorities.map((priority) => {
    const found = candidates.filter((entry) => entry.priorityId === priority.id);
    const good = validated.filter((entry) => entry.priorityId === priority.id);
    const picked = selected.find((entry) => entry.priorityId === priority.id);
    const verifiedPicked = picked && picked.sourceName !== "canlitv-az-unverified";
    return {
      id: priority.id,
      name: priority.name,
      country: priority.country,
      category: priority.category,
      priority: priority.priority,
      aliasesChecked: new Set([priority.name, ...priority.aliases].map(normalizeName)).size,
      candidatesFound: found.length,
      candidatesValidated: good.length,
      selectedSource: picked?.sourceName,
      status: verifiedPicked ? "working" : found.length === 0 ? "not_found" : "all_candidates_failed",
      failureReason: verifiedPicked ? undefined : picked?.sourceName === "canlitv-az-unverified" ? "Only warning-marked unverified CanliTV fallback is available" : found.length === 0 ? "No matching alias found in enabled M3U sources" : "Matching candidates did not pass media validation"
    };
  });
}

export function writeMissingPriority(statuses: PriorityChannelStatus[], file = "output/missing-priority-channels.json"): void {
  const missing = statuses.filter((status) => status.status !== "working");
  fs.writeFileSync(file, JSON.stringify(missing, null, 2), "utf8");
}

export async function addTargetedPriorityCandidates(entries: PlaylistEntry[], priorities: PriorityChannel[], previousMissingFile = "output/missing-priority-channels.json"): Promise<{ entries: PlaylistEntry[]; officialPagesChecked: number; officialSocialAccountsChecked: number }> {
  const missingIds = loadSearchableMissingIds(previousMissingFile, priorities);
  for (const priority of priorities) {
    if ((priority.directCandidates?.length ?? 0) > 0 || (priority.officialPages?.length ?? 0) > 0 || (priority.officialSocial?.length ?? 0) > 0) {
      missingIds.add(priority.id);
    }
  }
  const additions: PlaylistEntry[] = [];
  let officialPagesChecked = 0;
  let officialSocialAccountsChecked = 0;

  for (const priority of priorities.filter((item) => missingIds.has(item.id))) {
    for (const url of priority.directCandidates ?? []) additions.push(priorityEntry(priority, url, "priority-direct"));
    for (const page of priority.officialPages ?? []) {
      officialPagesChecked++;
      for (const url of await extractMediaUrls(page, 2)) {
        if (mediaUrlLooksRelevant(priority, url)) additions.push(priorityEntry(priority, url, "official-page"));
      }
    }
    if ((priority.officialSocial?.length ?? 0) > 0) {
      const checks = await checkOfficialSocial(priority.officialSocial ?? []);
      socialChecks.set(priority.id, checks);
      officialSocialAccountsChecked += checks.length;
    }
  }

  return { entries: tagPriorityEntries([...entries, ...additions], priorities), officialPagesChecked, officialSocialAccountsChecked };
}

export function buildMissingPriorityDetails(
  statuses: PriorityChannelStatus[],
  priorities: PriorityChannel[],
  candidates: PlaylistEntry[],
  fastResults: Map<PlaylistEntry, FastCheckResult>,
  mediaResults: Map<PlaylistEntry, MediaCheckResult>,
  sourcesChecked: number,
  officialPagesChecked: number,
  _officialSocialAccountsChecked: number
): MissingPriorityDetail[] {
  return statuses.filter((status) => status.status !== "working").map((status) => {
    const priority = priorities.find((item) => item.id === status.id)!;
    const found = candidates.filter((entry) => entry.priorityId === status.id);
    const details = found.map((entry) => ({
      host: safeHost(entry.url),
      sourceName: entry.sourceName,
      result: candidateResult(entry, fastResults.get(entry), mediaResults.get(entry))
    }));
    return {
      channel: status.name,
      id: status.id,
      previousStatus: status.status,
      aliasesChecked: [priority.name, ...priority.aliases],
      sourcesChecked,
      officialPagesChecked: Math.min(priority.officialPages?.length ?? 0, officialPagesChecked),
      officialSocialAccountsChecked: socialChecks.get(priority.id)?.length ?? 0,
      candidatesFound: found.length,
      candidates: details,
      socialAccounts: socialChecks.get(priority.id) ?? [],
      bestResult: details.find((item) => item.result === "working")?.result ?? details[0]?.result,
      finalStatus: finalMissingStatus(status, details, socialChecks.get(priority.id) ?? []),
      nextRecommendedDiscoveryMethod: nextRecommendedDiscoveryMethod(status, details, socialChecks.get(priority.id) ?? [])
    };
  });
}

export function writeMissingPriorityDetails(details: MissingPriorityDetail[], file = "output/missing-priority-details.json"): void {
  fs.writeFileSync(file, JSON.stringify(details, null, 2), "utf8");
}

export function priorityIdFor(entry: PlaylistEntry): string | undefined {
  return entry.priorityId;
}

export function normalizeName(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ıİ]/g, "i")
    .replace(/[əƏ]/g, "e")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u")
    .replace(/телевидение|televizyonu|television/g, "tv")
    .replace(/\btv\b/g, " tv ")
    .replace(/[^a-z0-9а-яё]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchPriority(entry: PlaylistEntry, priorities: PriorityChannel[]): PriorityChannel | undefined {
  const country = normalizeCountry(entry.country ?? entry.groupTitle);
  const haystack = normalizeName(`${entry.name} ${entry.tvgName ?? ""} ${entry.tvgId ?? ""} ${entry.groupTitle ?? ""}`);
  const exact = priorities.find((priority) => {
    if (normalizeCountry(priority.country) !== country) return false;
    return [priority.name, ...priority.aliases].some((alias) => normalizeName(alias) === normalizeName(entry.name) || normalizeName(alias) === normalizeName(entry.tvgName ?? ""));
  });
  if (exact) return exact;

  return priorities.find((priority) => {
    if (normalizeCountry(priority.country) !== country) return false;
    return [priority.name, ...priority.aliases].some((alias) => containsAlias(haystack, normalizeName(alias)));
  });
}

function loadSearchableMissingIds(file: string, priorities: PriorityChannel[]): Set<string> {
  if (!fs.existsSync(file)) return new Set(priorities.map((priority) => priority.id));
  const missing = JSON.parse(fs.readFileSync(file, "utf8")) as PriorityChannelStatus[];
  return new Set(missing.filter((item) => item.status === "not_found" || item.status === "all_candidates_failed").map((item) => item.id));
}

function priorityEntry(priority: PriorityChannel, url: string, sourceName: string): PlaylistEntry {
  return {
    sourceName,
    tvgId: priority.id,
    tvgName: priority.name,
    country: priority.country,
    category: categoryName(priority.category),
    groupTitle: priority.country,
    name: priority.name,
    url,
    headers: {},
    candidateReferer: priority.officialPages?.[0],
    priorityId: priority.id,
    priorityName: priority.name,
    priorityCountry: priority.country,
    priorityCategory: priority.category,
    priorityOrder: priority.priority
  };
}

async function checkOfficialSocial(urls: string[]): Promise<PrioritySocialCheck[]> {
  const checks: PrioritySocialCheck[] = [];
  for (const url of urls) {
    try {
      if (isForbiddenUrl(url)) {
        checks.push({ platform: socialPlatform(url), host: safeHost(url), result: "forbidden_url" });
        continue;
      }
      const response = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 IPTV-Playlist-Updater/1.0" },
        signal: AbortSignal.timeout(12_000)
      });
      if (!response.ok) {
        checks.push({ platform: socialPlatform(url), host: safeHost(url), result: `http_${response.status}` });
        continue;
      }
      const text = await response.text();
      const hasLiveHint = /"isLive(Content)?"\s*:\s*true|LIVE_STREAM|liveBroadcastDetails|canl[ıi]\s*yay[ıi]n|live/i.test(text);
      checks.push({ platform: socialPlatform(url), host: safeHost(url), result: hasLiveHint ? "live_hint_found_no_direct_manifest" : "social_live_not_active" });
    } catch (err: any) {
      checks.push({ platform: socialPlatform(url), host: safeHost(url), result: err?.name === "TimeoutError" ? "connection_timeout" : "dns_or_network_failure" });
    }
  }
  return checks;
}

async function extractMediaUrls(page: string, depth: number): Promise<string[]> {
  if (depth < 0 || isForbiddenUrl(page)) return [];
  try {
    const response = await fetch(page, {
      headers: { "User-Agent": "Mozilla/5.0 IPTV-Playlist-Updater/1.0" },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) return [];
    const html = await response.text();
    const found = new Set<string>();
    for (const raw of html.match(/https?:\\?\/\\?\/[^"'<>\\\s]+?(?:\.m3u8|\.mpd)(?:\?[^"'<>\\\s]*)?/gi) ?? []) {
      const url = cleanEmbeddedUrl(raw);
      if (!isForbiddenUrl(url)) found.add(url);
    }
    if (depth > 0) {
      for (const iframe of iframeUrls(html, page).slice(0, 4)) {
        for (const media of await extractMediaUrls(iframe, depth - 1)) found.add(media);
      }
    }
    return [...found];
  } catch {
    return [];
  }
}

function iframeUrls(html: string, base: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1]!, base).toString();
      if (!isForbiddenUrl(url)) urls.push(url);
    } catch {
      // ignore malformed iframe URLs
    }
  }
  return urls;
}

function cleanEmbeddedUrl(raw: string): string {
  return raw.replace(/\\\//g, "/").replace(/&amp;/g, "&");
}

function mediaUrlLooksRelevant(priority: PriorityChannel, url: string): boolean {
  if (!priority.id.startsWith("trt-")) return true;
  const compactUrl = compactAscii(url);
  const needles = [priority.id, priority.name, ...priority.aliases].map(compactAscii).filter(Boolean);
  return needles.some((needle) => compactUrl.includes(needle));
}

function compactAscii(value: string): string {
  return normalizeName(value).replace(/\s+/g, "");
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return "invalid-url";
  }
}

function candidateResult(_entry: PlaylistEntry, fast?: FastCheckResult, media?: MediaCheckResult): string {
  if (!fast) return "not_checked";
  if (!fast.ok) return normalizeFailure(fast.reason);
  if (!media) return "media_not_checked";
  if (!media.ok) return normalizeFailure(media.reason);
  return "working";
}

function finalMissingStatus(
  status: PriorityChannelStatus,
  details: Array<{ result: string }>,
  socials: PrioritySocialCheck[]
): MissingPriorityDetail["finalStatus"] {
  if (status.status === "working") return "working";
  if (details.length === 0 && socials.some((item) => item.result === "social_live_not_active")) return "social_live_not_active";
  if (details.length === 0) return "not_found_after_all_sources";
  return "all_direct_candidates_failed";
}

function nextRecommendedDiscoveryMethod(
  status: PriorityChannelStatus,
  details: Array<{ result: string }>,
  socials: PrioritySocialCheck[]
): string {
  if (status.status === "working") return "none";
  if (details.some((item) => item.result === "http_403")) return "find alternate direct source or official header-compatible M3U entry";
  if (details.some((item) => item.result === "dns_or_network_failure")) return "replace obsolete CDN hostname from another public M3U source";
  if (socials.length > 0 && socials.every((item) => item.result !== "live_hint_found_no_direct_manifest")) return "recheck official social account when continuous live is active";
  return "target another public direct M3U source or official page manifest";
}

function socialPlatform(raw: string): PrioritySocialCheck["platform"] {
  const host = safeHost(raw);
  if (/youtube|youtu\.be/i.test(host)) return "youtube";
  if (/(^|\.)vk\.com$/i.test(host)) return "vk";
  if (/(^|\.)ok\.ru$/i.test(host)) return "ok";
  return "other";
}

function normalizeFailure(reason?: string): string {
  if (!reason) return "unknown";
  if (reason === "html") return "html_response";
  if (reason === "timeout") return "connection_timeout";
  if (reason === "network_error") return "dns_or_network_failure";
  if (reason === "unsupported_response") return "invalid_hls";
  if (reason === "too_small") return "zero_media_bytes";
  if (reason === "ffprobe_failed") return "ffprobe_failed";
  if (reason === "no_segment") return "media_segment_unavailable";
  if (reason === "no_hls_uri") return "no_playable_variant";
  if (/http_403/.test(reason)) return "http_403";
  if (/http_404/.test(reason)) return "http_404";
  if (/http_5\d\d/.test(reason)) return "http_5xx";
  if (/forbidden_url/.test(reason)) return "private_or_local_url";
  return reason.replace(/[^a-z0-9_]+/gi, "_").toLowerCase();
}

function containsAlias(haystack: string, alias: string): boolean {
  if (!alias) return false;
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, "iu").test(haystack);
}

function categoryName(value: string): string {
  if (value === "news") return "News";
  if (value === "sports") return "Sports";
  if (value === "documentary") return "Documentary";
  if (value === "children") return "Children";
  if (value === "music") return "Music";
  if (value === "culture") return "Culture";
  return "General";
}
