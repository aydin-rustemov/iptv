import type { AppConfig } from "../types.js";
import type { SourceAdapter, AdapterResult } from "./source-adapter.js";

export class RussianDiscoveryAdapter implements SourceAdapter {
  name = "russian-discovery";
  private urls: string[];

  constructor() {
    this.urls = [
      "https://www.glaz.tv/",
      "http://www.ontvtime.ru/",
      "https://federal.tv/"
    ];
  }

  async discover(_config: AppConfig): Promise<AdapterResult> {
    const startTime = Date.now();
    const result: AdapterResult = {
      sourceName: this.name,
      status: "unsupported",
      pagesVisited: 0,
      candidates: [],
      browserUsed: false,
      durationMs: 0,
      warnings: ["These sources require browser interaction or are flash/iframe only. Excluded by policy."]
    };

    for (const url of this.urls) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        });
        result.pagesVisited++;
        if (res.status === 403 || res.status === 404) {
          result.status = "blocked";
        }
      } catch (err: any) {
        result.warnings.push(`Fetch failed for ${url}: ${err.message}`);
        result.status = "failed";
      }
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }
}
