import test from "node:test";
import assert from "node:assert/strict";
import { draftFromStored, renameStage } from "@/app/features/shared/pipelineAxisDraft";
import type { PipelineStagesRule } from "@/app/_lib/decision-config-schema";
import {
  finishPartsFor,
  finishRemainder,
  persistCompanionConsent,
  persistOnboardingSetup,
  persistSetupBrand,
  sendSetupInvites,
} from "./setupOnboardingFinish";
import {
  everyInviteLanded,
  foldSetupOutcome,
  inviteBatchResult,
  type SetupFinishRun,
  type SetupInviteResult,
  type SetupPartResult,
} from "./setupFinishOutcome";
import { INITIAL_SETUP, type SetupInvite, type SetupState } from "./setupSteps";

// The wizard's closing toast keys off this one boolean, and the trap it guards is
// that `fetch` RESOLVES on a 400/403/409 — so "the promise settled" is not "the
// invite landed". POST /api/org/invites refuses a malformed address, a role above
// the caller's own, and an already-active member; the wizard used to fire the
// batch, discard every result and close on a green "Your workspace is set up".

const INVITES: SetupInvite[] = [
  { email: "jana@acme.com", role: "recruiter" },
  { email: "petr@acme.com", role: "hiring_manager" },
];

/** Stub `fetch` for the duration of one call; restores whatever was there. */
async function withFetch<T>(impl: (url: string, init?: RequestInit) => Promise<Response>, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => impl(url, init)) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const ok = () => Promise.resolve(new Response(JSON.stringify({ invite: {} }), { status: 200 }));

test("every invite accepted → landed", async () => {
  const results = await withFetch(ok, () => sendSetupInvites(INVITES));
  assert.equal(everyInviteLanded(results), true);
  assert.deepEqual(
    results.map((r) => r.email),
    ["jana@acme.com", "petr@acme.com"]
  );
});

test("nobody invited is not a failure (the blank-tenant default: Team is skippable)", async () => {
  const results = await withFetch(
    () => Promise.reject(new Error("must not be called")),
    () => sendSetupInvites([])
  );
  assert.equal(everyInviteLanded(results), true);
  assert.deepEqual(results, []);
});

test("a 400 from the route is NOT a landed invite", async () => {
  // What an address the operator mistyped actually produces:
  // `if (!email || !email.includes("@")) return 400 "A valid email is required."`.
  let calls = 0;
  const results = await withFetch(() => {
    calls += 1;
    return calls === 1
      ? Promise.resolve(
          new Response(JSON.stringify({ error: "A valid email is required.", code: "INVITE_EMAIL_INVALID" }), { status: 400 })
        )
      : ok();
  }, () => sendSetupInvites(INVITES));
  assert.equal(calls, 2, "the other invite is still attempted — best-effort per invite");
  assert.equal(everyInviteLanded(results), false);
  // The ADDRESS and the machine CODE both survive the batch, so the partial toast
  // can say which invitee was refused and why — in the reader's language, never
  // from the server's English `error` string.
  assert.deepEqual(results, [
    { email: "jana@acme.com", ok: false, code: "INVITE_EMAIL_INVALID", token: null, httpStatus: 400 },
    { email: "petr@acme.com", ok: true, code: null, token: null, httpStatus: 200 },
  ]);
});

test("a 409 (already an active member) is NOT a landed invite", async () => {
  const results = await withFetch(
    () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "That person is already an active member.", code: "INVITE_ALREADY_MEMBER" }), {
          status: 409,
        })
      ),
    () => sendSetupInvites([INVITES[0]])
  );
  assert.equal(everyInviteLanded(results), false);
  assert.equal(results[0].code, "INVITE_ALREADY_MEMBER");
});

test("a network rejection is NOT a landed invite", async () => {
  const results = await withFetch(
    () => Promise.reject(new Error("offline")),
    () => sendSetupInvites(INVITES)
  );
  assert.equal(everyInviteLanded(results), false);
  // No response means no code: the toast falls back to its localized generic
  // rather than inventing a reason the server never gave.
  assert.deepEqual(results.map((r) => r.code), [null, null]);
});

test("a refusal with an unparseable body still reports the address", async () => {
  const results = await withFetch(
    () => Promise.resolve(new Response("<html>gateway</html>", { status: 502 })),
    () => sendSetupInvites([INVITES[1]])
  );
  assert.deepEqual(results, [{ email: "petr@acme.com", ok: false, code: null, token: null, httpStatus: 502 }]);
});

