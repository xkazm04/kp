import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyInviteUrl } from "@/app/features/settings/workspace/workspaceAdminHelpers";
import {
  describeSetupFailures,
  everyInviteLanded,
  finishNext,
  finishReceipt,
  foldSetupOutcome,
  inviteBatchResult,
  isRetryable,
  mergeFinishRuns,
  type SetupFinishRun,
  type SetupInviteResult,
  type SetupPartResult,
} from "./setupFinishOutcome";

// The wizard's closing sentence is the one claim the operator carries into the
// app. Every write behind it can be REFUSED rather than fail — setOrgName /
// setOrgLanguage answer ORG_SETTINGS_FORBIDDEN without org:manage, the invite
// route answers 400/403/409, the axis write answers 409 — and none of them
// throws. These pin the fold that turns those into one truthful outcome.

test("everything landed → saved", () => {
  const results: SetupPartResult[] = [
    { part: "orgName", status: "landed" },
    { part: "language", status: "landed" },
    { part: "invites", status: "skipped" },
    { part: "pipeline", status: "skipped" },
  ];
  assert.deepEqual(foldSetupOutcome(results), { ok: true });
});

test("a skipped write is a success, not a failure (every step ships a working default)", () => {
  assert.deepEqual(foldSetupOutcome([{ part: "orgName", status: "skipped" }]), { ok: true });
});

test("a REFUSED org name never folds to saved — the regression", () => {
  // A recruiter without org:manage finishing the wizard: the cookie is never
  // written and the workspace keeps the seed default as its identity, while the
  // old finish() (which discarded OrgSettingResult) closed on "saved".
  const outcome = foldSetupOutcome([
    { part: "orgName", status: "refused", code: "ORG_SETTINGS_FORBIDDEN" },
    { part: "language", status: "refused", code: "ORG_SETTINGS_FORBIDDEN" },
    { part: "invites", status: "skipped" },
  ]);
  assert.equal(outcome.ok, false);
  assert.deepEqual(
    outcome.ok ? [] : outcome.failures,
    [
      { part: "orgName", code: "ORG_SETTINGS_FORBIDDEN", addresses: [] },
      { part: "language", code: "ORG_SETTINGS_FORBIDDEN", addresses: [] },
    ]
  );
});

test("failures read in step order, not in the order the awaits resolved", () => {
  const outcome = foldSetupOutcome([
    { part: "pipeline", status: "refused", code: "PIPELINE_STAGES_OCCUPIED" },
    { part: "orgName", status: "refused", code: "ORG_SETTINGS_FORBIDDEN" },
  ]);
  assert.deepEqual(outcome.ok ? [] : outcome.failures.map((f) => f.part), ["orgName", "pipeline"]);
});

test("a refusal with no code still fails (a network drop has no vocabulary)", () => {
  const outcome = foldSetupOutcome([{ part: "pipeline", status: "refused", code: null }]);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok ? null : outcome.failures[0].code, null);
});

/* ── the invite batch ─────────────────────────────────────────────────────── */

const LANDED = (email: string): SetupInviteResult => ({ email, ok: true, code: null });

test("nobody invited is skipped, not failed", () => {
  assert.deepEqual(inviteBatchResult([]), { part: "invites", status: "skipped" });
  assert.equal(everyInviteLanded([]), true);
});

test("the refused ADDRESSES ride through to the toast", () => {
  const batch = inviteBatchResult([
    LANDED("jana@acme.com"),
    { email: "petr@acme", ok: false, code: "INVITE_EMAIL_INVALID" },
    { email: "eva@acme.com", ok: false, code: "INVITE_ALREADY_MEMBER" },
  ]);
  assert.deepEqual(batch, {
    part: "invites",
    status: "refused",
    code: "INVITE_EMAIL_INVALID",
    addresses: ["petr@acme", "eva@acme.com"],
  });
  assert.equal(everyInviteLanded([LANDED("a@b.c"), { email: "x@y.z", ok: false, code: null }]), false);
});

