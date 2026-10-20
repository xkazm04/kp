// The About deck's scene transport, tested without a DOM.
//
// Six diagrams loop 12.6-13.5 s each, forever, while on screen. The transport
// is the reader's say over that loop: a stop that is a VETO in the one merged
// run signal (not a fourth local boolean that the next scroll erases), step and
// scrub as "taking control" (so they stop autoplay), restart as a separate
// labelled act, and a deck-wide stop remembered per viewer.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INITIAL,
  createChapterTransport,
  createDeckTransport,
  loadDeckStop,
  onInViewChange,
  play,
  readPhase,
  readStoredDeckStop,
  runs,
  seek,
  step,
  stop,
  type TransportState,
} from "./transport.ts";

const OPEN = { inView: true, reduced: false, visible: true };
const CLOCK = { cycle: 14, stillTick: 10, reduced: false };
const auto = (tick: number): TransportState => ({ ...INITIAL, user: "auto", tick });
const stopped = (tick: number, held = true): TransportState => ({ user: "stopped", tick, held });

test("case 1: a user stop is a veto in the merged run signal", () => {
  assert.equal(runs(auto(0), OPEN), true);
  assert.equal(runs(stopped(0), OPEN), false, "stopped + every machine condition favourable -> no timer");
  assert.equal(runs(auto(0), { ...OPEN, inView: false }), false);
  assert.equal(runs(auto(0), { ...OPEN, visible: false }), false);
});

test("case 2: scrolling away and back does not re-arm a stop, and auto still rewinds", () => {
  let s = stopped(7);
  s = onInViewChange(s, false);
  s = onInViewChange(s, true);
  assert.equal(s.user, "stopped");
  assert.equal(s.tick, 7, "a held beat is never rewound by a scroll");

  let a = auto(7);
  a = onInViewChange(a, false);
  a = onInViewChange(a, true);
  assert.equal(a.user, "auto");
  assert.equal(a.tick, 0, "rewind-on-entry is kept for autoplay only");
});

test("case 3: stepping and scrubbing are taking control, and a seek clamps", () => {
  const fwd = step(auto(13), +1, CLOCK);
  assert.equal(fwd.user, "stopped");
  assert.equal(readPhase(fwd, CLOCK), 0, "forward from the last beat wraps to the first");

  const back = step(auto(0), -1, CLOCK);
  assert.equal(back.user, "stopped");
  assert.equal(readPhase(back, CLOCK), 13, "back from beat 0 is the last beat");

  const s5 = seek(auto(2), 5, CLOCK);
  assert.deepEqual([s5.user, readPhase(s5, CLOCK)], ["stopped", 5]);

  const far = seek(auto(2), 99, CLOCK);
  assert.equal(readPhase(far, CLOCK), 13, "clamped to the last beat, never wrapped to an arbitrary one");
  assert.equal(readPhase(seek(auto(2), -4, CLOCK), CLOCK), 0);
  assert.equal(readPhase(seek(auto(2), Number.NaN, CLOCK), CLOCK), 0);
});

test("case 4: play is a different act and continues from the held beat", () => {
  const p = play(stopped(5), CLOCK);
  assert.equal(p.user, "auto");
  assert.equal(readPhase(p, CLOCK), 5, "no rewind to 0 on resume");
  assert.equal(runs(p, OPEN), true);

  // Stopped without a chosen beat shows the still frame; resuming carries on from
  // what the reader was looking at, not from a stale counter behind it.
  const fromStill = play({ user: "stopped", tick: 3, held: false }, CLOCK);
  assert.equal(readPhase(fromStill, CLOCK), CLOCK.stillTick);

  // A stop at the current beat holds exactly that beat.
  assert.equal(readPhase(stop(auto(20), CLOCK), CLOCK), 20 % 14);
});

