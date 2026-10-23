import type { PlaylistEntry } from "../types.js";

/**
 * Alternate public M3U8 candidates for the user's six required AZ TV stations.
 * They are only SOURCE CANDIDATES: each must pass manifest + actual video
 * ffprobe and a second probe at least 65 seconds later before publishing.
 * Historical links may be offline, geo-restricted or require provider headers.
 */
const ALTERNATIVES = [
  {
    id: "arb", name: "ARB",
    urls: [
      "https://streams.livetv.az/azerbaijan/arb/playlist.m3u8",
      "https://tv.mobyservice.ru/ARB/tracks-v1a1/mono.m3u8",
      "http://85.132.81.184:8080/arb/live1/index.m3u8"
    ]
  },
  {
    id: "real-tv", name: "Real TV",
    urls: [
      "https://tv.mobyservice.ru/Real/tracks-v1a1/mono.m3u8",
      "https://str.yodacdn.net/real/tracks-v1a1/mono.ts.m3u8"
    ]
  },
  {
    id: "medeniyyet-tv", name: "Mədəniyyət TV",
    urls: [
      "https://str.yodacdn.net/medeniyyet/index.m3u8",
      "https://str.yodacdn.net/medeniyyettele/index.m3u8",
      "https://str2.yodacdn.net/medeniyyettele/index.m3u8"
    ]
  },
  {
    id: "ictimai-tv", name: "İctimai TV",
    urls: [
      "https://tv.mobyservice.ru/Ictimai/tracks-v1a1/mono.m3u8",
      "https://node19.connect.az:9081/tv/live/playlist.m3u8",
      "https://live.itv.az/itv.m3u8"
    ]
  },
  {
    id: "xezer-tv", name: "Xəzər TV",
    urls: [
      "https://www.xezerxeber.az/stream/index.m3u8",
      "https://tv.mobyservice.ru/Xezer/tracks-v1a1/mono.m3u8"
    ]
  },
  {
    id: "space-tv", name: "Space TV",
    urls: [
      "https://streams.livetv.az/azerbaijan/space_stream/playlist.m3u8",
      "https://tv.mobyservice.ru/Space/tracks-v1a1/mono.m3u8",
      "http://109.205.166.68/server124/space_tv/index.m3u8"
    ]
  }
] as const;

export const AZ_SIX_IDS = new Set(ALTERNATIVES.map((x) => x.id));

export function azSixCandidates(): PlaylistEntry[] {
  return ALTERNATIVES.flatMap((channel, index) => channel.urls.map((url) => ({
    sourceName: "community-az-six",
    name: channel.name,
    tvgName: channel.name,
    tvgId: channel.id,
    url,
    country: "Azərbaycan",
    groupTitle: "Azərbaycan",
    category: "General",
    priorityId: channel.id,
    priorityName: channel.name,
    priorityCountry: "Azərbaycan",
    priorityOrder: index,
    allowLivePath: true,
    headers: {}
  })));
}