test("the fold merges every refused address of the batch into one failure", () => {
  const outcome = foldSetupOutcome([
    inviteBatchResult([
      { email: "petr@acme", ok: false, code: "INVITE_EMAIL_INVALID" },
      { email: "eva@acme.com", ok: false, code: "INVITE_ALREADY_MEMBER" },
    ]),
  ]);
  assert.deepEqual(outcome.ok ? [] : outcome.failures, [
    { part: "invites", code: "INVITE_EMAIL_INVALID", addresses: ["petr@acme", "eva@acme.com"] },
  ]);
});

/* ── the sentence ─────────────────────────────────────────────────────────── */

// Stand-ins for the four catalog lookups the component supplies. The point is
// that describeSetupFailures never writes English of its own — every word comes
// from a translator, and the reason comes from the server's machine CODE.
const label = (part: string) => `[${part}]`;
const reason = (code: string | null) => (code ? `<${code}>` : "<unknown>");
const line = (p: { part: string; reason: string }) => `${p.part}: ${p.reason}`;
const withAddr = (p: { part: string; reason: string; addresses: string }) => `${p.part} (${p.addresses}): ${p.reason}`;

test("names WHAT did not land, by code", () => {
  const lines = describeSetupFailures(
    [{ part: "orgName", code: "ORG_SETTINGS_FORBIDDEN", addresses: [] }],
    label,
    reason,
    line,
    withAddr
  );
  assert.deepEqual(lines, ["[orgName]: <ORG_SETTINGS_FORBIDDEN>"]);
});

test("the invite line lists the refused addresses", () => {
  const lines = describeSetupFailures(
    [{ part: "invites", code: "INVITE_ALREADY_MEMBER", addresses: ["eva@acme.com", "petr@acme.com"] }],
    label,
    reason,
    line,
    withAddr
  );
  assert.deepEqual(lines, ["[invites] (eva@acme.com, petr@acme.com): <INVITE_ALREADY_MEMBER>"]);
});

test("a codeless failure falls back to the caller's localized generic, never to English prose", () => {
  const lines = describeSetupFailures([{ part: "pipeline", code: null, addresses: [] }], label, reason, line, withAddr);
  assert.deepEqual(lines, ["[pipeline]: <unknown>"]);
});

/* ── the receipt (challenge-r07 shell-setup-wizard/B) ─────────────────────── */

// kp sends no invite mail: POST /api/org/invites mints a tokenized accept link for
// the UI to share (org/invites/route.ts). The wizard used to discard that token and
// close on "2 teammates invited" - nobody was told. When finish() leaves something
// the operator must act on (a link to share, a part that did not land), the wizard
// stays open on a receipt; with nothing to act on it closes exactly as before.

const ORIGIN = "http://localhost:3000";

function run(parts: SetupPartResult[], invites: SetupInviteResult[] = []): SetupFinishRun {
  return { outcome: foldSetupOutcome(parts), parts, invites };
}

test("receipt: two landed invites become two share links, staged order, via copyInviteUrl's rule", () => {
  const invites: SetupInviteResult[] = [
    { email: "jana@acme.com", ok: true, code: null, token: "inv-abc", httpStatus: 200 },
    { email: "petr@acme.com", ok: true, code: null, token: "inv-def", httpStatus: 200 },
  ];
  const receipt = finishReceipt(run([inviteBatchResult(invites)], invites), ORIGIN);
  assert.ok(receipt);
  assert.deepEqual(receipt.links, [
    { email: "jana@acme.com", url: "http://localhost:3000/invite/inv-abc" },
    { email: "petr@acme.com", url: "http://localhost:3000/invite/inv-def" },
  ]);
  assert.equal(receipt.links[0].url, copyInviteUrl(ORIGIN, "inv-abc"));
  assert.equal(receipt.unshareable, 0);
  assert.deepEqual(receipt.failures, []);
});

test("receipt: a landed invite whose token did not come back is counted, never linked", () => {
  const invites: SetupInviteResult[] = [
    { email: "jana@acme.com", ok: true, code: null, token: "inv-abc", httpStatus: 200 },
    { email: "petr@acme.com", ok: true, code: null, token: null, httpStatus: 200 },
  ];
  const receipt = finishReceipt(run([inviteBatchResult(invites)], invites), ORIGIN);
  assert.ok(receipt);
  assert.deepEqual(receipt.links.map((l) => l.email), ["jana@acme.com"]);
  assert.equal(receipt.unshareable, 1);
});

