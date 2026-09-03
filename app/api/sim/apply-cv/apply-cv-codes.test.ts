// /api/sim/apply-cv was the one sim door still answering English literals where its
// four siblings answer codes — and it is the door the Channels CV card drives, whose
// `errMsg(data, …)` resolves `code` and otherwise paints a generic sentence. So a
// cs/de/fr reader who attached the wrong file, or aimed at a closed role, got
// "failed (400)" instead of the reason. `role_closed` was a code, but an ad-hoc
// lowercase one with no `errors.*` entry, so it resolved to nothing.
//
// Source guard (the idiom this directory already uses for route contracts): the
// handler body carries no client-facing English literal, and every refusal it does
// answer names a code the REFUSAL_ERRORS registry actually holds — which
// npm run i18n:check then pins to all four catalogs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { REFUSAL_ERRORS, STORE_ERRORS } from "@/app/_lib/api-response";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "route.ts"), "utf8");

test("every refusal the route answers is a declared code", () => {
  const codes = [...src.matchAll(/jsonRefusal\("([A-Z_]+)"/g)].map((m) => m[1]);
  assert.ok(codes.length >= 6, `expected the five literals plus the extractor path to be coded, found ${codes.length}`);
  for (const code of codes) {
    assert.ok(code in REFUSAL_ERRORS, `${code} must exist in REFUSAL_ERRORS (i18n:check then pins it to 4 catalogs)`);
  }
  assert.ok(codes.includes("SIM_ROLE_CLOSED"), "the closed-role 410 — the one refusal a real demo run hits — is coded");
});

test("the 500 goes through the store chokepoint, not the thrown message", () => {
  const store = [...src.matchAll(/safeJsonError\(error, "[^"]+", "([A-Z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(store, ["SIM_CV_INTAKE_FAILED"], "one coded catch — ingestCvApplication throws SQLITE_* text and Python tracebacks");
  assert.ok(store[0] in STORE_ERRORS);
  assert.doesNotMatch(src, /jsonError\(/, "jsonError forwards .message and is not safe on this path");
});

test("no client-facing English sentence is left in a response body", () => {
  // The two survivors are legitimate: the shared RATE_LIMITED_ERROR constant and
  // the success payload. Anything else with a prose `error:` is a regression.
  const bodies = [...src.matchAll(/NextResponse\.json\(\{[^}]*error:\s*("([^"]*)")/g)].map((m) => m[2]);
  assert.deepEqual(bodies, [], `no inline English error strings, found: ${JSON.stringify(bodies)}`);
  assert.doesNotMatch(src, /code: "role_closed"/, "the ad-hoc lowercase code is gone");
});
