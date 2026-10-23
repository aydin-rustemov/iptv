import fs from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { PlaylistEntry } from "../types.js";

type SiteName="icanlive"|"operativmm";
type Slot={id:string;name:string;group:string;order:number};
type Candidate={url:string;site:SiteName;page:string;foundBy:string};
type SlotReport=Slot&{status:"source_url_collected_no_playback_check"|"no_direct_hls_found";chosen?:Candidate;page?:string;reason?:string};
const slots=(JSON.parse(fs.readFileSync("config/az-fixed12.json","utf8")) as {channels:Slot[]}).channels;
const expected=["aztv","ictimai-tv","idman-tv","medeniyyet-tv","xezer-tv","atv-az","arb","space-tv","cbc-sport","real-tv","arb24","baku-tv"];
if(JSON.stringify(slots.map(x=>x.id))!==JSON.stringify(expected))throw Error("Fixed station order has changed");

const icanliveCategory="https://icanlive.tv/kategori/399/azerbaijan-tv-kanallari.html";
const aliases:Record<string,string[]>={
  "aztv":["aztv","az tv"],
  "ictimai-tv":["ictimai tv","itv"],
  "idman-tv":["idman tv"],
  "medeniyyet-tv":["medeniyyet tv","medeniyet tv","mədəniyyət tv"],
  "xezer-tv":["xezer tv","xəzər tv","xazar tv"],
  "atv-az":["atv"],
  "arb":["arb","arb tv"],
  "space-tv":["space tv"],
  "cbc-sport":["cbc sport","cbc sports"],
  "real-tv":["real tv"],
  "arb24":["arb 24","arb24"],
  "baku-tv":["baku tv","baku.tv"]
};
const operativSlugs:Record<string,string>={
  aztv:"aztv","ictimai-tv":"ictimai-tv","idman-tv":"idman-tv",
  "medeniyyet-tv":"medeniyyet","xezer-tv":"xezer-tv",
  "atv-az":"atv",arb:"arb","space-tv":"space-tv",
  "cbc-sport":"cbc-sport","real-tv":"real-tv",arb24:"arb-24","baku-tv":"baku-tv"
};
const clean=(text:string)=>text.toLocaleLowerCase("az").normalize("NFKD")
 .replace(/[\u0300-\u036f]/g,"").replace(/ə/g,"e").replace(/ı/g,"i")
 .replace(/[\s_.]+/g," ").replace(/\s*\d[\d,\s.]*$/,"").trim();
