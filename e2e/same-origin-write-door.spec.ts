import { test, expect } from "@playwright/test";

// Finding 13 (docs/security/2026-11-08-offer-scorecard-doors-scan.md): a state-changing
// /api request that says it is cross-site is refused by proxy.ts before any handler.
// Keyless: the refusal needs no provider, and the allowed leg only asserts "not 403".
const DOOR = "/api/pipeline/m-0-0";

test("write door refuses a foreign Origin and does not refuse its own", async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL: baseURL! });
  try {
    const foreign = await ctx.post(DOOR, {
      headers: { origin: "https://evil.example", "content-type": "text/plain" },
      data: JSON.stringify({ action: "noop" }),
    });
    expect(foreign.status()).toBe(403);

    const own = await ctx.post(DOOR, {
      headers: { origin: new URL(baseURL!).origin, "content-type": "application/json" },
      data: JSON.stringify({ action: "noop" }),
    });
    expect(own.status()).not.toBe(403);
  } finally {
    await ctx.dispose();
  }
});
