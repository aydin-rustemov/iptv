import fs from "node:fs";
import { fastCheck, mediaCheck, isForbiddenUrl } from "../validator.js";
import { isDirectManifestUrl } from "../playlistGuard.js";
import { isAdvertisingStream } from "../sourcePolicy.js";
import type { PlaylistEntry } from "../types.js";

type Candidate = { source: string; url: string };
type FixedChannel = { id:string; name:string; group:string; order:number; candidates:Candidate[] };
type FixedConfig = { mode:string; channels:FixedChannel[] };
type Probe = { source:string; url:string; state:string; codec?:string; latencyMs?:number };
type ChannelState = { id:string;name:string;group:string;order:number;status:"video_confirmed_on_github"|"no_confirmed_stream"; source?:string; url?:string; probes:Probe[] };
const sourceFile="config/az-fixed12.json";
const outRoot="output";
const config=JSON.parse(fs.readFileSync(sourceFile,"utf8")) as FixedConfig;
const expected=[
  "aztv","ictimai-tv","idman-tv","medeniyyet-tv","xezer-tv","atv-az",
  "arb","space-tv","cbc-sport","real-tv","arb24","baku-tv"
];
if(config.mode!=="fixed-12-non-yoda" ||
  JSON.stringify(config.channels.map(x=>x.id))!==JSON.stringify(expected) ||
  config.channels.some((ch,i)=>ch.order!==i+1||!ch.name||!ch.candidates?.length)){
  throw new Error("The fixed 12 station order/identity has changed");
}
const all=config.channels.flatMap(ch=>ch.candidates.map(c=>({ch,c})));
const seen=new Set<string>();
for(const {ch,c} of all){
  if(/yoda|yodacdn/i.test(c.url+" "+c.source)) throw Error("Yoda is prohibited: "+ch.id);
  if(!isDirectManifestUrl(c.url)||isForbiddenUrl(c.url,{allowLivePath:true})||isAdvertisingStream(c.url))throw Error("Unsafe/non-HLS candidate: "+ch.id);
  const key=ch.id+"|"+c.url;
  if(seen.has(key))throw Error("Duplicate source candidate: "+key);
  seen.add(key);
}
function channelEntry(ch:FixedChannel,c:Candidate):PlaylistEntry{
  return {name:ch.name,tvgName:ch.name,tvgId:ch.id,priorityId:ch.id,priorityName:ch.name,
    country:"Azərbaycan",groupTitle:ch.group,priorityCountry:"Azərbaycan",sourceName:c.source,
    category:ch.group,url:c.url,headers:{},allowLivePath:true};
}
function identityCompatible(ch:FixedChannel,c:Candidate):boolean{
  let parsed:URL;
  try {parsed=new URL(c.url);} catch{return false;}
  const path=(parsed.hostname+parsed.pathname).toLowerCase();
  if(ch.id==="arb" && /arbgunes|arb24|arb-24/.test(path))return false;
  if(ch.id==="atv-az" && /kanal[-_]?s|alanya|arbgunes/.test(path))return false;
  if(ch.id==="xezer-tv" && /web_video_ads|2mdn\.net/.test(path))return false;
  if(ch.id==="idman-tv" && /medeni|medeniyyet/.test(path))return false;
  if(ch.id==="medeniyyet-tv" && /idman|arb24/.test(path))return false;
  return true;
}
let cursor=0;
const checked:Probe[]=Array.from({length:all.length},()=>({source:"",url:"",state:"not_checked"}));
async function check(index:number):Promise<void>{
  const {ch,c}=all[index]!,record:Probe={source:c.source,url:c.url,state:"unknown"};
  checked[index]=record;
  try{
    if(!identityCompatible(ch,c)){record.state="wrong_channel_identity";return;}
    const entry=channelEntry(ch,c);
    const first=await fastCheck(entry);
    if(!first.ok){record.state=first.reason??"initial_check_failed";return;}
    if(first.finalUrl && /yoda|yodacdn/i.test(first.finalUrl)){
      record.state="redirected_to_disallowed_yoda";return;
    }
    record.latencyMs=first.latencyMs;
    const media=await mediaCheck(entry,first);
    if(!media.ok||!media.hasVideo){record.state=media.reason??"no_video";return;}
    record.codec=media.videoCodec;
    const again=await fastCheck(entry);
    if(!again.ok){record.state="second_check_"+(again.reason??"failed");return;}
    if(again.finalUrl && /yoda|yodacdn/i.test(again.finalUrl)){record.state="second_check_redirected_to_yoda";return;}
    record.state="video_confirmed_on_github";
  }catch(err){record.state="exception_"+String(err instanceof Error?err.message:err).slice(0,80);}
  finally{console.log("[FIXED12]",JSON.stringify({channel:ch.name,source:c.source,status:record.state,host:new URL(c.url).hostname}));}
}
await Promise.all(Array.from({length:8},async()=>{
  while(cursor<all.length){const id=cursor++;await check(id);}
}));
const states:ChannelState[]=config.channels.map(ch=>{
  const probes=all.flatMap(({ch:ref},index)=>ref.id===ch.id?[checked[index]!]:[]);
  const available=probes.find(x=>x.state==="video_confirmed_on_github");
  return {id:ch.id,name:ch.name,group:ch.group,order:ch.order,
    status:available?"video_confirmed_on_github":"no_confirmed_stream",
    ...(available?{source:available.source,url:available.url}:{}),probes};
});
const available=states.filter(s=>s.status==="video_confirmed_on_github");
const report={updatedAt:new Date().toISOString(),mode:"fixed-12-non-yoda",location:"github-runner-not-AZ",
  disclaimer:"HLS video and second manifest confirmed from GitHub IP only; AZ playback and pictured broadcaster NOT confirmed.",
  fixedCount:12,visibleInM3u:available.length,offlineOrGeoRestricted:12-available.length,
  sourceCandidates:all.length,sourceCandidatesPassed:checked.filter(p=>p.state==="video_confirmed_on_github").length,
  channels:states};
