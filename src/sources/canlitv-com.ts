import * as cheerio from "cheerio";
import { chromium } from "playwright";
import type { AppConfig, StreamCandidate } from "../types.js";
import type { SourceAdapter, AdapterResult } from "./source-adapter.js";
import { getPredefinedChannels, normalizeChannel, normalizeDisplayName } from "../discovery/normalize-channel.js";
import { createSafeContext } from "../discovery/browser-utils.js";
import { captureMediaRequests } from "../discovery/media-request-capture.js";
import { fetchTextSafe } from "../validation/fetch-manifest.js";

const CANLITV_PRIORITY_NAMES = [
  "Xezer Tv",
  "Az TV",
  "ARB TV",
  "Medeniyet Tv",
  "Kanal S Az",
  "CBC Tv",
  "İctimai Tv",
  "Ictimai Tv",
  "CBC Sport",
  "İdman Tv",
  "Idman Tv",
  "Space TV",
  "ARB 24 TV",
  "Dünya TV",
  "Dunya TV",
  "Atv Azad TV",
  "Real Tv",
  "Bakü TV",
  "Baku TV",
  "İctimai Tv",
  "İdman Tv",
  "Dünya TV",
  "Bakü TV",
  "Mədəniyyət Tv",
  "TRT 1",
  "Show TV",
  "Star TV",
  "ATV",
  "Kanal D",
  "NOW TV",
  "TV8",
  "Kanal 7",
  "TRT Haber",
  "CNN Türk",
  "NTV",
  "A Haber",
  "Habertürk TV",
  "Halk TV",
  "Sözcü TV",
  "Haber Global",
  "TV100",
  "Beyaz TV",
  "TRT Spor",
  "A Spor",
  "TRT Belgesel",
  "TRT Çocuk"
];

const CANLITV_CATALOG_PAGES = [
  "https://canlitv.com/tr",
  "https://canlitv.com/tv",
  "https://canlitv.com/turkiye-kanallari",
  "https://canlitv.com/azerbaycan-kanallari",
  "https://canlitv.com/genel-tv-kanallari",
  "https://canlitv.com/haber-kanallari",
  "https://canlitv.com/spor-kanallari"
];

export interface CanlitvChannelLink {
  name: string;
  url: string;
  priority: boolean;
}

export function extractCanlitvChannelLinks(html: string, baseUrl: string): CanlitvChannelLink[] {
  const $ = cheerio.load(html);
  const links = new Map<string, CanlitvChannelLink>();
  $("a").each((_, el) => {
    const href = $(el).attr("href");
    const name = normalizeDisplayName($(el).text().replace(/\s+/g, " ").trim());
    if (!href || !name) return;
    const url = new URL(href, baseUrl).toString();
    const parsed = new URL(url);
    if (parsed.hostname !== new URL(baseUrl).hostname) return;
    if (parsed.pathname === "/" || parsed.pathname === "/tr") return;
    if (parsed.pathname.includes("/about") || parsed.pathname.includes("/privacy") || parsed.pathname.includes("/contact")) return;
    const priority = isCanlitvPriorityName(name) || isConfiguredMainChannel(name);
    const looksLikeChannel = priority || parsed.pathname.includes("-izle") || parsed.pathname.split("/").filter(Boolean).length <= 2;
    if (!looksLikeChannel) return;
    links.set(url, { name, url, priority });
  });
  return [...links.values()].sort((a, b) => Number(b.priority) - Number(a.priority) || a.name.localeCompare(b.name, "tr"));
}

function isCanlitvPriorityName(name: string): boolean {
  const lower = name.toLocaleLowerCase("tr");
  return CANLITV_PRIORITY_NAMES.some((priority) => lower.includes(priority.toLocaleLowerCase("tr")));
}

export class CanlitvComAdapter implements SourceAdapter {
  name = "canlitv-com";
  private baseUrl: string;

  constructor(baseUrl = "https://canlitv.com/tr") {
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
      listPageLoaded: false,
      channelLinksFound: 0,
      priorityLinksFound: 0,
      channelPagesVisited: 0,
      staticStreamsFound: 0,
      iframeStreamsFound: 0,
      browserStreamsFound: 0,
      noStreamPages: [] as string[]
    };
    result.diagnostics = diagnostics;

