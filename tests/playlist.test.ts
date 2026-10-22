import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { isPublishableUrl, MAX_PLAYLIST_BYTES } from "../src/playlistGuard.js";
import { isDisplayableChannel, writePlaylist } from "../src/generator.js";
import type { ValidatedEntry } from "../src/types.js";

function entry(url: string, logo?: string): ValidatedEntry {
  return {
    sourceName: "test", name: "Test TV", tvgId: "test", headers: {},
    country: "Azərbaycan", url, tvgLogo: logo,
    normalizedUrl: url, score: 1,
    fast: { ok: true }, media: { ok: true, hasVideo: true, hasAudio: false, bytesRead: 188 }
  };
}

test("rejects excessive, malformed and short-lived stream URLs", () => {
  const now = 1_800_000_000_000;
  assert.equal(isPublishableUrl("https://example.com/live.m3u8", now), true);
  assert.equal(isPublishableUrl("https://example.com/" + "x".repeat(5000), now), false);
  assert.equal(isPublishableUrl("https://example.com/x\n#EXTINF", now), false);
  assert.equal(isPublishableUrl("https://example.com/live.m3u8?exp=" + Math.floor((now + 1000) / 1000), now), false);
  assert.equal(isPublishableUrl("https://example.com/live.m3u8?exp=" + Math.floor((now + 86400000) / 1000), now), true);
});

test("writes a compact playlist, drops oversize artwork, preserves valid channel", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iptv-"));
  try {
    const target = path.join(dir, "playlist.m3u");
    const item = entry("https://example.com/live.m3u8", "https://example.com/" + "X".repeat(5000));
    assert.equal(isDisplayableChannel(item), true);
    writePlaylist([item], target);
    const text = fs.readFileSync(target, "utf8");
    assert.match(text, /#EXTINF:-1/);
    assert.match(text, /https:\/\/example.com\/live\.m3u8/);
    assert.doesNotMatch(text, /tvg-logo=/);
    assert.ok(Buffer.byteLength(text) < MAX_PLAYLIST_BYTES);
    assert.throws(() => writePlaylist([entry("https://example.com/" + "x".repeat(5000))], target), /empty/);
    assert.equal(fs.readFileSync(target, "utf8"), text);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