test("receipt: nothing to share and everything landed -> null, so finish() closes as today", () => {
  const r = run([
    { part: "orgName", status: "landed" },
    { part: "language", status: "landed" },
    { part: "invites", status: "skipped" },
    { part: "pipeline", status: "landed" },
  ]);
  assert.equal(finishReceipt(r, ORIGIN), null);
  assert.equal(finishNext(r.outcome, null), "close");
});

test("receipt: a failed part with no invites still opens a receipt", () => {
  const r = run([{ part: "pipeline", status: "refused", code: "PIPELINE_MIGRATION_REQUIRED" }]);
  const receipt = finishReceipt(r, ORIGIN);
  assert.ok(receipt);
  assert.deepEqual(receipt.failures, [
    { part: "pipeline", code: "PIPELINE_MIGRATION_REQUIRED", addresses: [], retryable: false },
  ]);
  assert.equal(receipt.canRetry, false);
  assert.equal(finishNext(r.outcome, receipt), "receipt");
});

test("receipt: refused invites split by whether a retry can work, each group with its own reason", () => {
  const invites: SetupInviteResult[] = [
    { email: "jana@acme.com", ok: true, code: null, token: "inv-abc", httpStatus: 200 },
    { email: "petr@acme.com", ok: false, code: null, token: null, httpStatus: null },
    { email: "eva@acme.com", ok: false, code: "INVITE_ALREADY_MEMBER", token: null, httpStatus: 409 },
  ];
  const receipt = finishReceipt(run([inviteBatchResult(invites)], invites), ORIGIN);
  assert.ok(receipt);
  assert.deepEqual(receipt.failures, [
    { part: "invites", code: null, addresses: ["petr@acme.com"], retryable: true },
    { part: "invites", code: "INVITE_ALREADY_MEMBER", addresses: ["eva@acme.com"], retryable: false },
  ]);
  assert.equal(receipt.canRetry, true);
});

test("isRetryable: a network fault, a rate limit or a store *_FAILED can be retried", () => {
  assert.equal(isRetryable({ part: "pipeline", code: null }), true);
  assert.equal(isRetryable({ part: "invites", code: "TOO_MANY_REQUESTS" }), true);
  assert.equal(isRetryable({ part: "pipeline", code: "STAGE_MIGRATION_FAILED" }), true);
  assert.equal(isRetryable({ part: "invites", code: null, httpStatus: null }), true);
});

test("isRetryable: a permanent refusal is named, never offered a Retry that cannot work", () => {
  for (const code of ["ORG_SETTINGS_FORBIDDEN", "INVITE_ALREADY_MEMBER", "INVITE_ROLE_ABOVE_PRIVILEGE", "BRAND_ACCENT_ILLEGIBLE_LIGHT"]) {
    assert.equal(isRetryable({ part: "orgName", code }), false, code);
  }
});

test("isRetryable: a code-less refusal from the invite route is permanent unless it is 429 or 5xx", () => {
  // The route's no_workspace answer is a 409 whose body carries no code, and its
  // cross-org answer a bare 404: re-posting either cannot land.
  assert.equal(isRetryable({ part: "invites", code: null, httpStatus: 409 }), false);
  assert.equal(isRetryable({ part: "invites", code: null, httpStatus: 404 }), false);
  assert.equal(isRetryable({ part: "invites", code: null, httpStatus: 429 }), true);
  assert.equal(isRetryable({ part: "invites", code: null, httpStatus: 502 }), true);
});

test("finishNext: no receipt closes, a receipt stays open", () => {
  assert.equal(finishNext({ ok: true }, null), "close");
  assert.equal(
    finishNext({ ok: true }, { links: [{ email: "a@b.c", url: "u" }], unshareable: 0, failures: [], canRetry: false }),
    "receipt"
  );
});

