import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPublicHttpsEndpoint } from "./safe-url.ts";
import { assertPublicHttpsEndpointResolved } from "./ats-egress-guard.ts";

// bug-ui-scan-2026-07-09 shared-utility #2 — the DNS-rebind guard that llm-config's
// saveProviderKey now applies to an operator-supplied provider base URL (e.g. an
// Azure OpenAI resource endpoint fetched server-side WITH the bearer key). The
// string-only `assertPublicHttpsEndpoint` (in safe-url.ts) vets the literal host
// only; `assertPublicHttpsEndpointResolved` runs it as the FIRST gate and then
// resolves the host, rejecting if any A/AAAA record is private/loopback/link-local/
// metadata — the pivot the finding describes (a public-looking name that answers
// 169.254.169.254 at fetch time).
//
// DNS is INJECTED (a fake resolver) so the resolve branch is exercised deterministically
// and offline — no module-mock flags, no network.
//
// NON-VACUITY: the "string-only gate accepts the rebind host" test below shows what
// llm-config called BEFORE this fix — assertPublicHttpsEndpoint RETURNS
// `https://rebind.attacker.com` without throwing. So the rebind/private-resolution
// tests, wired to the pre-fix guard, would NOT reject (assert.rejects fails). The
// resolution step is what makes them throw.

/** Deterministic stand-in for node:dns lookup: host -> resolved addresses. */
const fakeLookup = (map: Record<string, string[]>) => async (host: string) => {
  const addrs = map[host];
  if (!addrs) throw new Error(`ENOTFOUND ${host}`);
  return addrs.map((address) => ({ address }));
};

test("NON-VACUITY: the pre-fix string-only gate ACCEPTS the rebind host", () => {
  // This is exactly what saveProviderKey used before the fix — no throw.
  assert.equal(
    assertPublicHttpsEndpoint("https://rebind.attacker.com/v1"),
    "https://rebind.attacker.com/v1",
  );
});

test("rejects a base URL whose host RESOLVES to the cloud-metadata IP (DNS rebinding)", async () => {
  await assert.rejects(
    assertPublicHttpsEndpointResolved(
      "https://rebind.attacker.com/v1",
      "azure_openai endpoint",
      fakeLookup({ "rebind.attacker.com": ["169.254.169.254"] }),
    ),
    /non-public address/,
  );
});

test("rejects when ANY resolved record is private (public + private mix)", async () => {
  await assert.rejects(
    assertPublicHttpsEndpointResolved(
      "https://sneaky.example.com",
      "endpoint",
      fakeLookup({ "sneaky.example.com": ["93.184.216.34", "127.0.0.1"] }),
    ),
    /non-public address/,
  );
});

test("rejects loopback / RFC-1918 resolution too", async () => {
  await assert.rejects(
    assertPublicHttpsEndpointResolved("https://a.example.com", "endpoint", fakeLookup({ "a.example.com": ["10.1.2.3"] })),
    /non-public address/,
  );
  await assert.rejects(
    assertPublicHttpsEndpointResolved("https://b.example.com", "endpoint", fakeLookup({ "b.example.com": ["::1"] })),
    /non-public address/,
  );
});

test("accepts a normal https host that resolves to a public address", async () => {
  const href = await assertPublicHttpsEndpointResolved(
    "https://api.openai.com/v1",
    "endpoint",
    fakeLookup({ "api.openai.com": ["104.18.6.192"] }),
  );
  assert.equal(href, "https://api.openai.com/v1");
});

test("the string gate fires FIRST — http / literal-IP / internal never reach DNS", async () => {
  const boom = () => {
    throw new Error("lookup must not run — the string gate should have rejected first");
  };
  await assert.rejects(assertPublicHttpsEndpointResolved("http://api.openai.com", "endpoint", boom), /https/);
  await assert.rejects(assertPublicHttpsEndpointResolved("https://169.254.169.254", "endpoint", boom), /IP address/);
  await assert.rejects(assertPublicHttpsEndpointResolved("https://localhost", "endpoint", boom), /internal\/loopback/);
});

test("rejects a host that does not resolve at all", async () => {
  await assert.rejects(
    assertPublicHttpsEndpointResolved("https://nope.example.com", "endpoint", fakeLookup({})),
    /could not be resolved/,
  );
});
