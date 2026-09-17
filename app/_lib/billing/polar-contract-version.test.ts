// Contract-version provenance at the Polar seam.
//
// Polar publishes DATED API contracts (YYYY-MM) and an integration that names none
// is served whatever "Current" is that quarter — a target that moves at each
// quarterly release. The contract is also chosen per WEBHOOK ENDPOINT at
// registration time, and an event keeps the version it was created under, so after
// a rotation new events and redeliveries of old ones arrive under DIFFERENT
// contracts for the same event type.
//
// Two invariants are pinned here, and the second one is the reason the first is
// safe to ship:
//   1. every outbound call and every parsed delivery either DECLARES or RECORDS a
//      contract version;
//   2. with no version configured, the outbound bytes are IDENTICAL to the
//      unpinned client's — so adopting this file cannot move a running
//      deployment's contract. Pinning stays a deliberate env change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PolarGateway, mapPolarEvent, noteObservedApiVersion, observedPolarApiVersion } from "./polar.ts";

const BASE = {
  accessToken: "unit-token",
  server: "sandbox" as const,
  webhookSecret: null,
  products: { starter: "prod_starter", growth: null, byom: null, minutePack: "prod_pack" },
};

const pinned = (apiVersion: string | null) => new PolarGateway({ ...BASE, apiVersion });

/** Capture the headers of every outbound call made by `run`, with a canned 200. */
async function capture(
  run: (g: PolarGateway) => Promise<unknown>,
  gateway: PolarGateway,
  responseHeaders: Record<string, string> = {}
): Promise<Record<string, string>[]> {
  const seen: Record<string, string>[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ ...((init?.headers ?? {}) as Record<string, string>) });
    return new Response(JSON.stringify({ id: "x", url: "https://example.test/c" }), {
      status: 200,
      headers: { "content-type": "application/json", ...responseHeaders },
    });
  }) as typeof fetch;
  try {
    await run(gateway);
  } finally {
    globalThis.fetch = real;
  }
  return seen;
}

const checkout = (g: PolarGateway) =>
  g.createCheckout({ kind: "plan", plan: "starter" }, { successUrl: "https://example.test/ok" });

test("a pinned deployment declares the contract on every outbound call", async () => {
  const headers = await capture(checkout, pinned("2026-10"));
  assert.equal(headers.length, 1);
  assert.equal(headers[0]["Polar-Version"], "2026-10");
});

test("the product read is pinned too — not just the money calls", async () => {
  const headers = await capture((g) => g.fetchProduct("prod_starter"), pinned("2026-10"));
  assert.equal(headers.length, 1);
  assert.equal(headers[0]["Polar-Version"], "2026-10");
});

// THE CONTROL, and the arm that could have refused this change: retrofitting a pin
// onto a live integration must be inert until someone opts in. If an unpinned
// gateway sent ANY version header, adopting this file would silently move the
// contract of every deployment that has not set the env — the exact failure the
// technique exists to prevent, committed by the fix for it.
test("an unpinned deployment sends NO version header — the change is inert by default", async () => {
  const headers = await capture(checkout, pinned(null));
  assert.equal(headers.length, 1);
  assert.ok(!("Polar-Version" in headers[0]), "unpinned must not name a contract");
  // And the rest of the request is unchanged: auth + content type, nothing else.
  assert.deepEqual(Object.keys(headers[0]).sort(), ["Authorization", "Content-Type"]);
});

test("a first-purchase checkout body has no customer_id field", async () => {
  // Pair of the header inertness rule: attaching an existing Polar customer is
  // opt-in on opts.customerId. A first purchase (no id) must not grow the JSON
  // with a null/empty customer_id, which Polar would treat as a different body.
  let body: Record<string, unknown> = {};
  const real = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: "x", url: "https://example.test/c" }), { status: 200 });
  }) as typeof fetch;
  try {
    await checkout(pinned(null));
  } finally {
    globalThis.fetch = real;
  }
  assert.ok(!("customer_id" in body), "first purchase must omit the key, not send null");
  assert.deepEqual(Object.keys(body).sort(), ["metadata", "products", "success_url"]);
});

test("the version the PROVIDER used is recorded, even when we pinned nothing", async () => {
  noteObservedApiVersion(null);
  await capture(checkout, pinned(null), { "polar-version": "2026-07" });
  assert.equal(observedPolarApiVersion(), "2026-07");
});

test("a delivery's declared contract lands on the normalized event", () => {
  const event = mapPolarEvent("evt_1", { type: "order.paid", data: { id: "ord_1" } }, "2026-07");
  assert.equal(event.apiVersion, "2026-07");
});

test("the raw payload's own api_version is the fallback when no header came", () => {
  const event = mapPolarEvent("evt_1", { type: "order.paid", api_version: "2026-04", data: { id: "ord_1" } });
  assert.equal(event.apiVersion, "2026-04");
});

// Absence is recorded as absence. A hand-built event, or a provider that publishes
// no contract versions, must not be stamped with a version nobody declared —
// a guessed provenance is worse than none, because a reader believes it.
test("an undeclared contract is null, never a guess at the current one", () => {
  const event = mapPolarEvent("evt_1", { type: "order.paid", data: { id: "ord_1" } });
  assert.equal(event.apiVersion, null);
});