test("case 5: reduced motion pins the still frame until the reader steps deliberately", () => {
  const R = { ...CLOCK, reduced: true };
  assert.equal(readPhase(auto(4), R), R.stillTick, "no user seek -> stillTick");
  const s3 = seek(auto(4), 3, R);
  assert.equal(readPhase(s3, R), 3, "a reduced-motion reader may step beats deliberately");
  assert.equal(readPhase(step(auto(0), +1, R), R), R.stillTick + 1, "a step starts from the frame on screen");

  for (const s of [auto(0), stopped(3), stopped(3, false), play(stopped(3), R)]) {
    assert.equal(runs(s, { ...OPEN, reduced: true }), false, `no timer under reduced motion (${JSON.stringify(s)})`);
  }
});

test("case 6: the deck-wide stop is one-directional and idempotent", () => {
  const deck = createDeckTransport();
  const a = deck.chapter("a");
  const b = deck.chapter("b");
  a.bind(CLOCK);
  b.bind(CLOCK);
  a.seek(4);
  a.play();
  assert.equal(deck.anyPlaying(), true);

  deck.stopAll();
  assert.equal(a.getSnapshot().user, "stopped");
  assert.equal(b.getSnapshot().user, "stopped");
  assert.equal(deck.anyPlaying(), false);

  const before = [a.getSnapshot(), b.getSnapshot()];
  let notified = 0;
  const off = a.subscribe(() => notified++);
  deck.stopAll();
  assert.deepEqual([a.getSnapshot(), b.getSnapshot()], before, "a second stopAll changes nothing");
  assert.equal(a.getSnapshot(), before[0], "not even the snapshot identity");
  assert.equal(notified, 0, "and wakes nobody");
  off();

  // Only an explicit play restarts.
  deck.playAll();
  assert.equal(a.getSnapshot().user, "auto");
  assert.equal(b.getSnapshot().user, "auto");
  deck.stopAll();
  b.play();
  assert.deepEqual([a.getSnapshot().user, b.getSnapshot().user], ["stopped", "auto"]);
});

test("case 6b: a stop the reader stepped into keeps its beat through stopAll", () => {
  const deck = createDeckTransport();
  const a = deck.chapter("a");
  a.bind(CLOCK);
  a.seek(9);
  deck.stopAll();
  assert.equal(readPhase(a.getSnapshot(), CLOCK), 9);
  // A chapter registered after the deck was stopped joins it stopped.
  const late = deck.chapter("late");
  assert.equal(late.getSnapshot().user, "stopped");
  assert.equal(deck.chapter("a"), a, "one store per chapter id");
});

test("case 6c: the store's tick only advances in autoplay", () => {
  const c = createChapterTransport();
  c.bind(CLOCK);
  c.advance();
  c.advance();
  assert.equal(c.getSnapshot().tick, 2);
  c.stop();
  c.advance();
  assert.equal(readPhase(c.getSnapshot(), CLOCK), 2);
});

test("case 7: the per-viewer deck stop survives an empty or throwing storage", () => {
  assert.equal(readStoredDeckStop("1"), true);
  assert.equal(readStoredDeckStop(null), false);
  assert.equal(readStoredDeckStop(undefined), false);
  assert.equal(readStoredDeckStop("garbage"), false);

  assert.equal(loadDeckStop(() => "1"), true);
  assert.equal(loadDeckStop(() => null), false);
  assert.equal(
    loadDeckStop(() => {
      throw new Error("SecurityError: storage is disabled");
    }),
    false,
    "the page renders playing and never crashes",
  );

  const writes: (string | null)[] = [];
  const deck = createDeckTransport({
    write: (v) => {
      writes.push(v);
    },
  });
  deck.chapter("a");
  deck.stopAll();
  deck.playAll();
  assert.deepEqual(writes, ["1", null], "stop remembers, play forgets");

  const throwing = createDeckTransport({
    write: () => {
      throw new Error("QuotaExceededError");
    },
  });
  throwing.chapter("a");
  assert.doesNotThrow(() => throwing.stopAll(), "a throwing write never breaks the button");
  assert.equal(throwing.anyPlaying(), false);

  // Applying the remembered stop at load is not a new choice: it must not write.
  const quiet: (string | null)[] = [];
  const restored = createDeckTransport({ write: (v) => void quiet.push(v) });
  restored.chapter("a");
  restored.stopAll({ remember: false });
  assert.deepEqual(quiet, []);
  assert.equal(restored.anyPlaying(), false);
});
