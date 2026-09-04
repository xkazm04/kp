// Pins the two properties an outbound relay delivery had NO way to guarantee:
//
//   (1) IDEMPOTENCY. The retry ladder (comms-status.ts COMMS_RELAY_RETRY) re-POSTs a
//       message whose attempt died in flight — but "died in flight" and "the receiver
//       accepted it and the answer was lost" are indistinguishable from here. Without
//       a stable delivery identity, the second attempt delivered the SAME OFFER a
//       second time. Every attempt of one message now carries one `messageId` in the
//       kp.comm.v1 envelope and the same value in the Idempotency-Key header, so a
//       receiver can drop the repeat.
//
//   (2) A BOUND. Node's fetch has no default timeout, so a receiver that accepts the
//       connection and then goes quiet held the recruiter's click open indefinitely,
//       three times over. Each attempt now carries AbortSignal.timeout(relayTimeoutMs()).
//
// Both are driven through the REAL WebhookChannel against a receiver fixture, not
// asserted from the source: the whole point is what happens on attempt 2.
//
// unit-db.ts MUST be the first project import.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { IDEMPOTENCY_HEADER } from "./comms-envelope.ts";
import { sendComm, setRelayHostLookupForTests } from "./comms.ts";

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setRelayHostLookupForTests(undefined);
  delete process.env.COMMS_WEBHOOK_URL;
  delete process.env.KP_COMMS_RELAY_TIMEOUT_MS;
});

/** A resolver answering with one ordinary public address. Injected because delivery
 *  now RESOLVES the relay host before it posts (SSRF: the string-level check at the
 *  config write vets a name, not the address it answers with at delivery time), and
 *  `relay.example.test` is a fixture no resolver knows. */
const PUBLIC_LOOKUP = async () => [{ address: "93.184.216.34" }];

type Attempt = { key: string | null; messageId: string | null; hasSignal: boolean };

/** Install a fake relay and record every attempt it sees. `respond` decides the
 *  outcome per attempt, exactly as a real receiver would. */
function installRelay(respond: (attempt: Attempt, n: number, signal: AbortSignal | null) => Promise<Response>) {
  const attempts: Attempt[] = [];
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  setRelayHostLookupForTests(PUBLIC_LOOKUP);
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(String(init.body)) as { messageId?: string | null };
    const signal = (init.signal as AbortSignal | undefined) ?? null;
    const a: Attempt = { key: headers[IDEMPOTENCY_HEADER] ?? null, messageId: body.messageId ?? null, hasSignal: signal !== null };
    attempts.push(a);
    return respond(a, attempts.length, signal);
  }) as unknown as typeof fetch;
  return attempts;
}

const MSG = { to: "jana@example.cz", subject: "Offer", body: "…", kind: "offer" };

test("a retried delivery reuses ONE idempotency key, and a deduplicating receiver delivers once", async () => {
  // The receiver ACCEPTS attempt 1 and then the answer is lost (a dropped connection).
  // Attempt 2 is the same message: it must be recognised, not delivered again.
  const delivered = new Set<string>();
  const attempts = installRelay(async (a, n) => {
    if (a.key) delivered.add(a.key);
    if (n === 1) throw new Error("socket hang up");
    return new Response(null, { status: 200 });
  });

  const row = await sendComm(MSG);

  assert.equal(attempts.length, 2);
  assert.ok(attempts[0].key, "attempt 1 must carry an Idempotency-Key");
  assert.equal(attempts[1].key, attempts[0].key, "the retry must reuse the SAME key");
  // The header is a verbatim copy of the signed envelope field, so a receiver can
  // verify the identity instead of trusting an unsigned header.
  assert.equal(attempts[0].messageId, attempts[0].key);
  assert.equal(attempts[1].messageId, attempts[0].key);
  assert.equal(delivered.size, 1, "the receiver saw ONE logical message, not two");
  assert.equal(row.status, "sent");
});

test("an explicit messageId (a re-send of an already recorded message) is carried through", async () => {
  const attempts = installRelay(async () => new Response(null, { status: 200 }));
  await sendComm({ ...MSG, messageId: "out-original-row" });
  assert.equal(attempts[0].key, "out-original-row");
  assert.equal(attempts[0].messageId, "out-original-row");
});

test("a hanging receiver is abandoned per attempt and dead-letters with the timeout as the reason", async () => {
  process.env.KP_COMMS_RELAY_TIMEOUT_MS = "40";
  // Never answers; only the AbortSignal ends the call — which is exactly the receiver
  // that used to hold the handler open forever.
  const attempts = installRelay(
    (_a, _n, signal) =>
      new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason as Error));
      })
  );

  const started = Date.now();
  const row = await sendComm(MSG);
  const elapsed = Date.now() - started;

  assert.equal(attempts.length, 3, "the full ladder ran, each attempt bounded");
  assert.ok(attempts.every((a) => a.hasSignal), "every attempt carries an AbortSignal");
  assert.equal(row.status, "failed");
  assert.equal(row.failureDetail, "timeout after 40ms");
  // A FRESH signal per attempt: one hoisted signal would abort attempts 2 and 3
  // instantly and the whole ladder would finish in ~40ms.
  assert.ok(elapsed >= 120, `three 40ms attempts must actually wait (elapsed ${elapsed}ms)`);
});

// --- the SSRF boundary ----------------------------------------------------------

test("a relay host that RESOLVES private is a dead letter, and nothing is posted", async () => {
  // The pivot the string-level check at the config write cannot see: the operator
  // saved a public NAME, and at delivery time it answers in link-local space. This
  // request would have carried the candidate's message body and the relay HMAC.
  const attempts = installRelay(async () => new Response(null, { status: 200 }));
  setRelayHostLookupForTests(async () => [{ address: "169.254.169.254" }]);

  const row = await sendComm(MSG);

  assert.equal(attempts.length, 0, "no request may leave for a host that resolves into private space");
  assert.equal(row.status, "failed", "a refused delivery is a dead letter, never a green lie");
  assert.match(String(row.failureDetail), /non-public address/, "the row carries the reason a recruiter can act on");
});

test("the refusal is permanent — it does not spend the retry ladder", async () => {
  // Retrying a rebinding host three times only widens the window in which one
  // attempt resolves publicly and the next does not.
  let calls = 0;
  installRelay(async () => new Response(null, { status: 200 }));
  setRelayHostLookupForTests(async () => {
    calls += 1;
    return [{ address: "127.0.0.1" }];
  });

  const row = await sendComm(MSG);

  assert.equal(calls, 1, "the host is vetted once, not once per attempt");
  assert.equal(row.status, "failed");
});

test("an unresolvable relay host is refused rather than posted to", async () => {
  const attempts = installRelay(async () => new Response(null, { status: 200 }));
  setRelayHostLookupForTests(async () => {
    throw new Error("ENOTFOUND");
  });

  const row = await sendComm(MSG);

  assert.equal(attempts.length, 0);
  assert.equal(row.status, "failed");
  assert.match(String(row.failureDetail), /could not be resolved/);
});
