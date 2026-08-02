import fs from "node:fs";
import path from "node:path";
import { chromium, type Response } from "playwright";
import type { PlaylistEntry } from "../types.js";
import { isForbiddenUrl } from "../validator.js";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const BASE = "https://web.canlitv.az";
const COUNTRY_SOURCES: Array<{ country: "AZ" | "TR" | "RU"; name: string; url: string }> = [
  { country: "AZ", name: "Azərbaycan", url: `${BASE}/azerbaycan-tv-kanallari.html` },
  { country: "TR", name: "Türkiyə", url: `${BASE}/turkiye-tv-kanallari.html` },
  { country: "RU", name: "Rusiya", url: `${BASE}/rusya-tv-kanallari.html` }
];

export interface CanliTvDiscoveryResult {
  entries: PlaylistEntry[];
  status: CanliTvStatus;
}

export interface CanliTvStatus {
  updatedAt: string;
  countryPages: Record<string, number>;
  channelPages: Record<string, number>;
  excludedPages: number;
  processedPages: number;
  manifestCandidatesCaptured: number;
  verifiedDirectChannels: number;
  unverifiedFallbackChannels: number;
  tokenDependentRejected: number;
  cookieOriginAccountRejected: number;
  noManifestChannels: number;
  channels: CanliTvChannelStatus[];
}

interface CanliTvChannelStatus {
  canonicalId: string;
  name: string;
  country: string;
  sourcePage: string;
  variantsChecked: number;
  manifestCandidatesFound: number;
  selectedCandidate?: string;
  selectedSource: string;
  verificationStatus: "candidate" | "unverified_canlitv_fallback" | "no_manifest" | "excluded";
  tokenClassification: "stable" | "refreshable_long_lived" | "short_lived" | "ip_bound" | "user_agent_bound" | "browser_session_bound" | "unknown_token";
  lastSuccessAt?: string;
  lastFailureReason?: string;
  published: boolean;
}

interface ChannelPage {
  url: string;
  title: string;
  country: "AZ" | "TR" | "RU";
  countryName: string;
}

export async function discoverCanliTvAz(options: { full?: boolean } = {}): Promise<CanliTvDiscoveryResult> {
  const pages = await discoverChannelPages();
  const limit = options.full ? Math.min(Number(process.env["IPTV_CANLITV_MAX_PAGES"] ?? 220), pages.channels.length) : Number(process.env["IPTV_CANLITV_REFRESH_PAGES"] ?? 90);
  const selectedPages = pages.channels.slice(0, limit);
  const channelStatuses: CanliTvChannelStatus[] = [];
  const entries: PlaylistEntry[] = [];
  let manifestCandidatesCaptured = 0;
  const browser = await chromium.launch({ headless: true }).catch(() => undefined);

  try {
    await runPool(selectedPages, 2, async (page) => {
      await delay(250);
      const result = await extractChannel(page, browser);
      manifestCandidatesCaptured += result.candidates.length;
      channelStatuses.push(result.status);
      entries.push(...result.entries);
    });
  } finally {
    await browser?.close().catch(() => undefined);
  }

  const status: CanliTvStatus = {
    updatedAt: new Date().toISOString(),
    countryPages: pages.countryPages,
    channelPages: pages.channelPages,
    excludedPages: pages.excluded,
    processedPages: selectedPages.length,
    manifestCandidatesCaptured,
    verifiedDirectChannels: 0,
    unverifiedFallbackChannels: entries.filter((entry) => entry.sourceName === "canlitv-az-unverified").length,
    tokenDependentRejected: channelStatuses.filter((item) => ["short_lived", "ip_bound", "user_agent_bound", "browser_session_bound"].includes(item.tokenClassification)).length,
    cookieOriginAccountRejected: 0,
    noManifestChannels: channelStatuses.filter((item) => item.verificationStatus === "no_manifest").length,
    channels: channelStatuses.sort((a, b) => countryRank(a.country) - countryRank(b.country) || a.name.localeCompare(b.name))
  };
  writeCanliTvArtifacts(status, entries);
  return { entries, status };
}

