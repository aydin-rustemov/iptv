import fs from "node:fs";
import { fastCheck, mediaCheck } from "../validator.js";
import type { PlaylistEntry } from "../types.js";

const catalog: Array<[string,string,string,string]> = [
  ["aztv","AzTV","iptv-org","https://str.yodacdn.net/azertv/index.m3u8"],
  ["aztv","AzTV","community-cinerama","https://stream8.cinerama.uz/1455/tracks-v1a1/mono.m3u8"],
  ["ictimai-tv","İctimai TV","iptv-org","https://live.itv.az/itv.m3u8"],
  ["ictimai-tv","İctimai TV","community-moby","https://tv.mobyservice.ru/Ictimai/tracks-v1a1/mono.m3u8"],
  ["atv-az","ATV Azərbaycan","iptv-org","https://lives.atv.az:5443/ATV_TV_STREAM/streams/atvcanli.m3u8"],
  ["xezer-tv","Xəzər TV","iptv-org","https://www.xezerxeber.az/stream/index.m3u8"],
  ["xezer-tv","Xəzər TV","community-moby","https://tv.mobyservice.ru/Xezer/tracks-v1a1/mono.m3u8"],
  ["arb","ARB","community-old-server","http://109.205.166.68/server124/arb/index.m3u8"],
  ["arb","ARB","community-livetv","https://streams.livetv.az/azerbaijan/arb/playlist.m3u8"],
  ["arb","ARB","community-moby","https://tv.mobyservice.ru/ARB/tracks-v1a1/mono.m3u8"],
  ["arb","ARB","yoda-unsigned","https://str.yodacdn.net/arb/tracks-v1a1/mono.ts.m3u8"],
  ["space-tv","Space TV","community-old-server","http://109.205.166.68/server124/space_tv/index.m3u8"],
  ["space-tv","Space TV","community-livetv","https://streams.livetv.az/azerbaijan/space_stream/playlist.m3u8"],
  ["space-tv","Space TV","community-moby","https://tv.mobyservice.ru/Space/tracks-v1a1/mono.m3u8"],
  ["space-tv","Space TV","yoda-unsigned","https://str.yodacdn.net/space/index.m3u8"],
  ["real-tv","Real TV","community-moby","https://tv.mobyservice.ru/Real/tracks-v1a1/mono.m3u8"],
  ["real-tv","Real TV","yoda-unsigned","https://str.yodacdn.net/real/index.m3u8"],
  ["medeniyyet-tv","Mədəniyyət TV","iptv-org","https://str.yodacdn.net/medeniyyettele/index.m3u8"],
  ["medeniyyet-tv","Mədəniyyət TV","community-yoda","https://str.yodacdn.net/medeniyyet/index.m3u8"],
  ["arb24","ARB24","community-moby","https://tv.mobyservice.ru/ARB24/tracks-v1a1/mono.m3u8"],
  ["arb24","ARB24","community-old-server","http://85.132.81.184:8080/arb24/live1/index.m3u8"],
  ["cbc-sport","CBC Sport","iptv-org","https://mn-nl.mncdn.com/cbcsports_live/cbcsports/playlist.m3u8"],
  ["cbc-sport","CBC Sport","community-livesports","https://cbcsports-live.lg.mncdn.com/cbcsports_live/cbcsports/chunklist.m3u8"],
  ["baku-tv","Baku TV","iptv-org","https://rtmp.baku.tv/hls/bakutv.m3u8"],
  ["baku-tv","Baku TV","community-1080","https://rtmp.baku.tv/hls/bakutv_1080p.m3u8"],
  ["naxcivan-tv","Naxçıvan TV","iptv-org","https://str2.yodacdn.net/ntv/video.m3u8"],
  ["eltv","ELTV","iptv-org","https://live.eltv.az/live/eltv/playlist.m3u8"],
  ["kanal-s","Kanal S","iptv-org","https://lives.atv.az:5443/KANAL-S/streams/kanals.m3u8"],
  ["kanal-35","Kanal 35","iptv-org","https://str2.yodacdn.net/kanal35/index.m3u8"],
  ["kapaz-tv","Kəpəz TV","iptv-org","http://85.132.78.122:8050/hls/stream/index.m3u8"],
  ["apa-tv","APA TV","iptv-org","http://stream.apa.tv/apastream/index.m3u8"],
  ["ayaz-tv","Ayaz TV","iptv-org","https://janya-ayaztv.vgcdn.net/ptnr-WebApp/title-Ayaz_TV/v1/vglive-sk-934820/main.m3u8"],
  ["anewz","AnewZ","iptv-org","https://53be5ef2d13aa.streamlock.net/cubesanewz-secure/smil:cubesanewz-secure-web.smil/playlist.m3u8"],
  ["alvin","Alvin Channel TV","iptv-org","https://cdn10-alvinchannel.yayin.com.tr/alvinchannel/alvinchannel/playlist.m3u8"],
  ["kn-music","KN Music TV","iptv-org","https://cdn4.yayin.com.tr/kntv/tracks-v1a1/mono.m3u8"],
  ["vilayet-tv","Vilayət TV","iptv-org","https://nl.livekadeh.com/hls2/vilayet.m3u8"]
];

