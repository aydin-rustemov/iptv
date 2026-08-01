import type { AppConfig, StreamCandidate } from "../types.js";
import type { AdapterResult, SourceAdapter } from "./source-adapter.js";
import { fetchTextSafe } from "../validation/fetch-manifest.js";
import { parseChannelM3u } from "../validation/parse-hls.js";
import { normalizeChannel } from "../discovery/normalize-channel.js";

const RUSSIAN_PRIORITY_NAMES = [
  "НТВ",
  "Пятый канал",
  "Россия 24",
  "Россия К",
  "ОТР",
  "ТВ Центр",
  "РБК",
  "Звезда",
  "Мир",
  "Москва 24",
  "Пятница",
  "ТНТ",
  "СТС",
  "РЕН ТВ",
  "Карусель"
];

export class IptvOrgAdapter implements SourceAdapter {
  name = "iptv-org";

  private playlists = [
    { kind: "country", url: "https://iptv-org.github.io/iptv/countries/ru.m3u" },
    { kind: "language", url: "https://iptv-org.github.io/iptv/languages/rus.m3u" }
  ];

  async discover(config: AppConfig): Promise<AdapterResult> {
    const startTime = Date.now();
    const result: AdapterResult = {
      sourceName: this.name,
      status: "failed",
      pagesVisited: 0,
      candidates: [],
      browserUsed: false,
      durationMs: 0,
      warnings: [],
      diagnostics: {
        playlistsFetched: 0,
        entriesParsed: 0,
        duplicateUrlsDropped: 0,
        excludedByCategory: 0
      }
    };

    const candidates: StreamCandidate[] = [];
    const seenUrls = new Set<string>();

    for (const playlist of this.playlists) {
      try {
        const response = await fetchTextSafe(playlist.url, {
          timeoutMs: config.validationTimeoutMs,
          limitBytes: 8 * 1024 * 1024
        });
        result.pagesVisited++;
        result.diagnostics!.playlistsFetched = Number(result.diagnostics!.playlistsFetched) + 1;

        const entries = parseChannelM3u(response.text);
        result.diagnostics!.entriesParsed = Number(result.diagnostics!.entriesParsed) + entries.length;

        for (const entry of entries) {
          if (seenUrls.has(entry.url)) {
            result.diagnostics!.duplicateUrlsDropped = Number(result.diagnostics!.duplicateUrlsDropped) + 1;
            continue;
          }
          if (isExcludedRussianEntry(entry.name, entry.groupTitle)) {
            result.diagnostics!.excludedByCategory = Number(result.diagnostics!.excludedByCategory) + 1;
            continue;
          }
          seenUrls.add(entry.url);
          const norm = normalizeChannel(entry.tvgName || entry.name);
          candidates.push({
            channelId: norm.country === "RU" ? norm.id : normalizeRussianId(entry.name),
            channelName: entry.tvgName || entry.name,
            country: "RU",
            category: inferRussianCategory(entry.name, entry.groupTitle),
            pageUrl: playlist.url,
            streamUrl: entry.url,
            sourceName: this.name,
            discoveryMethod: "m3u-import",
            discoveredAt: new Date().toISOString(),
            metadata: {
              iptvOrgPlaylistKind: playlist.kind,
              iptvOrgGroupTitle: entry.groupTitle
            }
          });
        }
      } catch (err: any) {
        result.warnings.push(`Failed to fetch ${playlist.url}: ${err.message}`);
      }
    }

    result.candidates = sortRussianCandidates(candidates).slice(0, 50);
    result.status = result.candidates.length > 0 ? "working" : result.warnings.length > 0 ? "failed" : "no_candidates";
    result.durationMs = Date.now() - startTime;
    return result;
  }
}

function sortRussianCandidates(candidates: StreamCandidate[]): StreamCandidate[] {
  return [...candidates].sort((a, b) => {
    const priorityDiff = priorityRank(a.channelName) - priorityRank(b.channelName);
    if (priorityDiff !== 0) return priorityDiff;
    const categoryDiff = categoryRank(a.category) - categoryRank(b.category);
    if (categoryDiff !== 0) return categoryDiff;
    return a.channelName.localeCompare(b.channelName, "ru");
  });
}

function priorityRank(name: string): number {
  const lower = name.toLocaleLowerCase("ru");
  const index = RUSSIAN_PRIORITY_NAMES.findIndex((priority) => lower.includes(priority.toLocaleLowerCase("ru")));
  return index === -1 ? 1000 : index;
}

function categoryRank(category?: string): number {
  const order = ["general", "news", "culture", "documentary", "music", "children"];
  const index = order.indexOf(category ?? "general");
  return index === -1 ? 100 : index;
}

function isExcludedRussianEntry(name: string, groupTitle?: string): boolean {
  const text = `${name} ${groupTitle ?? ""}`.toLocaleLowerCase("ru");
  return ["adult", "xxx", "18+", "gambling", "casino", "shopping", "shop", "webcam", "camera", "камер"].some((term) =>
    text.includes(term)
  );
}

function inferRussianCategory(name: string, groupTitle?: string): string {
  const text = `${name} ${groupTitle ?? ""}`.toLocaleLowerCase("ru");
  if (text.includes("news") || text.includes("новост") || text.includes("24")) return "news";
  if (text.includes("culture") || text.includes("культур")) return "culture";
  if (text.includes("doc") || text.includes("док")) return "documentary";
  if (text.includes("music") || text.includes("муз")) return "music";
  if (text.includes("kids") || text.includes("дет") || text.includes("карусель")) return "children";
  return "general";
}

function normalizeRussianId(name: string): string {
  return name
    .toLocaleLowerCase("ru")
    .replace(/[^a-zа-яё0-9]+/giu, "-")
    .replace(/(^-|-$)/g, "") || "ru-channel";
}
