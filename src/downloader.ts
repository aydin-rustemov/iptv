import fs from "node:fs";
import type { SourceConfig } from "./types.js";

export function loadSources(file = "config/sources.json"): SourceConfig[] {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { sources?: SourceConfig[] };
  return (parsed.sources ?? []).filter((source) => source.enabled);
}

export async function downloadSource(source: SourceConfig): Promise<string> {
  const response = await fetch(source.url, {
    headers: { "User-Agent": "Mozilla/5.0 IPTV-Playlist-Updater/1.0" },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`${source.name}: HTTP ${response.status}`);
  return await response.text();
}

export function updateSourceStats(stats: Array<{ name: string; parsedEntries: number; workingPriorityCandidates: number }>, file = "config/sources.json"): void {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { sources?: SourceConfig[] };
  const byName = new Map(stats.map((item) => [item.name, item]));
  parsed.sources = (parsed.sources ?? []).map((source) => {
    const stat = byName.get(source.name);
    if (!stat) return source;
    return {
      ...source,
      lastSuccessfulDownload: new Date().toISOString(),
      parsedEntries: stat.parsedEntries,
      workingPriorityCandidates: stat.workingPriorityCandidates
    };
  });
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2), "utf8");
}
