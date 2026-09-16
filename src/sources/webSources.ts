export type Country = "Azərbaycan" | "Türkiyə" | "Rusiya";
export type Seed = { url: string; country: Country };
export type Source = { name: string; seeds: Seed[]; hosts: string[] };
export type ChannelPage = { url: string; title: string; country: Country };

export const SOURCES: Source[] = [
  { name: "canlitv-volo", seeds: [{ url: "https://tv.canlitvvolo.com/canli-tv-list", country: "Türkiyə" }], hosts: ["tv.canlitvvolo.com"] },
  { name: "canlitv-video", seeds: [{ url: "https://www.canlitv.video/", country: "Türkiyə" }], hosts: ["canlitv.video"] },
  { name: "canlitv-me", seeds: [{ url: "https://www.canlitv.me/", country: "Türkiyə" }], hosts: ["canlitv.me"] },
  { name: "canlitv-watch", seeds: [{ url: "https://tr.canlitv.watch/", country: "Türkiyə" }, { url: "https://tr.canlitv.watch/kanallar/azerbaycan", country: "Azərbaycan" }], hosts: ["canlitv.watch"] },
  { name: "canlitv-com", seeds: [{ url: "https://canlitv.com/televizyonlar", country: "Türkiyə" }], hosts: ["canlitv.com"] },
  { name: "canlitv-date", seeds: [{ url: "https://www.canlitv.date/", country: "Türkiyə" }], hosts: ["canlitv.date"] },
  { name: "tvstream-az", seeds: [{ url: "https://tvstream.az/", country: "Azərbaycan" }], hosts: ["tvstream.az"] },
  { name: "smotret-tv-ru", seeds: [{ url: "https://smotret.tv/", country: "Rusiya" }], hosts: ["smotret.tv"] },
  { name: "glaz-tv-ru", seeds: [{ url: "https://glaz.tv/online-tv", country: "Rusiya" }], hosts: ["glaz.tv"] },
  { name: "ontvtime-ru", seeds: [{ url: "https://www.ontvtime.ru/", country: "Rusiya" }], hosts: ["ontvtime.ru"] }
];