test("mergeFinishRuns: a retry replaces only the parts and addresses it re-ran", () => {
  const firstInvites: SetupInviteResult[] = [
    { email: "jana@acme.com", ok: true, code: null, token: "inv-abc", httpStatus: 200 },
    { email: "petr@acme.com", ok: false, code: null, token: null, httpStatus: null },
  ];
  const first = run(
    [{ part: "orgName", status: "landed" }, inviteBatchResult(firstInvites), { part: "pipeline", status: "refused", code: null }],
    firstInvites
  );
  const retryInvites: SetupInviteResult[] = [{ email: "petr@acme.com", ok: true, code: null, token: "inv-xyz", httpStatus: 200 }];
  const retry = run(
    [{ part: "orgName", status: "skipped" }, inviteBatchResult(retryInvites), { part: "pipeline", status: "landed" }],
    retryInvites
  );
  const merged = mergeFinishRuns(first, retry, ["invites", "pipeline"]);
  assert.deepEqual(merged.outcome, { ok: true });
  assert.deepEqual(
    merged.invites.map((i) => [i.email, i.token]),
    [
      ["jana@acme.com", "inv-abc"],
      ["petr@acme.com", "inv-xyz"],
    ]
  );
  // orgName keeps its FIRST answer (landed), not the retry's "skipped".
  assert.deepEqual(
    merged.parts.find((p) => p.part === "orgName"),
    { part: "orgName", status: "landed" }
  );
});

/* ── the source shape the pure half cannot reach ──────────────────────────── */

// SOURCE-LEVEL: OnboardingExperience and SetupHandoffSummary are client components
// and the unit runner has no React renderer. The contract pinned is WHERE the
// completed stamp and the draft clear run.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const hostSrc = readFileSync(path.join(HERE, "OnboardingExperience.tsx"), "utf8");
const handoffSrc = readFileSync(path.join(HERE, "SetupHandoffSummary.tsx"), "utf8");

function callbackBody(name: string): string {
  const start = hostSrc.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `${name}() must be a useCallback on the host`);
  // A useCallback closes either as `}, [deps]);` or as `  [deps]\n  );` - the
  // body ends at whichever comes first.
  const ends = ["\n  }, [", "\n  );"].map((m) => hostSrc.indexOf(m, start)).filter((i) => i > start);
  assert.ok(ends.length > 0);
  const end = Math.min(...ends);
  return hostSrc.slice(start, end);
}

test("finish() no longer clears the draft or stamps 'completed' in a finally, whatever the outcome", () => {
  const body = callbackBody("finish");
  assert.doesNotMatch(body, /finally\s*\{/, "a partial finish must not drop the answers on its way out");
  assert.doesNotMatch(body, /clearDraft\(|stamp\("completed"\)/, "finish() itself never settles the run");
  // finish() hands its run to land(), which asks finishNext whether to close or
  // stay open on the receipt.
  assert.match(body, /land\(run\)/);
  assert.match(callbackBody("land"), /finishNext\(/);
  // The stamp and the draft clear still happen: once, in the one settle path the
  // receipt's Done (or a receipt-less finish) takes.
  const settle = callbackBody("settle");
  assert.match(settle, /clearDraft\(\)/);
  assert.match(settle, /stamp\("completed"\)/);
});

test("the tour tile starts the demo only after finish settles, never in the same tick", () => {
  assert.doesNotMatch(handoffSrc, /ctrl\.finish\(\);\s*sim\.start\(\);/);
  assert.match(handoffSrc, /ctrl\.finish\(\s*\(\)\s*=>\s*sim\.start\(\)\s*\)/);
});

/* ── the hand-off copy says what actually happens ─────────────────────────── */

const ROOT = path.resolve(HERE, "../../../..");
const LINK_WORD: Record<string, RegExp> = { en: /link/i, cs: /odkaz/i, de: /link/i, fr: /lien/i };

test("hand-off meta reads as links to share, not as teammates invited, in all four catalogs", () => {
  for (const [locale, word] of Object.entries(LINK_WORD)) {
    const catalog = JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8"));
    const meta: string = catalog.setup.handoff.readyMeta;
    assert.match(meta, word, `${locale}: setup.handoff.readyMeta must speak of links to share`);
    if (locale === "en") assert.doesNotMatch(meta, /invited/i);
  }
});
