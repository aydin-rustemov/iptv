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
