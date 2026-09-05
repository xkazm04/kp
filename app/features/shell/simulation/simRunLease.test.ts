// The walk's half of the lease, pinned where it broke: a start REFUSED with
// SIM_RUN_ACTIVE must not send the end-of-run release, because the wave-22 route
// honoured any release and freed the WINNER's lock — one more press and resetSim
// wiped a live run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SIM_RUN_TOKEN_HEADER, leaseFromClaim, releaseInit } from "./simRunLease.ts";

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
});

test("the release presents the token this walk claimed", () => {
  const init = releaseInit({ token: "lease-1" });
  assert.equal(init?.method, "DELETE");
  assert.deepEqual(init?.headers, { [SIM_RUN_TOKEN_HEADER]: "lease-1" });
});