const clean = (item: [string,string,string,string]): PlaylistEntry => ({
  priorityId:item[0],tvgId:item[0],name:item[1],tvgName:item[1],sourceName:item[2],
  url:item[3],country:"Azərbaycan",groupTitle:"Azərbaycan",
  category:"General",headers:{},allowLivePath:true
});
const pool=8;let next=0;
type Result={id:string;name:string;source:string;url:string;status:string;codec?:string;bytes?:number;httpMs?:number};
const results:Result[]=new Array(catalog.length);
async function check(i:number):Promise<void>{
  const entry=clean(catalog[i]!);
  const output:Result={id:entry.tvgId!,name:entry.name,source:entry.sourceName,url:entry.url,status:"unknown"};
  try{
    const fast=await fastCheck(entry);
    if(!fast.ok){output.status=fast.reason??"network_error";}
    else{
      output.httpMs=fast.latencyMs;
      const m=await mediaCheck(entry,fast);
      if(m.ok&&m.hasVideo){
        const second=await fastCheck(entry);
        output.status=second.ok?"gh_video_confirmed":"transient_"+(second.reason??"unknown");
        output.codec=m.videoCodec;output.bytes=m.bytesRead;
      } else output.status=m.reason??"no_video";
    }
  }catch(e){output.status="error_"+String(e instanceof Error?e.message:e).slice(0,90);}
  results[i]=output;
  console.log("[AZ-PROBE]",JSON.stringify({id:output.id,source:output.source,status:output.status,host:new URL(output.url).hostname}));
}
await Promise.all(Array.from({length:pool},async()=>{while(next<catalog.length){const i=next++;await check(i);}}));
const passed=results.filter(x=>x.status==="gh_video_confirmed");
fs.mkdirSync("output",{recursive:true});
fs.writeFileSync("output/az-live-probe.json",JSON.stringify({
  updatedAt:new Date().toISOString(),
  runner:"github-hosted-non-azerbaijan-ip",
  proof:"HLS manifest + ffprobe segment video + immediate second manifest request; does not prove broadcaster identity or Azerbaijani device playback",
  tested:results.length,passed:passed.length,results
},null,2)+"\n");
const seen=new Set<string>(),playlist=["#EXTM3U"];
for(const item of passed){if(seen.has(item.id))continue;seen.add(item.id);
  playlist.push('#EXTINF:-1 tvg-id="'+item.id+'" tvg-name="'+item.name+'" group-title="Azərbaycan",'+item.name);
  playlist.push(item.url);
}
fs.writeFileSync("output/az-gh-confirmed.m3u",playlist.join("\n")+"\n");
console.log("[AZ-PROBE-SUMMARY]",JSON.stringify({total:catalog.length,confirmed:passed.length,channels:[...seen],errors:results.filter(x=>x.status!=="gh_video_confirmed").map(x=>({id:x.id,reason:x.status}))}));
