import type { PlaylistEntry } from "./types.js";

/** Reject ad-stitched media manifests and ad-service redirects regardless of video codec. */
export function isAdvertisingStream(raw: string): boolean {
  try {
    const url = new URL(raw);
    const h = url.hostname.toLowerCase();
    const p = url.pathname.toLowerCase();
    return /(?:^|\.)(?:2mdn\.net|doubleclick\.net|googlesyndication\.com|googleadservices\.com|adnxs\.com|adsrvr\.org|adservice\.google\.com)$/.test(h) ||
      /\/(?:web_video_ads|advertising|preroll|midroll|adserver|ad_serving)(?:\/|$)/.test(p) ||
      /\/api\/manifest\/hls_variant\/source\/web_video_ads\//.test(p);
  } catch { return true; }
}

/** Restore broadcaster identity before priority matching; site headings can be wrong. */
export function normalizeBroadcaster(entry: PlaylistEntry): PlaylistEntry {
  const name = entry.name.trim().replace(/\s+/g, " ");
  const compact = name.toLocaleLowerCase("tr")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i").replace(/ə/g, "e");
  let url: URL | undefined;
  try { url = new URL(entry.url); } catch { return entry; }
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  // The 'Atv Azad TV' page was wrongly inferred to be Turkish because the
  // generic site's category was Turkey. The actual stream is from AZ ATV.
  if (/^(atv azad tv|azad azerbaycan(?: tv)?|atv az(?:erbaycan)?)$/i.test(compact)
      || host === "lives.atv.az" || /(?:^|\.)atv\.az$/.test(host) && /atv[_/-]/.test(pathname)) {
    return { ...entry, name: "ATV Azərbaycan", tvgName: "ATV Azərbaycan",
      country: "Azərbaycan", groupTitle: "Azərbaycan",
      priorityCountry: "Azərbaycan", priorityId: "atv-az", tvgId: "atv-az" };
  }
  const trNational = [
    ["show tv", "Show TV"], ["star tv", "Star TV"],
    ["kanal d", "Kanal D"], ["now tv", "NOW TV"],
    ["trt 1", "TRT 1"], ["tv8", "TV8"]
  ] as const;
  if (entry.country === "Türkiyə") {
    const shortName = compact.replace(/\s+(?:genel|ulusal)(?:\s+(?:turkiye|turkiye tv))?$/, "")
      .replace(/\s+turkiye$/, "").trim();
    const canon = trNational.find(([k]) => shortName === k)?.[1];
    if (canon) return { ...entry, name: canon, tvgName: canon };
  }
  return entry;
}

/** 0=Yoda, 1=other requested live-TV sites, 2=community lists, 3=official fallback. */
export function sourceTier(entry: PlaylistEntry): number {
  const region = entry.country === "Azərbaycan" ? "AZ" : entry.country === "Türkiyə" ? "TR" : "RU";
  if (entry.sourceName === "official-last-resort") return 3;
  if (region === "AZ" && (entry.sourceName === "yoda-az" || entry.sourceName === "yoda-az-cdn")) return 0;
  if (/^(?:canlitv-|tvstream-az)/.test(entry.sourceName)) return 1;
  if (entry.sourceName.startsWith("community-") || entry.sourceName.startsWith("iptv-org-")) return 2;
  return 2;
}

/** No station may be published under the wrong country or an ad stream. */
export function validCandidateIdentity(entry: PlaylistEntry): boolean {
  if (isAdvertisingStream(entry.url)) return false;
  const host = (() => { try { return new URL(entry.url).hostname.toLowerCase(); } catch { return ""; } })();
  if (entry.country === "Türkiyə" && (/(?:^|\.)atv\.az$/.test(host) ||
    host.endsWith(".tvstream.az") || host.endsWith(".yodacdn.net"))) return false;
  if (entry.country === "Azərbaycan" && entry.priorityId === "atv-tr") return false;
  if (/^(?:çocuk kanalları|cocuk kanallari|canlı tv|kanallar|tüm kanallar)$/i.test(entry.name)) return false;
  return true;
}
