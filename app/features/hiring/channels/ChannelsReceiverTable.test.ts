import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ChannelsReceiverTable.tsx"), "utf8");

test("every receiver row shows acceptedCount beside liveness, not instead of it", () => {
  assert.match(src, /h\.acceptedCount/, "the filed-candidate count is on the row");
  assert.match(src, /t\("receivers\.accepted"\)/, "the Accepted column is catalogued");
  assert.match(src, /isReceiverLive\(h\)/, "Listening stays receipt-driven");
  assert.doesNotMatch(
    src,
    /isReceiverLive\([^)]*acceptedCount/,
    "acceptedCount must not drive the Listening badge"
  );
});

test("firstAcceptedAt is a quiet relative time, or an em dash when no lead has landed", () => {
  assert.match(src, /useRelativeTime/, "first-lead time is locale-relative, not toLocaleString");
  assert.match(src, /h\.firstAcceptedAt \? rel\(h\.firstAcceptedAt\) : "—"/, "null firstAcceptedAt is an em dash, not a fake date");
  assert.match(src, /t\("receivers\.firstLead"\)/, "the time has a catalogued label");
});
