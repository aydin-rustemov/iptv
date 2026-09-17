import fs from "node:fs";
import path from "node:path";
import type { PriorityChannelStatus, StatusOutput, ValidatedEntry } from "./types.js";

export function writePlaylist(entries: ValidatedEntry[], file = "output/playlist.m3u"): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = "#EXTM3U\n";
  const ordered = [...entries].sort(comparePlaylistEntries);
  for (const entry of ordered) {
    const group = groupTitle(entry);
    const name = withWarningPrefix(displayName(entry.name), group);
    const attrs = [
      `tvg-id="${escapeAttr(entry.tvgId ?? slug(name))}"`,
      `tvg-name="${escapeAttr(entry.tvgName ?? name)}"`,
      entry.tvgLogo ? `tvg-logo="${escapeAttr(entry.tvgLogo)}"` : undefined,
      `group-title="${escapeAttr(group)}"`
    ].filter(Boolean).join(" ");
    text += `#EXTINF:-1 ${attrs},${name}\n`;
    if (entry.headers["User-Agent"]) text += `#EXTVLCOPT:http-user-agent=${entry.headers["User-Agent"]}\n`;
    if (entry.headers["Referer"]) text += `#EXTVLCOPT:http-referrer=${entry.headers["Referer"]}\n`;
    text += `${entry.url}\n`;
  }
  fs.writeFileSync(file, text, "utf8");
}

function comparePlaylistEntries(a: ValidatedEntry, b: ValidatedEntry): number {
  const country = groupCountryRank(groupTitle(a)) - groupCountryRank(groupTitle(b));
  if (country !== 0) return country;

  const category = categoryRank(a.category) - categoryRank(b.category);
  if (category !== 0) return category;

  const priority = (a.priorityOrder ?? Number.MAX_SAFE_INTEGER) - (b.priorityOrder ?? Number.MAX_SAFE_INTEGER);
  if (priority !== 0) return priority;

  return displayName(a.name).localeCompare(displayName(b.name), "az", { sensitivity: "base" });
}

function withWarningPrefix(name: string, group: string): string {
  if (!/Yoxlan/i.test(group)) return name;
  return name.startsWith("⚠") ? name : `⚠ ${name}`;
}

function displayName(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, "'")
    .replace(/\s+(?:tvg-id|tvg-name|tvg-logo|group-title)='[^']*'/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function groupCountryRank(group: string): number {
  const normalized = normalizeSortText(group);
  if (/azerbaycan|^az$/.test(normalized)) return 0;
  if (/turkiye|^tr$/.test(normalized)) return 1;
  if (/rusiya|russia|^ru$/.test(normalized)) return 2;
  if (/iran|^ir$/.test(normalized)) return 3;
  return 4;
}

function categoryRank(category?: string): number {
  const value = (category ?? "Other").toLocaleLowerCase("tr");
  if (/general|umumi|ümumi/.test(value)) return 0;
  if (/news|xeber|xəbər|haber/.test(value)) return 1;
  if (/sport|idman/.test(value)) return 2;
  if (/documentary|culture|sened|sənəd|medeniyyet|mədəniyyət/.test(value)) return 3;
  if (/children|kids|usaq|uşaq|cocuk|çocuk/.test(value)) return 4;
  if (/music|musiqi|muzik|müzik/.test(value)) return 5;
  return 6;
}

function normalizeSortText(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0259\u018f]/g, "e")
    .replace(/[\u0131\u0130]/g, "i")
    .replace(/[\u00fc\u00DC]/g, "u");
}

export function writeStatus(status: StatusOutput, htmlFile = "output/status.html", jsonFile = "output/status.json"): void {
  fs.mkdirSync(path.dirname(jsonFile), { recursive: true });
  fs.writeFileSync(jsonFile, JSON.stringify(status, null, 2), "utf8");
  const countries = Object.entries(status.countryCounts).map(([name, count]) => `<tr><td>${escapeHtml(name)}</td><td>${count}</td></tr>`).join("");
  const priorityRows = (status.priorityChannels ?? []).map(priorityRow).join("");
  fs.writeFileSync(htmlFile, `<!doctype html><html><head><meta charset="utf-8"><title>IPTV Status</title><style>body{font-family:Arial,sans-serif;margin:24px}td,th{border:1px solid #ddd;padding:6px}table{border-collapse:collapse;margin-bottom:24px}.ok{color:#067d17}.miss{color:#9a3412}</style></head><body><h1>IPTV Playlist Status</h1><p>Last update: ${status.updatedAt}</p><p>Published: ${status.published}</p><p>Fast passed: ${status.fastCheckPassed} Media passed: ${status.mediaCheckPassed} Failed: ${status.failed}</p><p>Degraded: ${status.degraded}</p><h2>Countries</h2><table><thead><tr><th>Country</th><th>Channels</th></tr></thead><tbody>${countries}</tbody></table><h2>Priority channels</h2><table><thead><tr><th>Priority</th><th>Channel</th><th>Country</th><th>Status</th><th>Candidates</th><th>Validated</th><th>Reason</th></tr></thead><tbody>${priorityRows}</tbody></table><p>CanliTV warning-marked entries are fallback diagnostics, not verified working channels.</p></body></html>`, "utf8");
}