test("posts the staged email and role verbatim", async () => {
  const bodies: unknown[] = [];
  await withFetch((url, init) => {
    assert.equal(url, "/api/org/invites");
    bodies.push(JSON.parse(String(init?.body)));
    return ok();
  }, () => sendSetupInvites(INVITES));
  assert.deepEqual(bodies, [
    { email: "jana@acme.com", role: "recruiter" },
    { email: "petr@acme.com", role: "hiring_manager" },
  ]);
});

// ---------------------------------------------------------------------------
// The brand write. It used to `await fetch(...)` and discard the response inside a
// catch labelled "brand is a nice-to-have" — true of a FAILURE, false of a
// REFUSAL. PUT /api/brand now answers 400 with a code when the accent has no
// legible twin in one of the two themes, and `fetch` RESOLVES on that, so the
// wizard closed green over a brand the server never stored.

const BRAND_STATE = { accentColor: "#0057b8", logoUrl: "" } as unknown as SetupState;

/** GET /api/brand answers the current record; PUT answers whatever `put` returns. */
function brandFetch(put: () => Promise<Response>) {
  return (url: string, init?: RequestInit) =>
    init?.method === "PUT"
      ? put()
      : Promise.resolve(new Response(JSON.stringify({ displayName: "Acme", accentColor: null, logoUrl: null }), { status: 200 }));
}

test("no accent and no logo is SKIPPED, and never touches the network", async () => {
  const result = await withFetch(
    () => Promise.reject(new Error("must not be called")),
    () => persistSetupBrand({ accentColor: null, logoUrl: "   " } as unknown as SetupState)
  );
  assert.deepEqual(result, { part: "brand", status: "skipped" });
});

test("a stored brand lands — and says nothing in the closing sentence", async () => {
  const result = await withFetch(brandFetch(() => Promise.resolve(new Response("{}", { status: 200 }))), () =>
    persistSetupBrand(BRAND_STATE)
  );
  assert.deepEqual(result, { part: "brand", status: "landed" });
  // Landed and skipped both fold to ok: the accent is decoration the operator can
  // redo in Settings, so only a refusal earns a line.
  assert.deepEqual(foldSetupOutcome([result]), { ok: true });
});

test("a REFUSED accent carries its code into the fold, not a green toast", async () => {
  const refusal = new Response(
    JSON.stringify({ error: "That accent has no readable Spark Dark version.", code: "BRAND_ACCENT_ILLEGIBLE_DARK" }),
    { status: 400 }
  );
  const result = await withFetch(brandFetch(() => Promise.resolve(refusal)), () => persistSetupBrand(BRAND_STATE));
  assert.deepEqual(result, { part: "brand", status: "refused", code: "BRAND_ACCENT_ILLEGIBLE_DARK" });
  // The component resolves that code through useErrorMessage, in the reader's
  // language — it never renders the server's English `error`.
  assert.deepEqual(foldSetupOutcome([result]), {
    ok: false,
    failures: [{ part: "brand", code: "BRAND_ACCENT_ILLEGIBLE_DARK", addresses: [] }],
  });
});

test("a refusal with no parseable body still refuses, with a null code", async () => {
  const result = await withFetch(brandFetch(() => Promise.resolve(new Response("not json", { status: 400 }))), () =>
    persistSetupBrand(BRAND_STATE)
  );
  assert.deepEqual(result, { part: "brand", status: "refused", code: null });
});

test("a network fault is a refusal too — nothing was stored", async () => {
  const result = await withFetch(
    () => Promise.reject(new Error("offline")),
    () => persistSetupBrand(BRAND_STATE)
  );
  assert.deepEqual(result, { part: "brand", status: "refused", code: null });
});

// ---------------------------------------------------------------------------
// Candi's memory — a consent write the wizard used to fire and forget.
//
// The trap: `POST /api/companion/brain` answers 403 (a seat without the
// capability) or 500 WITHOUT throwing, so the old `try { await fetch(...) } catch {}`
// resolved on a refusal and reported nothing. There is no consent control in
// Settings, so the operator's only clue was the dock's "memory off" line weeks
// later. A choice that was MADE and did not land now folds like every other write.

const CONSENT_STATE = { companionChoice: "birth" } as unknown as SetupState;