    try {
      const allLinks: CanlitvChannelLink[] = [];
      for (const pageUrl of new Set([this.baseUrl, ...CANLITV_CATALOG_PAGES])) {
        try {
          const res = await fetchTextSafe(pageUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
            timeoutMs: config.validationTimeoutMs,
            limitBytes: 2 * 1024 * 1024
          });
          result.pagesVisited++;
          diagnostics.listPageLoaded = true;
          allLinks.push(...extractCanlitvChannelLinks(res.text, pageUrl));
        } catch (err: any) {
          result.warnings.push(`Fetch list page failed for ${pageUrl}: ${err.message}`);
        }
      }

      if (allLinks.length === 0) {
        result.status = "blocked";
        result.durationMs = Date.now() - startTime;
        return result;
      }

      const channelLinks = prioritizeCanlitvLinks(allLinks);
      diagnostics.channelLinksFound = channelLinks.length;
      diagnostics.priorityLinksFound = channelLinks.filter((link) => link.priority).length;

      const priorityPages = channelLinks.filter((link) => link.priority).slice(0, 80);
      const nonPriorityPages = channelLinks.filter((link) => !link.priority).slice(0, 20);
      const pagesToVisit = [...priorityPages, ...nonPriorityPages].slice(0, config.maxSourcePages);
      if (pagesToVisit.length === 0) {
        result.status = "no_candidates";
        result.durationMs = Date.now() - startTime;
        return result;
      }

      const candidates: StreamCandidate[] = [];
      const pendingPages: string[] = [];