async function discoverChannelPages(): Promise<{ channels: ChannelPage[]; countryPages: Record<string, number>; channelPages: Record<string, number>; excluded: number }> {
  const byUrl = new Map<string, ChannelPage>();
  const countryPages: Record<string, number> = {};
  let excluded = 0;
  for (const source of COUNTRY_SOURCES) {
    const pageUrls = await discoverPagination(source.url);
    countryPages[source.name] = pageUrls.length;
    for (const pageUrl of pageUrls) {
      const html = await fetchText(pageUrl);
      for (const link of extractLinks(html, pageUrl)) {
        if (!isCanliTvChannelUrl(link.href)) continue;
        const title = channelTitle(link.text, link.href);
        if (isExcludedChannel(title, link.href, source.country)) {
          excluded++;
          continue;
        }
        byUrl.set(link.href, { url: link.href, title, country: source.country, countryName: source.name });
      }
    }
  }
  const channels = [...byUrl.values()].sort((a, b) => countryRank(a.countryName) - countryRank(b.countryName) || a.title.localeCompare(b.title));
  return {
    channels,
    countryPages,
    channelPages: countBy(channels, (page) => page.countryName),
    excluded
  };
}

async function discoverPagination(firstPage: string): Promise<string[]> {
  const html = await fetchText(firstPage);
  const urls = new Set<string>([firstPage]);
  for (const link of extractLinks(html, firstPage)) {
    if (sameCountryPage(firstPage, link.href)) urls.add(link.href);
  }
  return [...urls].sort();
}

async function extractChannel(page: ChannelPage, browser?: Awaited<ReturnType<typeof chromium.launch>>): Promise<{ entries: PlaylistEntry[]; candidates: string[]; status: CanliTvChannelStatus }> {
  const candidates: string[] = [];
  const html = await fetchText(page.url).catch(() => "");
  for (const url of extractManifestUrls(html, page.url)) candidates.push(url);
  const iframes = extractIframes(html, page.url).slice(0, 4);
  for (const iframe of iframes) {
    const iframeHtml = await fetchText(iframe, page.url).catch(() => "");
    for (const url of extractManifestUrls(iframeHtml, iframe)) candidates.push(url);
  }
  for (const url of await captureWithPlaywright(page.url, iframes, browser)) candidates.push(url);
  const uniqueCandidates = dedupeCandidates(candidates).filter(isPublishableManifestCandidate);
  const lastCandidate = uniqueCandidates.at(-1);
  const tokenClassification = classifyToken(lastCandidate);
  const entries = uniqueCandidates.map((url, index) => entryFromCandidate(page, url, index === uniqueCandidates.length - 1 && uniqueCandidates.length > 0));
  return {
    entries,
    candidates: uniqueCandidates,
    status: {
      canonicalId: slug(`${page.country}-${page.title}`),
      name: page.title,
      country: page.countryName,
      sourcePage: page.url,
      variantsChecked: Math.max(1, iframes.length),
      manifestCandidatesFound: uniqueCandidates.length,
      selectedCandidate: redactUrl(lastCandidate),
      selectedSource: uniqueCandidates.length ? "canlitv-az" : "none",
      verificationStatus: uniqueCandidates.length ? "candidate" : "no_manifest",
      tokenClassification,
      lastFailureReason: uniqueCandidates.length ? undefined : "no_channel_manifest_captured",
      published: false
    }
  };
}

