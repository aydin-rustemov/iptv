import assert from "node:assert/strict";
import { test } from "node:test";
import { selectRegionalPlaylist } from "../src/regional.js";
import type { ValidatedEntry } from "../src/types.js";

function channel(country: string, id: number, verified = true): ValidatedEntry {
  const name = country + " TV " + id;
  const url = "https://example.com/" + country + "/" + id + ".m3u8";
  return {
    sourceName: "iptv-org-" + country,
    name, tvgName: name, tvgId: country + id,
    country, url, normalizedUrl: url, headers: {},
    fast: { ok: verified }, media: { ok: verified, hasVideo: verified, hasAudio: true, bytesRead: 4096 },
    score: 50
  };
}

function byCountry(items: ValidatedEntry[], country: string): number {
  return items.filter((x) => x.country === country).length;
}

test("35 Azerbaijani channels take priority while protecting 50 Turkish and 15 Russian places", () => {
  const verified = [
    ...Array.from({ length: 35 }, (_, i) => channel("Azərbaycan", i)),
    ...Array.from({ length: 100 }, (_, i) => channel("Türkiyə", i)),
    ...Array.from({ length: 100 }, (_, i) => channel("Rusiya", i))
  ];
  const playlist = selectRegionalPlaylist(verified);
  assert.equal(playlist.length, 100);
  assert.equal(byCountry(playlist, "Azərbaycan"), 35);
  assert.equal(byCountry(playlist, "Türkiyə"), 50);
  assert.equal(byCountry(playlist, "Rusiya"), 15);
});

test("25 Azerbaijan, 55 Turkey, 20 Russia when available", () => {
  const verified = [
    ...Array.from({ length: 25 }, (_, i) => channel("Azərbaycan", i)),
    ...Array.from({ length: 90 }, (_, i) => channel("Türkiyə", i)),
    ...Array.from({ length: 90 }, (_, i) => channel("Rusiya", i))
  ];
  const playlist = selectRegionalPlaylist(verified);
  assert.equal(playlist.length, 100);
  assert.equal(byCountry(playlist, "Azərbaycan"), 25);
  assert.equal(byCountry(playlist, "Türkiyə"), 55);
  assert.equal(byCountry(playlist, "Rusiya"), 20);
});

test("never pads with unverified, duplicated, or other-country streams", () => {
  const verified = [
    channel("Azərbaycan", 1), channel("Azərbaycan", 1),
    channel("Azərbaycan", 2, false), channel("Türkiyə", 1),
    channel("Rusiya", 1), channel("ABŞ", 1)
  ];
  const selected = selectRegionalPlaylist(verified);
  assert.equal(selected.length, 3);
  assert.deepEqual(new Set(selected.map((x) => x.country)), new Set(["Azərbaycan", "Türkiyə", "Rusiya"]));
  assert.equal(selected.some((x) => !x.media.ok), false);
});