fs.mkdirSync(outRoot,{recursive:true});
fs.writeFileSync(outRoot+"/az-fixed12-status.json",JSON.stringify(report,null,2)+"\n","utf8");

const urls=new Set<string>();
const playlist=["#EXTM3U"];
for(const station of available){
  if(!station.url||urls.has(station.url))continue;
  urls.add(station.url);
  playlist.push('#EXTINF:-1 tvg-id="'+station.id+'" tvg-name="'+station.name+'" group-title="Azərbaycan",'+station.name);
  playlist.push(station.url);
}
const data=playlist.join("\n")+"\n";
fs.writeFileSync(outRoot+"/azerbaijan-fixed.m3u",data,"utf8");
if(available.length>0){
  // Publish only live-tested entries, NOT placeholder URL links for offline stations.
  fs.writeFileSync(outRoot+"/playlist.m3u",data,"utf8");
}
// Keep legacy status and audit in sync with this fixed 12-channel release.
// Do not claim phone/AZ-side playback: GitHub media verification is separate.
const copyM3u=["output/azerbaijan-manual.m3u","output/priority-test.m3u"];
for(const file of copyM3u) fs.writeFileSync(file,data,"utf8");
function getJson(path:string):Record<string,any>{
  try{return JSON.parse(fs.readFileSync(path,"utf8")) as Record<string,any>;}
  catch{return {};}
}
const meta=getJson("output/status.json");
meta.updatedAt=report.updatedAt;meta.published=available.length;
meta.sources=["fixed-12-non-yoda"];
meta.downloadedEntries=all.length;meta.uniqueCandidates=all.length;
meta.fastCheckPassed=checked.filter(p=>p.state==="video_confirmed_on_github").length;
meta.mediaCheckPassed=meta.fastCheckPassed;
meta.failed=all.length-meta.fastCheckPassed;
meta.countryCounts={"Azərbaycan":available.length,"Türkiyə":0,"Rusiya":0};
meta.categoryCounts={"Azərbaycan":available.length};
meta.degraded=available.length!==12;
meta.manualAzPlaylist=true;meta.manualAzRequiresDevicePlaybackTest=true;meta.fixed12Mode=true;
meta.priorityChannels=states.map(c=>({id:c.id,name:c.name,country:"Azərbaycan",priority:c.order,
  selectedSource:c.source??"none",candidatesFound:c.probes.length,
  candidatesValidated:c.probes.filter(p=>p.state==="video_confirmed_on_github").length,
  status:c.status,localPlaybackVerified:false}));
