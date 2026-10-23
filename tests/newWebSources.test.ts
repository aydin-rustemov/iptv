import assert from "node:assert/strict";
import { test } from "node:test";
import { SOURCES } from "../src/sources/webSources.js";
import { sourcePageIdentity, priorityWebPageScore } from "../src/sources/sourcePageIdentity.js";
import { sourceTier } from "../src/sourcePolicy.js";
import type { PlaylistEntry } from "../src/types.js";

test("OperativMM has an Azerbaijan catalogue and real station route seeds", () => {
  const x = SOURCES.find((s) => s.name === "operativmm-az");
  assert.ok(x);
  assert.ok(x.seeds.some((s) => s.url === "https://operativmm.az/az/canli-tv"));
  const page = sourcePageIdentity("operativmm-az", "https://operativmm.az/az/canli-tv/xezer-tv", "Xəzər TV İNCƏ SƏHƏR - CANLI", "Azərbaycan");
  assert.equal(page?.title, "Xəzər TV");
  assert.equal(page?.country, "Azərbaycan");
  assert.equal(sourcePageIdentity("operativmm-az", "https://operativmm.az/az/canli-tv", "Bütün kanallar", "Azərbaycan"), undefined);
});

test("iCanlive Azerbaijani, Turkish and Russian channel categories are distinct", () => {
  const sources = ["icanlive-az", "icanlive-tr", "icanlive-ru"];
  assert.ok(sources.every((name) => SOURCES.some((source) => source.name === name)));
  const az = sourcePageIdentity("icanlive-az", "https://icanlive.tv/canli/9090/atv-5.html", "ATV 3,583,083", "Azərbaycan");
  const tr = sourcePageIdentity("icanlive-tr", "https://icanlive.tv/canli/32152/atv-alanya.html", "ATV Alanya 1,297", "Türkiyə");
  const ru = sourcePageIdentity("icanlive-ru", "https://icanlive.tv/canli/464/1tv.html", "1TV 358,263", "Rusiya");
  assert.equal(az?.title, "ATV");
  assert.equal(az?.country, "Azərbaycan");
  assert.equal(tr?.title, "ATV Alanya");
  assert.equal(tr?.country, "Türkiyə");
  assert.equal(ru?.title, "1TV");
  assert.equal(ru?.country, "Rusiya");
  assert.equal(priorityWebPageScore(tr!), 0, "ATV Alanya is not the required Turkish ATV");
});

test("iCanlive numeric TV names survive popularity count removal", () => {
  const url = "https://icanlive.tv/canli/10000/trt-1.html";
  const station = sourcePageIdentity("icanlive-tr", url, "TRT 1 30,153", "Türkiyə");
  assert.equal(station?.title, "TRT 1");
  assert.equal(priorityWebPageScore(station!), 1000);
  const tv8 = sourcePageIdentity("icanlive-tr", "https://icanlive.tv/canli/12345/tv8.html", "TV8 1,927", "Türkiyə");
  assert.equal(tv8?.title, "TV8");
  assert.equal(priorityWebPageScore(tv8!), 1000);
});

test("Reject category navigation and external links as station pages", () => {
  assert.equal(sourcePageIdentity("icanlive-ru", "https://icanlive.tv/kategori/343/rusya-tv-kanallari.html", "Rusya", "Rusiya"), undefined);
  assert.equal(sourcePageIdentity("icanlive-tr", "https://foreign.example/canli/123/atv.html", "ATV", "Türkiyə"), undefined);
});

test("New websites are alternatives, not official last-resort sources", () => {
  const candidate = (sourceName: string, country: string): PlaylistEntry =>
    ({ sourceName, name: "TV", country, headers: {}, url: "https://stream.example/live.m3u8" });
  assert.equal(sourceTier(candidate("operativmm-az", "Azərbaycan")), 1);
  assert.equal(sourceTier(candidate("icanlive-az", "Azərbaycan")), 1);
  assert.equal(sourceTier(candidate("icanlive-tr", "Türkiyə")), 1);
  assert.equal(sourceTier(candidate("icanlive-ru", "Rusiya")), 1);
  assert.equal(sourceTier(candidate("official-last-resort", "Türkiyə")), 3);
});
