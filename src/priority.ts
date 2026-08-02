import fs from "node:fs";
import type { FastCheckResult, MediaCheckResult, MissingPriorityDetail, PlaylistEntry, PriorityChannel, PriorityChannelStatus, ValidatedEntry } from "./types.js";
import { normalizeCountry } from "./parser.js";
import { isForbiddenUrl } from "./validator.js";

interface PriorityConfig {
  channels: PriorityChannel[];
}

export function loadPriorityChannels(file = "config/priority-channels.json"): PriorityChannel[] {
  const config = JSON.parse(fs.readFileSync(file, "utf8")) as PriorityConfig;
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
      status: picked ? "working" : found.length === 0 ? "not_found" : "all_candidates_failed",
      failureReason: picked ? undefined : found.length === 0 ? "No matching alias found in enabled M3U sources" : "Matching candidates did not pass media validation"
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
      for (const url of await extractMediaUrls(page, 2)) additions.push(priorityEntry(priority, url, "official-page"));
    }
    officialSocialAccountsChecked += priority.officialSocial?.length ?? 0;
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
  officialSocialAccountsChecked: number
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
      officialSocialAccountsChecked: Math.min(priority.officialSocial?.length ?? 0, officialSocialAccountsChecked),
      candidatesFound: found.length,
      candidates: details,
      bestResult: details.find((item) => item.result === "working")?.result ?? details[0]?.result,
      finalStatus: status.status
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
    priorityId: priority.id,
    priorityName: priority.name,
    priorityCountry: priority.country,
    priorityCategory: priority.category,
    priorityOrder: priority.priority
  };
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
