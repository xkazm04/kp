// Direction 2 — the interview SPEND DOORS and their refusal vocabulary.
//
// Two properties, both source-level, because route handlers need a request scope the
// unit runner cannot give them and both properties are things the source states:
//
//  1. ORDERING. /create is four decisions in a fixed sequence and the order IS the
//     contract: the cheap 402/400 refusals serve free, the throttle comes next, the
//     grounding is built BEFORE the authoritative meter reservation (its booked
//     length is what the reservation is sized from), the reservation comes before
//     the revoke (so a 402 can never kill a candidate's live link), and only then is
//     a new session minted. Two of those five have already been inverted once in this
//     route's history; nothing pinned them.
//
//  2. CODES. Every refusal on the two doors the recruiter and the candidate actually
//     meet carries an `INTERVIEW_*` / `PIPELINE_*` / `TOO_MANY_REQUESTS` code, so
//     `useErrorMessage()` renders it in the reader's language. /connect is the one
//     that mattered most: a PUBLIC surface, opened from an invite deliberately
//     rendered in the applicant's own language, that answered five different
//     lifecycle refusals in hardcoded English.
//
// The rate limiters themselves are pinned by app/api/rate-limit-contract.test.ts
// (key, budget, window, and both ordering neighbours) - not duplicated here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** Index of `needle`, asserted present. */
function at(src: string, needle: string, what: string): number {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `${what}: expected to find\n  ${needle}`);
  return i;
}

// ---- /create: the order of its five decisions ------------------------------

test("/create refuses cheaply, throttles, grounds, reserves, THEN revokes and mints", () => {
  const src = read("./create/route.ts");

  const cheapGate = at(src, 'const quota = meterGate("interview_minutes"', "the cheap pre-gate");
  const named = at(src, 'jsonRefusal("INTERVIEW_ENTRY_REQUIRED", 400)', "the named-nothing refusal");
  const throttle = at(src, "rateLimit(`interview-create:", "the per-IP throttle");
  const promote = at(src, "resolveEntryForSubmission(submissionId, workspace)", "the submission promote");
  const grounded = at(src, "await buildGroundedInterview(entryId, workspace)", "the grounding build");
  const reserve = at(src, "maxBillableInterviewMin(grounded.durationMin)", "the authoritative reservation");
  const revoke = at(src, "revokeOpenInterviewSessions(entryId, workspace)", "the reissue revoke");
  const mint = at(src, "const session = createInterviewSession({", "the session mint");

  assert.ok(cheapGate < throttle, "an empty meter is refused before it can spend another caller's budget");
  assert.ok(named < throttle, "a call naming no candidate is refused before the throttle, not counted by it");
  assert.ok(throttle < promote, "the throttle precedes the PROMOTE - that door writes a board row");
  assert.ok(throttle < grounded, "the throttle precedes the model-backed grounding");
  assert.ok(
    grounded < reserve,
    "the reservation is sized from the run-of-show's booked length, so the build must come first",
  );
  assert.ok(
    reserve < revoke,
    "a 402 must never reach the revoke: refusing AFTER killing the candidate's live link is the worst of both",
  );
  assert.ok(revoke < mint, "exactly one link is live per entry - the prior ones die before the new one exists");
});

