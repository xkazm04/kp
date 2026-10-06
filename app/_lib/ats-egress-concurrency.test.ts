// F-6 — the outbound ATS mirror must not fan out without a ceiling. A committed screening
// wave fires one unawaited `void dispatchAtsEvent("candidate.rejected", …)` per applied
// reject (screen-wave.ts), and nothing used to count them: a 200-candidate cohort put up
// to 200 concurrent POSTs, each carrying candidate PII, on one customer endpoint from a
// single approved click. Keyless — the project's default, where the comms relay is a local
// write — the per-candidate spacing that made it look bounded disappears entirely.
//
// The fix is admission control on the NETWORK phase only (ats-egress.ts), so the four
// properties that make the ledger trustworthy must all survive it:
//   1. the cap holds (never more than `KP_ATS_MAX_CONCURRENT` POSTs in flight) AND the
//      ledger row of every queued dispatch is already open — a waiting delivery is
//      operator-VISIBLE, not an invisible pile of microtasks;
//   2. draining the queue settles every one of them as delivered (the cap delays, it
//      never drops);
//   3. a receiver that throws on every call still releases every slot — a leaked slot
//      would wedge the mirror for the life of the process — and `dispatchAtsEvent` keeps
//      its "never throws" contract, which on the `void` call site is a process exit;
//   4. the knob is real: 1 serialises.
//
// NON-VACUITY: with the cap removed, (1)'s peak assert reads 20 instead of the ceiling and
// (4)'s reads 3 instead of 1. (2) and (3) pass either way by construction — they are the
// regression floor, not the proof.
//
// unit-db is the FIRST project import (throwaway KP_DB_PATH).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { setAtsConfig } from "./ats-config-store.ts";
import { ATS_DEFAULT_MAX_CONCURRENT, atsEgressLoad, dispatchAtsEvent } from "./ats-egress.ts";
import { getAtsDelivery, listAtsDeliveries } from "./ats-delivery-store.ts";
import { createPipelineEntry } from "./db/pipeline.ts";

after(() => cleanupUnitDb());

/** A fetch stub that HOLDS every request open until released, while recording how many
 *  were concurrently in flight. The hold is what makes the ceiling observable at all: an
 *  instantly-answering stub would finish each POST before the next was admitted and a
 *  missing cap would look identical to a working one. */
function gatedFetch(answer: () => Promise<unknown> = async () => ({ ok: true, status: 200 })) {
  let inFlight = 0;
  let peak = 0;
  let calls = 0;
  let open = false;
  const held: Array<() => void> = [];
  const impl = (async () => {
    calls += 1;
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      if (!open) await new Promise<void>((resolve) => held.push(resolve));
      return await answer();
    } finally {
      inFlight -= 1;
    }
  }) as unknown as typeof fetch;
  return {
    impl,
    peak: () => peak,
    inFlight: () => inFlight,
    calls: () => calls,
    /** Let everything through, now and from here on. */
    release: () => {
      open = true;
      while (held.length) held.shift()!();
    },
  };
}

async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

/** Poll until `cond`, or fail loudly. Every wait here is for a REAL DNS resolve of
 *  example.com inside `deliver` (the SSRF re-vet), so this is a deadline, not a sleep —
 *  and a timeout is reported as the assertion it is, never as a vacuous pass. */