test("no choice is SKIPPED, and never touches the network", async () => {
  const result = await withFetch(
    () => Promise.reject(new Error("must not be called")),
    () => persistCompanionConsent({ companionChoice: null } as unknown as SetupState)
  );
  assert.deepEqual(result, { part: "companion", status: "skipped" });
});

test("a stored consent lands — and says nothing in the closing sentence", async () => {
  const result = await withFetch(
    () => Promise.resolve(new Response("{}", { status: 200 })),
    () => persistCompanionConsent(CONSENT_STATE)
  );
  assert.deepEqual(result, { part: "companion", status: "landed" });
  assert.deepEqual(foldSetupOutcome([result]), { ok: true });
});

test("a 403 carries its code into the fold, not a silent green", async () => {
  const result = await withFetch(
    () => Promise.resolve(new Response(JSON.stringify({ error: "Forbidden", code: "FORBIDDEN_CAPABILITY" }), { status: 403 })),
    () => persistCompanionConsent(CONSENT_STATE)
  );
  assert.deepEqual(result, { part: "companion", status: "refused", code: "FORBIDDEN_CAPABILITY" });
  assert.deepEqual(foldSetupOutcome([result]), {
    ok: false,
    failures: [{ part: "companion", code: "FORBIDDEN_CAPABILITY", addresses: [] }],
  });
});

test("a 500 with no parseable body still refuses, with a null code", async () => {
  const result = await withFetch(
    () => Promise.resolve(new Response("<html>502</html>", { status: 500 })),
    () => persistCompanionConsent(CONSENT_STATE)
  );
  assert.deepEqual(result, { part: "companion", status: "refused", code: null });
});

test("a network fault is a refusal too — memory is not on", async () => {
  const result = await withFetch(
    () => Promise.reject(new Error("offline")),
    () => persistCompanionConsent(CONSENT_STATE)
  );
  assert.deepEqual(result, { part: "companion", status: "refused", code: null });
});

