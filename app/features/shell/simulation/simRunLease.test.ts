// The walk's half of the lease, pinned where it broke: a start REFUSED with
// SIM_RUN_ACTIVE must not send the end-of-run release, because the wave-22 route
// honoured any release and freed the WINNER's lock — one more press and resetSim
// wiped a live run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SIM_RUN_TOKEN_HEADER, leaseFromClaim, releaseInit, renewInit } from "./simRunLease.ts";

test("a granted claim yields the lease token the walk will present", () => {
  assert.deepEqual(leaseFromClaim({ ok: true, cleared: {}, token: "lease-1" }), { token: "lease-1" });
});

test("a claim with no usable token is NO lease", () => {
  for (const body of [null, undefined, {}, { token: "" }, { token: 7 }, "nope", { ok: false }]) {
    assert.equal(leaseFromClaim(body), null, `${JSON.stringify(body) ?? "undefined"} must not read as ownership`);
  }
});

test("a refused start sends no release at all", () => {
  // The 409 path: okJson throws, the walk never records a lease, and the `finally`
  // asks for the release init — which is null, so nothing is sent.
  assert.equal(releaseInit(null), null, "the tab that lost the race must not free the winner");
  assert.equal(renewInit(null), null, "and it renews nothing either");
});

test("the release presents the token this walk claimed", () => {
  const init = releaseInit({ token: "lease-1" });
  assert.equal(init?.method, "DELETE");
  assert.deepEqual(init?.headers, { [SIM_RUN_TOKEN_HEADER]: "lease-1" });
});

test("the renew is the same door with no purge: a token, and `renew`", () => {
  const init = renewInit({ token: "lease-1" });
  assert.equal(init?.method, "POST");
  assert.equal((init?.headers as Record<string, string>)[SIM_RUN_TOKEN_HEADER], "lease-1");
  assert.deepEqual(JSON.parse(String(init?.body)), { renew: true }, "no `hold`, so the route claims and purges nothing");
});

test("a Start claims and purges exactly as before; a resume claims with keep and its own token", async () => {
  const { claimInit } = await import("./simRunLease.ts");
  const start = claimInit({ token: "lease-9" }, { keep: false });
  assert.equal(start.body, JSON.stringify({ hold: true }), "the Start shape is unchanged");
  assert.equal((start.headers as Record<string, string>)[SIM_RUN_TOKEN_HEADER], undefined, "a Start presents nothing");

  const resume = claimInit({ token: "lease-9" }, { keep: true });
  assert.equal(resume.body, JSON.stringify({ hold: true, keep: true }));
  assert.equal((resume.headers as Record<string, string>)[SIM_RUN_TOKEN_HEADER], "lease-9", "only the tab's own lease can be re-taken");
  assert.equal((claimInit(null, { keep: true }).headers as Record<string, string>)[SIM_RUN_TOKEN_HEADER], undefined);
});

test("the tab's lease survives a reload in session storage, and broken storage is no lease", async () => {
  const { storeLease, storedLease } = await import("./simRunLease.ts");
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  storeLease(storage, { token: "lease-3" });
  assert.deepEqual(storedLease(storage), { token: "lease-3" });
  storeLease(storage, null);
  assert.equal(storedLease(storage), null);
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(storedLease(throwing), null);
  assert.doesNotThrow(() => storeLease(throwing, { token: "x" }));
  assert.equal(storedLease(null), null);
});
