// The two OUTBOUND money calls, at the gateway seam: what bounds them and what may
// be tried twice. Nothing here touches the DB — PolarGateway is constructed directly
// and `fetch` is the only collaborator — so these run as pure unit tests.
//
// The invariant being pinned: a provider that never answers must not hold a purchase
// page open forever, and a retry is a PER-ENDPOINT decision (a customer-session may
// be minted twice; a checkout may not, because two live sessions for one intent is
// two payable links).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BillingProviderTimeoutError, POLAR_REQUEST_TIMEOUT_MS, PolarGateway } from "./polar.ts";

const CFG = {
  accessToken: "unit-token",
  server: "sandbox" as const,
  webhookSecret: null,
  products: { starter: "prod_starter", growth: null, byom: null, minutePack: "prod_pack" },
};

const gateway = () => new PolarGateway(CFG);

/** Swap `fetch` (and optionally the timeout clock) for the body of one test, and
 *  always put both back — a leaked stub would silently break every later test file
 *  sharing the process. */
async function withFetch(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
  opts: { timeoutMs?: number } = {}
): Promise<void> {
  const realFetch = globalThis.fetch;
  const realTimeout = AbortSignal.timeout;
  globalThis.fetch = impl as typeof fetch;
  if (opts.timeoutMs !== undefined) {
    // The production budget is a human-patience number (10s) and a unit test must not
    // wait it out. Shortening the CLOCK rather than the code keeps the real signal
    // path under test: the gateway still builds a real AbortSignal, still hands it to
    // fetch, and still converts the real abort into its own error.
    AbortSignal.timeout = (() => realTimeout.call(AbortSignal, opts.timeoutMs!)) as typeof AbortSignal.timeout;
  }
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
    AbortSignal.timeout = realTimeout;
  }
}

/** A provider that accepts the request and then says nothing — the shape that used
 *  to hang forever. It settles ONLY when the caller's own signal aborts. */
const hangingFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const signal = init?.signal as AbortSignal | undefined;
  assert.ok(signal instanceof AbortSignal, "every provider call must carry an abort signal");
  return new Promise<Response>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  });
};

test("the request budget is a stated, human-patience number", () => {
  assert.equal(POLAR_REQUEST_TIMEOUT_MS, 10_000);
});

test("a hanging provider aborts the checkout call as a timeout, not a hang", async () => {
  let calls = 0;
  await withFetch(
    async (input, init) => {
      calls += 1;
      return hangingFetch(input, init);
    },
    async () => {
      await assert.rejects(
        () => gateway().createCheckout({ kind: "plan", plan: "starter" }, { successUrl: "https://kp.test/?tab=billing" }),
        (err: unknown) => err instanceof BillingProviderTimeoutError
      );
      // NOT retried: a checkout create is not idempotent, and a timeout is exactly the
      // case where the first one may already have landed.
      assert.equal(calls, 1);
    },
    { timeoutMs: 20 }
  );
});

test("a hanging provider aborts the portal call too (both attempts bounded)", async () => {
  let calls = 0;
  await withFetch(
    async (input, init) => {
      calls += 1;
      return hangingFetch(input, init);
    },
    async () => {
      await assert.rejects(
        () => gateway().createPortalSession("cus_1"),
        (err: unknown) => err instanceof BillingProviderTimeoutError
      );
      // A timeout is not a "transient status", so the portal's one retry does not
      // apply to it — the budget is spent once, not twice.
      assert.equal(calls, 1);
    },
    { timeoutMs: 20 }
  );
});

test("the portal session is retried ONCE past a transient status", async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return calls === 1
        ? new Response("upstream hiccup", { status: 503 })
        : new Response(JSON.stringify({ customer_portal_url: "https://polar.test/portal/s1" }), { status: 200 });
    },
    async () => {
      assert.deepEqual(await gateway().createPortalSession("cus_1"), { url: "https://polar.test/portal/s1" });
      assert.equal(calls, 2);
    }
  );
});

test("a portal 400 is OUR request being wrong — never retried", async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return new Response("bad customer", { status: 400 });
    },
    async () => {
      await assert.rejects(() => gateway().createPortalSession("cus_nope"));
      assert.equal(calls, 1);
    }
  );
});

test("a checkout 503 is NOT retried — a second session would be a second payable link", async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return new Response("upstream hiccup", { status: 503 });
    },
    async () => {
      await assert.rejects(
        () => gateway().createCheckout({ kind: "pack", pack: "minutes_100" }, { successUrl: "https://kp.test/" }),
        (err: unknown) => err instanceof Error && !(err instanceof BillingProviderTimeoutError)
      );
      assert.equal(calls, 1);
    }
  );
});
