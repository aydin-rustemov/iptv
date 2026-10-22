import assert from "node:assert/strict";
import { test } from "node:test";
import { TVSTREAM_AZ_CHANNELS } from "../src/sources/tvstream.js";

test("TVSTREAM player capture explicitly targets both ARB and Space", () => {
  const ids = TVSTREAM_AZ_CHANNELS.map((entry) => entry.priorityId);
  assert.ok(ids.includes("arb"));
  assert.ok(ids.includes("space-tv"));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(TVSTREAM_AZ_CHANNELS.length, 10);
  assert.ok(TVSTREAM_AZ_CHANNELS.every((entry) => entry.label && entry.name));
});
