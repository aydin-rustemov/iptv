import assert from "node:assert/strict";
import { test } from "node:test";
import { YODA_CATALOGUE } from "../src/sources/yodaCatalogue.js";
import {
  allowedUpstream, channelById, manifestForGateway, MediaRegistry,
  matchesChannel, rewriteHls, tokenExpiryMs
} from "../src/gateway/hls.js";

test("Only trusted Yoda HTTPS CDN, never arbitrary URLs/private proxy targets", () => {
  assert.equal(allowedUpstream("https://str.yodacdn.net/arb/index.m3u8"), true);
  for (const url of [
    "http://str.yodacdn.net/arb/index.m3u8",
    "https://str.yodacdn.net.evil.example/arb/index.m3u8",
    "https://127.0.0.1/private",
    "file:///etc/passwd",
    "https://user:password@str.yodacdn.net/arb/index.m3u8"
  ]) assert.equal(allowedUpstream(url), false, url);
});

test("ARB, ARB Gunes, AzTV and Real require exact path identity", () => {
  const arb = channelById("arb")!, gunes = channelById("arb-gunes")!;
  const real = channelById("real-tv")!;
  assert.ok(arb && gunes && real);
  assert.equal(matchesChannel("https://str.yodacdn.net/ntv/video.m3u8", arb), false);
  assert.equal(matchesChannel("https://str.yodacdn.net/arbgunes/mono.m3u8", arb), false);
  assert.equal(matchesChannel("https://str.yodacdn.net/arbgunes/mono.m3u8", gunes), true);
  assert.equal(matchesChannel("https://str.yodacdn.net/arb/index.m3u8", arb), true);
  assert.equal(matchesChannel("https://str.yodacdn.net/real/index.m3u8", real), true);
});

test("Expiry on provider-supplied tokens is read without changing/synthesizing credentials", () => {
  const exp = Math.floor(Date.now() / 1000) + 600;
  const token = Buffer.from(JSON.stringify({ v:2, site:"yoda", exp }), "utf8").toString("base64url") + ".example";
  const link = "https://str.yodacdn.net/arb/index.m3u8?token=" + token;
  assert.equal(tokenExpiryMs(link), exp * 1000);
});

test("HLS URL resolver safely rewrites master variant, segments, AES keys, init maps", () => {
  const original = "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",URI=\"audio/index.m3u8\"\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:4,\nsegment01.ts\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\n720p/index.m3u8\n";
  const r = new MediaRegistry();
  const output = rewriteHls(original, "https://str.yodacdn.net/arb/master.m3u8",
    "arb", "http://192.168.1.88:8787", r);
  const keys = [...output.matchAll(/http:\/\/192\.168\.1\.88:8787\/media\/([a-f0-9-]{36})/g)]
    .map(x => x[1]!);
  assert.equal(keys.length, 5);
  const upstream = keys.map(k => r.lookup(k)?.url);
  assert.deepEqual(upstream, [
    "https://str.yodacdn.net/arb/audio/index.m3u8",
    "https://str.yodacdn.net/arb/key.bin",
    "https://str.yodacdn.net/arb/init.mp4",
    "https://str.yodacdn.net/arb/segment01.ts",
    "https://str.yodacdn.net/arb/720p/index.m3u8"
  ]);
  assert.equal(output.includes("token="), false);
});

test("An HLS manifest redirecting video segment to an untrusted host is rejected", () => {
  const m = "#EXTM3U\nhttps://malicious.example/private.ts";
  assert.throws(() => rewriteHls(m, "https://str.yodacdn.net/arb/master.m3u8",
    "arb", "http://127.0.0.1:8787", new MediaRegistry()), /Disallowed/);
});

test("Only 29 known broadcaster IDs become stable player URLs", () => {
  const txt = manifestForGateway(YODA_CATALOGUE, "http://192.168.1.88:8787");
  assert.equal((txt.match(/^#EXTINF/gm) ?? []).length, 29);
  assert.match(txt, /\/live\/arb\/index\.m3u8/);
  assert.match(txt, /\/live\/real-tv\/index\.m3u8/);
  assert.equal(txt.includes("str.yodacdn.net"), false);
  assert.equal(channelById("../../../etc/passwd"), undefined);
});
