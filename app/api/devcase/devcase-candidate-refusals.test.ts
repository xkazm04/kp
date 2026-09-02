// The dev-case CANDIDATE surfaces answer with codes, not English.
//
// `app/devcase/apply/[token]` is rendered in en/cs/de/fr, but three of its server
// refusals were bare `{ error: "<English sentence>" }` with no code, so the client had
// nothing to resolve: the closed-intake sentence was hand-copied verbatim into TWO route
// files while `REFUSAL_ERRORS.POSTING_CLOSED` — the localizable original — sat unused a
// few lines below in one of them, and the session mint's 404/429 refusals reached the
// candidate as nothing at all (`ensureSession` dropped a failed mint on the floor).
//
// This is a SOURCE guard, the idiom approve-gate.test.ts and error-response-contract.ts
// already use here: a Next 16 route module cannot be imported by the unit runner, and
// "the refusal carries a code" is a property the source states plainly. The behavioural
// half — that the statuses stay 404/410/429 — is pinned by session-intake-guards.test.ts
// and inbound/route.test.ts, which run the real handlers.
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(here, rel), "utf8");

// Every route below is reachable by an unauthenticated candidate holding an apply link.
const CANDIDATE_ROUTES = [
  "session/route.ts",
  "session/[id]/submit/route.ts",
  "inbound/route.ts",
] as const;

test("no candidate-facing dev-case route hand-writes the closed-intake sentence", () => {
  for (const rel of CANDIDATE_ROUTES) {
    assert.doesNotMatch(
      read(rel),
      /error:\s*"This role's intake has closed/,
      `${rel}: use jsonRefusal("POSTING_CLOSED", 410) — the sentence has one producer`
    );
  }
});

test("the session mint refuses with codes, not prose", () => {
  const src = read("session/route.ts");
  assert.match(src, /jsonRefusal\("DEVCASE_SESSION_UNAVAILABLE", 404\)/, "the unavailable-link refusal needs a code");
  assert.match(src, /jsonRefusal\("DEVCASE_SESSION_QUOTA", 429\)/, "the per-token/day quota refusal needs a code");
  assert.doesNotMatch(src, /error:\s*"This case is not accepting/, "the prose copy must be gone");
  assert.doesNotMatch(src, /error:\s*"Too many sessions/, "the prose copy must be gone");
});

test("both closed-intake doors answer with the same code", () => {
  for (const rel of ["session/[id]/submit/route.ts", "inbound/route.ts"] as const) {
    assert.match(read(rel), /jsonRefusal\("POSTING_CLOSED", 410\)/, `${rel}: one refusal, one code`);
  }
});

test("the two store-backed dev-case writes hide the thrown message", () => {
  for (const rel of ["publish/route.ts", "feedback/route.ts"] as const) {
    const src = read(rel);
    assert.match(src, /safeJsonError\(error, "api:devcase\//, `${rel}: a store/spawn catch must log and code`);
    assert.doesNotMatch(
      src,
      /error instanceof Error \? error\.message/,
      `${rel}: SQLITE_* codes, the db path and provider stderr must not reach the client`
    );
  }
});

test("the candidate work surface renders the code, never the server's error string", () => {
  const src = readFileSync(
    path.join(here, "..", "..", "devcase", "apply", "[token]", "LiveWorkSurface.tsx"),
    "utf8"
  );
  assert.match(src, /useErrorMessage/, "refusals must resolve through the reader's `errors` catalog");
  // The inverted fallback chain the hook exists to kill: `error` is almost always
  // present, so the localized fallback almost never runs.
  assert.doesNotMatch(src, /\.error\s*\?\?\s*t\(/, "never `body.error ?? t(...)` — that ships English to every locale");
});
