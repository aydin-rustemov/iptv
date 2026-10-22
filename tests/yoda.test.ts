import assert from "node:assert/strict";
import { test } from "node:test";
import { SOURCES } from "../src/sources/webSources.js";
import { uniqueVerified } from "../src/regional.js";
import { ensureMandatory } from "../src/mandatory.js";
import type { PlaylistEntry, ValidatedEntry } from "../src/types.js";

function entry(sourceName: string, url: string, working: boolean): ValidatedEntry {
  return {
    sourceName, url, normalizedUrl: url, name: "ARB", tvgName: "ARB",
    priorityId: "arb", country: "Azərbaycan", headers: {},
    score: 100,
    fast: { ok: working },
    media: { ok: working, hasVideo: working, hasAudio: working, bytesRead: working ? 20000 : 0 }
  };
}

test("Yoda is the first Azerbaijani live TV discovery source", () => {
  assert.equal(SOURCES[0]?.name, "yoda-az");
  assert.ok(SOURCES[0]!.seeds.some((seed) => seed.url === "https://yoda.az/tv/"));
  assert.ok(SOURCES[0]!.seeds.some((seed) => seed.url.includes("/tv/arb/")));
  assert.ok(SOURCES[0]!.seeds.some((seed) => seed.url.includes("/tv/space/")));
});

test("verified Yoda stream wins over verified Volo stream for same AZ channel", () => {
  const best = uniqueVerified([
    entry("canlitv-volo", "https://test.example/volo.m3u8", true),
    entry("yoda-az", "https://test.example/yoda.m3u8", true)
  ], "AZ");
  assert.equal(best.length, 1);
  assert.equal(best[0]?.sourceName, "yoda-az");
});

test("required unverified ARB prefers actual Yoda player discovery, not guessed direct URLs", () => {
  const mandatory = [{ id: "arb", name: "ARB", country: "Azərbaycan" as const }];
  const web: PlaylistEntry[] = [
    entry("canlitv-volo", "https://test.example/volo.m3u8", false),
    entry("yoda-az", "https://test.example/yoda.m3u8", false)
  ];
  const picked = ensureMandatory([], [], mandatory, 100, web);
  assert.equal(picked.entries.length, 1);
  assert.equal(picked.entries[0]?.url, "https://test.example/yoda.m3u8");
  assert.equal(picked.entries[0]?.fast.ok, false);
  assert.deepEqual(picked.unverifiedIds, ["arb"]);
});