test("/create's two meter gates are the cheap default and the authoritative worst case", () => {
  const src = read("./create/route.ts");
  const gates = [...src.matchAll(/meterGate\("interview_minutes"/g)];
  assert.equal(gates.length, 2, "the two-stage gate is deliberate: a cheap pre-check, then the true ceiling");
  assert.match(src, /minUnits: GROUNDED_DEFAULT_MIN/, "the pre-check reserves the 20-min default");
  assert.match(
    src,
    /minUnits: maxBillableInterviewMin\(grounded\.durationMin\)/,
    "the authoritative one reserves bookedMin*2 - the exact ceiling /complete's debit clamps to",
  );
});

test("only the EMAILED interview link is locale-pinned; the recruiter's copy is not", () => {
  const src = read("./create/route.ts");
  const langQuery = at(src, "const langQuery = inviteLocale ?", "the ?lang= pin");
  const link = at(src, "const link = `${publicBaseUrl(", "the emailed absolute link");
  assert.ok(langQuery < link, "the pin is computed before the link it goes on");
  assert.match(src, /\/interview\/\$\{session\.token\}\$\{langQuery\}/, "the emailed link carries ?lang=");
  // The `url` in the JSON body is opened by the RECRUITER; ?lang= there would rewrite
  // their own NEXT_LOCALE cookie and flip the whole console's language.
  assert.match(src, /url: `\/interview\/\$\{session\.token\}`/, "the response url stays unpinned");
});

test("/create tells the recruiter WHY an invite did not go out, as a code", () => {
  const src = read("./create/route.ts");
  assert.match(src, /INVITE_PROVIDER_UNCONFIGURED/, "no keys on this server is one class");
  assert.match(src, /INVITE_DISPATCH_FAILED/, "a relay/outbox failure is the other");
  assert.match(src, /\n\s+deliveryError,/, "the class rides back on the response, not only in a server log");
  // The truthful outbox claim stays: the class says WHY, `delivery` says WHAT happened.
  assert.match(src, /delivery = deliveryClaim\(isRelayConfigured\(\), status\)/, "the delivery claim is unchanged");
});

// ---- the refusal vocabulary ------------------------------------------------

test("every refusal on /create and /revoke carries a code", () => {
  for (const rel of ["./create/route.ts", "./revoke/route.ts"] as const) {
    const src = read(rel);
    // A refusal is a NextResponse.json with a 4xx status. The only ones left in these
    // files should be the TWO billing 402s (the cheap pre-check and the authoritative
    // reservation), whose bodies are meterGate's own typed payload rather than prose.
    for (const m of src.matchAll(/NextResponse\.json\(([\s\S]{0,240}?)\{\s*status:\s*(4\d\d)\s*\}/g)) {
      assert.ok(
        /quota|reserve/.test(m[1]),
        `${rel}: a ${m[2]} refusal still answers a bare message - route it through jsonRefusal:\n  ${m[0].slice(0, 140)}`,
      );
    }
  }
});

test("every lifecycle refusal on the PUBLIC /connect door carries a code", () => {
  const src = read("./connect/route.ts");
  for (const code of [
    "INTERVIEW_LINK_NOT_FOUND",
    "INTERVIEW_LAB_DISABLED",
    "INTERVIEW_ALREADY_COMPLETED",
    "INTERVIEW_LINK_INACTIVE",
    "INTERVIEW_LINK_EXPIRED",
    "INTERVIEW_PROVIDER_INVALID",
    "INTERVIEW_PROVIDER_UNCONFIGURED",
    "INTERVIEW_CONSENT_REQUIRED",
    "TOO_MANY_REQUESTS",
  ]) {
    assert.match(src, new RegExp(`jsonRefusal\\("${code}"`), `/connect must answer ${code} through the chokepoint`);
  }
  // No 4xx/503 left answering a hand-written English sentence.
  for (const m of src.matchAll(/NextResponse\.json\(([\s\S]{0,200}?)\{\s*status:\s*(4\d\d|503)\s*\}/g)) {
    assert.fail(`/connect still hand-rolls a ${m[2]} refusal:\n  ${m[0].slice(0, 140)}`);
  }
  // The operator's diagnostic detail survives the move: which env vars are missing
  // rides ALONGSIDE the code rather than inside an English sentence.
  assert.match(src, /need: missingVoiceEnv\(adapter\)/, "the unconfigured 503 keeps naming the missing vars");
});

test("the refusal registry defines every interview code the routes answer", () => {
  const registry = read("../../_lib/api-response.ts");
  const codes = new Set<string>();
  for (const rel of ["./create/route.ts", "./connect/route.ts", "./revoke/route.ts", "./simulate/route.ts"] as const) {
    for (const m of read(rel).matchAll(/jsonRefusal\("([A-Z_]+)"/g)) codes.add(m[1]);
  }
  assert.ok(codes.size >= 12, `expected the routes to answer a real vocabulary, found ${codes.size}`);
  for (const code of codes) {
    assert.match(
      registry,
      new RegExp(`^\\s{2}${code}:`, "m"),
      `REFUSAL_ERRORS must define ${code} (npm run i18n:check then pins its four catalogue entries)`,
    );
  }
});

// ---- the id-narrowing idiom, written once ----------------------------------

test("every interview door narrows its entry id through the one shared helper", () => {
  const helper = read("./entry-id.ts");
  assert.match(helper, /export const MAX_ID_LEN = 120;/, "the bound stays a named constant");

  for (const rel of ["./create/route.ts", "./revoke/route.ts", "./simulate/attach/route.ts"] as const) {
    const src = read(rel);
    assert.match(src, /readEntityId\(/, `${rel} must narrow through readEntityId`);
    assert.doesNotMatch(
      src,
      /\.length > 120/,
      `${rel} must not re-type the length bound - it lives in entry-id.ts`,
    );
    assert.doesNotMatch(
      src,
      /body\.(entryId|submissionId) === "string"/,
      `${rel} must not re-type the string narrowing - it lives in entry-id.ts`,
    );
  }
});

// ---- the two best-effort catches in /complete say what was lost ------------

test("/complete's best-effort catches log what an operator would act on", () => {
  const src = read("./complete/route.ts");
  assert.match(
    src,
    /catch \(ledgerErr\)[\s\S]{0,600}?console\.error\([\s\S]{0,200}?usage-ledger write failed/,
    "a dropped cost row must say which session lost its price - the ledger is the ONLY record of what a call cost",
  );
  assert.match(
    src,
    /catch \(scoringErr\)[\s\S]{0,900}?console\.error\([\s\S]{0,200}?scorecard synthesis failed/,
    "a failed synthesis must say so: the missing scorecard is already visible, the REASON is not",
  );
  // Still best-effort: neither may turn a persisted transcript into a failed request.
  assert.doesNotMatch(src, /catch \(ledgerErr\)[\s\S]{0,600}?throw /, "the ledger catch must not rethrow");
  assert.doesNotMatch(src, /catch \(scoringErr\)[\s\S]{0,900}?throw /, "the scoring catch must not rethrow");
});
