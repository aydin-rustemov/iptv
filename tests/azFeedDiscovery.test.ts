import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTrustedM3u, safeCandidate } from "../src/tools/azFeedDiscovery.js";

test("Only exact national Azerbaijani broadcaster names and tvg IDs are selected",()=>{
  const raw="#EXTM3U\n"+
    '#EXTINF:-1 tvg-id="ARB.az",ARB\nhttps://example.com/arb/master.m3u8\n'+
    '#EXTINF:-1 tvg-id="ARBGunes.az",ARB Günəş\nhttps://example.com/arbgunes/index.m3u8\n'+
    '#EXTINF:-1 tvg-id="AzadTV.az",Azad TV\nhttps://example.com/atv/master.m3u8\n'+
    '#EXTINF:-1 tvg-id="KanalS.az",Kanal S\nhttps://example.com/kanal-s/master.m3u8\n';
  const r=parseTrustedM3u(raw,"iptv-org-az");
  assert.deepEqual(r.map(x=>x.id),["arb","atv-az"]);
});
test("Never accept ARB Gunes as ARB or Turkish Alanya TV as Azerbaijan ATV",()=>{
  const raw="#EXTM3U\n"+
    '#EXTINF:-1 tvg-id="" group-title="Turkey",ATV\nhttps://example.com/alanya/playlist.m3u8\n'+
    '#EXTINF:-1 tvg-id="AzadTV.az" group-title="Azerbaijan",Azad TV\nhttps://example.com/atv/playlist.m3u8\n';
  const r=parseTrustedM3u(raw,"yusiff-az-tr");
  assert.deepEqual(r.map(x=>x.id),["atv-az"]);
});
test("Disallow Yoda streams, HTML player, advertising and private addresses",()=>{
  for(const url of [
    "https://str.yodacdn.net/arb/index.m3u8",
    "https://yoda.az/tv/arb/",
    "https://gcdn.2mdn.net/api/manifest/hls_variant/source/web_video_ads/live.m3u8",
    "http://192.168.1.20/live/index.m3u8",
    "http://169.254.1.1/live/index.m3u8"
  ])assert.equal(safeCandidate(url),false,url);
  assert.equal(safeCandidate("https://lives.atv.az:5443/ATV_TV_STREAM/streams/atvcanli.m3u8"),true);
});
test("Exact station tvg-ID wins over unrelated title and avoids the mixup",()=>{
  const txt="#EXTM3U\n"+
    '#EXTINF:-1 tvg-id="ARB24.az",ARB\nhttps://example.com/arbgunes/index.m3u8\n'+
    '#EXTINF:-1 tvg-id="BakuTV.az",Baku.TV\nhttps://rtmp.baku.tv/hls/bakutv.m3u8\n';
  const result=parseTrustedM3u(txt,"iptv-org-az");
  assert.deepEqual(result.map(x=>x.id),["baku-tv"]);
});
