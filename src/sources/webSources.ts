export type Country = "Azərbaycan" | "Türkiyə" | "Rusiya" | "İran" | "Beynəlxalq";
export type Seed = { url: string; country: Country };
export type Source = { name: string; seeds: Seed[]; hosts: string[] };
export type ChannelPage = { url: string; title: string; country: Country };

// Volo is a global catalogue, not a Turkey-only source. Channel pages are
// classified individually by name/URL in webAggregators.ts. Unknown channels
// stay Beynəlxalq instead of being incorrectly published under Türkiyə.
// Category pages go first: the first two list the Azerbaijani TV channels.
// Generic home/list pages add major Turkish stations without scraping 23 pages.
const VOLO_SEEDS: Seed[] = [
  ...[1, 2].map((page) => ({
    url: `https://tv.canlitvvolo.com/canli/azerbaycan-tv-kanallari-izle/?sayfa=${page}`,
    country: "Azərbaycan" as const
  })),
  { url: "https://tv.canlitvvolo.com/canli-tv-list", country: "Beynəlxalq" },
  ...[1, 2, 3, 4].map((page) => ({
    url: `https://tv.canlitvvolo.com/?sayfa=${page}`,
    country: "Beynəlxalq" as const
  }))
];

export const SOURCES: Source[] = [
  { name: "canlitv-volo", seeds: VOLO_SEEDS, hosts: ["tv.canlitvvolo.com"] },
  { name: "canlitv-video", seeds: [
    { url: "https://www.canlitv.video/kategori/azerbaycan", country: "Azərbaycan" },
    { url: "https://www.canlitv.video/hd", country: "Türkiyə" },
    { url: "https://www.canlitv.video/", country: "Türkiyə" }
  ], hosts: ["canlitv.video"] },
  { name: "canlitv-me", seeds: [
    { url: "https://www.canlitv.me/category/azerbaycan-kanallari", country: "Azərbaycan" },
    { url: "https://www.canlitv.me/category/ulusalkanallar", country: "Türkiyə" },
    { url: "https://www.canlitv.me/live", country: "Türkiyə" }
  ], hosts: ["canlitv.me"] },
  { name: "canlitv-watch", seeds: [{ url: "https://tr.canlitv.watch/", country: "Türkiyə" }, { url: "https://tr.canlitv.watch/kanallar/azerbaycan", country: "Azərbaycan" }], hosts: ["canlitv.watch"] },
  { name: "canlitv-com", seeds: [{ url: "https://canlitv.com/televizyonlar", country: "Türkiyə" }], hosts: ["canlitv.com"] },
  { name: "canlitv-date", seeds: [{ url: "https://www.canlitv.date/", country: "Türkiyə" }], hosts: ["canlitv.date"] },
  { name: "tvstream-az", seeds: [{ url: "https://tvstream.az/", country: "Azərbaycan" }], hosts: ["tvstream.az"] },
  { name: "smotret-tv-ru", seeds: [{ url: "https://smotret.tv/", country: "Rusiya" }], hosts: ["smotret.tv"] },
  { name: "glaz-tv-ru", seeds: [{ url: "https://glaz.tv/online-tv", country: "Rusiya" }], hosts: ["glaz.tv"] },
  { name: "ontvtime-ru", seeds: [{ url: "https://www.ontvtime.ru/", country: "Rusiya" }], hosts: ["ontvtime.ru"] }
];
