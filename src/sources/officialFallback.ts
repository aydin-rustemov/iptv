import type { PlaylistEntry } from "../types.js";

// Explicit last-resort broadcaster URLs collected from public playlists and
// broadcaster pages. These are CANDIDATES, not proof of live linear TV, and
// must pass the same ad, identity and two-pass media checks.
const BROADCASTERS = [
  { id: "ictimai-tv", name: "İctimai TV", country: "Azərbaycan", url: "https://live.itv.az/itv.m3u8" },
  { id: "xezer-tv", name: "Xəzər TV", country: "Azərbaycan", url: "https://www.xezerxeber.az/stream/index.m3u8" },
  { id: "atv-az", name: "ATV Azərbaycan", country: "Azərbaycan", url: "https://lives.atv.az:5443/ATV_TV_STREAM/streams/atvcanli.m3u8" },
  { id: "cbc-sport", name: "CBC Sport", country: "Azərbaycan", url: "https://mn-nl.mncdn.com/cbcsports_live/cbcsports/playlist.m3u8" },
  { id: "kanal-d", name: "Kanal D", country: "Türkiyə", url: "https://live.duhnet.tv/S2/HLS_LIVE/kanalddainp/track_4_1250/playlist.m3u8" },
  { id: "trt-1", name: "TRT 1", country: "Türkiyə", url: "https://tv-trt1.medya.trt.com.tr/master.m3u8" },
  { id: "show-tv", name: "Show TV", country: "Türkiyə", url: "https://ciner-live.daioncdn.net/showtv/showtv.m3u8" },
  { id: "atv-tr", name: "ATV", country: "Türkiyə", url: "https://turknet.ercdn.net/atv/atv.m3u8" },
  { id: "now-tv", name: "NOW TV", country: "Türkiyə", url: "https://uycyyuuzyh.turknet.ercdn.net/nphindgytw/nowtv/nowtv.m3u8" },
  { id: "tv8", name: "TV8", country: "Türkiyə", url: "https://tv8.daioncdn.net/tv8/tv8.m3u8" },
  { id: "star-tv", name: "Star TV", country: "Türkiyə", url: "https://dogus-live.daioncdn.net/startv/startv.m3u8" }
] as const;

export function officialLastResortCandidates(): PlaylistEntry[] {
  return BROADCASTERS.map((c, i) => ({
    sourceName: "official-last-resort",
    tvgId: c.id, tvgName: c.name, name: c.name,
    url: c.url, country: c.country, groupTitle: c.country,
    priorityId: c.id, priorityName: c.name, priorityCountry: c.country,
    priorityOrder: i, category: "General", headers: {}, allowLivePath: true
  }));
}
