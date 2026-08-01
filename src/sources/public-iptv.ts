import * as cheerio from "cheerio";
import type { AppConfig, StreamCandidate, CountryCode } from "../types.js";
import type { SourceAdapter, AdapterResult } from "./source-adapter.js";
import { normalizeChannel } from "../discovery/normalize-channel.js";
import { parseChannelM3u } from "../validation/parse-hls.js";
import { fetchTextSafe } from "../validation/fetch-manifest.js";

export class PublicIptvAdapter implements SourceAdapter {
  name = "public-iptv";
  private baseUrls: Record<CountryCode, string[]>;

  constructor() {
    // Provide fallback URL lists for each country
    this.baseUrls = {
      AZ: [
        "https://publiciptv.com/countries/az",
        "https://publiciptv.com/countries/az/m3u",
        "https://publiciptv.com/countries/az.m3u",
        "https://iptv-org.github.io/iptv/countries/az.m3u"
      ],
      TR: [
        "https://publiciptv.com/countries/tr",
        "https://publiciptv.com/countries/tr/m3u",
        "https://publiciptv.com/countries/tr.m3u",
        "https://iptv-org.github.io/iptv/countries/tr.m3u"
      ],
      RU: [
        "https://publiciptv.com/countries/ru",
        "https://publiciptv.com/countries/ru/m3u",
        "https://publiciptv.com/countries/ru.m3u",
        "https://iptv-org.github.io/iptv/countries/ru.m3u"
      ],
      OTHER: []
    };
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

    // Check configured countries
    for (const country of config.countries) {
      const urls = this.baseUrls[country] || [];
      let successForCountry = false;

      for (const url of urls) {
        if (successForCountry) break;

        try {
          const res = await fetchTextSafe(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
            timeoutMs: config.validationTimeoutMs,
            limitBytes: 5 * 1024 * 1024
          });
          result.pagesVisited++;

          const contentType = res.headers.get("content-type") || "";
          const bodyText = res.text;

          // Check if it's HTML or M3U
          if (contentType.includes("text/html") || bodyText.trim().startsWith("<!DOCTYPE") || bodyText.trim().startsWith("<html")) {
            // It's an HTML page. Inspect the page
            const $ = cheerio.load(bodyText);

            // 1. Look for pre/code blocks containing #EXTM3U
            let extractedM3u = "";
            $("pre, code, textarea").each((_, el) => {
              const text = $(el).text();
              if (text.includes("#EXTM3U")) {
                extractedM3u = text;
              }
            });

            if (extractedM3u) {
              const parsed = parseChannelM3u(extractedM3u);
              for (const entry of parsed) {
                const norm = normalizeChannel(entry.name);
                candidates.push({
                  channelId: norm.id,
                  channelName: norm.name,
                  country: country, // Enforce the scraped country category
                  pageUrl: url,
                  streamUrl: entry.url,
                  sourceName: this.name,
                  discoveryMethod: "m3u-import",
                  discoveredAt: new Date().toISOString()
                });
              }
              successForCountry = true;
              continue;
            }

            // 2. Look for download links ending with .m3u or .m3u8
            let downloadUrl = "";
            $("a").each((_, el) => {
              const href = $(el).attr("href");
              if (href && (href.endsWith(".m3u") || href.endsWith(".m3u8"))) {
                downloadUrl = new URL(href, url).toString();
              }
            });

            if (downloadUrl) {
              try {
                const dlRes = await fetchTextSafe(downloadUrl, {
                  timeoutMs: config.validationTimeoutMs,
                  limitBytes: 5 * 1024 * 1024
                });
                result.pagesVisited++;
                {
                  const dlBody = dlRes.text;
                  if (dlBody.includes("#EXTM3U")) {
                    const parsed = parseChannelM3u(dlBody);
                    for (const entry of parsed) {
                      const norm = normalizeChannel(entry.name);
                      candidates.push({
                        channelId: norm.id,
                        channelName: norm.name,
                        country: country,
                        pageUrl: downloadUrl,
                        streamUrl: entry.url,
                        sourceName: this.name,
                        discoveryMethod: "m3u-import",
                        discoveredAt: new Date().toISOString()
                      });
                    }
                    successForCountry = true;
                    continue;
                  }
                }
              } catch (err: any) {
                result.warnings.push(`Failed to fetch M3U link ${downloadUrl}: ${err.message}`);
              }
            }

            // 3. Scan all visible stream URLs in elements
            const streamRegex = /(https?:\/\/[^"'\s>\n]+\.m3u8[^"'\s>]*)/gi;
            let match;
            const seenUrls = new Set<string>();
            while ((match = streamRegex.exec(bodyText)) !== null) {
              const streamUrl = match[1];
              if (streamUrl && !seenUrls.has(streamUrl)) {
                seenUrls.add(streamUrl);
                // Attempt to find a nearby text label for the channel
                const norm = normalizeChannel(`PublicIPTV-${country}`);
                candidates.push({
                  channelId: norm.id,
                  channelName: norm.name,
                  country: country,
                  pageUrl: url,
                  streamUrl: streamUrl,
                  sourceName: this.name,
                  discoveryMethod: "html",
                  discoveredAt: new Date().toISOString()
                });
              }
            }

            if (seenUrls.size > 0) {
              successForCountry = true;
            }

          } else {
            // It's a raw M3U list
            if (bodyText.includes("#EXTM3U")) {
              const parsed = parseChannelM3u(bodyText);
              for (const entry of parsed) {
                const norm = normalizeChannel(entry.name);
                candidates.push({
                  channelId: norm.id,
                  channelName: norm.name,
                  country: country,
                  pageUrl: url,
                  streamUrl: entry.url,
                  sourceName: this.name,
                  discoveryMethod: "m3u-import",
                  discoveredAt: new Date().toISOString()
                });
              }
              successForCountry = true;
            }
          }
        } catch (err: any) {
          result.warnings.push(`Error querying ${url}: ${err.message}`);
        }
      }
    }

    result.candidates = candidates.slice(0, config.maxCandidatesPerSource);
    result.status = result.candidates.length > 0 ? "working" : "no_candidates";
    result.durationMs = Date.now() - startTime;
    return result;
  }
}
