import test from "node:test";
import assert from "node:assert/strict";
import { persistSetupBrand, sendSetupInvites } from "./setupOnboardingFinish";
import { everyInviteLanded, foldSetupOutcome } from "./setupFinishOutcome";
import type { SetupInvite, SetupState } from "./setupSteps";

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
    { email: "jana@acme.com", ok: false, code: "INVITE_EMAIL_INVALID" },
    { email: "petr@acme.com", ok: true, code: null },
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
  assert.deepEqual(results, [{ email: "petr@acme.com", ok: false, code: null }]);
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
