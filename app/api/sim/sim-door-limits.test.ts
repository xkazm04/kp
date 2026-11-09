// Finding 12 of the 2026-11-08 offer/scorecard doors scan: the two sim doors that touch an
// offer (offer-draft, offer-link) throttle per client, and offer-draft caps its body before
// it parses. Real handlers on a throwaway DB; the limiter key is the client address (one shared key when no
// trusted proxy is configured, as here), so the throttle tests run last in the file.
// unit-db.ts must stay the first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { POST: offerDraft } = await import("./offer-draft/route.ts");
const { GET: offerLink } = await import("./offer-link/route.ts");

after(() => cleanupUnitDb());

const asClient = (ip: string, url: string, init?: RequestInit): NextRequest =>
  new Request(url, { ...init, headers: { "x-forwarded-for": ip, "content-type": "application/json" } }) as unknown as NextRequest;

test("offer-draft refuses an oversized body with 413 before parsing it", async () => {
  const res = await offerDraft(
    asClient("10.12.0.1", "http://x/api/sim/offer-draft", { method: "POST", body: JSON.stringify({ entryId: "x", pad: "y".repeat(20_000) }) })
  );
  assert.equal(res.status, 413);
  assert.equal(((await res.json()) as { code?: string }).code, "PAYLOAD_TOO_LARGE");
});

test("offer-draft answers a malformed body with its own SIM_ENTRY_REQUIRED refusal", async () => {
  const res = await offerDraft(asClient("10.12.0.2", "http://x/api/sim/offer-draft", { method: "POST", body: "{not json" }));
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code?: string }).code, "SIM_ENTRY_REQUIRED");
});

test("offer-draft is throttled per client key: the 61st call in a window is a 429", async () => {
  let last = 0;
  for (let i = 0; i < 61; i++) {
    last = (await offerDraft(asClient("10.12.0.3", "http://x/api/sim/offer-draft", { method: "POST", body: "{}" }))).status;
  }
  assert.equal(last, 429);
});

test("offer-link is throttled per client key: the 121st call in a window is a 429", async () => {
  let last = 0;
  for (let i = 0; i < 121; i++) {
    last = (await offerLink(asClient("10.12.0.5", "http://x/api/sim/offer-link"))).status;
  }
  assert.equal(last, 429);
});
