import fs from "node:fs";
import path from "node:path";
import type { PlaybackHeaders, ValidationResult } from "../types.js";

export function escapeMetadata(text: string): string {
  return text.replace(/"/g, "'").replace(/\n/g, " ");
}

export function getGroupTitle(country: string, category?: string): string {
  const normalizedCategory = category ?? "general";
  switch (country.toUpperCase()) {
    case "AZ":
      return normalizedCategory === "other" ? "Azərbaycan - other" : "Azərbaycan";
    case "TR":
      return getTurkeyGroupTitle(normalizedCategory);
    case "RU":
      return normalizedCategory === "general" ? "Rusiya - main" : "Rusiya - other";
    default:
      return "Digər";
  }
}

export function generateM3uContent(streams: ValidationResult[], includeHeaders = false): string {
  let content = "#EXTM3U\n";

  for (const stream of streams) {
    const group = getGroupTitle(stream.country, stream.category);
    const escapedId = escapeMetadata(stream.channelId);
    const escapedName = escapeMetadata(stream.channelName);
    const escapedGroup = escapeMetadata(group);

    content += `#EXTINF:-1 tvg-id="${escapedId}" tvg-name="${escapedName}" group-title="${escapedGroup}",${escapedName}\n`;
    if (includeHeaders) {
      content += generateHeaderOptions(stream);
    }
    content += `${stream.streamUrl}\n`;
  }

  return content;
}

export function generateHeaderOptions(stream: ValidationResult): string {
  const headers = normalizePlaybackHeaders(stream.playbackHeaders);
  const required = new Set(stream.minimumRequiredHeaders ?? []);
  let content = "";

  if ((required.has("User-Agent") || stream.status === "portable_with_headers") && headers.userAgent) {
    content += `#EXTVLCOPT:http-user-agent=${headers.userAgent}\n`;
  }
  if ((required.has("Referer") || required.has("Referrer")) && headers.referer) {
    content += `#EXTVLCOPT:http-referrer=${headers.referer}\n`;
  }

  return content;
}

export function writePlaylists(
  validatedStreams: ValidationResult[],
  outputDir: string
): { stableCount: number; mainCount: number; experimentalCount: number } {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const ordered = sortForPlaylist(validatedStreams);
  const stableStreams = ordered.filter(
    (s) => s.status === "portable" && s.stability === "stable"
  );
  const mainStreams = ordered.filter(isMainPlaylistStream);
  const experimentalStreams = ordered.filter(
    (s) => isMainPlaylistStream(s) || s.status === "local_relay_required"
  );

  fs.writeFileSync(path.join(outputDir, "playlist-stable.m3u"), generateM3uContent(stableStreams), "utf8");
  fs.writeFileSync(path.join(outputDir, "playlist.m3u"), generateM3uContent(mainStreams, true), "utf8");
  fs.writeFileSync(
    path.join(outputDir, "playlist-experimental.m3u"),
    generateM3uContent(experimentalStreams, true),
    "utf8"
  );

  return {
    stableCount: stableStreams.length,
    mainCount: mainStreams.length,
    experimentalCount: experimentalStreams.length
  };
}

function normalizePlaybackHeaders(headers?: PlaybackHeaders): PlaybackHeaders {
  return headers ?? {};
}

function isMainPlaylistStream(stream: ValidationResult): boolean {
  if (stream.status === "portable" && stream.stability === "stable") return true;
  if (stream.status === "portable_with_headers") return canRepresentHeaders(stream);
  if (stream.sourceName === "canlitv-com" && stream.status === "portable" && stream.stability === "refreshable_public") {
    return true;
  }
  return false;
}

function canRepresentHeaders(stream: ValidationResult): boolean {
  const required = new Set(stream.minimumRequiredHeaders ?? []);
  if (required.has("Origin")) return false;
  return required.size === 0 || required.has("User-Agent") || required.has("Referer") || required.has("Referrer");
}

function getTurkeyGroupTitle(category: string): string {
  if (category === "news" || category === "economy") return "Türkiyə - news";
  if (category === "sports") return "Türkiyə - sports";
  if (["documentary", "culture", "lifestyle"].includes(category)) return "Türkiyə - documentary/culture";
  if (["children", "music"].includes(category)) return "Türkiyə - children/music";
  if (category === "regional") return "Türkiyə - regional/other";
  return "Türkiyə - main";
}

function sortForPlaylist(streams: ValidationResult[]): ValidationResult[] {
  return [...streams].sort((a, b) => {
    const countryDiff = countryPlaylistRank(a) - countryPlaylistRank(b);
    if (countryDiff !== 0) return countryDiff;
    const priorityDiff = priorityRank(a) - priorityRank(b);
    if (priorityDiff !== 0) return priorityDiff;
    return a.channelName.localeCompare(b.channelName, "tr");
  });
}

function countryPlaylistRank(stream: ValidationResult): number {
  const category = stream.category ?? "general";
  if (stream.country === "AZ" && isAzMain(stream.channelId)) return 1;
  if (stream.country === "AZ") return 2;
  if (stream.country === "TR") {
    if (category === "news" || category === "economy") return 4;
    if (category === "sports") return 5;
    if (["documentary", "culture", "lifestyle"].includes(category)) return 6;
    if (["children", "music"].includes(category)) return 7;
    if (category === "regional") return 8;
    return 3;
  }
  if (stream.country === "RU" && isRuMain(stream.channelName)) return 9;
  if (stream.country === "RU") return 10;
  return 11;
}

function priorityRank(stream: ValidationResult): number {
  const rank = [...AZ_MAIN, ...TR_MAIN].indexOf(stream.channelId);
  return rank === -1 ? 1000 : rank;
}

const AZ_MAIN = [
  "aztv",
  "ictimai-tv",
  "xezer-tv",
  "atv-az",
  "arb",
  "arb24",
  "space-tv",
  "real-tv",
  "baku-tv",
  "cbc",
  "cbc-sport",
  "idman-tv",
  "medeniyyet-tv",
  "mtv-az",
  "dunya-tv",
  "kanal-s",
  "naxcivan-tv",
  "gunaz-tv"
];

const TR_MAIN = [
  "trt-1",
  "show-tv",
  "star-tv",
  "atv-tr",
  "kanal-d",
  "now-tv",
  "tv8",
  "kanal-7",
  "trt-haber",
  "cnn-turk",
  "ntv-tr",
  "a-haber",
  "haberturk-tv",
  "halk-tv",
  "sozcu-tv",
  "haber-global",
  "tv100",
  "beyaz-tv",
  "360",
  "tv8-5",
  "trt-spor",
  "trt-spor-yildiz",
  "a-spor",
  "bein-sports-haber",
  "ht-spor",
  "trt-belgesel",
  "dmax",
  "tlc",
  "trt-2",
  "trt-cocuk"
];

function isAzMain(channelId: string): boolean {
  return AZ_MAIN.includes(channelId);
}

function isRuMain(name: string): boolean {
  const lower = name.toLocaleLowerCase("ru");
  return ["нтв", "пятый канал", "россия 24", "россия к", "отр", "тв центр", "рбк", "звезда", "мир", "москва 24"].some((item) =>
    lower.includes(item)
  );
}
