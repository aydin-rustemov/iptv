import type { PlaylistEntry } from "../types.js";

// Non-official, openly listed third-party alternatives for the seven
// user-required national Turkish stations. All are CANDIDATES only: every URL
// must pass direct HLS and video probing and the cross-channel identity guard.
// Known ad-slate host families remain blocked by validator.ts.
const ALTERNATIVES = [
  { id: "atv-tr", name: "ATV", urls: ["http://116.202.238.88/ATV_TR/tracks-v1a1/index.m3u8"] },
  { id: "now-tv", name: "NOW TV", urls: ["http://116.202.238.88/FOXTV_TR/index.m3u8"] },
  { id: "show-tv", name: "Show TV", urls: ["https://showtvdvr.blutv.com/blutv_showtv_dvr2/live.m3u8"] },
  { id: "kanal-d", name: "Kanal D", urls: ["https://live.duhnet.tv/S2/HLS_LIVE/kanalddainp/track_4_1250/playlist.m3u8"] },
  { id: "trt-1", name: "TRT 1", urls: ["https://trtcanlitv-lh.akamaihd.net/i/TRT1HD_1@181842/master.m3u8"] },
  { id: "star-tv", name: "Star TV", urls: ["https://raw.githubusercontent.com/ipstreet312/freeiptv/refs/heads/master/ressources/tur/star.m3u8"] },
  { id: "tv8", name: "TV8", urls: ["http://315e5a5d.ottrast.com/iptv/8KSD5KFDXA6H88/2454/index.m3u8"] }
] as const;

export function turkeyAlternativeCandidates(): PlaylistEntry[] {
  return ALTERNATIVES.flatMap((item, i) => item.urls.map((url) => ({
    sourceName: "community-turkey-candidate",
    tvgId: item.id, tvgName: item.name, name: item.name,
    country: "Türkiyə", groupTitle: "Türkiyə", category: "General",
    url, headers: {}, priorityId: item.id, priorityName: item.name,
    priorityCountry: "Türkiyə", priorityOrder: i + 101, allowLivePath: true
  })));
}