      // Step 2: Layer 1 & Layer 2 — Fetch channel pages statically and look for iframes/direct URLs
      for (const link of pagesToVisit) {
        const channelUrl = link.url;
        try {
          const res = await fetchTextSafe(channelUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
            timeoutMs: config.validationTimeoutMs,
            limitBytes: 2 * 1024 * 1024
          });
          result.pagesVisited++;
          diagnostics.channelPagesVisited++;
          {
            const html = res.text;
            const chName = getBestCanlitvName(html, link.name);
            const norm = normalizeChannel(chName);

            // Layer 1: Check if .m3u8 is inside the static HTML of page
            const m3u8Regex = /(https?:\/\/[^"'\s>\n]+(?:\.m3u8|\.mpd)[^"'\s>]*)/i;
            const match = html.match(m3u8Regex);
            if (match && match[1]) {
              diagnostics.staticStreamsFound++;
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

            // Layer 2: Check for iframes
            const $page = cheerio.load(html);
            let iframeSrc = "";
            $page("iframe").each((_, el) => {
              const src = $page(el).attr("src");
              if (src && (src.includes("canlitv") || src.includes("youtube.com/embed") === false)) {
                iframeSrc = new URL(src, channelUrl).toString();
              }
            });

            if (iframeSrc) {
              try {
                const iframeRes = await fetchTextSafe(iframeSrc, {
                  headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": channelUrl
                  },
                  timeoutMs: config.validationTimeoutMs,
                  limitBytes: 2 * 1024 * 1024
                });
                result.pagesVisited++;
                {
                  const iframeHtml = iframeRes.text;
                  const iframeMatch = iframeHtml.match(m3u8Regex);
                  if (iframeMatch && iframeMatch[1]) {
                    diagnostics.iframeStreamsFound++;
                    candidates.push({
                      channelId: norm.id,
                      channelName: norm.name,
                      country: norm.country,
                      category: norm.category,
                      pageUrl: channelUrl,
                      streamUrl: iframeMatch[1],
                      sourceName: this.name,
                      discoveryMethod: "iframe",
                      discoveredAt: new Date().toISOString(),
                      metadata: {
                        iframeUrl: iframeSrc
                      }
                    });
                    continue;
                  }
                }
              } catch {
                // Iframe fetch failed, fallback to Playwright
              }
            }

            // Fallback to Playwright
            pendingPages.push(channelUrl);
          }
        } catch {
          pendingPages.push(channelUrl);
        }
      }

      // Step 3: Layer 3 — Playwright Capture
      if (pendingPages.length > 0) {
        result.browserUsed = true;
        let browser;
        try {
          browser = await chromium.launch({ headless: true });
          const context = await createSafeContext(browser, ["canlitv.com", "canlitv.org", "canlitv.me", "canlitv.watch"]);

          for (const channelUrl of selectBrowserPendingPages(pendingPages, pagesToVisit, Math.min(24, config.maxSourcePages))) {
            const page = await context.newPage();
            let pageProducedCandidate = false;
            try {
              const captured = await captureMediaRequests(page, async () => {
                await page.goto(channelUrl, {
                  waitUntil: "domcontentloaded",
                  timeout: config.browserTimeoutMs
                });
                await page.waitForTimeout(config.browserCaptureTimeMs);
              });

              const link = pagesToVisit.find((item) => item.url === channelUrl);
              const title = getBestCanlitvName("", link?.name || (await page.title()) || "CanliTV Channel");
              const norm = normalizeChannel(title);

              for (const req of captured) {
                if (req.url.includes(".m3u8") || req.url.includes(".mpd")) {
                  const acceptedUrl = preferMasterUrl(req.url);
                  diagnostics.browserStreamsFound++;
                  pageProducedCandidate = true;
                  candidates.push({
                    channelId: norm.id,
                    channelName: norm.name,
                    country: norm.country,
                    category: norm.category,
                    pageUrl: channelUrl,
                    streamUrl: acceptedUrl,
                    sourceName: this.name,
                    discoveryMethod: "browser-network",
                    discoveredAt: new Date().toISOString(),
                    metadata: {
                      requestResourceType: req.resourceType,
                      responseContentType: req.contentType,
                      requiredHeaderNames: req.headersPresent.customHeaders,
                      playbackHeaders: req.playbackHeaders,
                      headerRequirements: {
                        requiresUserAgent: !!req.playbackHeaders.userAgent,
                        requiresReferer: req.headersPresent.referer,
                        requiresOrigin: req.headersPresent.origin,
                        requiresCookie: req.headersPresent.cookie,
                        requiresAuthorization: req.headersPresent.authorization
                      }
                    }
                  });
                }
              }
            } catch (err: any) {
              result.warnings.push(`Browser navigation failed for ${channelUrl}: ${err.message}`);
            } finally {
              if (!pageProducedCandidate) diagnostics.noStreamPages.push(channelUrl);
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
      result.status = result.candidates.length > 0 || diagnostics.channelPagesVisited > 0 ? "working" : "no_candidates";
    } catch (err: any) {
      result.status = "failed";
      result.warnings.push(err.message);
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }
}

function getBestCanlitvName(html: string, anchorName?: string): string {
  if (anchorName) return normalizeDisplayName(anchorName);
  if (html) {
    const $ = cheerio.load(html);
    const heading = $("h1").first().text().trim();
    if (heading) return normalizeDisplayName(heading);
    const ogTitle = $('meta[property="og:title"]').attr("content");
    if (ogTitle) return normalizeDisplayName(ogTitle);
    const title = $("title").text().trim();
    if (title) return normalizeDisplayName(title);
  }
  return "Canlitv Channel";
}

function prioritizeCanlitvLinks(links: CanlitvChannelLink[]): CanlitvChannelLink[] {
  const unique = new Map<string, CanlitvChannelLink>();
  for (const link of links) unique.set(link.url, { ...link, priority: link.priority || isConfiguredMainChannel(link.name) });
  return [...unique.values()].sort((a, b) => getLinkRank(a) - getLinkRank(b) || a.name.localeCompare(b.name, "tr"));
}

function getLinkRank(link: CanlitvChannelLink): number {
  const norm = normalizeChannel(link.name);
  if (norm.country === "AZ" && link.priority) return 1;
  if (norm.country === "TR" && link.priority) return 2;
  if (norm.country === "AZ") return 3;
  if (norm.country === "TR") return 4;
  return 5;
}

function isConfiguredMainChannel(name: string): boolean {
  return getPredefinedChannels().some((channel) => channel.enabled && (normalizeChannel(name).id === channel.id));
}

function selectBrowserPendingPages(
  pendingPages: string[],
  allLinks: CanlitvChannelLink[],
  limit: number
): string[] {
  const linkByUrl = new Map(allLinks.map((link) => [link.url, link]));
  const unique = [...new Set(pendingPages)];
  const az = unique.filter((url) => normalizeChannel(linkByUrl.get(url)?.name ?? url).country === "AZ").slice(0, 10);
  const tr = unique.filter((url) => normalizeChannel(linkByUrl.get(url)?.name ?? url).country === "TR").slice(0, 14);
  const selected = [...az, ...tr];
  for (const url of unique) {
    if (selected.length >= limit) break;
    if (!selected.includes(url)) selected.push(url);
  }
  return selected.slice(0, limit);
}

function preferMasterUrl(url: string): string {
  return url.replace(/\/chunklist[^/?]*\.m3u8/i, "/playlist.m3u8");
}
