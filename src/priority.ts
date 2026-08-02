import fs from "node:fs";
import type { PlaylistEntry, PriorityChannel, PriorityChannelStatus, ValidatedEntry } from "./types.js";
import { normalizeCountry } from "./parser.js";

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
