import assert from "node:assert/strict";
import { test } from "node:test";
import { isAdvertisingStream, isKnownBrokenOnDevice, normalizeBroadcaster, sourceTier, validCandidateIdentity } from "../src/sourcePolicy.js";
import { confirmLongerLivedStreams, orderedFallbacks } from "../src/stability.js";
import type { PlaylistEntry, ValidatedEntry } from "../src/types.js";

function stream(name: string, id: string, url: string, country: string, sourceName: string): PlaylistEntry {
  return { name, tvgName: name, tvgId: id, priorityId: id, url, country,
    groupTitle: country, sourceName, headers: {} };
}
function verified(e: PlaylistEntry, score = 40): ValidatedEntry {
  return { ...e, normalizedUrl: e.url, score, fast: { ok: true },
    media: { ok: true, hasVideo: true, hasAudio: true, bytesRead: 4096 } };
}

test("Google ad HLS is not a broadcast even if it has valid video", () => {
  const url = "https://gcdn.2mdn.net/api/manifest/hls_variant/source/web_video_ads/id/abc/playlist_type/LIVE/xpc/a";
  assert.equal(isAdvertisingStream(url), true);
  assert.equal(validCandidateIdentity(stream("Xəzər TV", "xezer-tv", url, "Azərbaycan", "yoda-az")), false);
});

test("Wrongly grouped AZ broadcaster is restored to Azerbaijan before matching", () => {
  const atv = normalizeBroadcaster(stream("Atv Azad TV", "other", 
    "https://lives.atv.az:5443/ATV_TV_STREAM/streams/atvcanli.m3u8?hash=a",
    "Türkiyə", "canlitv-date"));
  assert.equal(atv.country, "Azərbaycan");
  assert.equal(atv.name, "ATV Azərbaycan");
  assert.equal(atv.priorityId, "atv-az");
  assert.equal(validCandidateIdentity(atv), true);
});

test("Yoda first, alternative source next, broadcaster link last", () => {
  const a = stream("ARB", "arb", "https://str.yodacdn.net/arb/index.m3u8", "Azərbaycan", "yoda-az");
  const b = stream("ARB", "arb", "https://arb.tvstream.az/hls/stream10/index.m3u8", "Azərbaycan", "tvstream-az");
  const c = stream("ARB", "arb", "https://iptv.example/arb.m3u8", "Azərbaycan", "iptv-org-azerbaijan");
  const d = stream("ARB", "arb", "https://arb.example/arb.m3u8", "Azərbaycan", "official-last-resort");
  assert.deepEqual([a,b,c,d].map(sourceTier), [0,1,2,3]);
  assert.deepEqual(orderedFallbacks([verified(d,100), verified(c,200), verified(b,5), verified(a,0)]).map(x => x.sourceName),
    ["yoda-az", "tvstream-az", "iptv-org-azerbaijan", "official-last-resort"]);
});

test("Selected stream failing its second probe falls back to another source", async () => {
  const yoda = verified(stream("ARB", "arb", "https://str.yodacdn.net/arb/index.m3u8", "Azərbaycan", "yoda-az"));
  const backup = verified(stream("ARB", "arb", "https://arb.tvstream.az/hls/stream10/index.m3u8", "Azərbaycan", "tvstream-az"));
  const r = await confirmLongerLivedStreams([yoda], [yoda,backup], async (e) => e.sourceName === "tvstream-az", 0);
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0]?.sourceName, "tvstream-az");
  assert.equal(r.switched.length, 1);
  assert.equal(r.failed.length, 1);
});

test("User-reported dead streams and wrong Turkish video are never republished", async () => {
  const badAz = verified(stream("Mədəniyyət TV", "medeniyyet-tv", 
    "https://yayin2.canlitv.fun/live/medeniyettv.stream/playlist.m3u8?hash=x", "Azərbaycan", "canlitv-date"));
  const badTr = verified(stream("TV8", "tv8", 
    "http://315e5a5d.ottrast.com/iptv/8KSD5KFDXA6H88/2454/index.m3u8", "Türkiyə", "community-turkey-candidate"));
  assert.equal(isKnownBrokenOnDevice(badAz), true);
  assert.equal(isKnownBrokenOnDevice(badTr), true);
  const r = await confirmLongerLivedStreams([badAz,badTr], [badAz,badTr], async () => true, 0);
  assert.equal(r.entries.length, 0);
});
