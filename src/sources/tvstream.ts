import { chromium, type Browser } from "playwright";
import type { PlaylistEntry } from "../types.js";
import { isForbiddenUrl } from "../validator.js";
import { isPublishableUrl } from "../playlistGuard.js";

const HOME = "https://tvstream.az/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const TVSTREAM_AZ_CHANNELS: ReadonlyArray<{ name: string; label: string; priorityId: string }> = [
  { name: "Xəzər TV", label: "XƏZƏR TV", priorityId: "xezer-tv" },
  { name: "AzTV", label: "AZTV HD", priorityId: "aztv" },
  { name: "İctimai TV", label: "ICTIMAI TV", priorityId: "ictimai-tv" },
  { name: "Real TV", label: "REAL TV", priorityId: "real-tv" },
  { name: "ARB 24", label: "ARB 24", priorityId: "arb24" },
  { name: "İdman TV", label: "IDMAN TV", priorityId: "idman-tv" },
  { name: "CBC Sport", label: "CBC SPORT", priorityId: "cbc-sport" },
  { name: "ARB", label: "ARB TV", priorityId: "arb" },
  { name: "ATV Azərbaycan", label: "ATV", priorityId: "atv-az" },
  { name: "Space TV", label: "SPACE TV", priorityId: "space-tv" }
];

function manifestCandidate(url: string): boolean {
  if (!isPublishableUrl(url)) return false;
  if (isForbiddenUrl(url, { allowLivePath: true })) return false;
  if (/license|widevine|playready|drm|doubleclick|googleads|advert|analytics/i.test(url)) return false;
  return /\.(?:m3u8|mpd)(?:$|\?)/i.test(url);
}

/**
 * TVSTREAM is a single-page player. Its channel cards don't provide a unique
 * href, so a link-only scraper misses ARB/Space. Select each channel and
 * capture only network requests actually issued for its own playback.
 * A fresh page per channel prevents stale previous-channel responses.
 * The validator must still check portability outside this browser session.
 */
export async function discoverTvstreamAz(browser?: Browser): Promise<PlaylistEntry[]> {
  const ownedBrowser = browser ? undefined : await chromium.launch({ headless: true });
  const active = browser ?? ownedBrowser!;
  const results: PlaylistEntry[] = [];
  let next = 0;

  try {
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (next < TVSTREAM_AZ_CHANNELS.length) {
        const channel = TVSTREAM_AZ_CHANNELS[next++]!;
        const context = await active.newContext({ userAgent: UA, serviceWorkers: "block" });
        try {
          const page = await context.newPage();
          const observed = new Set<string>();
          page.on("request", (req) => {
            if (manifestCandidate(req.url())) observed.add(req.url());
          });
          page.on("response", (response) => {
            const type = response.headers()["content-type"] ?? "";
            if (/mpegurl|dash\+xml/i.test(type) && manifestCandidate(response.url())) observed.add(response.url());
          });
          const response = await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 17_000 });
          if (!response?.ok()) throw new Error("page_http_" + response?.status());
          await page.waitForTimeout(1300);
          if (channel.priorityId !== "xezer-tv") {
            observed.clear();
            const name = page.getByText(channel.label, { exact: true }).last();
            try {
              await name.click({ timeout: 4_000 });
            } catch {
              await page.locator('[alt="' + channel.label + '"]').first()
                .click({ timeout: 2_000 }).catch(() => undefined);
            }
          }
          await page.waitForTimeout(3_500);
          const captured = [...observed].filter(manifestCandidate);
          for (const url of captured) {
            results.push({
              sourceName: "tvstream-az",
              tvgId: channel.priorityId,
              tvgName: channel.name,
              name: channel.name,
              country: "Azərbaycan",
              groupTitle: "Azərbaycan",
              category: channel.priorityId === "cbc-sport" || channel.priorityId === "idman-tv" ? "Sports" : "General",
              url,
              headers: {},
              candidateReferer: HOME,
              priorityId: channel.priorityId,
              priorityName: channel.name,
              priorityCountry: "Azərbaycan",
              allowLivePath: true
            });
          }
          console.log("[TVSTREAM] " + channel.name + ": " + captured.length + " HLS/DASH network candidates");
        } catch (error) {
          console.warn("[TVSTREAM FAIL] " + channel.name + ": " + String(error).slice(0, 160));
        } finally {
          await context.close().catch(() => undefined);
        }
      }
    }));
  } finally {
    if (ownedBrowser) await ownedBrowser.close().catch(() => undefined);
  }
  return results;
}
