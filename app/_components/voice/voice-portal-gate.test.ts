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
import { readFileSync } from "node:fs";
import { armConnectTimeout, createTimerRegistry, type Clock } from "./timer-registry.ts";

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

// The defect this pins: VoiceInterview retired its connect timeout with clearAll(),
// the unmount teardown — so the 30 s connect timeout was never armed (start()
// "cleared" right before arming it), the ElevenLabs end fallback never fired, and the
// finalize poll's sleep() resolved instantly, spinning a 3 s busy-loop that starved
// the data channel carrying the candidate's closing answer. Retiring ONE timer must
// leave the call's other timers — and the registry — fully working.
test("cancelling one timer leaves the registry usable for the call's other timers", async () => {
  const { clock, queued, run } = fakeClock();
  const timers = createTimerRegistry(clock);
  let connectTimeout = 0;
  let endFallback = 0;

  const cancelConnect = timers.set(() => (connectTimeout += 1), 30_000);
  cancelConnect(); // the call went live
  assert.equal(queued.size, 0, "the cancelled handle must reach the clock's clear()");
  assert.equal(timers.cleared, false, "cancelling one timer is not a teardown");

  timers.set(() => (endFallback += 1), 3_000); // End pressed on ElevenLabs
  assert.equal(timers.pending, 1, "a timer scheduled after a cancel must be armed");
  run();
  assert.equal(connectTimeout, 0);
  assert.equal(endFallback, 1);

  // The finalize poll must actually WAIT — a sleep that resolves before its tick
  // is the busy-loop.
  let slept = false;
  const waited = timers.sleep(100).then(() => {
    slept = true;
  });
  await Promise.resolve();
  assert.equal(slept, false, "sleep must not resolve before its timer fires");
  run();
  await waited;
  assert.equal(slept, true);
});

test("a timer's cancel is idempotent and harmless after it fired or after clearAll", () => {
  const { clock, run } = fakeClock();
  const timers = createTimerRegistry(clock);
  let fired = 0;
  const cancel = timers.set(() => (fired += 1), 10);
  run();
  cancel();
  cancel();
  assert.equal(fired, 1);
  const late = timers.set(() => (fired += 1), 10);
  timers.clearAll();
  late();
  assert.equal(timers.pending, 0);
  const afterTeardown = timers.set(() => (fired += 1), 10);
  afterTeardown();
  run();
  assert.equal(fired, 1);
});

// ---- connect timeout across attempts (idea 046efe21) -----------------------
// The connect path cleared the prior attempt's timeout with clearAll() and armed
// the new one straight after. clearAll LATCHES the registry, so the arm was a
// no-op: the 30s timeout never fired — on the first attempt, not only a retry —
// and every later timer in the call (the finalize poll, the EL disconnect-grace
// fallback) was dead with it.

test("the connect timeout fires on EVERY attempt, not just until the first clear", () => {
  const { clock, run } = fakeClock();
  const timers = createTimerRegistry(clock);
  let timedOut = 0;

  armConnectTimeout(timers, () => (timedOut += 1), 30_000); // attempt 1 hangs
  run();
  assert.equal(timedOut, 1, "the first attempt's timeout must fire");

  armConnectTimeout(timers, () => (timedOut += 1), 30_000); // Retry, hangs again
  run();
  assert.equal(timedOut, 2, "the retry's timeout must fire too");
  assert.equal(timers.cleared, false, "arming between attempts must never latch the registry");
});

test("re-arming cancels the prior attempt's timeout instead of stacking it", () => {
  const { clock, queued, run } = fakeClock();
  const timers = createTimerRegistry(clock);
  let first = 0;
  let second = 0;
  armConnectTimeout(timers, () => (first += 1), 30_000);
  armConnectTimeout(timers, () => (second += 1), 30_000);
  assert.equal(queued.size, 1);
  run();
  assert.deepEqual([first, second], [0, 1]);
});

test("cancelAll keeps other timers schedulable; clearAll after it still silences everything", async () => {
  const { clock, queued, run } = fakeClock();
  const timers = createTimerRegistry(clock);
  let fired = 0;
  armConnectTimeout(timers, () => (fired += 1), 30_000);
  timers.cancelAll(); // went live
  timers.set(() => (fired += 1), 1_500); // the EL disconnect-grace fallback, scheduled later
  run();
  assert.equal(fired, 1, "a timer scheduled after cancelAll must still run");

  armConnectTimeout(timers, () => (fired += 1), 30_000);
  timers.clearAll(); // unmount
  armConnectTimeout(timers, () => (fired += 1), 30_000); // a late path after teardown
  assert.equal(queued.size, 0);
  run();
  assert.equal(fired, 1, "nothing may fire after teardown");
  await timers.sleep(100); // cleared — resolves immediately, never hangs
});

test("VoiceInterview latches its registry only in the unmount teardown", () => {
  const src = readFileSync(new URL("./VoiceInterview.tsx", import.meta.url), "utf8");
  const latches = src.match(/^\s*timers(?:Ref\.current)?\.clearAll\(\);/gm) ?? [];
  assert.equal(latches.length, 1, "clearAll() is teardown-only; comments are not calls");
  assert.match(src, /timers\.clearAll\(\)/, "the one clearAll is the unmount effect's copied registry");
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

// ---- spoken-language seed (spark ai-interview-parity P0) ------------------------
// The portal used to seed `locale === "cs" ? "cs" : "en"`, pinning English into the
// ElevenLabs agent language and the OpenAI transcription language for every German
// and French applicant — the two transport settings that outrank the brief's
// "open in their language" line.
test("the portal's spoken-language hint follows every shipped locale", async () => {
  const { portalLanguageHint } = await import("./ui-types.ts");
  assert.equal(portalLanguageHint("cs"), "cs");
  assert.equal(portalLanguageHint("en"), "en");
  assert.equal(portalLanguageHint("de"), "de");
  assert.equal(portalLanguageHint("fr"), "fr");
  assert.equal(portalLanguageHint("pl"), "auto", "an unshipped locale is detection, never a wrong pin");
  assert.equal(portalLanguageHint("cs-CZ"), "auto");
});
