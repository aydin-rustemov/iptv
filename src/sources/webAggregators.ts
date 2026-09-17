import { chromium, type Browser, type Response } from "playwright";
import type { PlaylistEntry } from "../types.js";
import { isForbiddenUrl } from "../validator.js";
import { SOURCES, type ChannelPage, type Country, type Source } from "./webSources.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MAX_PAGES = Number(process.env["IPTV_WEB_MAX_PAGES_PER_SOURCE"] ?? 600);
const PAGE_CONCURRENCY = Number(process.env["IPTV_WEB_PAGE_CONCURRENCY"] ?? 6);
const SOURCE_CONCURRENCY = Number(process.env["IPTV_WEB_SOURCE_CONCURRENCY"] ?? 2);

export interface WebSourceStatus {
  source: string;
  ok: boolean;
  seedPages: number;
  channelPages: number;
  processedPages: number;
  manifestCandidates: number;
  entries: number;
  error?: string;
}

export interface WebDiscoveryResult {
  entries: PlaylistEntry[];
  statuses: WebSourceStatus[];
}

export async function discoverWebAggregators(): Promise<WebDiscoveryResult> {
  const entries: PlaylistEntry[] = [];
  const statuses: WebSourceStatus[] = [];
  const browser = await chromium.launch({ headless: true }).catch(() => undefined);

  try {
    await runPool(SOURCES, SOURCE_CONCURRENCY, async (source) => {
      try {
        const result = await discoverSource(source, browser);
        entries.push(...result.entries);
        statuses.push(result.status);
        console.log(`[WEB SOURCE ${result.status.ok ? "OK" : "FAILED"}] ${source.name}: ${result.entries.length} candidates; pages ${result.status.processedPages}/${result.status.channelPages}`);
      } catch (err) {
        const error = errText(err);
        statuses.push({ source: source.name, ok: false, seedPages: 0, channelPages: 0, processedPages: 0, manifestCandidates: 0, entries: 0, error });
        console.warn(`[WEB SOURCE FAILED] ${source.name}: ${error}`);
      }
    });
  } finally {
    await browser?.close().catch(() => undefined);
  }

  return { entries: dedupe(entries), statuses: statuses.sort((a, b) => a.source.localeCompare(b.source)) };
}

async function discoverSource(source: Source, browser?: Browser): Promise<{ entries: PlaylistEntry[]; status: WebSourceStatus }> {
  const pages = new Map<string, ChannelPage>();
  let seedPages = 0;
  let firstError: string | undefined;

  for (const seed of source.seeds) {
    try {
      const html = await fetchSeedHtml(seed.url, browser);
      seedPages++;
      collectChannelPages(pages, html, seed.url, seed.country, source);

      if (manifestUrls(html, seed.url).length) {
        pages.set(seed.url, {
          url: seed.url,
          title: pageTitle(html) || source.name,
          country: seed.country
        });
      }
    } catch (err) {
      firstError ??= errText(err);
      console.warn(`[WEB SOURCE] ${source.name} seed failed: ${seed.url} -> ${errText(err)}`);
    }
  }

  const selected = [...pages.values()].slice(0, MAX_PAGES);
  const entries: PlaylistEntry[] = [];
  let manifestCandidates = 0;

  await runPool(selected, PAGE_CONCURRENCY, async (page) => {
    try {
      const found = await pageCandidates(page, browser);
      manifestCandidates += found.length;
      for (const url of found) entries.push(toEntry(source.name, page, url));
    } catch (err) {
      firstError ??= errText(err);
      console.warn(`[WEB SOURCE] ${source.name} page failed: ${page.url} -> ${errText(err)}`);
    }
  });

  const unique = dedupe(entries);
  return {
    entries: unique,
    status: {
      source: source.name,
      ok: seedPages > 0,
      seedPages,
      channelPages: pages.size,
      processedPages: selected.length,
      manifestCandidates,
      entries: unique.length,
      error: seedPages === 0 ? firstError ?? "all_seed_pages_failed" : undefined
    }
  };
}

