import fs from "node:fs";
import { chromium, type Browser, type Response } from "playwright";
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
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const LIST_PAGES = 23;
const CONCURRENCY = Math.min(Number(process.env["VOLO_BOOTSTRAP_CONCURRENCY"] ?? 4), 4);

interface DiscoveredPage { url: string; hint: string; }
interface ProcessResult { classifiedTurkey: boolean; entry?: ValidatedEntry; name?: string; reason?: string; }
interface BootstrapStatus {
  updatedAt: string;
  listPagesAttempted: number;
  listPagesLoaded: number;
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
  const trPriorities = loadPriorityChannels().filter((item) => normalizeCountry(item.country) === "Türkiyə");
  const locked = forcedPublishedOverrides(loadManualOverrides());
  const browser = await chromium.launch({ headless: true });

  try {
    const discovery = await discoverPages(browser);
    console.log(`[VOLO DISCOVERY] loaded=${discovery.loadedSeeds} channels=${discovery.pages.length}`);

    const results: Array<ValidatedEntry | undefined> = new Array(discovery.pages.length);
    const failures: BootstrapStatus["failed"] = [];
    let turkeyPagesClassified = 0;

    await runPool(discovery.pages, CONCURRENCY, async (item, index) => {
      try {
        const result = await processChannel(browser, item, trPriorities, current);
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
        console.warn(`[VOLO ERROR] ${item.url}: ${errText(err)}`);
      }
    });

    const turkey = dedupeTurkey(results.filter((item): item is ValidatedEntry => Boolean(item)));
    const coreWorking = turkey.filter((entry) => entry.priorityId).length;
    console.log(`[VOLO SAFETY] total=${turkey.length} priority/core=${coreWorking}`);
    if (turkey.length < 25 || coreWorking < 8) {
      throw new Error(`safety_stop_turkish=${turkey.length}_core=${coreWorking}`);
    }

    const nonTurkey = buildNonTurkeyBaseline(current, locked);
    const finalEntries = [...nonTurkey, ...turkey];
    if (fs.existsSync(PLAYLIST)) fs.copyFileSync(PLAYLIST, "output/playlist.previous.m3u");
    writePlaylist(finalEntries);

    const status: BootstrapStatus = {
      updatedAt: new Date().toISOString(),
      listPagesAttempted: LIST_PAGES,
      listPagesLoaded: discovery.loadedSeeds,
      channelPagesDiscovered: discovery.pages.length,
      turkeyPagesClassified,
      workingTurkeyChannels: turkey.length,
      failedTurkeyChannels: failures.length,
      preservedNonTurkeyChannels: nonTurkey.length,
      finalPublished: finalEntries.length,
      failed: failures.slice(0, 300)
    };
    fs.writeFileSync(STATUS, JSON.stringify(status, null, 2), "utf8");
    console.log(`[VOLO BASELINE DONE] Turkish=${turkey.length} nonTurkish=${nonTurkey.length} final=${finalEntries.length}`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function discoverPages(browser: Browser): Promise<{ pages: DiscoveredPage[]; loadedSeeds: number }> {
  const found = new Map<string, string>();
  const categorySeeds = [
    `${VOLO}/`,
    `${VOLO}/canli-tv-list`,
    `${VOLO}/canli/spor-tv-kanallari/`,
    `${VOLO}/canli/cocuk-tv-kanallari/`,
    `${VOLO}/canli/azerbaycan-tv-kanallari-izle/`
  ];
  const seeds = [
    ...Array.from({ length: LIST_PAGES }, (_, i) => `${VOLO}/?sayfa=${i + 1}`),
    ...categorySeeds
  ];
  let loadedSeeds = 0;

  for (const seed of seeds) {
    let loaded = false;
    for (let attempt = 1; attempt <= 2 && !loaded; attempt++) {
      const context = await browser.newContext({ userAgent: UA, serviceWorkers: "block" });
      try {
        const page = await context.newPage();
        const response = await page.goto(seed, { waitUntil: "domcontentloaded", timeout: 25_000 }).catch(() => undefined);
        if (!response?.ok()) continue;
        await page.waitForTimeout(900);
        const links = await page.locator("a").evaluateAll((anchors) => anchors.map((a) => ({
          href: (a as HTMLAnchorElement).href,
          text: (a.textContent ?? "").replace(/\s+/g, " ").trim()
        })));
        for (const link of links) {
          if (!isChannelPage(link.href, link.text)) continue;
          const url = stripTracking(link.href);
          const hint = cleanName(link.text) || nameFromUrl(url);
          const old = found.get(url);
          if (!old || hint.length < old.length) found.set(url, hint);
        }
        loadedSeeds++;
        loaded = true;
        console.log(`[VOLO SEED OK] ${seed} totalLinks=${found.size}`);
      } finally {
        await context.close().catch(() => undefined);
      }
      if (!loaded) await sleep(700 * attempt);
    }
    if (!loaded) console.warn(`[VOLO SEED FAILED] ${seed}`);
    await sleep(180);
  }

  return { pages: [...found].map(([url, hint]) => ({ url, hint })), loadedSeeds };
}

function isChannelPage(raw: string, text: string): boolean {
  try {
    const url = new URL(raw);
    if (url.hostname !== "tv.canlitvvolo.com") return false;
    const path = url.pathname.toLocaleLowerCase("tr");
    if (path === "/" || path.includes("canli-tv-list") || path.includes("yayin-akisi")) return false;
    if (/^\/canli\//.test(path)) return false;
    if (/iletisim|gizlilik|privacy|dmca|hakkimizda|kategori|category|arama|search|favori|reklam/.test(path)) return false;
    const value = `${path} ${text}`.toLocaleLowerCase("tr");
    return /tv|kanal|trt|atv|show|star|haber|spor|cocuk|çocuk|muzik|müzik|canli|canlı|izle|hd/.test(value);
  } catch {
    return false;
  }
}

async function processChannel(browser: Browser, item: DiscoveredPage, priorities: PriorityChannel[], current: PlaylistEntry[]): Promise<ProcessResult> {
  const context = await browser.newContext({ userAgent: UA, serviceWorkers: "block" });
  const page = await context.newPage();
  const captured = new Set<string>();
  page.on("response", (response) => { void captureResponse(response, captured); });

  let name = bestInitialName(item);
  try {
    for (const yayin of [1, 2, 3]) {
      captured.clear();
      const variant = new URL(item.url);
      variant.searchParams.set("yayin", String(yayin));
      const response = await page.goto(variant.toString(), { waitUntil: "domcontentloaded", timeout: 22_000 }).catch(() => undefined);
      if (!response?.ok()) continue;
      await page.waitForTimeout(4_000);

      if (yayin === 1) {
        const h1 = cleanName(await page.locator("h1").first().textContent().catch(() => "") || "");
        const title = cleanName(await page.title().catch(() => ""));
        name = chooseName(name, h1, title, item.url, priorities);
        const body = (await page.locator("body").textContent().catch(() => ""))?.slice(0, 20_000) ?? "";
        if (!isTurkish(name, item.url, body, priorities)) return { classifiedTurkey: false, name };
      }

      const html = await page.content().catch(() => "");
      collectManifestStrings(html, item.url, captured);
      const candidates = [...captured].filter((url) => /^https?:\/\//i.test(url));
      for (const streamUrl of candidates) {
        const entry = buildEntry(name, item.url, streamUrl, priorities, current);
        const validated = await validate(entry);
        if (validated) return { classifiedTurkey: true, entry: validated, name };
      }
    }
    return { classifiedTurkey: true, name, reason: "all_three_yayin_failed" };
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
    collectUrls(data, out);
  } catch {
    // best effort
  }
}

function collectUrls(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 10 || value == null) return;
  if (typeof value === "string") {
    const clean = value.replace(/\\\//g, "/");
    if (/^https?:\/\//i.test(clean) && (/\.m3u8|\.mpd|manifest|playlist/i.test(clean))) out.add(clean);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectUrls(child, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) collectUrls(child, out, depth + 1);
  }
}

function collectManifestStrings(html: string, base: string, out: Set<string>): void {
  for (const m of html.matchAll(/https?:\\?\/\\?\/[^"'<>\\\s]+?(?:\.m3u8|\.mpd)(?:\?[^"'<>\\\s]*)?/gi)) {
    out.add(m[0]!.replace(/\\\//g, "/").replace(/&amp;/g, "&"));
  }
  for (const m of html.matchAll(/["']([^"']+(?:\.m3u8|\.mpd)(?:\?[^"']*)?)["']/gi)) {
    try { out.add(new URL(m[1]!, base).toString()); } catch { /* ignore */ }
  }
}

async function validate(entry: PlaylistEntry): Promise<ValidatedEntry | undefined> {
  const firstFast = await fastCheck(entry);
  if (!firstFast.ok) return undefined;
  const firstMedia = await mediaCheck(entry, firstFast);
  if (!firstMedia.ok) return undefined;
  const secondFast = await fastCheck(entry);
  if (!secondFast.ok) return undefined;
  const secondMedia = await mediaCheck(entry, secondFast);
  if (!secondMedia.ok) return undefined;
  return {
    ...entry,
    headers: { ...entry.headers },
    normalizedUrl: normalizeUrl(entry.url),
    fast: secondFast,
    media: secondMedia,
    score: score(entry, secondMedia, secondFast.latencyMs)
  };
}

function buildEntry(name: string, pageUrl: string, streamUrl: string, priorities: PriorityChannel[], current: PlaylistEntry[]): PlaylistEntry {
  const priority = matchPriority(name, priorities);
  const old = findCurrent(name, priority, current);
  const canonical = priority?.name ?? old?.tvgName ?? old?.name ?? name;
  return {
    sourceName: "canlitv-volo-baseline",
    tvgId: priority?.id ?? old?.tvgId ?? slug(canonical),
    tvgName: canonical,
    tvgLogo: old?.tvgLogo,
    groupTitle: "Türkiyə",
    country: "Türkiyə",
    category: category(priority?.category, canonical),
    name: canonical,
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

function bestInitialName(item: DiscoveredPage): string {
  const fromHint = cleanName(item.hint);
  const fromUrl = nameFromUrl(item.url);
  if (isGenericName(fromHint)) return fromUrl;
  return fromHint || fromUrl;
}

function chooseName(initial: string, h1: string, title: string, url: string, priorities: PriorityChannel[]): string {
  const candidates = [initial, h1, title, nameFromUrl(url)].map(cleanName).filter((x) => x && !isGenericName(x));
  for (const candidate of candidates) {
    const p = matchPriority(candidate, priorities);
    if (p) return p.name;
  }
  return candidates.sort((a, b) => a.length - b.length)[0] ?? nameFromUrl(url);
}

function isGenericName(value: string): boolean {
  const n = normalizeName(value);
  return !n || n === "tv canlitvvolo com" || n === "volotv" || n === "canli tv izle" || n.includes("ucretsiz hd tv kanallari");
}

function isTurkish(name: string, url: string, body: string, priorities: PriorityChannel[]): boolean {
  if (matchPriority(name, priorities)) return true;
  const value = `${name} ${url}`.toLocaleLowerCase("tr");
  const bodyText = body.toLocaleLowerCase("tr");

  if (/azerbaycan|azerbaijan|azərbaycan|xezer|xəzər|ictimai|arb(?:\W|$)|space tv az|cbc sport az|baku tv|naxcivan|naxçıvan|qafqaz|qəbələ|gunaz|günaz/.test(value)) return false;
  if (/rusya|russia|russian|россия|первый|пятый|нтв|тнт|стс|звезда|карусель/.test(value)) return false;
  if (/\biran\b|iranian|persian|farsi|irib|ifilm|press tv|manoto|gem tv|persiana|sahar/.test(value)) return false;
  if (/germany|deutsch|france|italy|spain|ukraine|georgia|armenia|kazakh|uzbek|kyrgyz|pakistan|india|afghan|iraq|syria|lebanon|egypt|romania|bulgaria|serbia|croatia|greece|albania|usa|canada|brazil|argentina|mexico/.test(value)) return false;

  if (/\bturkiye\b|\btürkiye\b|\bturkey\b|\btürk\b|\bturk\b|\btrt\b|\bkanal d\b|\bshow tv\b|\bstar tv\b|\bnow tv\b|\btv8\b|\bteve2\b|\bkanal 7\b|\bbeyaz tv\b|\b360 tv\b|\bcnn türk\b|\ba haber\b|\bhabertürk\b|\bhaber global\b|\bhalk tv\b|\btgrt\b|\btv100\b|\btvnet\b|\ba spor\b|\bminika\b|\bdmax\b|\btele1\b|\bulusal kanal\b|\bvav tv\b|\bakit tv\b|\bblt türk\b|\bbbn türk\b/.test(value)) return true;
  if (/alanya|malatya|kayseri|kocaeli|konya|trabzon|izmir|istanbul|van(?:\W|$)|maraş|maras|tokat|sivas|ankara|ege(?:\W|$)|karadeniz|bursa|mersin|adana|antalya|samsun|erzurum|diyarbak|gaziantep|denizli|çorum|corum|bolu|ordu|rize|sakarya|tekirdağ|tekirdag|manisa|balıkesir|balikesir|eskişehir|eskisehir|kütahya|kutahya|afyon|aydın|aydin|muğla|mugla/.test(value)) return true;
  return /türkiye'nin|türkiye'de|türk televizyon|yerel türk kanalları|türkiye merkezli|türkiye'den yayın/.test(bodyText);
}

function matchPriority(name: string, priorities: PriorityChannel[]): PriorityChannel | undefined {
  const n = simple(name);
  return priorities.find((p) => [p.name, ...p.aliases].some((alias) => {
    const a = simple(alias);
    return a === n || (a.length >= 4 && n.includes(a));
  }));
}

function findCurrent(name: string, priority: PriorityChannel | undefined, current: PlaylistEntry[]): PlaylistEntry | undefined {
  const n = simple(name);
  return current.find((entry) => {
    if (normalizeCountry(entry.country ?? entry.groupTitle) !== "Türkiyə") return false;
    if (priority && (entry.tvgId === priority.id || entry.priorityId === priority.id)) return true;
    return simple(entry.tvgName ?? entry.name) === n || simple(entry.name) === n;
  });
}

function dedupeTurkey(entries: ValidatedEntry[]): ValidatedEntry[] {
  const best = new Map<string, ValidatedEntry>();
  for (const entry of entries) {
    const key = entry.priorityId ? `p:${entry.priorityId}` : `n:${simple(entry.tvgName ?? entry.name)}`;
    const existing = best.get(key);
    const rank = (x: ValidatedEntry) => x.score - Object.keys(x.headers).length * 120;
    if (!existing || rank(entry) > rank(existing)) best.set(key, entry);
  }
  return [...best.values()];
}

function buildNonTurkeyBaseline(current: PlaylistEntry[], locked: ValidatedEntry[]): ValidatedEntry[] {
  const lockedIdentities = new Set(locked.map(identity));
  const seen = new Set<string>();
  const out: ValidatedEntry[] = [];
  for (const entry of current) {
    if (normalizeCountry(entry.country ?? entry.groupTitle) === "Türkiyə") continue;
    if (junk(entry.tvgName ?? entry.name)) continue;
    const key = identity(entry);
    if (lockedIdentities.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(asValidated(entry));
  }
  for (const entry of locked) {
    if (normalizeCountry(entry.country ?? entry.groupTitle) === "Türkiyə") continue;
    const key = identity(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function identity(entry: PlaylistEntry): string {
  return `${normalizeCountry(entry.country ?? entry.groupTitle)}:${simple(entry.tvgName ?? entry.name)}`;
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

function category(p: string | undefined, name: string): string {
  if (p === "news") return "News";
  if (p === "sports") return "Sports";
  if (p === "documentary" || p === "culture") return "Documentary";
  if (p === "children") return "Children";
  if (p === "music") return "Music";
  const v = name.toLocaleLowerCase("tr");
  if (/haber|news|24|tele1|tv100|ntv/.test(v)) return "News";
  if (/spor|sport/.test(v)) return "Sports";
  if (/belgesel|kültür|kultur/.test(v)) return "Documentary";
  if (/çocuk|cocuk|minika|kids/.test(v)) return "Children";
  if (/müzik|muzik|music|power türk|number 1/.test(v)) return "Music";
  return "General";
}

function cleanName(value: string): string {
  return value
    .replace(/\s*[|\-–—]\s*VoloTV.*$/i, "")
    .replace(/\bcanl[ıi]\s*(?:izle|yay[ıi]n)?\b/giu, " ")
    .replace(/\b(?:izle|kesintisiz|online|ücretsiz|ucretsiz)\b/giu, " ")
    .replace(/\s+hd\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameFromUrl(raw: string): string {
  try {
    return cleanName((new URL(raw).pathname.split("/").filter(Boolean).at(-1) ?? "")
      .replace(/[-_]+/g, " ")
      .replace(/\b(?:canli|canlı|izle|hd|yayin|yayın|tv)\b/giu, " "));
  } catch { return ""; }
}

function simple(value: string): string {
  return normalizeName(value)
    .replace(/\b(?:canli|live|izle|seyret|yayin|yayini|hd|fhd|fullhd|full hd)\b/g, " ")
    .replace(/\btv\b$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function junk(value: string): boolean {
  const n = normalizeName(value);
  return /sitene tv ekle|indi izle|simdi izle|canli izle|youtube canli tv izle|kanal ara|tikla izle/.test(n);
}

function slug(value: string): string { return simple(value).replace(/[^a-z0-9а-яё]+/giu, "-").replace(/^-|-$/g, ""); }
function stripTracking(raw: string): string { const u = new URL(raw); u.hash = ""; u.search = ""; return u.toString(); }
function normalizeUrl(raw: string): string { try { return new URL(raw).toString().toLowerCase(); } catch { return raw.toLowerCase(); } }
function safeHost(raw: string): string { try { return new URL(raw).hostname; } catch { return raw; } }
function errText(err: unknown): string { return err instanceof Error ? err.message : String(err); }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function runPool<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const count = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  await Promise.all(Array.from({ length: count }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]!, i);
    }
  }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
