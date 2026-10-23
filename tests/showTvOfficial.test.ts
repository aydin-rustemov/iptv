import assert from "node:assert/strict";
import { test } from "node:test";
import { isOfficialShowTvStream, pickOfficialShowTv } from "../src/sources/showTvOfficial.js";

test("Official Show TV player URL identity cannot be replaced by a different broadcaster",()=>{
  assert.equal(isOfficialShowTvStream("https://ciner.daioncdn.net/showtv/showtv_1080p.m3u8?ex=1664766175&st=sample"),true);
  assert.equal(isOfficialShowTvStream("https://ciner.daioncdn.net/showtv/showtv.m3u8?ce=3"),true);
  for(const url of [
    "http://ciner.daioncdn.net/showtv/showtv.m3u8",
    "https://ciner.daioncdn.net.evil.example/showtv/showtv_1080p.m3u8",
    "https://ciner.daioncdn.net/showtv/showturk.m3u8",
    "https://ciner.daioncdn.net/alanyatv/showtv_1080p.m3u8",
    "https://ciner.daioncdn.net/showtv/advertisement.m3u8"
  ]) assert.equal(isOfficialShowTvStream(url),false,url);
});

test("Prefer Show TV's real network 200 1080p HLS response over stale HTML candidates",()=>{
  const picked=pickOfficialShowTv([
    {url:"https://ciner.daioncdn.net/showtv/showtv.m3u8",kind:"player-html",quality:25},
    {url:"https://ciner.daioncdn.net/showtv/showtv_480p.m3u8?ex=1664766175",kind:"network-response",status:200,quality:45},
    {url:"https://ciner.daioncdn.net/showtv/showtv_1080p.m3u8?ex=1664766175",kind:"network-response",status:200,quality:100}
  ]);
  assert.equal(new URL(picked!.url).pathname,"/showtv/showtv_1080p.m3u8");
  assert.equal(picked!.status,200);
});

test("Reject arbitrary third-party URLs even if labeled Show TV",()=>{
  assert.equal(pickOfficialShowTv([
    {url:"https://cdn-alanyatv.yayin.com.tr/alanya/index.m3u8",kind:"network-response",status:200,quality:100},
    {url:"https://ciner.daioncdn.net/fox/nowtv.m3u8",kind:"network-response",status:200,quality:100}
  ]),undefined);
});
