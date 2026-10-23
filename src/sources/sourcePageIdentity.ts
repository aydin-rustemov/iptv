import type { ChannelPage, Country } from "./webSources.js";

// Known broadcaster routes. Never use EPG titles (e.g. "AZTV Aztv xəbər") as
// station identities and never infer a stream from a page URL.
const OPERATIV_NAMES: Record<string, string> = {
  aztv: "AzTV",
  ictimai: "İctimai TV", "ictimai-tv": "İctimai TV",
  atv: "ATV Azərbaycan", "atv-az": "ATV Azərbaycan",
  xezer: "Xəzər TV", "xezer-tv": "Xəzər TV",
  space: "Space TV", "space-tv": "Space TV",
  arb: "ARB", "arb-tv": "ARB",
  "baku-tv": "Baku TV", "real-tv": "Real TV",
  "arb-24": "ARB 24", arb24: "ARB 24",
  "apa-tv": "APA TV", anewz: "AnewZ",
  "biznes-tv": "Biznes TV", "idman-tv": "İdman TV",
  "cbc-sport": "CBC Sport", medeniyyet: "Mədəniyyət TV",
  "medeniyyet-tv": "Mədəniyyət TV", "medeniyyet-tv-kanali": "Mədəniyyət TV",
  "naxcivan-tv": "Naxçıvan TV", "qafqaz-tv": "Qafqaz TV",
  eltv: "ELTV", "kanal-35": "Kanal 35"
};

export function sourcePageIdentity(
  sourceName: string, href: string, linkText: string, _fallbackCountry: Country
): ChannelPage | undefined {
  let url: URL;
  try { url = new URL(href); } catch { return undefined; }
  if (sourceName === "operativmm-az") {
    if (url.hostname !== "operativmm.az" && url.hostname !== "www.operativmm.az") return undefined;
    const slug = url.pathname.match(/^\/az\/canli-tv\/([^/]+)\/?$/)?.[1]?.toLowerCase();
    if (!slug) return undefined;
    const title = OPERATIV_NAMES[slug];
    return title ? { url: url.toString(), title, country: "Azərbaycan" } : undefined;
  }
  if (sourceName.startsWith("icanlive-")) {
    if (url.hostname !== "icanlive.tv" && url.hostname !== "www.icanlive.tv") return undefined;
    if (!/^\/canli\/\d+\/[^/]+\.html$/i.test(url.pathname)) return undefined;
    // Catalogue labels contain popularity counters: "ATV 3,583,083".
    // Never mistake their counters, region, or page slug for channel identity.
    let title = linkText.replace(/\s+[\d][\d,.\s]*$/, "").trim();
    if (!title) {
      title = url.pathname.split("/").at(-1)!.replace(/\.html$/i, "").replace(/[-_]+/g, " ");
    }
    const country: Country = sourceName === "icanlive-az" ? "Azərbaycan" :
      sourceName === "icanlive-tr" ? "Türkiyə" : "Rusiya";
    return { url: url.toString(), title, country };
  }
  return undefined;
}

export function priorityWebPageScore(page: ChannelPage): number {
  const label = page.title.toLocaleLowerCase("tr")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[ıİ]/g, "i").replace(/[əƏ]/g, "e").trim();
  const required = [
    "show tv", "atv", "kanal d", "now tv", "tv8", "trt 1", "star tv",
    "aztv", "ictimai tv", "idman tv", "medeniyyet tv",
    "xezer tv", "space tv", "arb", "arb 24", "cbc sport", "real tv",
    "ntv", "russia 1", "russia 24", "1tv", "channel one",
    "channel 5", "ren tv", "mir tv", "moscow 24 tv"
  ];
  // Exact title match ensures ATV Alanya never ranks as the requested ATV.
  if (required.includes(label)) return 1000;
  if (/^(?:trt|russia|ntv|ren|mir|channel|first|rossiya|moscow|match)\b/i.test(label)) return 100;
  return 0;
}
