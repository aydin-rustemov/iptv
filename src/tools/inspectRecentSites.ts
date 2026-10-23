import { chromium } from "playwright";
const pages=[
"https://operativmm.az/az/canli-tv/arb",
"https://operativmm.az/az/canli-tv/real-tv",
"https://operativmm.az/az/canli-tv/ictimai-tv",
"https://operativmm.az/az/canli-tv/xezer-tv",
"https://operativmm.az/az/canli-tv/space-tv",
"https://operativmm.az/az/canli-tv/medeniyyet",
"https://icanlive.tv/canli/9891/aztv.html",
"https://icanlive.tv/kategori/399/azerbaijan-tv-kanallari.html"
];
const browser=await chromium.launch({headless:true});
for(const target of pages){
 const ctx=await browser.newContext({serviceWorkers:"block"});
 const page=await ctx.newPage(),requests=new Set<string>();
 page.on("request",r=>{if(/\.m3u8(?:\?|$)|\.mpd(?:\?|$)/i.test(r.url()))requests.add(r.url().split("?")[0]!)});
 let html="",status=0;
 try{const resp=await page.goto(target,{waitUntil:"domcontentloaded",timeout:16000});status=resp?.status()||0;html=await page.content();await page.waitForTimeout(3000);}catch(e){console.log("[INSPECT ERROR]",target,String(e).slice(0,130))}
 const urls=[...html.matchAll(/https?:[^\s"'<>\\]{8,220}/gi)].map(m=>m[0]!.replace(/&amp;/g,"&"));
 const media=urls.filter(u=>/m3u8|\.mpd|stream|hls|youtube|embed|player|cdn|\.js\b/i.test(u)).slice(0,18).map(x=>x.split("?")[0]);
 const iframe=await page.locator("iframe").evaluateAll(nodes=>nodes.map(n=>(n as HTMLIFrameElement).src)).catch(()=>[]);
 const scripts=await page.locator("script[src]").evaluateAll(nodes=>nodes.map(n=>(n as HTMLScriptElement).src).filter(x=>/player|tv|canli|hls|live|stream/i.test(x)).slice(0,15)).catch(()=>[]);
 const marker=html.match(/.{0,100}(?:m3u8|\.mpd|video-js|hls\.js|jwplayer|streamUrl|playerConfig).{0,140}/gi)?.slice(0,8).map(x=>x.replace(/(?:token|signature|hash)=[^&"\s]+/gi,"token=REDACTED"))||[];
 console.log("[INSPECT]",JSON.stringify({target,status,html:html.length,iframe,requests:[...requests],media,scripts,marker}));
 await ctx.close();
}
await browser.close();