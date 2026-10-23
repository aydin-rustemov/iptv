import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { isDirectManifestUrl } from "../src/playlistGuard.js";
const file=JSON.parse(fs.readFileSync("config/az-fixed12.json","utf8")) as {
  mode:string;channels:Array<{id:string;name:string;order:number;group:string;candidates:Array<{source:string;url:string}>}>
};
test("exact twelve channels remain in user-specified order",()=>{
  assert.equal(file.mode,"fixed-12-non-yoda");
  assert.deepEqual(file.channels.map(c=>c.id),[
    "aztv","ictimai-tv","idman-tv","medeniyyet-tv","xezer-tv","atv-az",
    "arb","space-tv","cbc-sport","real-tv","arb24","baku-tv"
  ]);
  assert.deepEqual(file.channels.map(c=>c.order),Array.from({length:12},(_,i)=>i+1));
  assert.equal(new Set(file.channels.map(c=>c.id)).size,12);
});
test("no Yoda anywhere, all candidate source URLs are HLS and station-specific",()=>{
  for(const channel of file.channels){
    assert.ok(channel.candidates.length>=2,channel.id);
    assert.ok(channel.name.trim());
    for(const candidate of channel.candidates){
      assert.ok(isDirectManifestUrl(candidate.url),candidate.url);
      assert.ok(!/yodacdn|yoda\.az|yoda/i.test(candidate.url+" "+candidate.source),channel.id);
      const u=new URL(candidate.url);
      const station=(u.hostname+u.pathname).toLowerCase();
      if(channel.id==="arb")assert.ok(!/arb24|arb-gunes|arbgunes/.test(station));
      if(channel.id==="atv-az")assert.ok(!/alanya|kanal-s|kanal_s/.test(station));
    }
  }
});
test("unavailable stations retain identity slots: never substitute a different stream",()=>{
  assert.ok(file.channels.some(x=>x.id==="arb"&&x.name==="ARB"));
  assert.ok(file.channels.some(x=>x.id==="arb24"&&x.name==="ARB 24"));
  assert.ok(file.channels.some(x=>x.id==="atv-az"&&x.name==="ATV Azərbaycan"));
});
