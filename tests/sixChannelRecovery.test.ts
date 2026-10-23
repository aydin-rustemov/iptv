import assert from "node:assert/strict";
import { test } from "node:test";
import { azSixCandidates, AZ_SIX_IDS } from "../src/sources/azSixCandidates.js";
import { isDirectManifestUrl } from "../src/playlistGuard.js";
import { isKnownBrokenOnDevice, normalizeBroadcaster, sourceTier, validCandidateIdentity } from "../src/sourcePolicy.js";
import { isMismatchedChannel } from "../src/channelMatchGuard.js";
import type { PlaylistEntry } from "../src/types.js";

const basic = (name: string, id: string, url: string): PlaylistEntry => ({
  sourceName: "canlitv-date", name, tvgName: name, priorityId: id, country: "Azərbaycan", url, headers: {}
});

test("all six required AZ stations have multiple independent source candidates", () => {
  assert.deepEqual([...AZ_SIX_IDS], ["arb", "real-tv", "medeniyyet-tv", "ictimai-tv", "xezer-tv", "space-tv"]);
  const entries = azSixCandidates();
  for (const id of AZ_SIX_IDS) {
    const group = entries.filter((e) => e.priorityId === id);
    assert.ok(group.length >= 2, id + " needs >=2 candidates");
    assert.ok(group.every((x) => isDirectManifestUrl(x.url) && !isMismatchedChannel(x) && validCandidateIdentity(x)));
  }
});

test("the actual user-broken six streams may never be reselected by CI", () => {
  const failures = [
    basic("ARB", "arb", "https://arb.tvstream.az/hls/stream5/index.m3u8"),
    basic("Real TV", "real-tv", "https://realtv.tvstream.az/hls/stream2/index.m3u8"),
    basic("İctimai TV", "ictimai-tv", "https://ictimai.tvstream.az/hls/stream6/index.m3u8"),
    basic("Xəzər TV", "xezer-tv", "https://yayin2.canlitv.fun/live/xezertv.stream/playlist.m3u8?hash=example"),
    basic("Space TV", "space-tv", "https://yayin2.canlitv.fun/live/spacetv.stream/playlist.m3u8?hash=example"),
    basic("Mədəniyyət TV", "medeniyyet-tv", "https://yayin2.canlitv.fun/live/medeniyettv.stream/playlist.m3u8?hash=example")
  ];
  for (const candidate of failures) assert.equal(isKnownBrokenOnDevice(candidate), true, candidate.priorityId);
});

test("ATV brand-owned CDN does not make Kanal S the ATV television channel", () => {
  const wrong = basic("ATV Azərbaycan", "atv-az", "https://lives.atv.az:5443/KANAL-S/streams/kanals.m3u8");
  assert.equal(validCandidateIdentity(wrong), false);
  const fixed = normalizeBroadcaster(wrong);
  assert.equal(fixed.name, "Kanal S");
  assert.equal(fixed.priorityId, undefined);
  assert.equal(sourceTier(fixed), 1);
});

test("the authentic ATV path retains its own identity", () => {
  const atv = basic("Atv Azad TV", "atv-az", "https://lives.atv.az:5443/ATV_TV_STREAM/streams/atvcanli.m3u8");
  assert.equal(normalizeBroadcaster(atv).priorityId, "atv-az");
  assert.equal(validCandidateIdentity(atv), true);
});

test("Yoda Mədəniyyət candidates outrank community mirrors when healthy", () => {
  const pool = azSixCandidates().filter(e => e.priorityId === "medeniyyet-tv");
  const yoda = pool.filter(x => /yodacdn.net/.test(x.url));
  assert.ok(yoda.length >= 2);
  assert.ok(yoda.every(x => sourceTier(x) === 0));
});
