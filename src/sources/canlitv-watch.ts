import * as cheerio from "cheerio";
import { chromium } from "playwright";
import type { AppConfig, StreamCandidate } from "../types.js";
import type { SourceAdapter, AdapterResult } from "./source-adapter.js";
import { normalizeChannel } from "../discovery/normalize-channel.js";
import { createSafeContext } from "../discovery/browser-utils.js";
import { captureMediaRequests } from "../discovery/media-request-capture.js";

export class CanlitvWatchAdapter implements SourceAdapter {
  name = "canlitv-watch";
  private baseUrl: string;

  constructor(baseUrl = "https://tr.canlitv.watch") {
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

    try {
      let listHtml = "";
      try {
        const res = await fetch(this.baseUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        });
        result.pagesVisited++;
        if (res.ok) {
          listHtml = await res.text();
        } else {
          result.warnings.push(`List page returned status ${res.status}`);
        }
      } catch (err: any) {
        result.warnings.push(`Fetch failed: ${err.message}`);
      }

      if (!listHtml) {
        result.status = "blocked";
        result.durationMs = Date.now() - startTime;
        return result;
      }

      const $ = cheerio.load(listHtml);
      const channelUrls: string[] = [];

      $("a").each((_, el) => {
        const href = $(el).attr("href");
        if (href) {
          const absoluteUrl = new URL(href, this.baseUrl).toString();
          const path = new URL(absoluteUrl).pathname;
          if (
            path !== "/" &&
            !path.includes("/about") &&
            !path.includes("/privacy") &&
            (path.includes("-izle") || path.includes("/canli-"))
          ) {
            if (!channelUrls.includes(absoluteUrl)) {
              channelUrls.push(absoluteUrl);
            }
          }
        }
      });

      const pagesToVisit = channelUrls.slice(0, config.maxSourcePages);
      if (pagesToVisit.length === 0) {
        result.status = "no_candidates";
        result.durationMs = Date.now() - startTime;
        return result;
      }

      const candidates: StreamCandidate[] = [];
      const pendingPages: string[] = [];

      for (const channelUrl of pagesToVisit) {
        try {
          const res = await fetch(channelUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
          });
          result.pagesVisited++;
          if (res.ok) {
            const html = await res.text();
            const chName = cheerio.load(html)("title").text() || "CanliTV Watch Channel";
            const norm = normalizeChannel(chName);

            const m3u8Regex = /(https?:\/\/[^"'\s>\n]+\.m3u8[^"'\s>]*)/i;
            const match = html.match(m3u8Regex);
            if (match && match[1]) {
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
              continue;
            }

            pendingPages.push(channelUrl);
          }
        } catch {
          pendingPages.push(channelUrl);
        }
      }

      if (pendingPages.length > 0) {
        result.browserUsed = true;
        let browser;
        try {
          browser = await chromium.launch({ headless: true });
          const context = await createSafeContext(browser, ["canlitv.watch"]);

          for (const channelUrl of pendingPages.slice(0, 5)) {
            const page = await context.newPage();
            try {
              const captured = await captureMediaRequests(page, async () => {
                await page.goto(channelUrl, {
                  waitUntil: "domcontentloaded",
                  timeout: config.browserTimeoutMs
                });
                await page.waitForTimeout(config.browserCaptureTimeMs);
              });

              const title = await page.title();
              const norm = normalizeChannel(title || "CanliTV Watch Channel");

              for (const req of captured) {
                if (req.url.includes(".m3u8")) {
                  candidates.push({
                    channelId: norm.id,
                    channelName: norm.name,
                    country: norm.country,
                    category: norm.category,
                    pageUrl: channelUrl,
                    streamUrl: req.url,
                    sourceName: this.name,
                    discoveryMethod: "browser-network",
                    discoveredAt: new Date().toISOString()
                  });
                }
              }
            } catch (err: any) {
              result.warnings.push(`Browser navigation failed: ${err.message}`);
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
