// The two pure seams the voice portal's honesty rests on (wave 18b).
//
// 1. `voiceStartGate` — a failed availability probe used to be stored as `null`,
//    the same value as "not asked yet", and the render treated `null` as
//    AVAILABLE. So a keyless or unreachable server rendered a normal Start that
//    died at connect, and the `unavailableCandidate` copy written for that exact
//    moment was unreachable code. Three probe outcomes, three answers.
//
// 2. `createTimerRegistry` — the ElevenLabs disconnect-grace fallback and the
//    finalize poll were both untracked `setTimeout`s that outlived unmount; only
//    the connect timeout was cleared. They were harmless solely because
//    `finalizedRef` latches first, in another function.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canPickProvider,
  canStart,
  probeAvailability,
  providerPickerGate,
  voiceStartGate,
  type AvailabilityProbe,
} from "./availability-gate.ts";
import { createTimerRegistry, type Clock } from "./timer-registry.ts";

const configured = { elevenlabs: true, openai: true };
const keyless = { elevenlabs: false, openai: false };

test("a failed probe is UNKNOWN, never available — the bug this seam exists for", () => {
  const failed: AvailabilityProbe = { status: "failed" };
  assert.equal(voiceStartGate(failed, "elevenlabs"), "unknown");
  assert.equal(canStart("unknown"), false, "a plain Start must never render on an unchecked provider");
  assert.equal(probeAvailability(failed), null, "the picker must not be handed a fabricated map");
});

test("the other three states keep their existing meanings", () => {
  assert.equal(voiceStartGate({ status: "loading" }, "elevenlabs"), "checking");
  assert.equal(canStart("checking"), true, "Start stays live while the fast probe is in flight");
  assert.equal(voiceStartGate({ status: "ok", availability: configured }, "elevenlabs"), "available");
  assert.equal(voiceStartGate({ status: "ok", availability: keyless }, "elevenlabs"), "unavailable");
  assert.equal(canStart("unavailable"), false);
});

test("availability is per PROVIDER, not per server", () => {
  const probe: AvailabilityProbe = { status: "ok", availability: { elevenlabs: false, openai: true } };
  assert.equal(voiceStartGate(probe, "elevenlabs"), "unavailable");
  assert.equal(voiceStartGate(probe, "openai"), "available");
});

// ---- timer registry --------------------------------------------------------

function fakeClock() {
  const queued = new Map<number, () => void>();
  let next = 1;
  const clock: Clock = {
    set(fn) {
      const id = next++;
      queued.set(id, fn);
      return id;
    },
    clear(h) {
      queued.delete(h as number);
    },
  };
  // Firing DRAINS the queue, like a real clock: a timeout fires once.
  const run = () => {
    const due = [...queued.values()];
    queued.clear();
    due.forEach((fn) => fn());
  };
  return { clock, queued, run };
}

test("clearAll cancels EVERY outstanding timer, not just the one that was tracked", () => {
  const { clock, queued } = fakeClock();
  const timers = createTimerRegistry(clock);
  let fired = 0;
  timers.set(() => (fired += 1), 30_000); // the connect timeout
  timers.set(() => (fired += 1), 1_500); // the EL disconnect-grace fallback
  assert.equal(timers.pending, 2);

  timers.clearAll(); // unmount

  assert.equal(timers.pending, 0);
  assert.equal(queued.size, 0, "both handles must reach the clock's clear()");
  assert.equal(fired, 0);
});

test("a fired timer forgets itself, and nothing schedules after clearAll", () => {
  const { clock, run } = fakeClock();
  const timers = createTimerRegistry(clock);
  let fired = 0;
  timers.set(() => (fired += 1), 10);
  run();
  assert.equal(fired, 1);
  assert.equal(timers.pending, 0, "a fired timer must not stay pending forever");

  timers.clearAll();
  timers.set(() => (fired += 1), 10);
  run();
  assert.equal(fired, 1, "a torn-down call must not be resurrected by a late schedule");
  assert.equal(timers.cleared, true);
});

test("sleep resolves on clearAll instead of hanging the finalize path", async () => {
  const { clock } = fakeClock();
  const timers = createTimerRegistry(clock);
  let settled = false;
  const waited = timers.sleep(100).then(() => {
    settled = true;
  });
  assert.equal(settled, false);
  timers.clearAll();
  await waited;
  assert.equal(settled, true);
  await timers.sleep(100); // already cleared — resolves immediately
});

// ---- provider picker (wave 20) ---------------------------------------------
// The picker was left on the pre-18b rule (`availability ? !availability[p] : false`),
// so a FAILED probe rendered every provider selectable — the same "we could not
// find out, so assume yes" lie the Start button was fixed for, one control over.

test("a failed probe never enables a provider in the picker", () => {
  const failed: AvailabilityProbe = { status: "failed" };
  assert.equal(canPickProvider(failed, "elevenlabs"), false);
  assert.equal(canPickProvider(failed, "openai"), false);
  assert.equal(providerPickerGate(failed, "openai"), "unknown", "the picker must show the check-again line");
});

test("the picker gates on exactly the same fact as Start", () => {
  const probes: AvailabilityProbe[] = [
    { status: "loading" },
    { status: "failed" },
    { status: "ok", availability: configured },
    { status: "ok", availability: keyless },
    { status: "ok", availability: { elevenlabs: false, openai: true } },
  ];
  for (const probe of probes) {
    for (const p of ["elevenlabs", "openai"] as const) {
      assert.equal(
        canPickProvider(probe, p),
        canStart(voiceStartGate(probe, p)),
        `picker and Start disagreed for ${probe.status}/${p}`
      );
    }
  }
});

test("an unconfigured provider stays pickable-refused, a configured one pickable", () => {
  const probe: AvailabilityProbe = { status: "ok", availability: { elevenlabs: false, openai: true } };
  assert.equal(canPickProvider(probe, "elevenlabs"), false);
  assert.equal(canPickProvider(probe, "openai"), true);
  assert.equal(canPickProvider({ status: "loading" }, "elevenlabs"), true, "the fast probe must not block the picker");
});
