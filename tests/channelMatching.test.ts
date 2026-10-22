import assert from "node:assert/strict";
import { test } from "node:test";
import { isMismatchedChannel } from "../src/channelMatchGuard.js";
import { isDisplayableChannel } from "../src/generator.js";
import type { PlaylistEntry } from "../src/types.js";

const candidate = (name: string, url: string, priorityId?: string): PlaylistEntry => ({
  sourceName: "canlitv-watch", name, tvgName: name, url,
  priorityId, country: "Azərbaycan", headers: {}
});

test("ARB Gunes must not be mislabeled as ARB TV", () => {
  const wrong = candidate("ARB", "https://yayin2.canlitv.fun/live/arbgunes.stream/playlist.m3u8?hash=example", "arb");
  assert.equal(isMismatchedChannel(wrong), true);
  const genuine = candidate("ARB", "https://example.com/live/arb/playlist.m3u8", "arb");
  assert.equal(isMismatchedChannel(genuine), false);
});

test("site headings may not be published as stations", () => {
  const wrong = candidate("TVSTREAM — Canlı TV İzlə", "https://az.tvstream.az/hls/stream9/index.m3u8");
  assert.equal(isMismatchedChannel(wrong), true);
  assert.equal(isDisplayableChannel(wrong), false);
});

test("correctly named Space TV may be validated as a distinct station", () => {
  const space = candidate("Space TV", "https://example.com/space.m3u8", "space-tv");
  assert.equal(isMismatchedChannel(space), false);
  assert.equal(isDisplayableChannel(space), true);
});

test("Turkish ATV must never play Alanya TV", () => {
  const bad = candidate("ATV", "https://cdn-alanyatv.yayin.com.tr/alanyatv/alanyatv/playlist.m3u8", "atv-tr");
  assert.equal(isMismatchedChannel(bad), true);
});
test("Turkish Star TV must never play AzStar", () => {
  const bad = candidate("Star TV", "https://live.livestreamtv.ca/azstar/amlst:azstar/playlist.m3u8", "star-tv");
  assert.equal(isMismatchedChannel(bad), true);
});
test("Turkish main TV8 must never play TV8.5", () => {
  const bad = candidate("TV8", "https://example.com/tv8.5/playlist.m3u8", "tv8");
  assert.equal(isMismatchedChannel(bad), true);
});
