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
  apiVersion: null,
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

test("createCheckout posts customer_id only when the caller supplies a non-empty one", async () => {
  const bodies: Record<string, unknown>[] = [];
  await withFetch(
    async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: "chk_1", url: "https://polar.test/c" }), { status: 200 });
    },
    async () => {
      await gateway().createCheckout(
        { kind: "plan", plan: "starter" },
        { successUrl: "https://kp.test/?tab=billing", customerId: "cus_1" }
      );
      await gateway().createCheckout(
        { kind: "plan", plan: "starter" },
        { successUrl: "https://kp.test/?tab=billing" }
      );
      await gateway().createCheckout(
        { kind: "pack", pack: "minutes_100" },
        { successUrl: "https://kp.test/", customerId: "  " }
      );
    }
  );
  assert.equal(bodies[0]?.customer_id, "cus_1");
  assert.ok(!("customer_id" in (bodies[1] ?? {})), "omit path must not send the key");
  assert.deepEqual(Object.keys(bodies[1] ?? {}).sort(), ["metadata", "products", "success_url"]);
  assert.ok(!("customer_id" in (bodies[2] ?? {})), "blank customerId is treated as absent");
});

test("an invalid Polar customer is a thrown error, never a silent second customer", async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return new Response("unknown customer", { status: 404 });
    },
    async () => {
      await assert.rejects(() =>
        gateway().createCheckout(
          { kind: "pack", pack: "minutes_100" },
          { successUrl: "https://kp.test/", customerId: "cus_gone" }
        )
      );
      // Not retried without the id: that would mint a second MoR customer.
      assert.equal(calls, 1);
    }
  );
});

// ---- the subscription READ (challenge-r07 billing-subscriptions/B) -----------------
// The daily subscription reconcile reads each stored subscription back from the
// provider. The GET mirrors fetchProduct: same headers, same budget, never retried,
// null on any failure (an unreadable subscription is "unknown", never drift), and it
// refuses outright under KP_OFFLINE. The method is read through a loose handle so this
// file type-checks on the tree it was written against.
type SubscriptionReader = { fetchSubscription?: (id: string) => Promise<unknown | null> };
const readSubscription = (g: PolarGateway, id: string): Promise<unknown | null> => {
  const f = (g as unknown as SubscriptionReader).fetchSubscription;
  assert.equal(typeof f, "function", "PolarGateway.fetchSubscription exists");
  return f!.call(g, id);
};

test("fetchSubscription GETs /v1/subscriptions/{id} with the gateway's own headers", async () => {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  await withFetch(
    async (input, init) => {
      seen.push({ url: String(input), init });
      return new Response(JSON.stringify({ id: "sub_1", status: "active" }), { status: 200 });
    },
    async () => {
      assert.deepEqual(await readSubscription(gateway(), "sub_1"), { id: "sub_1", status: "active" });
      const pinned = new PolarGateway({ ...CFG, apiVersion: "2026-10" });
      await readSubscription(pinned, "sub/2");
    }
  );
  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, "https://sandbox-api.polar.sh/v1/subscriptions/sub_1");
  assert.equal(seen[1].url, "https://sandbox-api.polar.sh/v1/subscriptions/sub%2F2", "the id is path-encoded");
  assert.equal((seen[0].init?.method ?? "GET").toUpperCase(), "GET");
  assert.equal(seen[0].init?.body, undefined, "a read carries no body");
  const h0 = seen[0].init?.headers as Record<string, string>;
  const h1 = seen[1].init?.headers as Record<string, string>;
  assert.equal(h0.Authorization, "Bearer unit-token");
  assert.equal("Polar-Version" in h0, false, "unpinned: no Polar-Version header");
  assert.equal(h1["Polar-Version"], "2026-10", "pinned: the operator's contract is named");
  assert.ok(seen[0].init?.signal instanceof AbortSignal, "the read is bounded");
});

test("fetchSubscription answers null on a non-2xx, a throw or a timeout — once, never retried", async () => {
  for (const impl of [
    async () => new Response("nope", { status: 503 }),
    async () => new Response("gone", { status: 404 }),
    async () => {
      throw new Error("socket hang up");
    },
    hangingFetch,
  ] as Array<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>) {
    let calls = 0;
    await withFetch(
      async (input, init) => {
        calls += 1;
        return impl(input, init);
      },
      async () => {
        assert.equal(await readSubscription(gateway(), "sub_1"), null);
      },
      { timeoutMs: 20 }
    );
    assert.equal(calls, 1, "a background read is never retried");
  }
});

test("fetchSubscription refuses under KP_OFFLINE without touching the network", async () => {
  let calls = 0;
  const prior = process.env.KP_OFFLINE;
  process.env.KP_OFFLINE = "1";
  try {
    await withFetch(
      async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
      },
      async () => {
        assert.equal(await readSubscription(gateway(), "sub_1"), null);
      }
    );
  } finally {
    if (prior === undefined) delete process.env.KP_OFFLINE;
    else process.env.KP_OFFLINE = prior;
  }
  assert.equal(calls, 0);
});
