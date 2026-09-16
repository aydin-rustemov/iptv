import fs from "node:fs";
import { chromium, type Browser, type Response } from "playwright";
import { fastCheck, isForbiddenUrl, mediaCheck } from "../src/validator.js";
import type { PlaylistEntry } from "../src/types.js";

const PLAYLIST = "output/playlist.m3u";
const STATUS = "output/turkey-volo-status.json";
const VOLO_ORIGIN = "https://tv.canlitvvolo.com";
const LIST_PAGES = Array.from({ length: 23 }, (_, index) => `${VOLO_ORIGIN}/?sayfa=${index + 1}`);
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CHANNEL_CONCURRENCY = Number(process.env["VOLO_TR_CONCURRENCY"] ?? 4);
const PAGE_WAIT_MS = Number(process.env["VOLO_TR_PAGE_WAIT_MS"] ?? 4500);

type Block = {
  lines: string[];
  extinf: string;
  groupTitle: string;
  tvgName: string;
  displayName: string;
  tvgId: string;
  url: string;
};

type VoloPage = {
  url: string;
  title: string;
};

type ChannelStatus = {
  channel: string;
  tvgId: string;
  oldHost: string;
  matchedPage?: string;
  matchedTitle?: string;
  matchScore?: number;
  newHost?: string;
  headers?: string[];
  status: "replaced" | "no_match" | "no_working_stream" | "error";
  error?: string;
};

type StreamWinner = {
  url: string;
  headers: Record<string, string>;
};

