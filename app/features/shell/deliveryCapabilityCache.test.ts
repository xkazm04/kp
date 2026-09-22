import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITY_CHANGED,
  createCapabilityCache,
  type Capability,
  type CapabilityChannel,
} from "./deliveryCapabilityCache.ts";

// The relay is UI-configurable (Channels → relay card), so the capability bit the
// whole client keys its "sent" vs "queued" vocabulary off is a LIVE fact: one read
// per page while nothing changes, a pushed invalidation when the relay editor saves.

const OFF: Capability = { relayConfigured: false, emailInboundDomain: null };
const ON: Capability = { relayConfigured: true, emailInboundDomain: null };
const UNKNOWN: Capability = { relayConfigured: null, emailInboundDomain: null };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A fetcher answering from a queue of values (or deferreds), counting calls. */
function scripted(answers: Array<Capability | Promise<Capability>>) {
  const f = {
    calls: 0,
    fetcher: async () => {
      const a = answers[Math.min(f.calls, answers.length - 1)];
      f.calls++;
      return a;
    },
  };
  return f;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A BroadcastChannel stand-in: `deliver` plays a message from another window. */
function channelStub() {
  const listeners = new Set<(e: { data: unknown }) => void>();
  const posted: unknown[] = [];
  const ch: CapabilityChannel = {
    postMessage: (m) => void posted.push(m),
    addEventListener: (_t, l) => void listeners.add(l),
  };
  return { ch, posted, deliver: (data: unknown) => listeners.forEach((l) => l({ data })) };
}

test("two concurrent get() calls share ONE fetch and resolve to the same record", async () => {
  const d = deferred<Capability>();
  const f = scripted([d.promise]);
  const cache = createCapabilityCache({ fetcher: f.fetcher });
  const a = cache.get();
  const b = cache.get();
  d.resolve(OFF);
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(f.calls, 1);
  assert.deepEqual(ra, OFF);
  assert.equal(ra, rb);
});

test("a known record is cached — a second get() does not fetch again", async () => {
  const f = scripted([OFF]);
  const cache = createCapabilityCache({ fetcher: f.fetcher });
  assert.deepEqual(await cache.get(), OFF);
  assert.deepEqual(await cache.get(), OFF);
  assert.equal(f.calls, 1);
  assert.deepEqual(cache.peek(), OFF);
});

test("invalidate() drops the cached record — the next get() re-reads the live fact", async () => {
  const f = scripted([OFF, ON]);
  const cache = createCapabilityCache({ fetcher: f.fetcher });
  assert.equal((await cache.get()).relayConfigured, false);
  cache.invalidate();
  const next = await cache.get();
  assert.equal(f.calls, 2);
  assert.equal(next.relayConfigured, true);
});

test("a subscriber hears the refetch an invalidate() triggers — and nothing after unsubscribing", async () => {
  const f = scripted([OFF, ON, OFF]);
  const cache = createCapabilityCache({ fetcher: f.fetcher });
  await cache.get();
  const heard: Capability[] = [];
  const unsubscribe = cache.subscribe((v) => heard.push(v));
  cache.invalidate();
  await flush();
  assert.equal(heard.length, 1);
  assert.equal(heard[0].relayConfigured, true);
  unsubscribe();
  cache.invalidate();
  await flush();
  assert.equal(heard.length, 1);
});

test("the UNKNOWN record is never cached — a failed read stays retryable", async () => {
  const f = scripted([UNKNOWN, OFF]);
  const cache = createCapabilityCache({ fetcher: f.fetcher });
  assert.deepEqual(await cache.get(), UNKNOWN);
  assert.equal(cache.peek(), null);
  assert.deepEqual(await cache.get(), OFF);
  assert.equal(f.calls, 2);
});

test("generation guard: a read that started before invalidate() never lands as final", async () => {
  const stale = deferred<Capability>();
  const fresh = deferred<Capability>();
  const f = scripted([stale.promise, fresh.promise]);
  const cache = createCapabilityCache({ fetcher: f.fetcher });
  const heard: Capability[] = [];
  cache.subscribe((v) => heard.push(v));
  const first = cache.get();
  cache.invalidate(); // the operator saved a relay while the boot read was in flight
  fresh.resolve(ON);
  await flush();
  stale.resolve(OFF); // the pre-save answer arrives LAST
  await flush();
  assert.equal(cache.peek()?.relayConfigured, true);
  assert.equal(heard.at(-1)?.relayConfigured, true);
  assert.ok(heard.every((v) => v.relayConfigured === true), "the stale false is never delivered");
  assert.equal((await first).relayConfigured, true, "the stale caller is handed the fresh answer");
});

test("a 'capability-changed' message from another window invalidates + refetches; the general 'changed' bus does not", async () => {
  const f = scripted([OFF, ON]);
  const stub = channelStub();
  const cache = createCapabilityCache({ fetcher: f.fetcher, channel: stub.ch });
  await cache.get();
  const heard: Capability[] = [];
  cache.subscribe((v) => heard.push(v));

  stub.deliver("changed"); // every pipeline mutation — must not refetch capability
  await flush();
  assert.equal(f.calls, 1);
  assert.equal(heard.length, 0);

  stub.deliver({ type: CAPABILITY_CHANGED });
  await flush();
  assert.equal(f.calls, 2);
  assert.equal(heard.length, 1);
  assert.equal(heard[0].relayConfigured, true);
  assert.equal(stub.posted.length, 0, "a received invalidation is not re-broadcast (no ping-pong)");
});

test("a local invalidate() announces itself on the capability channel", () => {
  const stub = channelStub();
  const cache = createCapabilityCache({ fetcher: scripted([OFF]).fetcher, channel: stub.ch });
  cache.invalidate();
  assert.deepEqual(stub.posted, [{ type: CAPABILITY_CHANGED }]);
});
