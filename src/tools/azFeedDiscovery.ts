import { isDirectManifestUrl } from "../playlistGuard.js";
import { isForbiddenUrl } from "../validator.js";
import { isAdvertisingStream } from "../sourcePolicy.js";

export type LiveCandidate={source:string;url:string};
export type FeedStation={id:string;name:string};
export type FeedReport={source:string;entries:number;accepted:number;error?:string};
const FEEDS=[
  {source:"iptv-org-az",url:"https://raw.githubusercontent.com/iptv-org/iptv/master/streams/az.m3u"},
  {source:"free-tv-az",url:"https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_azerbaijan.m3u8"},
  {source:"yusiff-az-tr",url:"https://raw.githubusercontent.com/Yusiff0/IPTV-Azerbaycan-ve-Turkiye-kanallari/main/az_tr.m3u"},
  {source:"simuratli-az",url:"https://raw.githubusercontent.com/Simuratli/iptv/master/Global%20IPTV%20Azerbaijan.m3u"}
] as const;

function key(raw:string):string{
  return raw.toLocaleLowerCase("az").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,"").replace(/ı/g,"i").replace(/ə/g,"e")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
const IDS:Record<string,string>={
  "aztv":"aztv","aztv az sd":"aztv","aztv az hd":"aztv",
  "ictimai tv":"ictimai-tv","ictimai":"ictimai-tv","ictimai tv az sd":"ictimai-tv",
  "idman tv":"idman-tv","idman azerbaycan tv":"idman-tv","idman":"idman-tv",
  "medeniyyet tv":"medeniyyet-tv","medeniyyet":"medeniyyet-tv",
  "xezer tv":"xezer-tv","xezer":"xezer-tv",
  "azad tv":"atv-az","azad azerbaycan tv":"atv-az","atv azerbaycan":"atv-az","atv":"atv-az",
  "arb":"arb","arb tv":"arb",
  "space tv":"space-tv","space":"space-tv",
  "cbc sport":"cbc-sport","cbc sport hd":"cbc-sport",
  "real tv":"real-tv","real":"real-tv",
  "arb24":"arb24","arb 24":"arb24",
  "baku tv":"baku-tv","baku":"baku-tv"
};
const TVG_IDS:Record<string,string>={
  "aztv az":"aztv","ictimai tv az":"ictimai-tv","ictima itv az":"ictimai-tv","ictimai tv":"ictimai-tv",
  "idman tv az":"idman-tv","medeniyyet tv az":"medeniyyet-tv","xezer tv az":"xezer-tv",
  "azad tv az":"atv-az","arb az":"arb","space tv az":"space-tv",
  "cbc sport az":"cbc-sport","real tv az":"real-tv","arb24 az":"arb24","baku tv az":"baku-tv"
};
function identify(title:string,rawTvg:string,group:string,source:string):string|undefined{
  const tvg=key(rawTvg.replace(/@(?:sd|hd|fhd).*$/i,""));
  const name=key(title.replace(/\([^)]*(?:\d+p|hd|sd|fullhd)[^)]*\)/gi,"")
    .replace(/\[(?:geo.blocked|not 24\/7|offline|720p|1080p)[^\]]*\]/gi,""));
  const byId=TVG_IDS[tvg];
  const byName=IDS[name];
  if(byId&&byName&&byId!==byName)return undefined;
  const found=byId||byName;
  if(!found)return undefined;
  // Mixed AZ/TR playlist: only assign ATV to Azerbaijan with explicit AZ metadata.
  if(found==="atv-az" && source==="yusiff-az-tr" &&
      !/(?:azad.*\.az|atv\.az)/i.test(rawTvg) && !/azerbaycan|azerbaijan/i.test(group))return undefined;
  return found;
}
export function safeCandidate(url:string):boolean{
  if(/yoda|yodacdn/i.test(url) || !isDirectManifestUrl(url) || isAdvertisingStream(url) ||
    isForbiddenUrl(url,{allowLivePath:true}))return false;
  try{
    const host=new URL(url).hostname.toLowerCase();
    if(host==="0.0.0.0"||host.endsWith(".local")||host.endsWith(".internal")||
      /^169\.254\./.test(host)||host==="[::1]")return false;
    return true;
  }catch{return false;}
}
export function parseTrustedM3u(text:string,source:string):Array<{id:string;candidate:LiveCandidate}>{
  const rows:Array<{id:string;candidate:LiveCandidate}>=[];
  if(text.length>2_000_000||!text.trimStart().startsWith("#EXTM3U"))return rows;
  let pending:{id:string}|undefined;
  for(const line of text.split(/\r?\n/)){
    const row=line.trim();
    if(row.startsWith("#EXTINF")){
      const name=row.split(",").slice(1).join(",").trim();
      const tvg=row.match(/tvg-id="([^"]+)"/)?.[1]??"";
      const group=row.match(/group-title="([^"]+)"/)?.[1]??"";
      const id=identify(name,tvg,group,source);
      pending=id?{id}:undefined;
    }else if(row.startsWith("#"))continue;
    else if(pending&&/^https?:\/\//i.test(row)){
      // Candidate URLs are provenance checked and must still pass video probes.
      const uri=row.split("|")[0]!;
      if(safeCandidate(uri))rows.push({id:pending.id,candidate:{source,url:uri}});
      pending=undefined;
    }else if(row){pending=undefined;}
  }
  return rows;
}
export async function gatherExternalSources():Promise<{candidates:Map<string,LiveCandidate[]>;report:FeedReport[]}>{
  const candidates=new Map<string,LiveCandidate[]>(),report:FeedReport[]=[];
  await Promise.all(FEEDS.map(async feed=>{
    try{
      const r=await fetch(feed.url,{headers:{"User-Agent":"AZ-fixed12-source-discovery/1.0"},
        signal:AbortSignal.timeout(12_000)});
      if(!r.ok)throw Error("http_"+r.status);
      const raw=await r.text();
      const rows=parseTrustedM3u(raw,feed.source);
      for(const row of rows)candidates.set(row.id,[...(candidates.get(row.id)??[]),row.candidate]);
      report.push({source:feed.source,entries:(raw.match(/^#EXTINF/gm)??[]).length,accepted:rows.length});
    }catch(e){report.push({source:feed.source,entries:0,accepted:0,error:String(e instanceof Error?e.message:e).slice(0,100)});}
  }));
  return {candidates,report:report.sort((a,b)=>a.source.localeCompare(b.source))};
}