async function captureWithPlaywright(pageUrl: string, iframeUrls: string[], browser?: Awaited<ReturnType<typeof chromium.launch>>): Promise<string[]> {
  const found: string[] = [];
  const ownsBrowser = !browser;
  const activeBrowser = browser ?? await chromium.launch({ headless: true });
  try {
    const context = await activeBrowser.newContext({ serviceWorkers: "block", userAgent: USER_AGENT });
    const page = await context.newPage();
    const capture = async (response: Response): Promise<void> => {
      const url = response.url();
      const contentType = response.headers()["content-type"] ?? "";
      if (isManifestLike(url, contentType) && !isSegmentUrl(url)) found.push(url);
    };
    page.on("response", (response) => { void capture(response); });
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
    await page.waitForTimeout(2_500);
    for (const iframe of iframeUrls.slice(0, 2)) {
      await page.goto(iframe, { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
      await page.waitForTimeout(2_000);
    }
    await context.close().catch(() => undefined);
  } catch {
    // Playwright is best-effort for fallback discovery.
  } finally {
    if (ownsBrowser) await activeBrowser.close().catch(() => undefined);
  }
  return found;
}

function entryFromCandidate(page: ChannelPage, url: string, isLast: boolean): PlaylistEntry {
  const unverified = isLast;
  return {
    sourceName: unverified ? "canlitv-az-unverified" : "canlitv-az",
    tvgId: slug(`${page.country}-${page.title}`),
    tvgName: unverified ? `⚠ ${page.title}` : page.title,
    groupTitle: unverified ? `${page.countryName} — Yoxlanılmamış` : groupTitle(page.countryName, page.title),
    country: page.countryName,
    category: categoryFromTitle(page.title),
    name: unverified ? `⚠ ${page.title}` : page.title,
    url,
    headers: {},
    candidateReferer: page.url,
    allowLivePath: true
  };
}

function extractLinks(html: string, base: string): Array<{ href: string; text: string }> {
  return [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap((match) => {
    try {
      return [{
        href: new URL(match[1]!, base).toString(),
        text: stripTags(match[2] ?? "")
      }];
    } catch {
      return [];
    }
  });
}

function extractIframes(html: string, base: string): string[] {
  return [...html.matchAll(/<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/gi)].flatMap((match) => {
    try {
      const url = new URL(match[1]!, base).toString();
      return isForbiddenUrl(url, { allowLivePath: true }) ? [] : [url];
    } catch {
      return [];
    }
  });
}

function extractManifestUrls(text: string, base: string): string[] {
  const urls = new Set<string>();
  for (const match of text.matchAll(/https?:\\?\/\\?\/[^"'<>\\\s]+?(?:\.m3u8|\.mpd)(?:\?[^"'<>\\\s]*)?/gi)) {
    const cleaned = cleanEmbeddedUrl(match[0]!);
    if (isPublishableManifestCandidate(cleaned)) urls.add(cleaned);
  }
  for (const match of text.matchAll(/["']([^"']+(?:\.m3u8|\.mpd)(?:\?[^"']*)?)["']/gi)) {
    try {
      const url = new URL(cleanEmbeddedUrl(match[1]!), base).toString();
      if (isPublishableManifestCandidate(url)) urls.add(url);
    } catch {
      // ignore relative garbage
    }
  }
  return [...urls];
}

async function fetchText(url: string, referer?: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, ...(referer ? { Referer: referer } : {}) },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return await response.text();
}

function sameCountryPage(firstPage: string, href: string): boolean {
  const first = new URL(firstPage);
  const url = new URL(href);
  return url.origin === first.origin && url.pathname === first.pathname && (!url.search || url.searchParams.has("sayfa"));
}

function isCanliTvChannelUrl(href: string): boolean {
  const url = new URL(href);
  if (url.origin !== BASE) return false;
  if (!url.pathname.endsWith(".html")) return false;
  if (/kanallari|frekans|favori|reyting|hakkinda|iletisim|arama|blog/i.test(url.pathname)) return false;
  return /canli-izle|hd-canli-izle|canli-yayim/i.test(url.pathname);
}

function isExcludedChannel(title: string, href: string, country: "AZ" | "TR" | "RU"): boolean {
  const value = `${title} ${href}`.toLocaleLowerCase("tr");
  if (/\b(radio|fm|webcam|kamera|camera)\b/.test(value)) return true;
  if (/dublaj|film|filim|movie|episode|bolum|bölüm|fragman|trailer|vod/.test(value)) return true;
  if (/ufc|canli mac|canlı maç|\bvs\b|match day|tek mac|tek maç/.test(value)) return true;
  if (/bein sport [1-9]|s sport|tivibu|exxen|tabii spor [1-9]/.test(value)) return true;
  if (country !== "AZ" && !looksLikeLinearChannel(title)) return true;
  return false;
}

function looksLikeLinearChannel(title: string): boolean {
  const value = title.toLocaleLowerCase("tr");
  return /(\btv\b|televizyon|channel|kanal|haber|news|spor|sport|belgesel|çocuk|cocuk|kids|müzik|muzik|music|trt|cnn|ntv|atv|show|max|star|now|teve|beyaz|ulke|ülke|a haber|a spor|kral|power|number|tnt|sts|ctc|ren|mir|match|матч|россия|пятый|первый|нтв|рен|стс|тнт|звезда|мир|карусель|пятница|тв|москва)/iu.test(value);
}

function isPublishableManifestCandidate(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (isForbiddenUrl(url, { allowLivePath: true })) return false;
  if (isSegmentUrl(url)) return false;
  if (/license|widevine|playready|drm|advert|ads|analytics|doubleclick|googlesyndication/i.test(url)) return false;
  if (/yoda/i.test(url) && /(?:ip|ua|exp|jti|token|signature|sig)=/i.test(url)) return false;
  return /\.(m3u8|mpd)(?:$|\?)/i.test(url);
}

function isManifestLike(url: string, contentType: string): boolean {
  return /\.(m3u8|mpd)(?:$|\?)/i.test(url) || /mpegurl|dash\+xml/i.test(contentType);
}

function isSegmentUrl(url: string): boolean {
  return /\.(ts|m4s|mp4|jpg|png|gif|webp)(?:$|\?)/i.test(url) || /\/segment|\/chunk-\d+|\/media_\d+/i.test(url);
}

function classifyToken(raw?: string): CanliTvChannelStatus["tokenClassification"] {
  if (!raw) return "stable";
  const url = raw.toLowerCase();
  if (/(^|[?&])(ip|jti)=/.test(url)) return "ip_bound";
  if (/(^|[?&])ua=/.test(url)) return "user_agent_bound";
  if (/cookie|session/.test(url)) return "browser_session_bound";
  if (/(token|hash|expires|expire|exp|signature|sig|auth|jwt|hdnts|hdnea)=/.test(url)) return "unknown_token";
  return "stable";
}

function dedupeCandidates(urls: string[]): string[] {
  const seen = new Set<string>();
  return urls.filter((url) => {
    const key = url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function writeCanliTvArtifacts(status: CanliTvStatus, entries: PlaylistEntry[]): void {
  fs.mkdirSync("output", { recursive: true });
  fs.mkdirSync("state", { recursive: true });
  fs.writeFileSync("output/canlitv-status.json", JSON.stringify(status, null, 2), "utf8");
  fs.writeFileSync("state/channel-registry.json", JSON.stringify({
    updatedAt: status.updatedAt,
    channels: status.channels.map((channel) => ({
      canonicalId: channel.canonicalId,
      displayName: channel.name,
      country: channel.country,
      category: categoryFromTitle(channel.name),
      aliases: [channel.name],
      currentPrimaryUrl: undefined,
      currentSource: channel.selectedSource,
      candidateUrls: entries
        .filter((entry) => entry.tvgId === channel.canonicalId)
        .map((entry) => redactUrl(entry.url)),
      manualOverride: false,
      lastSuccessAt: channel.lastSuccessAt,
      lastFailureAt: channel.lastFailureReason ? status.updatedAt : undefined,
      consecutiveFailures: channel.lastFailureReason ? 1 : 0,
      lastCanliTvDiscoveryAt: status.updatedAt,
      verificationStatus: channel.verificationStatus,
      tokenClassification: channel.tokenClassification,
      requiredHeaders: [],
      sourcePage: channel.sourcePage
    }))
  }, null, 2), "utf8");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanTitle(value: string): string {
  return value
    .replace(/\bHD\b/gi, "")
    .replace(/\bcanl[ıi]\b/gi, "")
    .replace(/\byay[ıi]m\b/gi, "")
    .replace(/\bizle\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function channelTitle(text: string, href: string): string {
  const cleaned = cleanTitle(text);
  if (!cleaned || /^hd$/i.test(cleaned)) return titleFromUrl(href);
  return cleaned;
}

function titleFromUrl(href: string): string {
  const base = path.basename(new URL(href).pathname, ".html");
  return cleanTitle(base.replace(/-hd-canli-izle|-canli-izle/g, "").replace(/-/g, " "));
}

function cleanEmbeddedUrl(raw: string): string {
  return raw.replace(/\\\//g, "/").replace(/&amp;/g, "&").replace(/\\u0026/g, "&");
}

function redactUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|hash|expires|expire|exp|signature|sig|auth|jwt|hdnts|hdnea/i.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function slug(value: string): string {
  return value.toLocaleLowerCase("tr").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9а-яё]+/giu, "-").replace(/^-|-$/g, "");
}

function categoryFromTitle(title: string): string {
  const value = title.toLocaleLowerCase("tr");
  if (/haber|xeber|news/.test(value)) return "News";
  if (/spor|sport|idman|match tv/.test(value)) return "Sports";
  if (/belgesel|documentary|kultur|culture|medeniyet/.test(value)) return "Documentary";
  if (/cocuk|çocuk|usaq|kids/.test(value)) return "Children";
  if (/muzik|musiqi|music|kral|power|number/.test(value)) return "Music";
  return "General";
}

function groupTitle(country: string, title: string): string {
  const category = categoryFromTitle(title);
  if (country === "Azərbaycan") {
    if (category === "News") return "Azərbaycan — Xəbər";
    if (category === "Sports") return "Azərbaycan — İdman";
    if (category === "Music") return "Azərbaycan — Musiqi";
    if (category === "Children") return "Azərbaycan — Uşaq";
    return "Azərbaycan";
  }
  if (country === "Türkiyə") {
    if (category === "News") return "Türkiyə — Xəbər";
    if (category === "Sports") return "Türkiyə — İdman";
    if (category === "Documentary") return "Türkiyə — Sənədli və mədəniyyət";
    if (category === "Children") return "Türkiyə — Uşaq";
    if (category === "Music") return "Türkiyə — Musiqi";
    return "Türkiyə — Ümumi";
  }
  if (country === "Rusiya") {
    if (category === "News") return "Rusiya — Xəbər";
    if (category === "Sports") return "Rusiya — İdman";
    if (category === "Documentary") return "Rusiya — Sənədli və mədəniyyət";
    if (category === "Children") return "Rusiya — Uşaq";
    if (category === "Music") return "Rusiya — Musiqi";
    return "Rusiya — Ümumi";
  }
  return country;
}

function countryRank(country: string): number {
  if (country === "AZ" || country === "Azərbaycan") return 0;
  if (country === "TR" || country === "Türkiyə") return 1;
  if (country === "RU" || country === "Rusiya") return 2;
  return 3;
}

function countBy<T>(items: T[], picker: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = picker(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++]!;
      await worker(item);
    }
  }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv[1]?.endsWith("canlitvAz.ts")) {
  discoverCanliTvAz({ full: true }).then((result) => {
    console.log(JSON.stringify(result.status, null, 2));
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
