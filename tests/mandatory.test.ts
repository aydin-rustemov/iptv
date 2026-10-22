import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureMandatory, loadMandatoryChannels, mandatoryCandidates } from "../src/mandatory.js";
import type { ValidatedEntry } from "../src/types.js";

const channel = (id: string, name: string, country: "Azərbaycan" | "Türkiyə") => ({
  id, name, country, urls: ["https://example.com/" + id + ".m3u8"]
});

function verified(id: string, name: string, country: string): ValidatedEntry {
  const url = "https://example.com/" + id + ".m3u8";
  return { sourceName: "verified", name, country, url, normalizedUrl: url,
    priorityId: id, headers: {}, score: 100,
    fast: { ok: true }, media: { ok: true, hasVideo: true, hasAudio: true, bytesRead: 1234 } };
}

test("config includes exactly the user-required 11 AZ and 7 TR channel IDs", () => {
  const configured = loadMandatoryChannels();
  assert.equal(configured.length, 18);
  assert.equal(configured.filter((c) => c.country === "Azərbaycan").length, 11);
  assert.equal(configured.filter((c) => c.country === "Türkiyə").length, 7);
  assert.deepEqual(configured.map((c) => c.id), [
    "aztv", "ictimai-tv", "idman-tv", "medeniyyet-tv", "xezer-tv",
    "atv-az", "space-tv", "arb", "cbc-sport", "real-tv", "arb24",
    "show-tv", "atv-tr", "kanal-d", "now-tv", "tv8", "trt-1", "star-tv"
  ]);
  assert.equal(mandatoryCandidates(configured).length, 0, "No official or static direct links are permitted");
});

test("working channels stay verified; geo-limited Yoda streams use clean titles", () => {
  const channels = [channel("atv-az", "ATV Azərbaycan", "Azərbaycan"), channel("aztv", "AzTV", "Azərbaycan")];
  const working = verified("atv-az", "ATV Azərbaycan", "Azərbaycan");
  const webCandidate = { ...verified("aztv", "AzTV", "Azərbaycan"), url: "https://str.yodacdn.net/aztv/index.m3u8", sourceName: "yoda-az-cdn" };
  const result = ensureMandatory([working], [working], channels, 3, [webCandidate]);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.verifiedIds, ["atv-az"]);
  assert.deepEqual(result.unverifiedIds, ["aztv"]);
  const fallback = result.entries.find((c) => c.priorityId === "aztv")!;
  assert.equal(fallback.groupTitle, "Azərbaycan");
  assert.equal(fallback.name, "AzTV");
  assert.equal(fallback.fast.ok, false);
  assert.equal(fallback.media.ok, false);
});

test("missing mandatory channels replace less important channels if maximum exceeded", () => {
  const others = [verified("other1", "Other 1", "Türkiyə"), verified("other2", "Other 2", "Türkiyə")];
  const required = [channel("aztv", "AzTV", "Azərbaycan")];
  const webCandidate = { ...verified("aztv", "AzTV", "Azərbaycan"), url: "https://str.yodacdn.net/aztv/index.m3u8", sourceName: "yoda-az-cdn" };
  const result = ensureMandatory(others, others, required, 2, [webCandidate]);
  assert.equal(result.entries.length, 2);
  assert.ok(result.entries.some((entry) => entry.priorityId === "aztv"));
});

test("unavailable priority stream is reported missing instead of inventing official URL", () => {
  const required = [channel("aztv", "AzTV", "Azərbaycan")];
  const result = ensureMandatory([], [], required);
  assert.equal(result.entries.length, 0);
  assert.deepEqual(result.missingIds, ["aztv"]);
  assert.deepEqual(result.unverifiedIds, []);
});

test("unverified Turkish TV and embedded viewer pages are never padded into the playlist", () => {
  const required = [channel("atv-tr", "ATV", "Türkiyə")];
  const wrong = { ...verified("atv-tr", "ATV", "Türkiyə"), sourceName: "canlitv-date",
    url: "https://cdn-alanyatv.yayin.com.tr/alanyatv/alanyatv/playlist.m3u8" };
  const embed = { ...wrong, url: "https://www.livereacting.com/tools/hls-player-embed?url=https://example.org/atv.m3u8" };
  const result = ensureMandatory([], [], required, 100, [wrong, embed]);
  assert.equal(result.entries.length, 0);
  assert.deepEqual(result.missingIds, ["atv-tr"]);
  assert.deepEqual(result.unverifiedIds, []);
});
