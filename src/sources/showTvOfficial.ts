import type { BrowserContext } from "playwright";

const OFFICIAL_LIVE_PAGE = "https://www.showtv.com.tr/canli-yayin";
const ALLOWED_HOST = "ciner.daioncdn.net";
type Candidate = {url:string; kind:"network-response"|"player-html"; status?:number; quality:number};

export type OfficialShowTvResult = {
  page: string;
  fetchedAt: string;
  status: "official_hls_captured" | "official_hls_not_exposed";
  url?: string;
  networkStatus?: number;
  foundBy?: "network-response"|"player-html";
  message?: string;
};

/** Only exact Show TV streams from the broadcaster's own player are allowed. */
export function isOfficialShowTvStream(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.hostname !== ALLOWED_HOST ||
      u.username || u.password || u.port) return false;
    return /^\/showtv\/showtv(?:_1080p|_720p|_480p)?\.m3u8$/i.test(u.pathname);
  } catch { return false; }
}

/** Prefer an HTTP 200 response for 1080p actually requested by showtv.com.tr. */
export function pickOfficialShowTv(candidates: Candidate[]): Candidate|undefined {
  return candidates
    .filter(x => isOfficialShowTvStream(x.url))
    .sort((a,b) => {
      const rank = (x:Candidate) =>
        (x.kind==="network-response" && x.status===200 ? 1000 : 0) +
        (x.quality || 0) +
        (x.kind==="player-html" ? 0 : 50);
      return rank(b)-rank(a);
    })[0];
}

export async function collectOfficialShowTv(ctx: BrowserContext): Promise<OfficialShowTvResult> {
  const page=await ctx.newPage();
  const all = new Map<string,Candidate>();
  const discoveredAt=new Date().toISOString();
  function record(raw:string, kind:Candidate["kind"], status?:number) {
    if (!isOfficialShowTvStream(raw)) return;
    const path=new URL(raw).pathname;
    const quality=/_1080p/.test(path)?100: /_720p/.test(path)?80: /_480p/.test(path)?45: 25;
    const old=all.get(raw);
    // Keep HTTP response evidence when the URL was also found in HTML.
    if (old?.kind==="network-response" && old.status===200 && kind==="player-html") return;
    all.set(raw,{url:raw,kind,status,quality});
  }
  page.on("response",response=>record(response.url(),"network-response",response.status()));
  let status:number|null=null;
  try {
    status=(await page.goto(OFFICIAL_LIVE_PAGE,{waitUntil:"domcontentloaded",timeout:22000}))?.status()??null;
    if(status!==200)return {page:OFFICIAL_LIVE_PAGE,fetchedAt:discoveredAt,status:"official_hls_not_exposed",message:"Official page returned HTTP "+status};
    await page.waitForTimeout(4000);
    for(const frame of page.frames()) {
      try {
        const html=await frame.content();
        for(const m of html.matchAll(/https?:\/\/[^"'<> \r\n\\]{6,700}?\.m3u8(?:\?[^"'<> \r\n\\]*)?/gi))
          record(m[0].replaceAll("&amp;","&"),"player-html");
        const tags=await frame.locator("video source[src],video[src]").evaluateAll(nodes=>nodes.map(node=>(node as HTMLSourceElement).src||""));
        for(const src of tags)record(src,"player-html");
      } catch { /* frame may be inaccessible */ }
    }
    const chosen=pickOfficialShowTv([...all.values()]);
    return chosen
      ? {page:OFFICIAL_LIVE_PAGE,fetchedAt:discoveredAt,status:"official_hls_captured",
         url:chosen.url,foundBy:chosen.kind,networkStatus:chosen.status}
      : {page:OFFICIAL_LIVE_PAGE,fetchedAt:discoveredAt,status:"official_hls_not_exposed",message:"No exact Show TV HLS manifest in official player"};
  } catch(e) {
    return {page:OFFICIAL_LIVE_PAGE,fetchedAt:discoveredAt,status:"official_hls_not_exposed",message:String(e instanceof Error?e.message:e).slice(0,160)};
  } finally {await page.close();}
}