test("the choice is posted verbatim to the brain door", async () => {
  const seen: { url: string; body: unknown }[] = [];
  await withFetch(
    (url, init) => {
      seen.push({ url, body: JSON.parse(String(init?.body)) });
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
    () => persistCompanionConsent(CONSENT_STATE)
  );
  assert.deepEqual(seen, [{ url: "/api/companion/brain", body: { action: "birth" } }]);
});

// ---------------------------------------------------------------------------
// The intent fork. A seeker walked Welcome → Hand-off: there was no company step,
// no team, no board, no Candi — so none of those writers may fire, not as "skipped
// because empty" but as "never asked". `finishPartsFor` is the pure gate
// persistOnboardingSetup consults before each writer; the language is the one
// answer every run gives (it lives on the rail).

test("a seeker's finish writes the language and nothing else", () => {
  assert.deepEqual(finishPartsFor({ ...INITIAL_SETUP, intent: "seek", orgName: "Acme", invites: INVITES }), ["language"]);
});

test("a hiring finish keeps every writer, in the order the toast names them", () => {
  assert.deepEqual(finishPartsFor({ ...INITIAL_SETUP, intent: "hire" }), [
    "language",
    "orgName",
    "currency",
    "brand",
    "invites",
    "pipeline",
    "companion",
  ]);
  // An unanswered fork is a hiring run: nothing is hidden before Welcome is answered.
  assert.deepEqual(finishPartsFor(INITIAL_SETUP), finishPartsFor({ ...INITIAL_SETUP, intent: "hire" }));
});

// ---------------------------------------------------------------------------
// The seat. A recruiter walked Welcome → Pipeline → Candi → Hand-off: no company,
// no team — and the language is an ORG-wide setting (setOrgLanguage takes
// org:manage), so a seat without it must not fire a write the server refuses. The
// rail's language switch already set the personal cookie.

test("a recruiter's hire finish never fires an org-wide write it would be refused", () => {
  const parts = finishPartsFor({ ...INITIAL_SETUP, intent: "hire", seat: ["pipeline:write", "read"] });
  for (const refused of ["language", "orgName", "currency", "brand", "invites"] as const) {
    assert.ok(!parts.includes(refused), `${refused} must not be written by a recruiter`);
  }
  assert.deepEqual(parts, ["pipeline", "companion"]);
});

// ---------------------------------------------------------------------------
// The receipt (challenge-r07 shell-setup-wizard/B). The route answers a landed
// invite with the tokenized accept link it minted - kp sends no invite mail, so
// that link IS the invitation, and the wizard used to throw it away.

test("a landed invite carries the token the route minted", async () => {
  const results = await withFetch(
    () => Promise.resolve(new Response(JSON.stringify({ invite: { token: "inv-abc" } }), { status: 200 })),
    () => sendSetupInvites([INVITES[0]])
  );
  assert.equal(results[0].ok, true);
  assert.equal(results[0].token, "inv-abc");
});

test("a landed invite with no token in the body is still landed, with a null token", async () => {
  const results = await withFetch(ok, () => sendSetupInvites([INVITES[0]]));
  assert.equal(results[0].ok, true);
  assert.equal(results[0].token, null);
});

// The retry re-runs ONLY the failed parts and ONLY the refused addresses: jana's
// invite landed and holds a live token, so re-posting it would mint a second link
// for the same person; the org name landed, so re-calling setOrgName is a write
// nobody asked for.
const BOARD: PipelineStagesRule = {
  stages: [
    { id: "applied", label: "Applied", role: "entry" },
    { id: "interview", label: "Interview", role: "interview" },
    { id: "hired", label: "Hired", role: "terminal" },
  ],
  retired: [],
} as unknown as PipelineStagesRule;

function hireRunWithFailures(): { state: SetupState; run: SetupFinishRun } {
  const draft = renameStage(draftFromStored(BOARD), "interview", "Talk");
  const state: SetupState = {
    ...INITIAL_SETUP,
    intent: "hire",
    orgName: "Acme",
    invites: INVITES,
    pipelineLoad: "ready",
    pipeline: { stored: BOARD, draft, counts: {} },
  };
  const invites: SetupInviteResult[] = [
    { email: "jana@acme.com", ok: true, code: null, token: "inv-abc", httpStatus: 200 },
    { email: "petr@acme.com", ok: false, code: null, token: null, httpStatus: null },
  ];
  const parts: SetupPartResult[] = [
    { part: "orgName", status: "landed" },
    { part: "language", status: "landed" },
    { part: "currency", status: "landed" },
    { part: "brand", status: "skipped" },
    inviteBatchResult(invites),
    { part: "pipeline", status: "refused", code: null },
    { part: "companion", status: "skipped" },
  ];
  return { state, run: { outcome: foldSetupOutcome(parts), parts, invites } };
}

test("finishRemainder: after a partial finish only the failed parts and the refused addresses remain", () => {
  const { state, run } = hireRunWithFailures();
  const rem = finishRemainder(state, run);
  assert.ok(rem);
  assert.deepEqual(finishPartsFor(rem.state, rem.parts), ["invites", "pipeline"]);
  assert.deepEqual(rem.state.invites, [INVITES[1]]);
});

test("retrying the remainder posts petr's invite and the board, and nothing else", async () => {
  const { state, run } = hireRunWithFailures();
  const rem = finishRemainder(state, run);
  assert.ok(rem);
  const calls: { url: string; body: unknown }[] = [];
  const retry = await withFetch((url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url === "/api/org/invites") {
      return Promise.resolve(new Response(JSON.stringify({ invite: { token: "inv-xyz" } }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  }, () => persistOnboardingSetup(rem.state, rem.parts));
  assert.deepEqual(
    calls.map((c) => c.url),
    ["/api/org/invites", "/api/pipeline/stage-migration"]
  );
  assert.deepEqual(calls[0].body, { email: "petr@acme.com", role: "hiring_manager" });
  assert.deepEqual(retry.outcome, { ok: true });
  // Nothing org-wide was touched: those parts are reported skipped, not re-run.
  for (const part of ["orgName", "language", "currency"] as const) {
    assert.deepEqual(
      retry.parts.find((p) => p.part === part),
      { part, status: "skipped" }
    );
  }
});

test("finishRemainder: a permanent refusal is not re-run, and nothing retryable means no remainder", () => {
  const { state } = hireRunWithFailures();
  const invites: SetupInviteResult[] = [
    { email: "jana@acme.com", ok: false, code: "INVITE_ALREADY_MEMBER", token: null, httpStatus: 409 },
    { email: "petr@acme.com", ok: true, code: null, token: "inv-def", httpStatus: 200 },
  ];
  const parts: SetupPartResult[] = [
    { part: "orgName", status: "refused", code: "ORG_SETTINGS_FORBIDDEN" },
    inviteBatchResult(invites),
  ];
  assert.equal(finishRemainder(state, { outcome: foldSetupOutcome(parts), parts, invites }), null);
});
