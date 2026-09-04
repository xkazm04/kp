import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The winnability coach grades the SAME shared candidate pool the recruiter
// ranking scores — and that pool is capped (`buildCandidatePool` answers an
// honest `truncated`). The candidates route has always echoed it as
// `poolTruncated` and the ranking says so on screen; the winnability route
// destructured `{ entries }` only, so the coach's verdict ("only 3 of your 40
// candidates qualify — loosen this gate") was computed over a silently reduced
// denominator and presented as the whole truth. A recruiter edits their JD off
// that number.
//
// A .tsx/route has no runner here, so this pins the SOURCE of the pair: the route
// must forward the flag and the panel must render the admission.
const here = path.dirname(fileURLToPath(import.meta.url));
const ROUTE = readFileSync(path.join(here, "..", "..", "..", "api", "jobs", "[id]", "winnability", "route.ts"), "utf8");
const PANEL = readFileSync(path.join(here, "JobsCoachPanel.tsx"), "utf8");

test("the winnability route reads the pool's truncated flag and echoes it", () => {
  assert.match(ROUTE, /buildCandidatePool\(ws\)/);
  assert.match(ROUTE, /const \{ entries, truncated \}/);
  assert.match(ROUTE, /poolTruncated: truncated/);
});

test("the coach renders the cap admission from the candidates namespace, not a copy", () => {
  assert.match(PANEL, /data\.poolTruncated/);
  assert.match(PANEL, /useTranslations\("jobs\.candidates"\)/);
  assert.match(PANEL, /poolTruncatedNote/);
});

test("the route no longer answers an English `note` the client would have to render", () => {
  assert.equal(ROUTE.includes('note: "No saved candidates yet."'), false);
  assert.equal(/\bnote:\s*"/.test(ROUTE), false);
});
