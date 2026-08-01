import * as cheerio from "cheerio";
import { chromium } from "playwright";
import type { AppConfig, StreamCandidate } from "../types.js";
import type { SourceAdapter, AdapterResult } from "./source-adapter.js";
import { normalizeChannel } from "../discovery/normalize-channel.js";
import { createSafeContext } from "../discovery/browser-utils.js";
import { captureMediaRequests } from "../discovery/media-request-capture.js";
import { fetchTextSafe } from "../validation/fetch-manifest.js";

const YODA_STREAM_CHANNELS: Array<{ pattern: string; name: string }> = [
  { pattern: "azertv", name: "AzTV" },
  { pattern: "ictimai", name: "İctimai TV" },
  { pattern: "xezer", name: "Xəzər TV" },
  { pattern: "arb24", name: "ARB24" },
  { pattern: "arb", name: "ARB" },
  { pattern: "space", name: "Space TV" },
  { pattern: "cbc_sport", name: "CBC Sport" },
  { pattern: "cbcsport", name: "CBC Sport" },
  { pattern: "cbc", name: "CBC" },
  { pattern: "idman", name: "İdman TV" },
  { pattern: "medeniyyet", name: "Mədəniyyət TV" },
  { pattern: "kanal-s", name: "Kanal S" },
  { pattern: "kanals", name: "Kanal S" }
];

export class YodaAdapter implements SourceAdapter {
  name = "yoda";
  private baseUrl: string;

  constructor(baseUrl = "https://yoda.az") {
    this.baseUrl = baseUrl;
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
    const diagnostics = {
      channelRecordsFound: 0,
      playerPagesFound: 0,
      playerPagesVisited: 0,
      liveRequestsCaptured: 0,
      archiveRequestsIgnored: 0,
      normalizedPriorityChannels: [] as string[]
    };
    result.diagnostics = diagnostics;

    try {
      // Step 1: Fetch homepage statically
      let homepageHtml = "";
      try {
        const res = await fetchTextSafe(this.baseUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          },
          timeoutMs: config.validationTimeoutMs,
          limitBytes: 2 * 1024 * 1024
        });
        result.pagesVisited++;
        homepageHtml = res.text;
      } catch (err: any) {
        result.warnings.push(`Static fetch failed: ${err.message}`);
      }

      if (!homepageHtml) {
        // If static fetch fails, we treat it as failed or blocked
        result.status = "blocked";
        result.durationMs = Date.now() - startTime;
        return result;
      }

      const $ = cheerio.load(homepageHtml);
      const channelUrls: string[] = [];

      // Find links on homepage
      $("a").each((_, el) => {
        const href = $(el).attr("href");
        if (href) {
          const absoluteUrl = new URL(href, this.baseUrl).toString();
          // Filter to paths on yoda.az that might be channels
          const path = new URL(absoluteUrl).pathname;
          if (
            path !== "/" &&
            !path.includes("/about") &&
            !path.includes("/contact") &&
            !path.includes("/terms") &&
            !path.includes("/privacy") &&
            !path.startsWith("/assets") &&
            path.length > 2
          ) {
            if (!channelUrls.includes(absoluteUrl)) {
              channelUrls.push(absoluteUrl);
            }
          }
        }
      });
      diagnostics.channelRecordsFound = channelUrls.length;
      diagnostics.playerPagesFound = channelUrls.length;

      // Limit pages to visit
      const pagesToVisit = channelUrls.slice(0, config.maxSourcePages);
      if (pagesToVisit.length === 0) {
        result.status = "no_candidates";
        result.durationMs = Date.now() - startTime;
        return result;
      }

      // Step 2: For each channel, try static HTML extraction first
      const candidates: StreamCandidate[] = [];
      const pendingPages: string[] = [];