function mediaUrl(raw:string):boolean{
 try {
  const u=new URL(raw);
  if(!["http:","https:"].includes(u.protocol)||!u.hostname||u.username||u.password)return false;
  if(!u.pathname.toLowerCase().endsWith(".m3u8"))return false;
  if(/yoda|2mdn|doubleclick|googlesyndication|adservice/i.test(u.hostname+u.pathname))return false;
  if(/(?:exp|expires|token|hash|signature|sig)=/i.test(u.search))return false;
  return true;
 }catch{return false;}
}
function sameBroadcaster(slot:Slot,url:string){
 const p=new URL(url).pathname.toLowerCase();
 if(slot.id==="arb"&&/arb24|arbgunes|arb.gunes/.test(p))return false;
 if(slot.id==="atv-az"&&/alanya|kanal.?s/.test(p))return false;
 if(slot.id==="baku-tv"&&/bakusport/i.test(p))return false;
 return true;
}
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({serviceWorkers:"block",viewport:{width:1280,height:760}});
async function open(page:Page,url:string){
 const response=await page.goto(url,{waitUntil:"domcontentloaded",timeout:18_000});
 return response?.status()??0;
}
async function extract(url:string,site:SiteName,slot:Slot):Promise<{links:Candidate[];status:string}>{
 const page=await ctx.newPage();
 const captured=new Map<string,string>();
 const record=(url:string,by:string)=>{if(mediaUrl(url)&&sameBroadcaster(slot,url))captured.set(url,by)};
 page.on("request",r=>record(r.url(),"network"));
 page.on("response",r=>record(r.url(),"network-response"));
 try{
   const code=await open(page,url);
   if(code!==200)return {links:[],status:"source_http_"+code};
   const tags=await page.locator("video[src], video source[src], source[src]").evaluateAll(nodes=>nodes.map(n=>(n as HTMLMediaElement).src||n.getAttribute("src")||""));
   for(const value of tags)record(value,"video-source");
   const html=await page.content();
   const matches=[...html.matchAll(/https?:\/\/[^\s"'<>\\]{6,700}?\.m3u8(?:\?[^\s"'<>\\]*)?/gi)];
   for(const m of matches)record(m[0]!.replaceAll("&amp;","&"),"player-html");
   await page.waitForTimeout(2200);
   const frames=page.frames().filter(f=>f!==page.mainFrame()&&!/google|doubleclick|adservice/i.test(f.url()));
   for(const frame of frames){
     const tags=await frame.locator("video source[src], video[src]").evaluateAll(nodes=>nodes.map(n=>(n as HTMLMediaElement).src||n.getAttribute("src")||"")).catch(()=>[]);
     for(const value of tags)record(value,"player-iframe");
   }
   const found=[...captured.entries()].map(([value,foundBy])=>({url:value,site,page:url,foundBy}));
   found.sort((a,b)=>Number(b.foundBy==="video-source")-Number(a.foundBy==="video-source"));
   return {links:found,status:found.length?"found_hls":"no_direct_hls_found"};
 }catch(e){return {links:[],status:"page_error_"+String(e instanceof Error?e.message:e).slice(0,90)}}
 finally{await page.close();}
}
const cat=await ctx.newPage();
let categoryLinks:Array<{name:string;url:string}>=[];
try{
 const code=await open(cat,icanliveCategory);
 if(code===200){
 categoryLinks=await cat.locator("a[href*='/canli/']").evaluateAll(nodes=>nodes
   .map(n=>({name:n.textContent?.trim()||"",url:(n as HTMLAnchorElement).href}))
   .filter(n=>/^https:\/\/(?:www\.)?icanlive\.tv\/canli\/\d+\/[^/]+\.html$/i.test(n.url)));
 }
 console.log("[SOURCE CATALOG]",JSON.stringify({site:"icanlive",code,links:categoryLinks.length}));
}catch(e){console.log("[SOURCE CATALOG]",JSON.stringify({site:"icanlive",error:String(e).slice(0,120)}));}
await cat.close();
const reports:SlotReport[]=[];
for(const slot of slots){
 let selected:Candidate|undefined, reason="";
 const matched=categoryLinks.filter(link=>aliases[slot.id]!.includes(clean(link.name)));
 // Explicitly exclude ATV Alanya and ATV-related unrelated station names.
 if(matched.length){
  for(const match of matched.slice(0,2)){
    const result=await extract(match.url,"icanlive",slot);
    console.log("[SITE CAPTURE]",JSON.stringify({id:slot.id,site:"icanlive",code:result.status,found:result.links.length}));
    selected=result.links[0];reason=result.status;
    if(selected)break;
  }
 }else reason="not_in_icanlive_az_catalogue";
 if(!selected){
   const result=await extract("https://operativmm.az/az/canli-tv/"+operativSlugs[slot.id],"operativmm",slot);
   console.log("[SITE CAPTURE]",JSON.stringify({id:slot.id,site:"operativmm",code:result.status,found:result.links.length}));
   selected=result.links[0];
   if(!selected)reason+="; operativmm_"+result.status;
 }
 reports.push({...slot,status:selected?"source_url_collected_no_playback_check":"no_direct_hls_found",
  ...(selected?{chosen:selected}:{}),reason});
}
await ctx.close();await browser.close();
const selected=reports.filter(r=>r.chosen),playlist=["#EXTM3U"];
for(const item of selected){
  const url=item.chosen!.url;
  playlist.push('#EXTINF:-1 tvg-id="'+item.id+'" tvg-name="'+item.name+'" group-title="Azərbaycan",'+item.name);
  playlist.push("#EXTVLCOPT:http-referrer="+new URL(item.chosen!.page).origin+"/");
  playlist.push("#EXTVLCOPT:http-origin="+new URL(item.chosen!.page).origin);
  playlist.push(url);
}
const out={mode:"recent-user-sites-no-playback-validation",updatedAt:new Date().toISOString(),
  sites:[icanliveCategory,"https://operativmm.az/az/canli-tv"],
  disclaimer:"Captured real HLS URLs from source page/player; no HTTP/HLS/ffprobe/playback check. No AZ-IP guarantee.",
  slots:reports,found:selected.length,missing:12-selected.length};
fs.mkdirSync("output",{recursive:true});
fs.writeFileSync("output/recent-site-status.json",JSON.stringify(out,null,2)+"\n");
fs.writeFileSync("output/azerbaijan-fixed.m3u",playlist.join("\n")+"\n");
console.log("[SITE CAPTURE SUMMARY]",JSON.stringify({found:selected.map(s=>({id:s.id,source:s.chosen!.site,host:new URL(s.chosen!.url).hostname})),missing:reports.filter(x=>!x.chosen).map(x=>({id:x.id,reason:x.reason}))}));
