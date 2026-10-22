import { chromium, type Browser, type Page } from "playwright";
import type { PlaylistEntry } from "../types.js";
import { isForbiddenUrl } from "../validator.js";
import { isPublishableUrl } from "../playlistGuard.js";

const ROOT = "https://tvstream.az/";
const CHANNELS = [
  { name: "ARB", labels: ["ARB TV", "ARB"] },
  { name: "Space TV", labels: ["SPACE TV", "Space TV"] },
  { name: "AzTV", labels: ["AZTV HD", "AZTV"] },
  { name: "İctimai TV", labels: ["ICTIMAI TV", "İCTİMAİ TV"] },
  { name: "Xəzər TV", labels: ["XƏZƏR TV", "Xəzər TV"] },
  { name: "İdman TV", labels: ["IDMAN TV", "İDMAN TV"] },
  { name: "Real TV", labels: ["REAL TV"] },
  { name: "ARB24", labels: ["ARB 24", "ARB24"] },
  { name: "CBC Sport", labels: ["CBC SPORT", "CBC Sport"] },
  { name: "ATV Azərbaycan", labels: ["ATV"] }
] as const;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function manifestUrls(text: string): string[] {
  return [...text.matchAll(/https?:\\?\/\\?\/[^"'<>\\\s]+?(?:\.m3u8|\.mpd)(?:\?[^"'<>\\\s]*)?/gi)]
    .map((match) => match[0]!.replace(/\\\//g, "/").replace(/&amp;/g, "&"))
    .filter((url) => isPublishableUrl(url) && !isForbiddenUrl(url, { allowLivePath: true }));
}

export async function discoverTvstreamAz(): Promise<{ entries: PlaylistEntry[]; attempted: number; matched: number; reason?: string }> {
  const entries: PlaylistEntry[] = [];
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    for (const channel of CHANNELS) {
      const page = await browser.newPage({ userAgent: UA, serviceWorkers: "block" });
      const found = new Set<string>();
      let clicked = false;
      try {
        page.on("request", (req) => {
          const url = req.url();
          if (/\.(?:m3u8|mpd)(?:$|\?)/i.test(url) && isPublishableUrl(url)) found.add(url);
        });
        page.on("response", (response) => {
          void (async () => {
            try {
              if (/json|javascript/.test(response.headers()["content-type"] ?? "")) {
                for (const url of manifestUrls((await response.text()).slice(0, 200_000))) found.add(url);
              }
            } catch { /* Best effort: streaming responses can be unbounded. */ }
          })();
        });
        const response = await page.goto(ROOT, { waitUntil: "domcontentloaded", timeout: 12_000 });
        if (!response?.ok()) continue;
        await page.waitForTimeout(700);
        // Drop the default playing channel before selecting our named station.
        found.clear();
        for (const label of channel.labels) {
          const candidate = page.getByText(label, { exact: true }).first();
          try {
            if ((await candidate.count()) > 0) {
              await candidate.click({ timeout: 2_500 });
              clicked = true;
              break;
            }
          } catch { /* Try next matching label. */ }
        }
        if (!clicked) continue;
        await page.waitForTimeout(2_000);
        for (const video of await page.locator("video, source").all()) {
          const src = await video.getAttribute("src").catch(() => null);
          if (src) for (const url of manifestUrls(src)) found.add(url);
        }
        for (const url of found) {
          if (!isPublishableUrl(url) || isForbiddenUrl(url, { allowLivePath: true })) continue;
          entries.push({
            sourceName: "tvstream-az",
            tvgName: channel.name, name: channel.name,
            country: "Azərbaycan", groupTitle: "Azərbaycan",
            category: "General", url, headers: {},
            candidateReferer: ROOT, allowLivePath: true
          });
        }
      } catch (error) {
        console.warn("[TVSTREAM]", channel.name, String(error).slice(0, 90));
      } finally {
        await page.close().catch(() => undefined);
      }
    }
    return { entries, attempted: CHANNELS.length, matched: new Set(entries.map((x) => x.name)).size };
  } catch (err) {
    return { entries, attempted: CHANNELS.length, matched: new Set(entries.map((x) => x.name)).size, reason: String(err).slice(0, 150) };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
