import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPriorityChannels, tagPriorityEntries } from "../src/priority.js";
import { isDirectManifestUrl } from "../src/playlistGuard.js";
import { isMismatchedChannel } from "../src/channelMatchGuard.js";
import { yodaCdnCandidates } from "../src/sources/yodaCdn.js";
import { turkeyAlternativeCandidates } from "../src/sources/turkeyAlternatives.js";
import type { PlaylistEntry } from "../src/types.js";

const entry = (name: string, url: string): PlaylistEntry => ({
  sourceName: "canlitv-date", name, tvgName: name, country: "Türkiyə",
  groupTitle: "Türkiyə", url, headers: {}
});

test("An Alanya TV channel may never match the priority national ATV station", () => {
  const tagged = tagPriorityEntries(
    [entry("Alanya Posta TV", "https://cdn-alanyatv.yayin.com.tr/alanyatv/alanyatv/playlist.m3u8")],
    loadPriorityChannels()
  );
  assert.notEqual(tagged[0]?.priorityId, "atv-tr");
  const disguised = tagPriorityEntries(
    [entry("ATV", "https://cdn-alanyatv.yayin.com.tr/alanyatv/alanyatv/playlist.m3u8")],
    loadPriorityChannels()
  );
  assert.equal(disguised[0]?.priorityId, "atv-tr");
  assert.equal(isMismatchedChannel(disguised[0]!), true);
});

test("Star TV and AzStar are different broadcasters", () => {
  const tagged = tagPriorityEntries(
    [entry("AzStar", "https://live.livestreamtv.ca/azstar/amlst:azstar/playlist.m3u8")],
    loadPriorityChannels()
  );
  assert.notEqual(tagged[0]?.priorityId, "star-tv");
});

test("HTML HLS player page must not be inserted as IPTV channel", () => {
  assert.equal(isDirectManifestUrl(
    "https://www.livereacting.com/tools/hls-player-embed?url=https://example.com/atv.m3u8"
  ), false);
  assert.equal(isDirectManifestUrl("https://str.yodacdn.net/aztv/index.m3u8"), true);
});

test("Yoda direct streams are all distinct named AZ channels", () => {
  const items = yodaCdnCandidates();
  assert.ok(items.length >= 5);
  assert.equal(new Set(items.map((x) => x.priorityId)).size, items.length);
  assert.ok(items.every((x) => x.country === "Azərbaycan" && isDirectManifestUrl(x.url)));
});

test("All seven essential Turkish channels have identity-labelled fallback candidates", () => {
  const items = turkeyAlternativeCandidates();
  assert.deepEqual(items.map((x) => x.priorityId), ["atv-tr", "now-tv", "show-tv", "kanal-d", "trt-1", "star-tv", "tv8"]);
  assert.ok(items.every((x) => isDirectManifestUrl(x.url) && !isMismatchedChannel(x)));
});