async function main(): Promise<void> {
  if (!fs.existsSync(PLAYLIST)) throw new Error(`${PLAYLIST} not found`);

  const original = fs.readFileSync(PLAYLIST, "utf8");
  const parsed = parseBlocks(original);
  const turkeyBlocks = parsed.blocks.filter(isTurkeyBlock);
  if (!turkeyBlocks.length) throw new Error("No Turkey channels found in playlist");

  console.log(`[VOLO-TR] Turkey channels in playlist: ${turkeyBlocks.length}`);
  const browser = await chromium.launch({ headless: true });
  const statuses: ChannelStatus[] = [];

  try {
    const voloPages = await discoverVoloPages(browser);
    console.log(`[VOLO-TR] Unique Volo channel pages discovered: ${voloPages.length}`);
    if (voloPages.length < 50) throw new Error(`Volo discovery too small: ${voloPages.length}`);

    const replacements = new Map<Block, StreamWinner>();
    await runPool(turkeyBlocks, CHANNEL_CONCURRENCY, async (block) => {
      const base: ChannelStatus = {
        channel: block.tvgName || block.displayName,
        tvgId: block.tvgId,
        oldHost: safeHost(block.url),
        status: "no_match"
      };

      try {
        const match = bestMatch(block, voloPages);
        if (!match || match.score < 62) {
          statuses.push(base);
          console.log(`[VOLO-TR NO MATCH] ${base.channel}`);
          return;
        }

        base.matchedPage = match.page.url;
        base.matchedTitle = match.page.title;
        base.matchScore = match.score;

        const winner = await findWorkingStream(browser, match.page.url, block);
        if (!winner) {
          base.status = "no_working_stream";
          statuses.push(base);
          console.log(`[VOLO-TR NO STREAM] ${base.channel} -> ${match.page.title}`);
          return;
        }

        replacements.set(block, winner);
        base.newHost = safeHost(winner.url);
        base.headers = Object.keys(winner.headers);
        base.status = "replaced";
        statuses.push(base);
        console.log(`[VOLO-TR REPLACED] ${base.channel}: ${base.oldHost} -> ${base.newHost}`);
      } catch (err) {
        base.status = "error";
        base.error = errorText(err);
        statuses.push(base);
        console.warn(`[VOLO-TR ERROR] ${base.channel}: ${base.error}`);
      }
    });

    if (replacements.size === 0) throw new Error("No Turkish channel could be replaced from Volo; playlist left untouched");

    const output = renderPlaylist(parsed.header, parsed.blocks, replacements);
    fs.writeFileSync(PLAYLIST, output, "utf8");

    const summary = {
      updatedAt: new Date().toISOString(),
      source: VOLO_ORIGIN,
      listPagesChecked: LIST_PAGES.length,
      voloChannelPages: voloPages.length,
      turkeyChannelsInPlaylist: turkeyBlocks.length,
      replaced: replacements.size,
      noMatch: statuses.filter((item) => item.status === "no_match").length,
      noWorkingStream: statuses.filter((item) => item.status === "no_working_stream").length,
      errors: statuses.filter((item) => item.status === "error").length,
      channels: statuses.sort((a, b) => a.channel.localeCompare(b.channel, "tr"))
    };
    fs.writeFileSync(STATUS, JSON.stringify(summary, null, 2), "utf8");
    console.log(JSON.stringify({ ...summary, channels: undefined }, null, 2));
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function discoverVoloPages(browser: Browser): Promise<VoloPage[]> {
  const pages = new Map<string, VoloPage>();
  await runPool(LIST_PAGES, 4, async (listUrl) => {
    const context = await browser.newContext({ serviceWorkers: "block", userAgent: USER_AGENT });
    try {
      const page = await context.newPage();
      await page.goto(listUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
      await page.waitForTimeout(1200);
      const anchors = await page.locator("a[href]").evaluateAll((nodes) => nodes.map((node) => ({
        href: (node as HTMLAnchorElement).href,
        text: (node.textContent ?? "").replace(/\s+/g, " ").trim()
      })));

      for (const anchor of anchors) {
        if (!anchor.href.startsWith(VOLO_ORIGIN)) continue;
        const url = canonicalPageUrl(anchor.href);
        if (!url || !looksLikeChannelPage(url, anchor.text)) continue;
        const title = cleanVoloTitle(anchor.text || titleFromUrl(url));
        if (!title) continue;
        const existing = pages.get(url);
        if (!existing || title.length > existing.title.length) pages.set(url, { url, title });
      }
    } catch (err) {
      console.warn(`[VOLO-TR LIST FAILED] ${listUrl}: ${errorText(err)}`);
    } finally {
      await context.close().catch(() => undefined);
    }
  });
  return [...pages.values()];
}

function bestMatch(block: Block, pages: VoloPage[]): { page: VoloPage; score: number } | undefined {
  const target = block.tvgName || block.displayName;
  let best: { page: VoloPage; score: number } | undefined;
  for (const page of pages) {
    const score = similarity(target, page.title, page.url);
    if (!best || score > best.score) best = { page, score };
  }
  return best;
}

function similarity(targetRaw: string, candidateRaw: string, candidateUrl: string): number {
  const target = normalizeName(targetRaw);
  const candidate = normalizeName(candidateRaw);
  const slug = normalizeName(titleFromUrl(candidateUrl));
  if (!target || !candidate) return 0;

  if (target === candidate || target === slug) return 100;
  const compactTarget = target.replace(/\s+/g, "");
  const compactCandidate = candidate.replace(/\s+/g, "");
  const compactSlug = slug.replace(/\s+/g, "");
  if (compactTarget === compactCandidate || compactTarget === compactSlug) return 98;

  let score = 0;
  if (compactCandidate.includes(compactTarget) || compactSlug.includes(compactTarget)) {
    const extra = Math.max(0, compactCandidate.length - compactTarget.length);
    score = Math.max(score, 88 - Math.min(20, extra));
  }
  if (compactTarget.includes(compactCandidate) && compactCandidate.length >= 3) score = Math.max(score, 78);

  const targetTokens = new Set(target.split(" ").filter(Boolean));
  const candidateTokens = new Set(candidate.split(" ").filter(Boolean));
  const intersection = [...targetTokens].filter((token) => candidateTokens.has(token)).length;
  const union = new Set([...targetTokens, ...candidateTokens]).size || 1;
  score = Math.max(score, Math.round((intersection / union) * 85));

  if (/\batv\b/.test(target) && /az|azer|azad/.test(candidate)) score -= 30;
  if (/\bntv\b/.test(target) && /spor/.test(candidate) && !/spor/.test(target)) score -= 25;
  if (/\btrt\s*1\b/.test(target) && /trt\s*1/.test(candidate)) score += 10;
  return Math.min(100, score);
}

async function findWorkingStream(browser: Browser, pageUrl: string, block: Block): Promise<StreamWinner | undefined> {
  let headerFallback: StreamWinner | undefined;
  for (const yayin of [1, 2, 3]) {
    const variant = new URL(pageUrl);
    variant.searchParams.set("yayin", String(yayin));
    const candidates = await captureCandidates(browser, variant.toString());
    for (const url of candidates) {
      if (!/\.m3u8(?:$|\?)/i.test(url) || isForbiddenUrl(url, { allowLivePath: true })) continue;
      const entry: PlaylistEntry = {
        sourceName: "canlitv-volo-turkey-refresh",
        tvgId: block.tvgId || undefined,
        tvgName: block.tvgName || block.displayName,
        groupTitle: block.groupTitle,
        country: "Türkiyə",
        category: "General",
        name: block.tvgName || block.displayName,
        url,
        headers: {},
        candidateReferer: variant.toString(),
        allowLivePath: true
      };

      const fast = await fastCheck(entry);
      if (!fast.ok) continue;
      const media = await mediaCheck(entry, fast);
      if (!media.ok) continue;

      const winner = { url: fast.finalUrl ?? url, headers: { ...entry.headers } };
      if (Object.keys(winner.headers).length === 0) return winner;
      headerFallback ??= winner;
    }
  }
  return headerFallback;
}

async function captureCandidates(browser: Browser, url: string): Promise<string[]> {
  const found = new Set<string>();
  const tasks: Promise<void>[] = [];
  const context = await browser.newContext({ serviceWorkers: "block", userAgent: USER_AGENT });
  try {
    const page = await context.newPage();
    page.on("response", (response) => {
      tasks.push(captureResponse(response, found));
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 }).catch(() => undefined);
    await page.waitForTimeout(PAGE_WAIT_MS);
    const html = await page.content().catch(() => "");
    manifestUrls(html).forEach((item) => found.add(item));
    await Promise.allSettled(tasks);
  } finally {
    await context.close().catch(() => undefined);
  }
  return [...found];
}

async function captureResponse(response: Response, found: Set<string>): Promise<void> {
  try {
    const url = response.url();
    const type = response.headers()["content-type"] ?? "";
    if (/\.m3u8(?:$|\?)/i.test(url) || /mpegurl/i.test(type)) found.add(url);
    if (!/json|javascript|text\//i.test(type) && !/api|ajax|player|stream|yayin|broadcast/i.test(url)) return;
    const text = await response.text();
    manifestUrls(text).forEach((item) => found.add(item));
  } catch {
    // Best-effort network inspection.
  }
}

function manifestUrls(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/https?:\\?\/\\?\/[^"'<>\\\s]+?\.m3u8(?:\?[^"'<>\\\s]*)?/gi)) {
    const value = match[0]!.replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
    if (/^https?:\/\//i.test(value)) found.add(value);
  }
  return [...found];
}

function parseBlocks(text: string): { header: string; blocks: Block[] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const header = lines[0]?.startsWith("#EXTM3U") ? lines[0] : "#EXTM3U";
  const blocks: Block[] = [];
  let current: string[] | undefined;

  const flush = () => {
    if (!current?.length) return;
    const extinf = current.find((line) => line.startsWith("#EXTINF"));
    const url = [...current].reverse().find((line) => /^https?:\/\//i.test(line));
    if (extinf && url) {
      const attrs = parseAttrs(extinf);
      const comma = extinf.indexOf(",");
      blocks.push({
        lines: [...current],
        extinf,
        groupTitle: attrs["group-title"] ?? "",
        tvgName: attrs["tvg-name"] ?? "",
        displayName: comma >= 0 ? extinf.slice(comma + 1).trim() : attrs["tvg-name"] ?? "",
        tvgId: attrs["tvg-id"] ?? "",
        url
      });
    }
    current = undefined;
  };

  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      flush();
      current = [line];
    } else if (current) {
      current.push(line);
      if (/^https?:\/\//i.test(line)) flush();
    }
  }
  flush();
  return { header, blocks };
}

function renderPlaylist(header: string, blocks: Block[], replacements: Map<Block, StreamWinner>): string {
  const lines = [header];
  for (const block of blocks) {
    const replacement = replacements.get(block);
    if (!replacement) {
      lines.push(...block.lines);
      continue;
    }
    lines.push(block.extinf);
    if (replacement.headers["User-Agent"]) lines.push(`#EXTVLCOPT:http-user-agent=${replacement.headers["User-Agent"]}`);
    if (replacement.headers["Referer"]) lines.push(`#EXTVLCOPT:http-referrer=${replacement.headers["Referer"]}`);
    lines.push(replacement.url);
  }
  return `${lines.join("\n")}\n`;
}

function isTurkeyBlock(block: Block): boolean {
  return normalizeName(block.groupTitle).includes("turkiye");
}

function parseAttrs(line: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of line.matchAll(/([a-zA-Z0-9_-]+)="([^"]*)"/g)) result[match[1]!.toLowerCase()] = match[2]!;
  return result;
}

function looksLikeChannelPage(url: string, text: string): boolean {
  const path = new URL(url).pathname.toLocaleLowerCase("tr");
  if (path === "/" || /canli-tv-list|yayin-akisi|gizlilik|iletisim|dmca|hakkimizda|kategori|category/.test(path)) return false;
  const value = `${path} ${text}`.toLocaleLowerCase("tr");
  return /izle|canli|canlı|tv|kanal|trt|spor|haber|show|star|atv|ntv|cnn|bloomberg|teve|dmax|tlc/.test(value);
}

function canonicalPageUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function cleanVoloTitle(value: string): string {
  return value
    .replace(/\b(?:canl[ıi]|yay[ıi]n|izle|kesintisiz)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromUrl(raw: string): string {
  try {
    return decodeURIComponent(new URL(raw).pathname.split("/").filter(Boolean).at(-1) ?? "")
      .replace(/[-_]+/g, " ")
      .replace(/\b(?:canli|izle|hd)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

function normalizeName(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[çÇ]/g, "c")
    .replace(/[öÖ]/g, "o")
    .replace(/[üÜ]/g, "u")
    .replace(/\b(?:hd|fullhd|fhd|canli|yayin|izle|turkiye|turkey)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeHost(raw: string): string {
  try { return new URL(raw).hostname; } catch { return "invalid-url"; }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const count = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  await Promise.all(Array.from({ length: count }, async () => {
    while (index < items.length) await worker(items[index++]!);
  }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
