import test from "node:test";
import assert from "node:assert/strict";
import { sendSetupInvites } from "./setupOnboardingFinish";
import type { SetupInvite } from "./setupSteps";

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
  const landed = await withFetch(ok, () => sendSetupInvites(INVITES));
  assert.equal(landed, true);
});

test("nobody invited is not a failure (the blank-tenant default: Team is skippable)", async () => {
  const landed = await withFetch(
    () => Promise.reject(new Error("must not be called")),
    () => sendSetupInvites([])
  );
  assert.equal(landed, true);
});

test("a 400 from the route is NOT a landed invite", async () => {
  // What an address the operator mistyped actually produces:
  // `if (!email || !email.includes("@")) return 400 "A valid email is required."`.
  let calls = 0;
  const landed = await withFetch(() => {
    calls += 1;
    return calls === 1
      ? Promise.resolve(new Response(JSON.stringify({ error: "A valid email is required." }), { status: 400 }))
      : ok();
  }, () => sendSetupInvites(INVITES));
  assert.equal(calls, 2, "the other invite is still attempted — best-effort per invite");
  assert.equal(landed, false);
});

test("a 409 (already an active member) is NOT a landed invite", async () => {
  const landed = await withFetch(
    () => Promise.resolve(new Response(JSON.stringify({ error: "That person is already an active member." }), { status: 409 })),
    () => sendSetupInvites([INVITES[0]])
  );
  assert.equal(landed, false);
});

test("a network rejection is NOT a landed invite", async () => {
  const landed = await withFetch(
    () => Promise.reject(new Error("offline")),
    () => sendSetupInvites(INVITES)
  );
  assert.equal(landed, false);
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