      for (const channelUrl of pagesToVisit) {
        try {
          const res = await fetchTextSafe(channelUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
            timeoutMs: config.validationTimeoutMs,
            limitBytes: 2 * 1024 * 1024
          });
          result.pagesVisited++;
          {
            const html = res.text;
            const chName = cheerio.load(html)("title").text() || "Yoda Channel";

            // Layer 1 check: Look for HLS links directly in HTML (variables, scripts, elements)
            const m3u8Regex = /(https?:\/\/[^"'\s>\n]+\.m3u8[^"'\s>]*)/i;
            const match = html.match(m3u8Regex);
            if (match && match[1]) {
              const norm = normalizeChannel(inferYodaChannelName(match[1]) ?? chName);
              candidates.push({
                channelId: norm.id,
                channelName: norm.name,
                country: norm.country,
                category: norm.category,
                pageUrl: channelUrl,
                streamUrl: match[1],
                sourceName: this.name,
                discoveryMethod: "html",
                discoveredAt: new Date().toISOString()
              });
            } else {
              pendingPages.push(channelUrl);
            }
          }
        } catch {
          pendingPages.push(channelUrl);
        }
      }

      // Step 3: Use Playwright for pages that failed static extraction
      if (pendingPages.length > 0) {
        result.browserUsed = true;
        let browser;
        try {
          browser = await chromium.launch({ headless: true });
          const context = await createSafeContext(browser, ["yoda.az", "yodacdn.net"]);
          
          for (const channelUrl of pendingPages.slice(0, 5)) { // Max 5 browser checks for performance
            const page = await context.newPage();
            try {
              diagnostics.playerPagesVisited++;
              const captured = await captureMediaRequests(page, async () => {
                await page.goto(channelUrl, {
                  waitUntil: "domcontentloaded",
                  timeout: config.browserTimeoutMs
                });
                // Wait for video player to initialize and trigger requests
                await page.waitForTimeout(config.browserCaptureTimeMs);
              });

              for (const req of captured) {
                if (req.url.includes(".m3u8")) {
                  if (isArchiveRequest(req.url)) {
                    diagnostics.archiveRequestsIgnored++;
                    continue;
                  }
                  diagnostics.liveRequestsCaptured++;
                  const title = inferYodaChannelName(req.url) ?? ((await page.title()) || "Yoda Channel");
                  const norm = normalizeChannel(title);
                  if (!diagnostics.normalizedPriorityChannels.includes(norm.id)) {
                    diagnostics.normalizedPriorityChannels.push(norm.id);
                  }
                  candidates.push({
                    channelId: norm.id,
                    channelName: norm.name,
                    country: norm.country,
                    category: norm.category,
                    pageUrl: channelUrl,
                    streamUrl: req.url,
                    sourceName: this.name,
                    discoveryMethod: "browser-network",
                    discoveredAt: new Date().toISOString(),
                    metadata: {
                      requestResourceType: req.resourceType,
                      responseContentType: req.contentType,
                      requiredHeaderNames: req.headersPresent.customHeaders
                    }
                  });
                }
              }
            } catch (err: any) {
              result.warnings.push(`Browser navigation failed for ${channelUrl}: ${err.message}`);
            } finally {
              await page.close();
            }
          }
          await context.close();
        } catch (err: any) {
          result.warnings.push(`Playwright error: ${err.message}`);
        } finally {
          if (browser) await browser.close();
        }
      }

      result.candidates = candidates.slice(0, config.maxCandidatesPerSource);
      result.status = result.candidates.length > 0 ? "working" : "no_candidates";
    } catch (err: any) {
      result.status = "failed";
      result.warnings.push(err.message);
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }
}

function inferYodaChannelName(streamUrl: string): string | undefined {
  const lower = streamUrl.toLowerCase();
  return YODA_STREAM_CHANNELS.find((entry) => lower.includes(entry.pattern))?.name;
}

function isArchiveRequest(streamUrl: string): boolean {
  const lower = streamUrl.toLowerCase();
  return lower.includes("archive") || lower.includes("timeshift") || lower.includes("record");
}
