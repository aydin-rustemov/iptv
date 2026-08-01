import * as cheerio from "cheerio";
import type { AppConfig, StreamCandidate } from "../types.js";
import type { SourceAdapter, AdapterResult } from "./source-adapter.js";
import { normalizeChannel } from "../discovery/normalize-channel.js";
import { fetchTextSafe } from "../validation/fetch-manifest.js";

export class IptvCatAdapter implements SourceAdapter {
  name = "iptv-cat";
  private urls: string[];

  constructor() {
    this.urls = [
      "https://iptvcat.net/country/ru",
      "https://iptvcat.com/country/ru",
      "https://iptvcat.net/country/ru/m3u",
      "https://iptvcat.com/country/ru/m3u"
    ];
  }

  async discover(config: AppConfig): Promise<AdapterResult> {
    const startTime = Date.now();
    const result: AdapterResult = {
      sourceName: this.name,
      status: "failed",
      pagesVisited: 0,
      candidates: [],
      browserUsed: false,
      durationMs: 0,
      warnings: []
    };

    const candidates: StreamCandidate[] = [];

    for (const url of this.urls) {
      try {
        const res = await fetchTextSafe(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          },
          timeoutMs: config.validationTimeoutMs,
          limitBytes: 5 * 1024 * 1024
        });
        result.pagesVisited++;

        const bodyText = res.text;

        // Check if raw M3U playlist format
        if (bodyText.includes("#EXTM3U")) {
          const lines = bodyText.split(/\r?\n/);
          let currentName = "RU Channel";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith("#EXTINF:")) {
              const commaIdx = trimmed.lastIndexOf(",");
              if (commaIdx !== -1) {
                currentName = trimmed.substring(commaIdx + 1).trim();
              }
            } else if (!trimmed.startsWith("#")) {
              const norm = normalizeChannel(currentName);
              candidates.push({
                channelId: norm.id,
                channelName: norm.name,
                country: "RU",
                pageUrl: url,
                streamUrl: trimmed,
                sourceName: this.name,
                discoveryMethod: "m3u-import",
                discoveredAt: new Date().toISOString()
              });
            }
          }
          continue;
        }

        // Otherwise treat as HTML page
        const $ = cheerio.load(bodyText);
        
        // Scan for tables or class names representing stream URLs
        // IPTV Cat tables often contain links to streams or player pages
        // We can search for .m3u8 pattern in elements or attributes
        const streamRegex = /(https?:\/\/[^"'\s>\n]+\.m3u8[^"'\s>]*)/gi;
        let match;
        const seenUrls = new Set<string>();

        // Look for rows with channel names and stream links
        $("tr").each((_, row) => {
          const text = $(row).text();
          let rowUrl = "";
          
          $(row).find("a, span, td").each((_, cell) => {
            const href = $(cell).attr("href");
            if (href && href.includes(".m3u8")) {
              rowUrl = href;
            }
            const cellText = $(cell).text().trim();
            if (cellText && cellText.includes(".m3u8")) {
              rowUrl = cellText;
            }
          });

          // Check if there is matching URL in the raw text of the row
          if (!rowUrl) {
            const m = text.match(streamRegex);
            if (m && m[0]) rowUrl = m[0];
          }

          if (rowUrl && !seenUrls.has(rowUrl)) {
            seenUrls.add(rowUrl);
            const firstCellText = $(row).find("td").first().text().trim();
            const channelName = firstCellText || "IPTVCat Channel";
            const norm = normalizeChannel(channelName);
            candidates.push({
              channelId: norm.id,
              channelName: norm.name,
              country: "RU",
              pageUrl: url,
              streamUrl: rowUrl,
              sourceName: this.name,
              discoveryMethod: "html",
              discoveredAt: new Date().toISOString()
            });
          }
        });

        // Fallback: search for any stream link in the raw text
        while ((match = streamRegex.exec(bodyText)) !== null) {
          const streamUrl = match[1];
          if (streamUrl && !seenUrls.has(streamUrl)) {
            seenUrls.add(streamUrl);
            const norm = normalizeChannel("IPTVCat Fallback RU");
            candidates.push({
              channelId: norm.id,
              channelName: norm.name,
              country: "RU",
              pageUrl: url,
              streamUrl: streamUrl,
              sourceName: this.name,
              discoveryMethod: "html",
              discoveredAt: new Date().toISOString()
            });
          }
        }

      } catch (err: any) {
        result.warnings.push(`Error fetching/parsing ${url}: ${err.message}`);
      }
    }

    result.candidates = candidates.slice(0, config.maxCandidatesPerSource);
    result.status = result.candidates.length > 0 ? "working" : "no_candidates";
    result.durationMs = Date.now() - startTime;
    return result;
  }
}
