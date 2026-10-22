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
  assert.ok(mandatoryCandidates(configured).length >= configured.length);
});

test("working mandatory channels stay verified; inaccessible mandatory channels are clearly warned", () => {
  const channels = [channel("atv-az", "ATV Azərbaycan", "Azərbaycan"), channel("aztv", "AzTV", "Azərbaycan")];
  const working = verified("atv-az", "ATV Azərbaycan", "Azərbaycan");
  const result = ensureMandatory([working], [working], channels, 3);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.verifiedIds, ["atv-az"]);
  assert.deepEqual(result.unverifiedIds, ["aztv"]);
  const fallback = result.entries.find((c) => c.priorityId === "aztv")!;
  assert.match(fallback.groupTitle ?? "", /Yoxlanmamış/);
  assert.equal(fallback.fast.ok, false);
  assert.equal(fallback.media.ok, false);
});

test("missing mandatory channels replace less important channels if maximum exceeded", () => {
  const others = [verified("other1", "Other 1", "Türkiyə"), verified("other2", "Other 2", "Türkiyə")];
  const required = [channel("aztv", "AzTV", "Azərbaycan")];
  const result = ensureMandatory(others, others, required, 2);
  assert.equal(result.entries.length, 2);
  assert.ok(result.entries.some((entry) => entry.priorityId === "aztv"));
});
