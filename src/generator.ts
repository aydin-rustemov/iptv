import fs from "node:fs";
import path from "node:path";
import type { StatusOutput, ValidatedEntry } from "./types.js";

export function writePlaylist(entries: ValidatedEntry[], file = "output/playlist.m3u"): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = "#EXTM3U\n";
  for (const entry of entries) {
    const attrs = [
      `tvg-id="${escapeAttr(entry.tvgId ?? slug(entry.name))}"`,
      `tvg-name="${escapeAttr(entry.tvgName ?? entry.name)}"`,
      entry.tvgLogo ? `tvg-logo="${escapeAttr(entry.tvgLogo)}"` : undefined,
      `group-title="${escapeAttr(entry.country ?? "Beynəlxalq")}"`
    ].filter(Boolean).join(" ");
    text += `#EXTINF:-1 ${attrs},${entry.name}\n`;
    if (entry.headers["User-Agent"]) text += `#EXTVLCOPT:http-user-agent=${entry.headers["User-Agent"]}\n`;
    if (entry.headers["Referer"]) text += `#EXTVLCOPT:http-referrer=${entry.headers["Referer"]}\n`;
    text += `${entry.url}\n`;
  }
  fs.writeFileSync(file, text, "utf8");
}

export function writeStatus(status: StatusOutput, htmlFile = "output/status.html", jsonFile = "output/status.json"): void {
  fs.mkdirSync(path.dirname(jsonFile), { recursive: true });
  fs.writeFileSync(jsonFile, JSON.stringify(status, null, 2), "utf8");
  const countries = Object.entries(status.countryCounts).map(([name, count]) => `<tr><td>${escapeHtml(name)}</td><td>${count}</td></tr>`).join("");
  fs.writeFileSync(htmlFile, `<!doctype html><html><head><meta charset="utf-8"><title>IPTV Status</title><style>body{font-family:Arial,sans-serif;margin:24px}td,th{border:1px solid #ddd;padding:6px}table{border-collapse:collapse}</style></head><body><h1>IPTV Playlist Status</h1><p>Last update: ${status.updatedAt}</p><p>Published: ${status.published}</p><p>Fast passed: ${status.fastCheckPassed} Media passed: ${status.mediaCheckPassed} Failed: ${status.failed}</p><p>Degraded: ${status.degraded}</p><table><thead><tr><th>Country</th><th>Channels</th></tr></thead><tbody>${countries}</tbody></table></body></html>`, "utf8");
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
  return value.toLowerCase().normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
}
