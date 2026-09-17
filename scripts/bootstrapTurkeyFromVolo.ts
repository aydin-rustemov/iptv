import fs from "node:fs";
import { chromium, type Browser, type Page, type Response } from "playwright";
import { parseM3u, normalizeCountry } from "../src/parser.js";
import { writePlaylist } from "../src/generator.js";
import { fastCheck, mediaCheck } from "../src/validator.js";
import { loadPriorityChannels, normalizeName } from "../src/priority.js";
import { forcedPublishedOverrides, loadManualOverrides } from "../src/manualOverrides.js";
import { score } from "../src/selector.js";
import type { PlaylistEntry, PriorityChannel, ValidatedEntry } from "../src/types.js";

const PLAYLIST = "output/playlist.m3u";
const STATUS = "output/turkey-volo-bootstrap.json";
const VOLO = "https://tv.canlitvvolo.com";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const LIST_PAGES = 23;
const CHANNEL_CONCURRENCY = Number(process.env["VOLO_BOOTSTRAP_CONCURRENCY"] ?? 8);

type PlayerJson = Record<string, unknown> & { streamUrl?: string; channelName?: string };

interface BootstrapStatus {
  updatedAt: string;
  listPages: number;
  channelPagesDiscovered: number;
  turkeyPagesClassified: number;
  workingTurkeyChannels: number;
  failedTurkeyChannels: number;
  preservedNonTurkeyChannels: number;
  finalPublished: number;
  failed: Array<{ page: string; name?: string; reason: string }>;
}