async function waitFor(cond: () => boolean, what: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) assert.fail(`timed out after ${timeoutMs}ms waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Give the event loop room to over-admit if the cap is missing. Without this the peak
 *  assert could read the ceiling simply because the 5th dispatch had not got there yet. */
async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 25));
}

function makeEntries(n: number, tag: string): string[] {
  return Array.from({ length: n }, (_, i) => {
    const { entry } = createPipelineEntry({
      candidateId: `c-${tag}-${i}`,
      candidateLabel: `Burst Person ${tag}-${i}`,
      jobId: `job-${tag}`,
      jobTitle: "Role",
    });
    return entry.id;
  });
}

// (1) + (2) — the burst is capped, every queued delivery is already in the ledger, and
// draining settles all of them.
test("a 20-dispatch burst never exceeds the cap, every row is open while queued, and the drain delivers all 20", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  const ids = makeEntries(20, "cap");
  const cap = atsEgressLoad().ceiling;
  assert.equal(cap, ATS_DEFAULT_MAX_CONCURRENT, "the default ceiling is in force for this test");

  const gate = gatedFetch();
  await withFetch(gate.impl, async () => {
    const before = listAtsDeliveries(500).length;
    // Fire-and-forget exactly as screen-wave.ts does, with NO await between them.
    const inFlight = ids.map((id) => dispatchAtsEvent("candidate.hired", id));
    // THE SYNCHRONOUS PREFIX. `dispatchAtsEvent` opens its ledger row before its first
    // await, so all 20 rows exist right here — before a single slot has been taken, let
    // alone freed. A cap that queued BEFORE the row would hide 16 pending deliveries from
    // GET /api/ats/deliveries for the length of the wave.
    const rows = listAtsDeliveries(500);
    assert.equal(rows.length, before + 20, "all 20 ledger rows are open synchronously, while 16 are still queued");
    assert.equal(
      ids.every((id) => rows.find((r) => r.entryId === id)?.status === "pending"),
      true,
      "each one is `pending` — a queued delivery is visible work, not a lost one"
    );

    await waitFor(() => gate.inFlight() >= cap, `${cap} POSTs in flight`);
    await drainMicrotasks();
    assert.equal(gate.peak(), cap, `at most ${cap} POSTs are in flight at once (uncapped this reads 20)`);
    assert.equal(gate.calls(), cap, "and only the admitted ones have reached the wire at all");
    assert.equal(atsEgressLoad().queued, 20 - cap, "the rest are queued, not dropped and not sent");

    // (2) — the cap delays; it never drops.
    gate.release();
    const settled = await Promise.allSettled(inFlight);
    assert.equal(settled.every((s) => s.status === "fulfilled"), true, "no dispatch rejected");
    assert.equal(gate.calls(), 20, "every one of the 20 eventually reached the receiver");
    for (const id of ids) {
      const row = listAtsDeliveries(500).find((r) => r.entryId === id);
      assert.equal(row?.status, "delivered", `delivery for ${id} settled as delivered`);
    }
    assert.deepEqual(
      { inFlight: atsEgressLoad().inFlight, queued: atsEgressLoad().queued },
      { inFlight: 0, queued: 0 },
      "the semaphore is empty again"
    );
  });
});

// (3) — a throwing receiver must not leak slots. One leaked slot per failed POST wedges
// the mirror permanently: with the ceiling exhausted by phantom holders, every later
// dispatch waits forever and the ledger fills with rows that never get an attempt.
test("a receiver that throws on every call releases every slot, and no dispatch rejects", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  const cap = atsEgressLoad().ceiling;
  const ids = makeEntries(cap + 2, "throw");

  const thrower = gatedFetch(async () => {
    throw new Error("socket hang up");
  });
  thrower.release(); // answer immediately — the point here is the release path, not the queue
  const settled = await withFetch(thrower.impl, () =>
    Promise.allSettled(ids.map((id) => dispatchAtsEvent("candidate.hired", id)))
  );
  assert.equal(settled.every((s) => s.status === "fulfilled"), true, "the never-throws contract holds under a throwing receiver");
  assert.equal(thrower.calls(), ids.length, "every dispatch was admitted — no slot was lost on the way");
  assert.deepEqual(
    { inFlight: atsEgressLoad().inFlight, queued: atsEgressLoad().queued },
    { inFlight: 0, queued: 0 },
    "every slot came back"
  );
  for (const id of ids) {
    const row = listAtsDeliveries(500).find((r) => r.entryId === id);
    assert.equal(row?.status, "failed", "and each failure is a visible, retryable ledger row");
  }

  // The real proof that nothing is wedged: a following dispatch still completes.
  const [after1] = makeEntries(1, "after-throw");
  const ok = gatedFetch();
  ok.release();
  await withFetch(ok.impl, () => dispatchAtsEvent("candidate.hired", after1));
  assert.equal(getAtsDelivery(listAtsDeliveries(500).find((r) => r.entryId === after1)!.id)?.status, "delivered");
});

// (4) — the knob is real. 1 is the strictly-serial setting an operator reaches for when a
// customer endpoint cannot take parallel POSTs at all.
test("KP_ATS_MAX_CONCURRENT=1 serialises the mirror", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  const previous = process.env.KP_ATS_MAX_CONCURRENT;
  process.env.KP_ATS_MAX_CONCURRENT = "1";
  try {
    assert.equal(atsEgressLoad().ceiling, 1, "the override is read live");
    const ids = makeEntries(3, "serial");
    const gate = gatedFetch();
    await withFetch(gate.impl, async () => {
      const inFlight = ids.map((id) => dispatchAtsEvent("candidate.hired", id));
      await waitFor(() => gate.inFlight() >= 1, "the first POST in flight");
      await drainMicrotasks();
      assert.equal(gate.peak(), 1, "exactly one POST at a time (uncapped this reads 3)");
      gate.release();
      await Promise.all(inFlight);
      assert.equal(gate.calls(), 3, "all three were delivered, one after another");
      assert.equal(gate.peak(), 1, "…and the peak never moved past one");
    });
  } finally {
    if (previous === undefined) delete process.env.KP_ATS_MAX_CONCURRENT;
    else process.env.KP_ATS_MAX_CONCURRENT = previous;
  }
});

// (4b) — a missing, non-numeric or non-positive value is the default, never 0 (which would
// wedge the mirror outright) and never NaN (which would uncap it).
test("an invalid KP_ATS_MAX_CONCURRENT falls back to the default, never to 0 or uncapped", () => {
  const previous = process.env.KP_ATS_MAX_CONCURRENT;
  try {
    for (const bad of ["", "0", "-3", "abc", "NaN"]) {
      process.env.KP_ATS_MAX_CONCURRENT = bad;
      assert.equal(atsEgressLoad().ceiling, ATS_DEFAULT_MAX_CONCURRENT, `"${bad}" falls back to the default`);
    }
    delete process.env.KP_ATS_MAX_CONCURRENT;
    assert.equal(atsEgressLoad().ceiling, ATS_DEFAULT_MAX_CONCURRENT, "absent falls back to the default");
    process.env.KP_ATS_MAX_CONCURRENT = "2.7";
    assert.equal(atsEgressLoad().ceiling, 2, "a fractional override floors to a whole number of slots");
  } finally {
    if (previous === undefined) delete process.env.KP_ATS_MAX_CONCURRENT;
    else process.env.KP_ATS_MAX_CONCURRENT = previous;
  }
});
