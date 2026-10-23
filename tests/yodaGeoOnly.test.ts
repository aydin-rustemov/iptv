import assert from "node:assert/strict";
import { test } from "node:test";
import { YODA_CATALOGUE, YODA_REGION_REASON, yodaChannelFromPage, yodaRegionalEntries, overlayYodaRegional } from "../src/sources/yodaCatalogue.js";
import type { PlaylistEntry, ValidatedEntry } from "../src/types.js";

function candidate(id: string, name: string, url: string, sourceName = "yoda-az"): PlaylistEntry {
  return { sourceName, priorityId: id, tvgId: id, tvgName: name, name, url,
    country: "Azərbaycan", groupTitle: "Azərbaycan", headers: {},
    candidateReferer: "https://yoda.az/tv/" + id + "/" };
}
function verified(sourceName: string): ValidatedEntry {
  const c = candidate("arb", "ARB", "https://other.example/arb/master.m3u8", sourceName);
  return { ...c, normalizedUrl: c.url, score: 100,
    fast: { ok: true }, media: { ok: true, hasVideo: true, hasAudio: true, bytesRead: 5000 } };
}

test("Yoda catalogue retains 29 station identities and separates ARB from ARB Gunes", () => {
  assert.equal(YODA_CATALOGUE.length, 29);
  assert.equal(new Set(YODA_CATALOGUE.map(x => x.id)).size, YODA_CATALOGUE.length);
  assert.equal(yodaChannelFromPage("https://yoda.az/tv/ictimaitele/")?.id, "ictimai-tv");
  assert.equal(yodaChannelFromPage("https://yoda.az/tv/xazartv/")?.id, "xezer-tv");
  assert.equal(yodaChannelFromPage("https://www.yoda.az/tv/arb/")?.name, "ARB");
  assert.equal(yodaChannelFromPage("https://yoda.az/tv/arbgunes/")?.id, "arb-gunes");
  assert.equal(yodaChannelFromPage("https://yoda.az/tv/"), undefined);
});

test("Yoda M3U candidate bypasses video probing and gets a clear machine-readable reason", () => {
  const entries = yodaRegionalEntries([candidate("arb", "ARB", "https://str.yodacdn.net/arb/index.m3u8")]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.name, "ARB");
  assert.equal(entries[0]?.fast.ok, false);
  assert.equal(entries[0]?.fast.reason, YODA_REGION_REASON);
  assert.equal(entries[0]?.media.hasVideo, false);
});

test("Yoda HTML page, ad links and mislabeled streams never enter playlist", () => {
  const entries = yodaRegionalEntries([
    candidate("arb", "ARB", "https://yoda.az/tv/arb/"),
    candidate("arb", "ARB", "https://gcdn.2mdn.net/api/manifest/hls_variant/source/web_video_ads/a.m3u8"),
    candidate("arb", "ARB", "https://str.yodacdn.net/arbgunes/index.m3u8"),
    candidate("arb", "ARB", "https://str.yodacdn.net/arb/index.m3u8")
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.url, "https://str.yodacdn.net/arb/index.m3u8");
});

test("Yoda stream wins over otherwise GitHub-verified regional stream of same broadcaster", () => {
  const yoda = yodaRegionalEntries([candidate("arb", "ARB", "https://str.yodacdn.net/arb/index.m3u8")]);
  const combined = overlayYodaRegional([verified("tvstream-az")], yoda);
  assert.equal(combined.length, 1);
  assert.equal(combined[0]?.sourceName, "yoda-az");
});

test("Full Yoda catalogue isn't reduced by the 100-channel worldwide ceiling", () => {
  const yoda = yodaRegionalEntries(YODA_CATALOGUE.map((x) => candidate(x.id, x.name,
    "https://media.example.net/" + x.id + "/index.m3u8")));
  // These URLs are example HLS-shaped test values only, not real broadcast links.
  const others = Array.from({ length: 99 }, (_, i): ValidatedEntry => ({
    ...verified("iptv-org-turkey"),
    priorityId: "tr-" + i, tvgId: "tr-" + i, name: "TR " + i,
    country: "Türkiyə", groupTitle: "Türkiyə",
    url: "https://test.example/tr-" + i + "/playlist.m3u8"
  }));
  const combined = overlayYodaRegional(others, yoda, 100);
  assert.equal(yoda.length, 29);
  assert.equal(combined.length, 100);
  assert.equal(combined.filter(x => x.fast.reason === YODA_REGION_REASON).length, 29);
});

test("Never publish generic unidentified Yoda TV list page as a channel", () => {
  assert.deepEqual(yodaRegionalEntries([
    candidate("generic", "TV", "https://media.example.net/id/index.m3u8")
  ]), []);
});
