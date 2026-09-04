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

// /perfect wave 23 (devcase-candidate-and-devcase). Three doors still answered ENGLISH
// on the wire after the first pass: the mint's "token is required", the finalize door's
// "session not found" / "session has no posting token" / "posting not found" / "could
// not submit", and the webhook's "a valid apply token is required." / "candidate and
// repoRef are required." Every one of them is read by someone with no account, on a page
// the app renders in four languages.
test("no candidate-facing dev-case route answers a bare English sentence", () => {
  for (const rel of CANDIDATE_ROUTES) {
    const src = read(rel);
    // `{ error: "…" }` with a capital-or-lowercase English sentence and no code. The
    // only NextResponse.json bodies left on these three routes are success payloads.
    assert.doesNotMatch(
      src,
      /NextResponse\.json\(\s*\{\s*error:\s*"/,
      `${rel}: every refusal goes through jsonRefusal/safeJsonError, so it carries a code`
    );
  }
});

test("the finalize door refuses with codes and hides the store's message", () => {
  const src = read("session/[id]/submit/route.ts");
  assert.match(src, /jsonRefusal\("DEVCASE_SESSION_NOT_FOUND", 404\)/, "a dead session id needs a code");
  assert.match(src, /jsonRefusal\("DEVCASE_SESSION_UNAVAILABLE", 404\)/, "a link that resolves to no posting reuses the mint's code");
  assert.match(src, /jsonRefusal\("TOO_MANY_REQUESTS", 429\)/, "the new per-token budget refuses through the chokepoint");
  assert.match(src, /safeJsonError\(error, "api:devcase\/session\/submit", "DEVCASE_SUBMIT_FAILED"\)/, "the catch logs and codes");
  assert.doesNotMatch(src, /jsonError\(/, "jsonError forwards .message — never on a public candidate door");
});

test("the session mint and the webhook name their remaining refusals", () => {
  assert.match(read("session/route.ts"), /jsonRefusal\("DEVCASE_APPLY_TOKEN_REQUIRED", 400\)/);
  assert.match(read("session/route.ts"), /safeJsonError\(error, "api:devcase\/session", "DEVCASE_SESSION_START_FAILED"\)/);
  assert.match(read("inbound/route.ts"), /jsonRefusal\("DEVCASE_APPLY_TOKEN_REQUIRED", 401\)/);
  assert.match(read("inbound/route.ts"), /jsonRefusal\("DEVCASE_SUBMISSION_FIELDS_REQUIRED", 400\)/);
  // The throttle too: a hand-rolled { error: RATE_LIMITED_ERROR } carries no code, so a
  // throttled applicant read the server's English.
  assert.match(read("inbound/route.ts"), /jsonRefusal\("TOO_MANY_REQUESTS", 429\)/);
});

test("the finalize door goes through the SHARED intake, like its two siblings", () => {
  const src = read("session/[id]/submit/route.ts");
  // The whole direction in one assertion: a direct `submitDevSession` and nothing else
  // meant no acknowledgement and no lifecycle resume on the ONE submit path a workspace
  // case has. The behavioural half is session-intake-guards.test.ts.
  assert.match(src, /await intakeSubmission\(\{/, "the ack comes from the shared intake, not a second producer");
  // The posting's OWN workspace, never a default: resumeCollectingLifecycle now
  // requires the tenant, because this is a public token surface with no session.
  assert.match(
    src,
    /resumeCollectingLifecycle\(posting\.id, posting\.workspaceId\)/,
    "a new arrival resumes a collecting lifecycle, in the posting's team"
  );
});

test("neither candidate surface prints the raw submission id", () => {
  const dir = path.join(here, "..", "..", "devcase", "apply", "[token]");
  for (const file of ["LiveWorkSurface.tsx", "DevApplyForm.tsx"] as const) {
    const src = readFileSync(path.join(dir, file), "utf8");
    assert.doesNotMatch(src, /payload\??\.submissionId/, `${file}: show the opaque reference, not the store id`);
    assert.match(src, /\breference\b/, `${file}: the candidate's handle is the opaque reference`);
  }
});