async function main(): Promise<void> {
  fs.mkdirSync("output", { recursive: true });
  const current = fs.existsSync(PLAYLIST) ? parseM3u(fs.readFileSync(PLAYLIST, "utf8"), "existing-playlist") : [];
  const priorities = loadPriorityChannels();
  const trPriorities = priorities.filter((item) => normalizeCountry(item.country) === "Türkiyə");
  const locked = forcedPublishedOverrides(loadManualOverrides());

  const browser = await chromium.launch({ headless: true });
  try {
    const pages = await discoverVoloChannelPages(browser);
    console.log(`[VOLO BASELINE] discovered ${pages.length} channel pages from ${LIST_PAGES} list pages.`);

    const results: Array<ValidatedEntry | undefined> = new Array(pages.length);
    const failures: BootstrapStatus["failed"] = [];
    let turkeyPagesClassified = 0;

    await runPool(pages, CHANNEL_CONCURRENCY, async (item, index) => {
      try {
        const result = await processChannel(browser, item.url, item.text, trPriorities, current);
        if (result.classifiedTurkey) turkeyPagesClassified++;
        if (result.entry) {
          results[index] = result.entry;
          console.log(`[VOLO OK] ${result.entry.name}: ${safeHost(result.entry.url)}`);
        } else if (result.classifiedTurkey) {
          failures.push({ page: item.url, name: result.name, reason: result.reason ?? "no_working_stream" });
          console.warn(`[VOLO FAILED] ${result.name ?? item.url}: ${result.reason ?? "no_working_stream"}`);
        }
      } catch (err) {
        failures.push({ page: item.url, reason: errText(err) });
        console.warn(`[VOLO PAGE ERROR] ${item.url}: ${errText(err)}`);
      }
    });

    const turkey = dedupeTurkey(results.filter((item): item is ValidatedEntry => Boolean(item)));
    const nonTurkey = buildNonTurkeyBaseline(current, locked);
    const finalEntries = [...nonTurkey, ...turkey];

    if (fs.existsSync(PLAYLIST)) fs.copyFileSync(PLAYLIST, "output/playlist.previous.m3u");
    writePlaylist(finalEntries);

    const status: BootstrapStatus = {
      updatedAt: new Date().toISOString(),
      listPages: LIST_PAGES,
      channelPagesDiscovered: pages.length,
      turkeyPagesClassified,
      workingTurkeyChannels: turkey.length,
      failedTurkeyChannels: failures.length,
      preservedNonTurkeyChannels: nonTurkey.length,
      finalPublished: finalEntries.length,
      failed: failures.slice(0, 250)
    };
    fs.writeFileSync(STATUS, JSON.stringify(status, null, 2), "utf8");
    console.log(`[VOLO BASELINE DONE] Turkish=${turkey.length} non-Turkish=${nonTurkey.length} final=${finalEntries.length}`);
    console.log(JSON.stringify(status, null, 2));

    if (turkey.length < 20) {
      throw new Error(`safety_stop_only_${turkey.length}_working_turkish_channels`);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function discoverVoloChannelPages(browser: Browser): Promise<Array<{ url: string; text: string }>> {
  const context = await browser.newContext({ userAgent: USER_AGENT, serviceWorkers: "block" });
  const found = new Map<string, string>();
  try {
    const page = await context.newPage();
    for (let n = 1; n <= LIST_PAGES; n++) {
      const urls = [
        `${VOLO}/?sayfa=${n}`,
        `${VOLO}/canli-tv-list?sayfa=${n}`
      ];
      let loaded = false;
      for (const url of urls) {
        try {
          const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
          if (!response?.ok()) continue;
          await page.waitForTimeout(500);
          const links = await page.locator("a").evaluateAll((anchors) => anchors.map((a) => ({
            href: (a as HTMLAnchorElement).href,
            text: (a.textContent ?? "").replace(/\s+/g, " ").trim()
          })));
          for (const link of links) {
            if (!isVoloChannelPage(link.href, link.text)) continue;
            const clean = stripTracking(link.href);
            if (!found.has(clean)) found.set(clean, link.text);
          }
          console.log(`[VOLO LIST] page=${n} links=${found.size}`);
          loaded = true;
          break;
        } catch {
          // Try the alternate list URL.
        }
      }
      if (!loaded) console.warn(`[VOLO LIST FAILED] page=${n}`);
    }
  } finally {
    await context.close().catch(() => undefined);
  }
  return [...found].map(([url, text]) => ({ url, text }));
}

function isVoloChannelPage(raw: string, text: string): boolean {
  try {
    const url = new URL(raw);
    if (url.hostname !== "tv.canlitvvolo.com") return false;
    const path = url.pathname.toLowerCase();
    if (path === "/" || path.includes("canli-tv-list") || path.includes("yayin-akisi")) return false;
    if (/iletisim|gizlilik|privacy|dmca|hakkimizda|kategori|category|arama|search|favori|reklam/.test(path)) return false;
    const value = `${path} ${text}`.toLocaleLowerCase("tr");
    return /tv|kanal|trt|atv|show|star|haber|spor|cocuk|çocuk|muzik|müzik|canli|canlı|izle|hd/.test(value);
  } catch {
    return false;
  }
}

async function processChannel(
  browser: Browser,
  baseUrl: string,
  hint: string,
  trPriorities: PriorityChannel[],
  current: PlaylistEntry[]
): Promise<{ classifiedTurkey: boolean; entry?: ValidatedEntry; name?: string; reason?: string }> {
  const context = await browser.newContext({ userAgent: USER_AGENT, serviceWorkers: "block" });
  const page = await context.newPage();
  const captured = new Set<string>();
  let name = cleanChannelName(hint || titleFromUrl(baseUrl));
  let body = "";

  page.on("response", (response) => { void captureResponse(response, captured); });
  try {
    for (const yayin of [1, 2, 3]) {
      captured.clear();
      const url = new URL(baseUrl);
      url.searchParams.set("yayin", String(yayin));
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(1_500);

      const h1 = cleanChannelName(await page.locator("h1").first().textContent().catch(() => "") || "");
      if (h1) name = h1;
      if (yayin === 1) {
        body = (await page.locator("body").textContent().catch(() => ""))?.slice(0, 18_000) ?? "";
        const classifiedTurkey = isTurkishChannel(name, baseUrl, body, trPriorities);
        if (!classifiedTurkey) return { classifiedTurkey: false, name };
      }

      const html = await page.content().catch(() => "");
      collectManifestStrings(html, baseUrl, captured);
      const candidates = [...captured].filter((candidate) => /^https?:\/\//i.test(candidate));
      for (const streamUrl of candidates) {
        const entry = buildTurkeyEntry(name, baseUrl, streamUrl, trPriorities, current);
        const validated = await validateCandidate(entry);
        if (validated) return { classifiedTurkey: true, entry: validated, name };
      }
    }
    return { classifiedTurkey: true, name, reason: "all_yayin_alternatives_failed" };
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function captureResponse(response: Response, out: Set<string>): Promise<void> {
  try {
    const url = response.url();
    const type = response.headers()["content-type"] ?? "";
    if (/\.(m3u8|mpd)(?:$|\?)/i.test(url) || /mpegurl|dash\+xml/i.test(type)) out.add(url);
    if (!/json/i.test(type) && !/api|ajax|player|stream|yayin|broadcast/i.test(url)) return;
    const data = await response.json().catch(() => undefined);
    collectStreamUrls(data, out);
  } catch {
    // Best effort network capture.
  }
}

function collectStreamUrls(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 8 || value == null) return;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && (/\.m3u8|\.mpd|manifest|playlist/i.test(value))) out.add(value.replace(/\\\//g, "/"));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStreamUrls(item, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectStreamUrls(item, out, depth + 1);
  }
}

function collectManifestStrings(html: string, base: string, out: Set<string>): void {
  for (const match of html.matchAll(/https?:\\?\/\\?\/[^"'<>\\\s]+?(?:\.m3u8|\.mpd)(?:\?[^"'<>\\\s]*)?/gi)) {
    out.add(match[0]!.replace(/\\\//g, "/").replace(/&amp;/g, "&"));
  }
  for (const match of html.matchAll(/["']([^"']+(?:\.m3u8|\.mpd)(?:\?[^"']*)?)["']/gi)) {
    try { out.add(new URL(match[1]!, base).toString()); } catch { /* ignore */ }
  }
}

async function validateCandidate(entry: PlaylistEntry): Promise<ValidatedEntry | undefined> {
  const fast = await fastCheck(entry);
  if (!fast.ok) return undefined;
  const media = await mediaCheck(entry, fast);
  if (!media.ok) return undefined;

  // Retest after the first media check so a short-lived browser/session URL is not
  // accepted as the baseline channel URL.
  const retestFast = await fastCheck(entry);
  if (!retestFast.ok) return undefined;
  const retestMedia = await mediaCheck(entry, retestFast);
  if (!retestMedia.ok) return undefined;

  return {
    ...entry,
    headers: { ...entry.headers },
    normalizedUrl: normalizeUrl(entry.url),
    fast: retestFast,
    media: retestMedia,
    score: score(entry, retestMedia, retestFast.latencyMs)
  };
}

function buildTurkeyEntry(
  name: string,
  pageUrl: string,
  streamUrl: string,
  priorities: PriorityChannel[],
  current: PlaylistEntry[]
): PlaylistEntry {
  const priority = matchTurkeyPriority(name, priorities);
  const currentMatch = findCurrentTurkey(name, priority, current);
  const canonicalName = priority?.name ?? currentMatch?.tvgName ?? currentMatch?.name ?? name;
  return {
    sourceName: "canlitv-volo-baseline",
    tvgId: priority?.id ?? currentMatch?.tvgId ?? slug(canonicalName),
    tvgName: canonicalName,
    tvgLogo: currentMatch?.tvgLogo,
    groupTitle: "Türkiyə",
    country: "Türkiyə",
    category: categoryName(priority?.category, canonicalName),
    name: canonicalName,
    url: streamUrl,
    headers: {},
    candidateReferer: pageUrl,
    allowLivePath: true,
    priorityId: priority?.id,
    priorityName: priority?.name,
    priorityCountry: priority?.country,
    priorityCategory: priority?.category,
    priorityOrder: priority?.priority
  };
}

function isTurkishChannel(name: string, url: string, body: string, priorities: PriorityChannel[]): boolean {
  if (matchTurkeyPriority(name, priorities)) return true;
  const value = `${name} ${url}`.toLocaleLowerCase("tr");
  const pageText = body.toLocaleLowerCase("tr");

  if (/azerbaycan|azerbaijan|azərbaycan|\baz\b|xezer|xəzər|ictimai|arb(?:\W|$)|space tv az|cbc sport az|baku tv|naxcivan|naxçıvan|qafqaz|qəbələ|kepez|kəpəz|gunaz|günaz/.test(value)) return false;
  if (/rusya|russia|russian|россия|первый|пятый|нтв|тнт|стс|звезда|карусель/.test(value)) return false;
  if (/\biran\b|iranian|persian|farsi|irib|ifilm|press tv|manoto|gem tv|persiana|sahar/.test(value)) return false;
  if (/germany|deutsch|france|italy|spain|ukraine|georgia|armenia|kazakh|uzbek|kyrgyz|pakistan|india|afghan|iraq|syria|lebanon|egypt|arabia|arabic|romania|bulgaria|serbia|croatia|greece|albania|usa|canada|brazil|argentina|mexico/.test(value)) return false;

  if (/\bturkiye\b|\btürkiye\b|\bturkey\b|\btürk\b|\bturk\b|\btrt\b|\bkanal d\b|\bshow tv\b|\bstar tv\b|\bnow tv\b|\btv8\b|\bteve2\b|\bkanal 7\b|\bbeyaz tv\b|\b360 tv\b|\bcnn türk\b|\ba haber\b|\bhabertürk\b|\bhaber global\b|\bhalk tv\b|\btgrt\b|\btv100\b|\btvnet\b|\ba spor\b|\bminika\b|\bdmax\b|\btele1\b|\bulusal kanal\b|\bvav tv\b|\bakit tv\b|\bblt türk\b|\bbbn türk\b/.test(value)) return true;
  if (/alanya|malatya|kayseri|kocaeli|konya|trabzon|izmir|istanbul|van(?:\W|$)|maraş|maras|tokat|sivas|ankara|ege(?:\W|$)|karadeniz|bursa|mersin|adana|antalya|samsun|erzurum|diyarbakir|diyarbakır|gaziantep|denizli|çorum|corum|bolu|ordu|rize|sakarya|tekirdağ|tekirdag|manisa|balıkesir|balikesir|eskişehir|eskisehir|kütahya|kutahya|afyon|aydın|aydin|muğla|mugla/.test(value)) return true;

  // Many local Turkish Volo pages use this exact explanatory language. Only use
  // it after explicit foreign-country checks above.
  if (/türkiye'nin|türkiye'de|türk televizyon|yerel türk kanalları|türkiye merkezli|türkiye'den yayın/.test(pageText)) return true;
  return false;
}

function matchTurkeyPriority(name: string, priorities: PriorityChannel[]): PriorityChannel | undefined {
  const normalized = simplified(name);
  return priorities.find((priority) => [priority.name, ...priority.aliases].some((alias) => {
    const candidate = simplified(alias);
    return candidate === normalized || (candidate.length >= 4 && normalized.includes(candidate));
  }));
}

function findCurrentTurkey(name: string, priority: PriorityChannel | undefined, current: PlaylistEntry[]): PlaylistEntry | undefined {
  const normalized = simplified(name);
  return current.find((entry) => {
    if (normalizeCountry(entry.country ?? entry.groupTitle) !== "Türkiyə") return false;
    if (priority && (entry.priorityId === priority.id || entry.tvgId === priority.id)) return true;
    return simplified(entry.tvgName ?? entry.name) === normalized || simplified(entry.name) === normalized;
  });
}

function dedupeTurkey(entries: ValidatedEntry[]): ValidatedEntry[] {
  const best = new Map<string, ValidatedEntry>();
  for (const entry of entries) {
    const key = entry.priorityId ? `p:${entry.priorityId}` : `n:${simplified(entry.tvgName ?? entry.name)}`;
    const existing = best.get(key);
    const portability = (item: ValidatedEntry) => item.score - Object.keys(item.headers).length * 100;
    if (!existing || portability(entry) > portability(existing)) best.set(key, entry);
  }
  return [...best.values()];
}

function buildNonTurkeyBaseline(current: PlaylistEntry[], locked: ValidatedEntry[]): ValidatedEntry[] {
  const lockedNames = new Set(locked.map((entry) => `${normalizeCountry(entry.country)}:${simplified(entry.tvgName ?? entry.name)}`));
  const seen = new Set<string>();
  const output: ValidatedEntry[] = [];

  for (const entry of current) {
    if (normalizeCountry(entry.country ?? entry.groupTitle) === "Türkiyə") continue;
    if (isJunkName(entry.tvgName ?? entry.name)) continue;
    const identity = `${normalizeCountry(entry.country ?? entry.groupTitle)}:${simplified(entry.tvgName ?? entry.name)}`;
    if (lockedNames.has(identity) || seen.has(identity)) continue;
    seen.add(identity);
    output.push(asValidated(entry));
  }

  for (const entry of locked) {
    if (normalizeCountry(entry.country ?? entry.groupTitle) === "Türkiyə") continue;
    const identity = `${normalizeCountry(entry.country)}:${simplified(entry.tvgName ?? entry.name)}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    output.push(entry);
  }
  return output;
}

function asValidated(entry: PlaylistEntry): ValidatedEntry {
  return {
    ...entry,
    headers: { ...entry.headers },
    normalizedUrl: normalizeUrl(entry.url),
    score: 0,
    fast: { ok: true, finalUrl: entry.url, latencyMs: 0 },
    media: { ok: true, hasVideo: true, hasAudio: true, bytesRead: 0 }
  };
}

function cleanChannelName(value: string): string {
  return value
    .replace(/\bcanl[ıi]\s*(?:izle|yay[ıi]n)?\b/giu, " ")
    .replace(/\b(?:izle|kesintisiz|online)\b/giu, " ")
    .replace(/\s+hd\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function categoryName(priorityCategory: string | undefined, name: string): string {
  if (priorityCategory === "news") return "News";
  if (priorityCategory === "sports") return "Sports";
  if (priorityCategory === "documentary" || priorityCategory === "culture") return "Documentary";
  if (priorityCategory === "children") return "Children";
  if (priorityCategory === "music") return "Music";
  const value = name.toLocaleLowerCase("tr");
  if (/haber|news|24|tele1|tv100|ntv/.test(value)) return "News";
  if (/spor|sport|idman|ht spor/.test(value)) return "Sports";
  if (/belgesel|kültür|kultur/.test(value)) return "Documentary";
  if (/çocuk|cocuk|minika|kids/.test(value)) return "Children";
  if (/müzik|muzik|music|power türk|number 1/.test(value)) return "Music";
  return "General";
}

function simplified(value: string): string {
  return normalizeName(value)
    .replace(/\b(?:canli|live|izle|seyret|yayin|yayini|hd|fhd|fullhd|full hd)\b/g, " ")
    .replace(/\btv\b$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isJunkName(value: string): boolean {
  const name = normalizeName(value);
  return /sitene tv ekle|indi izle|şimdi izle|simdi izle|canli izle|canli tv izle|youtube canli tv izle|kanal ara|tikla izle/.test(name);
}

function stripTracking(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.search = "";
  return url.toString();
}

function titleFromUrl(raw: string): string {
  try { return new URL(raw).pathname.split("/").filter(Boolean).at(-1)?.replace(/[-_]+/g, " ") ?? ""; }
  catch { return ""; }
}

function slug(value: string): string {
  return simplified(value).replace(/[^a-z0-9а-яё]+/giu, "-").replace(/^-|-$/g, "");
}

function normalizeUrl(raw: string): string {
  try { return new URL(raw).toString().toLowerCase(); }
  catch { return raw.toLowerCase(); }
}

function safeHost(raw: string): string {
  try { return new URL(raw).hostname; }
  catch { return raw; }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let index = 0;
  const count = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  await Promise.all(Array.from({ length: count }, async () => {
    while (index < items.length) {
      const current = index++;
      await worker(items[current]!, current);
    }
  }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
