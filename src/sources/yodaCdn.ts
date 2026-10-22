import type { PlaylistEntry } from "../types.js";

// Publicly indexed Yoda CDN endpoints are rechecked at every refresh.
// Some are Azerbaijan-geo restricted and cannot be probed from a US CI runner.
// Their status is reported separately, never called 'verified' without playback.
const KNOWN_YODA_CHANNELS = [
  { id: "aztv", name: "AzTV", url: "https://str.yodacdn.net/aztv/index.m3u8" },
  { id: "medeniyyet-tv", name: "Mədəniyyət TV", url: "https://str.yodacdn.net/medeniyyet/index.m3u8" },
  { id: "idman-tv", name: "İdman TV", url: "https://str.yodacdn.net/idman/mono.m3u8" },
  { id: "arb", name: "ARB", url: "https://str.yodacdn.net/arb/tracks-v1a1/mono.ts.m3u8" },
  { id: "space-tv", name: "Space TV", url: "https://str.yodacdn.net/space/tracks-v1a1/mono.ts.m3u8" }
] as const;

export function yodaCdnCandidates(): PlaylistEntry[] {
  return KNOWN_YODA_CHANNELS.map((item, index) => ({
    sourceName: "yoda-az-cdn",
    tvgId: item.id,
    tvgName: item.name,
    name: item.name,
    url: item.url,
    country: "Azərbaycan",
    groupTitle: "Azərbaycan",
    category: "General",
    headers: {},
    priorityId: item.id,
    priorityName: item.name,
    priorityCountry: "Azərbaycan",
    priorityOrder: index + 1,
    allowLivePath: true
  }));
}