function collectChannelPages(
  pages: Map<string, ChannelPage>,
  html: string,
  base: string,
  fallbackCountry: Country,
  source: Source
): void {
  for (const link of links(html, base)) {
    if (!allowedHost(link.href, source.hosts) || !channelLike(link.text, link.href)) continue;
    const title = cleanTitle(link.text) || titleFromUrl(link.href);
    if (!title || excluded(title)) continue;
    pages.set(link.href, {
      url: link.href,
      title,
      country: inferCountry(title, link.href, fallbackCountry)
    });
  }
}

async function fetchSeedHtml(url: string, browser?: Browser): Promise<string> {
  try {
    return await fetchText(url);
  } catch (fetchErr) {
    if (!browser) throw fetchErr;
    try {
      const html = await browserHtml(url, browser);
      console.log(`[WEB SEED BROWSER FALLBACK] ${url}`);
      return html;
    } catch (browserErr) {
      throw new Error(`${errText(fetchErr)}; browser=${errText(browserErr)}`);
    }
  }
}

async function browserHtml(url: string, browser: Browser): Promise<string> {
  const context = await browser.newContext({ serviceWorkers: "block", userAgent: UA });
  try {
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    if (!response) throw new Error("browser_no_response");
    if (!response.ok()) throw new Error(`browser_http_${response.status()}`);
    await page.waitForTimeout(1_500);
    return await page.content();
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function pageCandidates(page: ChannelPage, browser?: Browser): Promise<string[]> {
  const found = new Set<string>();
  const html = await fetchText(page.url).catch(() => "");

  manifestUrls(html, page.url).forEach((url) => found.add(url));

  for (const iframe of iframeUrls(html, page.url).slice(0, 5)) {
    const text = await fetchText(iframe, page.url).catch(() => "");
    manifestUrls(text, iframe).forEach((url) => found.add(url));
  }

  const variants = variantUrls(html, page.url).slice(0, 4);
  for (const variant of variants) {
    const text = await fetchText(variant, page.url).catch(() => "");
    manifestUrls(text, variant).forEach((url) => found.add(url));
    for (const iframe of iframeUrls(text, variant).slice(0, 3)) {
      const iframeHtml = await fetchText(iframe, variant).catch(() => "");
      manifestUrls(iframeHtml, iframe).forEach((url) => found.add(url));
    }
  }

  const needsBrowser = found.size === 0 || isVolo(page.url);
  if (browser && needsBrowser) {
    (await captureNetwork(page.url, browser)).forEach((url) => found.add(url));
    for (const variant of variants.slice(0, 2)) {
      (await captureNetwork(variant, browser)).forEach((url) => found.add(url));
    }
  }

  return [...found].filter(publishable);
}

async function captureNetwork(url: string, browser: Browser): Promise<string[]> {
  const found = new Set<string>();
  const context = await browser.newContext({ serviceWorkers: "block", userAgent: UA }).catch(() => undefined);
  if (!context) return [];

  try {
    const page = await context.newPage();
    page.on("response", (response) => { void captureResponse(response, found); });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000);
  } catch {
    // Browser/network failures are source-local and must never abort the update.
  } finally {
    await context.close().catch(() => undefined);
  }

  return [...found];
}

async function captureResponse(response: Response, found: Set<string>): Promise<void> {
  try {
    const type = response.headers()["content-type"] ?? "";
    if (/\.(m3u8|mpd)(?:$|\?)/i.test(response.url()) || /mpegurl|dash\+xml/i.test(type)) found.add(response.url());
    if (!/json|javascript|text\//i.test(type) && !/api|ajax|player|stream|yayin|broadcast/i.test(response.url())) return;
    const text = await response.text();
    manifestUrls(text, response.url()).forEach((url) => found.add(url));
  } catch {
    // Best-effort response inspection.
  }
}

function variantUrls(html: string, base: string): string[] {
  const found = new Set<string>();
  try {
    const url = new URL(base);
    if (url.hostname.endsWith("canlitvvolo.com")) {
      for (const yayin of [1, 2, 3]) {
        const variant = new URL(url);
        variant.searchParams.set("yayin", String(yayin));
        found.add(variant.toString());
      }
    }
  } catch {
    // Ignore malformed base URL.
  }

  for (const link of links(html, base)) {
    if (/yay[ıi]n|alternatif|server\s*[1-9]|source\s*[1-9]/i.test(link.text)) found.add(link.href);
  }
  return [...found];
}

function manifestUrls(text: string, base: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/https?:\\?\/\\?\/[^"'<>\\\s]+?(?:\.m3u8|\.mpd)(?:\?[^"'<>\\\s]*)?/gi)) {
    const url = cleanEmbeddedUrl(match[0]!);
    if (publishable(url)) found.add(url);
  }
  for (const match of text.matchAll(/["']([^"']+(?:\.m3u8|\.mpd)(?:\?[^"']*)?)["']/gi)) {
    try {
      const url = new URL(cleanEmbeddedUrl(match[1]!), base).toString();
      if (publishable(url)) found.add(url);
    } catch {
      // Ignore malformed relative URL.
    }
  }
  return [...found];
}

function links(html: string, base: string): Array<{ href: string; text: string }> {
  return [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap((m) => {
    try {
      return [{ href: new URL(m[1]!, base).toString(), text: strip(m[2] ?? "") }];
    } catch {
      return [];
    }
  });
}

function iframeUrls(html: string, base: string): string[] {
  return [...html.matchAll(/<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/gi)].flatMap((m) => {
    try {
      const url = new URL(m[1]!, base).toString();
      return isForbiddenUrl(url, { allowLivePath: true }) ? [] : [url];
    } catch {
      return [];
    }
  });
}

async function fetchText(url: string, referer?: string): Promise<string> {
  if (isForbiddenUrl(url, { allowLivePath: true })) throw new Error("forbidden_url");
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      ...(referer ? { Referer: referer } : {})
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return await response.text();
}

function publishable(url: string): boolean {
  return /^https?:\/\//i.test(url)
    && !isForbiddenUrl(url, { allowLivePath: true })
    && !/\.(ts|m4s|jpg|jpeg|png|gif|webp)(?:$|\?)/i.test(url)
    && !/license|widevine|playready|drm|doubleclick|googlesyndication|analytics|advert|\/ads?(?:\/|$)/i.test(url)
    && (/\.(m3u8|mpd)(?:$|\?)/i.test(url) || /manifest|playlist|master/i.test(url));
}

function channelLike(text: string, href: string): boolean {
  const value = `${text} ${href}`.toLocaleLowerCase("tr");
  if (/blog|program|yayin-akisi|frekans|iletisim|privacy|gizlilik|dmca|reklam|category|search|arama|favori|reyting/.test(value)) return false;
  if (/\/(?:tag|author|page)\//i.test(href)) return false;
  return /canli|canlı|yayin|yayın|izle|live|watch|online|stream|tv|kanal|channel|spor|sport|haber|news|trt|atv|show|star|arb|cbc|xezer|xəzər|ictimai|aztv|idman|baku|нтв|тнт|рен|стс|россия|первый|пятый|звезда|карусель|матч|мир|iran|persian|irib/i.test(value);
}

function inferCountry(title: string, url: string, fallback: Country): Country {
  const value = `${title} ${url}`.toLocaleLowerCase("tr");

  if (/azerbaycan|azerbaijan|azərbaycan|aztv|xezer|xəzər|ictimai|idman|medeniyyet|mədəniyyət|arb(?:\W|$)|arb24|cbc sport|cbc tv|baku tv|naxcivan|naxçıvan|qafqaz|kepez|kəpəz|kanal s/.test(value)) return "Azərbaycan";
  if (/rusya|russia|russian|россия|первый|пятый|нтв|рен(?:\W|$)|стс|тнт|звезда|карусель|пятница|матч|мир 24|твц|домашний/.test(value)) return "Rusiya";
  if (/\biran\b|iranian|persian|farsi|irib|ifilm|press tv|iran international|voa persian|bbc persian|manoto|gem tv|simaye azadi|jame jam|sahar tv|irinn|شبکه|ایران/.test(value)) return "İran";
  if (/\bturkiye\b|\btürkiye\b|\bturkey\b|\btürk\b|\bturk\b|\btrt\b|\bkanal d\b|\bshow tv\b|\bstar tv\b|\bnow tv\b|\btv8\b|\bteve2\b|\bkanal 7\b|\bbeyaz tv\b|\b360 tv\b|\bcnn türk\b|\bcnn turk\b|\ba haber\b|\bhabertürk\b|\bhaberturk\b|\bhaber global\b|\bhalk tv\b|\btgrt\b|\btv100\b|\btvnet\b|\ba spor\b|\bminika\b|\bdmax\b|\bpower türk\b|\bpowertürk\b|\bnumber 1 türk\b/.test(value)) return "Türkiyə";

  return fallback;
}

function toEntry(sourceName: string, page: ChannelPage, url: string): PlaylistEntry {
  return {
    sourceName,
    tvgId: slug(`${page.country}-${page.title}`),
    tvgName: page.title,
    groupTitle: page.country,
    country: page.country,
    category: category(page.title),
    name: page.title,
    url,
    headers: {},
    candidateReferer: page.url,
    allowLivePath: true
  };
}

function allowedHost(raw: string, hosts: string[]): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function isVolo(raw: string): boolean {
  try {
    return new URL(raw).hostname.endsWith("canlitvvolo.com");
  } catch {
    return false;
  }
}

function pageTitle(html: string): string {
  return cleanTitle(strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""));
}

function titleFromUrl(raw: string): string {
  try {
    return cleanTitle(new URL(raw).pathname.split("/").filter(Boolean).at(-1)?.replace(/[-_]+/g, " ") ?? "");
  } catch {
    return "";
  }
}

function cleanTitle(value: string): string {
  return value.replace(/\b(?:canl[ıi]|yay[ıi]n|izle|watch|online|hd|kesintisiz)\b/giu, " ").replace(/\s+/g, " ").trim();
}

function excluded(value: string): boolean {
  return /radio|fm|webcam|kamera|camera|film|movie|dizi|series|fragman|trailer|vod|maç izle|mac izle/i.test(value);
}

function category(value: string): string {
  const text = value.toLocaleLowerCase("tr");
  if (/haber|xeber|xəbər|news|24/.test(text)) return "News";
  if (/spor|sport|idman|match|матч/.test(text)) return "Sports";
  if (/belgesel|documentary|kultur|kültür|medeniyyet|mədəniyyət/.test(text)) return "Documentary";
  if (/cocuk|çocuk|usaq|uşaq|kids|карусель/.test(text)) return "Children";
  if (/muzik|müzik|musiqi|music|ru tv/.test(text)) return "Music";
  return "General";
}

function cleanEmbeddedUrl(raw: string): string {
  return raw.replace(/\\\//g, "/").replace(/&amp;/g, "&").replace(/\\u0026/g, "&");
}

function strip(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function slug(value: string): string {
  return value.toLocaleLowerCase("tr").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9а-яё]+/giu, "-").replace(/^-|-$/g, "");
}

function dedupe(entries: PlaylistEntry[]): PlaylistEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.sourceName}|${entry.url}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function errText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string } }).cause;
    return cause?.code ? `${cause.code}: ${err.message}` : err.message;
  }
  return String(err);
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const count = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  await Promise.all(Array.from({ length: count }, async () => {
    while (index < items.length) {
      const item = items[index++]!;
      await worker(item);
    }
  }));
}
