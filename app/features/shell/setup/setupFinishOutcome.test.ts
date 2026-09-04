import test from "node:test";
import assert from "node:assert/strict";
import {
  describeSetupFailures,
  everyInviteLanded,
  foldSetupOutcome,
  inviteBatchResult,
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