fs.writeFileSync("output/status.json",JSON.stringify(meta,null,2)+"\n","utf8");
const mandatory=getJson("output/mandatory-health.json");
const availableIds=new Set(available.map(x=>x.id));
mandatory.updatedAt=report.updatedAt;
mandatory.verified=[...availableIds];
mandatory.needsLocalTest=[];
mandatory.missingNoWebStream=(mandatory.details??[]).filter((ch:{id:string})=>!availableIds.has(ch.id)).map((ch:{id:string})=>ch.id);
for(const detail of mandatory.details??[]){
  detail.status=availableIds.has(detail.id)?"github_video_confirmed_local_playback_unknown":"no_github_video_confirmed_stream";
  detail.candidates=states.find(x=>x.id===detail.id)?.probes.length??0;
}
fs.writeFileSync("output/mandatory-health.json",JSON.stringify(mandatory,null,2)+"\n","utf8");
const health=getJson("output/channel-health.json");
health.updatedAt=report.updatedAt;health.published=available.length;
health.verifiedWorking=available.length;health.mandatoryVerified=mandatory.verified.length;
health.mandatoryNeedsLocalTest=[];health.mandatoryMissing=mandatory.missingNoWebStream;
health.countryCounts=meta.countryCounts;health.candidatesScanned=all.length;
health.candidatesWithVideo=meta.fastCheckPassed;health.rejected=meta.failed;
health.validation=report.disclaimer;
health.manualAzLocalTestPending=true;
health.selectedSources=available.map(x=>({id:x.id,name:x.name,source:x.source,
  urlHost:new URL(x.url!).hostname,sourceTier:1,localPlaybackVerified:false}));
health.sourcesLoaded=["fixed-12-non-yoda"];health.sourceErrors=[];
fs.writeFileSync("output/channel-health.json",JSON.stringify(health,null,2)+"\n","utf8");

const html=[
"<!DOCTYPE html><html lang=\"az\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
"<title>Azərbaycan IPTV — sabit 12 kanal</title><style>body{font:16px system-ui;background:#101827;color:#edf3ff;padding:20px;max-width:850px;margin:auto}h1{font-size:24px}p{color:#bac7d9}.station{display:flex;align-items:center;gap:16px;justify-content:space-between;padding:15px;margin:8px 0;border:1px solid #38465b;border-radius:10px}.name{font-weight:700}.status{color:#aebed6;font-size:13px}.online{color:#81d9b5}.offline{color:#ffcc8b}a{color:#a2ccff}</style></head><body>",
"<h1>Azərbaycan TV — sabit 12 kanal</h1>",
"<p>Bu siyahının adı və sırası dəyişmir. Xarici serverin video yoxlamasından keçənlər playlist-də görünür; keçməyənlərə saxta link əlavə olunmur. Bu, Azərbaycandakı cihaz testi deyil.</p>",
'<p><a href="./azerbaijan-fixed.m3u">Yoxlamadan keçən M3U</a></p>',
...states.map(c=>'<div class="station"><span class="name">'+c.order+". "+c.name+"</span><span class=\"status "+(c.status==="video_confirmed_on_github"?"online":"offline")+"\">"+(c.status==="video_confirmed_on_github"?"GitHub video testi keçib":"Təsdiqlənmiş yayım yoxdur")+"</span></div>"),
"</body></html>"
].join("\n");
fs.writeFileSync(outRoot+"/azerbaijan-fixed.html",html,"utf8");
console.log("[FIXED12-SUMMARY]",JSON.stringify({ordered:states.map(x=>x.name),visible:available.map(x=>x.id),unavailable:states.filter(x=>x.status!=="video_confirmed_on_github").map(x=>x.id),tested:all.length}));
