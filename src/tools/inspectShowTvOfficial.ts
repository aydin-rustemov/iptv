import fs from "node:fs";
import { chromium } from "playwright";

const origins = [
  "https://www.showtv.com.tr/canli-yayin",
  "https://www.showtv.com.tr/canli-yayin/",
  "https://www.showtv.com.tr/"
];
type Captured = { uri: string; via: string; status?: number };
const streams = new Map<string, Captured>();
const pages: Array<{ page: string; status: number | null; title: string; frames: string[]; errors: string[] }> = [];

const browser = await chromium.launch({ headless: true });
for (const uri of origins) {
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    viewport: {width: 1365, height: 768}, locale: "tr-TR",
    serviceWorkers: "block"
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  function record(raw: string, via: string, status?: number) {
    try {
      const url = new URL(raw);
      if (!/\.m3u8(?:$|\?)/i.test(raw) && !/showtv|daioncdn|ciner/i.test(url.hostname + url.pathname)) return;
      const key = url.toString();
      streams.set(key, { uri: key, via, status });
    } catch { /* ignore malformed requests */ }
  }
  page.on("request", req => record(req.url(), "network-request"));
  page.on("response", response => record(response.url(), "network-response", response.status()));
  page.on("pageerror", err => { if (errors.length < 12) errors.push(err.message.slice(0,160)); });
  let status: number | null = null, title = "", frames: string[] = [];
  try {
    status = (await page.goto(uri, { waitUntil: "domcontentloaded", timeout: 20_000 }))?.status() ?? null;
    await page.waitForTimeout(4500);
    for(const f of page.frames()) {
      frames.push(f.url().split("?")[0]!);
      try {
        for(const video of await f.locator("video source, video").evaluateAll(nodes => nodes.map(node =>
          (node as HTMLSourceElement).src || (node as HTMLVideoElement).currentSrc || ""))) {
          if(video)record(video, "video-tag");
        }
        const html = await f.content();
        for(const m of html.matchAll(/https?:\/\/[^"'<> \r\n\\]{6,500}?\.m3u8(?:\?[^"'<> \r\n\\]*)?/gi)) {
          record(m[0].replaceAll("&amp;", "&"), "player-html");
        }
      } catch { /* cross-origin frames have inconsistent loading */ }
    }
    title = await page.title();
  } catch(e) {
    errors.push(String(e instanceof Error ? e.message : e).slice(0,180));
  }
  pages.push({page: uri, status, title, frames, errors});
  await ctx.close();
}
await browser.close();

const media = [...streams.values()].filter(x => /\.m3u8(?:$|\?)/i.test(x.uri));
const report = {
  checkedAt: new Date().toISOString(),
  officialPages: pages,
  media: media.map(({ uri, via, status }) => {
    const u = new URL(uri);
    return {
      uri, via, status,
      host: u.hostname,
      path: u.pathname,
      expiry: u.searchParams.get("ex") ?? u.searchParams.get("exp") ?? "",
      queryKeys: [...u.searchParams.keys()]
    };
  })
};
fs.mkdirSync("output", {recursive: true});
fs.writeFileSync("output/showtv-official-inspect.json",JSON.stringify(report,null,2)+"\n");
for(const page of pages) console.log("[SHOWTV PAGE]",JSON.stringify({page:page.page,status:page.status,title:page.title,frames:page.frames,errors:page.errors}));
for(const item of report.media) console.log("[SHOWTV HLS]",JSON.stringify({host:item.host,path:item.path,expiry:item.expiry,via:item.via,status:item.status,queryKeys:item.queryKeys}));
console.log("[SHOWTV SUMMARY]",JSON.stringify({total:report.media.length,pages:report.officialPages.map(p=>({url:p.page,status:p.status}))}));