export function countBy<T extends string | undefined>(entries: ValidatedEntry[], picker: (entry: ValidatedEntry) => T): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const key = picker(entry) || "Other";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, "'");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]!));
}

function slug(value: string): string {
  return value.toLocaleLowerCase("tr").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
}

function groupTitle(entry: ValidatedEntry): string {
  if (entry.groupTitle?.includes("Yoxlan") || entry.groupTitle?.includes("YoxlanÄ")) return normalizeGroup(entry.groupTitle);
  const priorityCountry = normalizeCountryLabel(entry.priorityCountry);
  const country = normalizeCountryLabel(entry.country);

  if (priorityCountry === "Azərbaycan") return azerbaijanGroup(entry.priorityCategory ?? entry.category);
  if (priorityCountry === "Türkiyə") return `Türkiyə — ${countryCategoryGroup(entry.priorityCategory ?? entry.category)}`;
  if (priorityCountry === "Rusiya") return `Rusiya — ${countryCategoryGroup(entry.priorityCategory ?? entry.category)}`;
  if (priorityCountry === "İran") return `İran — ${countryCategoryGroup(entry.priorityCategory ?? entry.category)}`;
  if (priorityCountry) return priorityCountry;

  if (country === "Azərbaycan") return azerbaijanGroup(entry.category);
  if (country === "Türkiyə") return `Türkiyə — ${countryCategoryGroup(entry.category)}`;
  if (country === "Rusiya") return `Rusiya — ${countryCategoryGroup(entry.category)}`;
  if (country === "İran") return `İran — ${countryCategoryGroup(entry.category)}`;

  return normalizeGroup(entry.groupTitle ?? entry.country ?? "Beynəlxalq");
}

function countryCategoryGroup(category?: string): string {
  const value = (category ?? "").toLocaleLowerCase("tr");
  if (/news|haber|xəbər/.test(value)) return "Xəbər";
  if (/sport|idman/.test(value)) return "İdman";
  if (/documentary|culture|sənəd|mədəni/.test(value)) return "Sənədli və mədəniyyət";
  if (/children|kids|çocuk|uşaq/.test(value)) return "Uşaq";
  if (/music|müzik|musiqi/.test(value)) return "Musiqi";
  return "Ümumi";
}

function azerbaijanGroup(category?: string): string {
  const value = (category ?? "").toLocaleLowerCase("tr");
  if (/news|xəbər/.test(value)) return "Azərbaycan — Xəbər";
  if (/sport|idman/.test(value)) return "Azərbaycan — İdman";
  if (/music|musiqi/.test(value)) return "Azərbaycan — Musiqi";
  if (/children|uşaq/.test(value)) return "Azərbaycan — Uşaq";
  if (/regional|other/.test(value)) return "Azərbaycan — Digər";
  return "Azərbaycan — Ümumi";
}

function normalizeCountryLabel(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeSortText(value);
  if (/azerbaycan|^az$/.test(normalized)) return "Azərbaycan";
  if (/turkiye|^tr$/.test(normalized)) return "Türkiyə";
  if (/rusiya|russia|^ru$/.test(normalized)) return "Rusiya";
  if (/iran|^ir$/.test(normalized)) return "İran";
  return undefined;
}

function normalizeGroup(value: string): string {
  return value
    .replace(/AzÉ™rbaycan|AzÃ‰â„¢rbaycan/g, "Azərbaycan")
    .replace(/TÃ¼rkiyÉ™|TÃƒÂ¼rkiyÃ‰â„¢/g, "Türkiyə")
    .replace(/â€”/g, "—")
    .replace(/YoxlanÄ±lmamÄ±ÅŸ/g, "Yoxlanılmamış")
    .replace(/XÉ™bÉ™r/g, "Xəbər")
    .replace(/Ä°dman/g, "İdman")
    .replace(/SÉ™nÉ™dli vÉ™ mÉ™dÉ™niyyÉ™t/g, "Sənədli və mədəniyyət")
    .replace(/UÅŸaq/g, "Uşaq")
    .replace(/Ãœmumi/g, "Ümumi");
}

function priorityRow(status: PriorityChannelStatus): string {
  const cls = status.status === "working" ? "ok" : "miss";
  return `<tr><td>${status.priority}</td><td>${escapeHtml(status.name)}</td><td>${escapeHtml(status.country)}</td><td class="${cls}">${escapeHtml(status.status)}</td><td>${status.candidatesFound}</td><td>${status.candidatesValidated}</td><td>${escapeHtml(status.failureReason ?? "")}</td></tr>`;
}
