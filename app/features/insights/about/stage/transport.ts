/*
 * The About deck's scene transport: the reader's say over a loop that starts on
 * its own.
 *
 * Every scene loops 12.6-13.5 s, forever, while on screen. Before this module
 * the only inputs to that loop were machine conditions (in view, OS reduced
 * motion, tab visible), so a reader who wanted to study one beat had 900 ms to
 * do it, and a screen-reader user heard the status line change every beat with
 * no way to hold it.
 *
 * The lifecycle, and why each rule is the shape it is:
 *
 *   - The USER stop is a named veto in the one merged run signal (`runs`), not
 *     a fourth local boolean. The machine's pauses are transient and undo
 *     themselves; the user's stop is only ever undone by the user.
 *   - Scrolling back re-arms only what was transiently paused. The clock's
 *     rewind-on-entry stays, but for autoplay only: a held beat is never
 *     rewound by a scroll (`onInViewChange`).
 *   - Stepping or scrubbing is TAKING CONTROL, so it stops autoplay. A step
 *     that kept the loop running would be overwritten 900 ms later.
 *   - Restart is a separate labelled act (`play`), never a key toggle, and it
 *     continues from the beat on screen rather than rewinding.
 *   - The deck-wide stop is one-directional and idempotent (`stopAll`). It
 *     shows every chapter's still frame, the same frame an OS reduced-motion
 *     reader gets, unless the reader already stepped a chapter to a beat of
 *     their own. It is remembered per viewer; the stored flag is a convenience,
 *     so every read and write of it tolerates a throwing or empty storage.
 *   - OS reduced motion stays the default for those readers: `runs` is false in
 *     every user state, and the phase is `stillTick` until the reader
 *     deliberately steps to another beat.
 *
 * Pure module apart from the two tiny external stores at the bottom (plain
 * listener sets, no React, no DOM), so node:test exercises all of it.
 */
import { phaseOf, shouldTick, type ClockConditions } from "./clock";

export type UserState = "auto" | "stopped";

export type TransportState = {
  /** Autoplay, or held by the reader. */
  user: UserState;
  /** Monotonic in autoplay; the held beat once the reader took control. */
  tick: number;
  /**
   * True when `tick` is a beat the reader chose (a step, a scrub, a stop at
   * the frame on screen). False means "no chosen beat": a stopped or reduced
   * scene then shows its still frame.
   */
  held: boolean;
};

/** A scene's clock shape: what `readPhase` needs to turn a state into a beat. */
export type ClockShape = { cycle: number; stillTick: number; reduced: boolean };

export const INITIAL: TransportState = { user: "auto", tick: 0, held: false };

/** Does the interval exist? The machine conditions AND the reader's veto. */
export function runs(state: TransportState, cond: Omit<ClockConditions, "stopped">): boolean {
  return shouldTick({ ...cond, stopped: state.user === "stopped" });
}

/**
 * The beat to render. A chosen beat wins over everything, including reduced
 * motion (a reduced-motion reader may step deliberately); otherwise a stopped
 * or reduced scene shows `stillTick`, and autoplay shows its running tick.
 */
export function readPhase(state: TransportState, clock: ClockShape): number {
  if (state.held) return phaseOf(state.tick, clock.cycle, { reduced: false, stillTick: clock.stillTick });
  const still = clock.reduced || state.user === "stopped";
  return phaseOf(state.tick, clock.cycle, { reduced: still, stillTick: clock.stillTick });
}

/** Viewport entry. Rewinds autoplay only; a stop survives any amount of scrolling. */
export function onInViewChange(state: TransportState, inView: boolean): TransportState {
  if (!inView || state.user !== "auto" || (state.tick === 0 && !state.held)) return state;
  return { user: "auto", tick: 0, held: false };
}

/** One interval tick. A stopped transport does not move. */
export function advance(state: TransportState): TransportState {
  return state.user === "auto" ? { ...state, tick: state.tick + 1 } : state;
}

/** Hold the frame on screen. Idempotent. */
export function stop(state: TransportState, clock: ClockShape): TransportState {
  if (state.user === "stopped") return state;
  return { user: "stopped", tick: readPhase(state, clock), held: true };
}

/** Restart autoplay from the beat on screen. Idempotent. */
export function play(state: TransportState, clock: ClockShape): TransportState {
  if (state.user === "auto") return state;
  return { user: "auto", tick: readPhase(state, clock), held: false };
}

/** Step one beat either way, wrapping. Taking control: it stops autoplay. */
export function step(state: TransportState, delta: 1 | -1, clock: ClockShape): TransportState {
  const n = clock.cycle > 0 ? clock.cycle : 1;
  const next = (((readPhase(state, clock) + delta) % n) + n) % n;
  return { user: "stopped", tick: next, held: true };
}

/** Scrub to a beat. Clamped into `[0, cycle)`, never wrapped to an arbitrary beat. */
export function seek(state: TransportState, beat: number, clock: ClockShape): TransportState {
  const last = Math.max(0, clock.cycle - 1);
  const n = Number.isFinite(beat) ? Math.min(last, Math.max(0, Math.round(beat))) : 0;
  if (state.user === "stopped" && state.held && state.tick === n) return state;
  return { user: "stopped", tick: n, held: true };
}

/**
 * The deck-wide stop applied to one chapter. Holds whatever the reader chose,
 * otherwise pins the still frame. A no-op when already stopped.
 */
export function stopForDeck(state: TransportState): TransportState {
  return state.user === "stopped" ? state : { user: "stopped", tick: state.tick, held: false };
}

// ── Per-viewer memory ──────────────────────────────────────────────────────

export const DECK_STOP_KEY = "kp.about.transport.stopped";

/** Only the exact flag this module writes counts as a stop. */
export function readStoredDeckStop(raw: string | null | undefined): boolean {
  return raw === "1";
}

/**
 * Read the remembered stop through an accessor that may throw (a private
 * window, blocked site data, a sandboxed preview). Any failure reads as "not
 * stopped": the page renders playing and never crashes.
 */
export function loadDeckStop(read: () => string | null | undefined): boolean {
  try {
    return readStoredDeckStop(read());
  } catch {
    /* best-effort: the stored stop is a per-viewer convenience, never a requirement */
    return false;
  }
}

// ── Stores ─────────────────────────────────────────────────────────────────

type Listener = () => void;

export type ChapterTransport = {
  getSnapshot: () => TransportState;
  /** The bound clock shape, or null before the scene has mounted. */
  getClock: () => ClockShape | null;
  subscribe: (fn: Listener) => () => void;
  bind: (clock: ClockShape) => void;
  advance: () => void;
  inView: (inView: boolean) => void;
  stop: () => void;
  play: () => void;
  step: (delta: 1 | -1) => void;
  seek: (beat: number) => void;
  /** Deck-wide stop for this chapter (see `stopForDeck`). */
  stopForDeck: () => void;
};

const UNBOUND: ClockShape = { cycle: 1, stillTick: 0, reduced: false };

/**
 * One chapter's transport, as an external store: the scene subscribes, the
 * chapter frame around it does not, so the frame never re-renders per tick.
 * The clock shape and the state change together, so the snapshot is ONE value
 * whose identity only changes when something the reader can see did.
 */
export function createChapterTransport(initial: TransportState = INITIAL): ChapterTransport {
  let state = initial;
  let clock: ClockShape | null = null;
  const listeners = new Set<Listener>();
  const emit = () => {
    for (const fn of listeners) fn();
  };
  const set = (next: TransportState) => {
    if (next === state) return;
    state = next;
    emit();
  };
  const shape = () => clock ?? UNBOUND;

  return {
    getSnapshot: () => state,
    getClock: () => clock,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    bind(next) {
      if (clock && clock.cycle === next.cycle && clock.stillTick === next.stillTick && clock.reduced === next.reduced) {
        return;
      }
      clock = next;
      emit();
    },
    advance: () => set(advance(state)),
    inView: (v) => set(onInViewChange(state, v)),
    stop: () => set(stop(state, shape())),
    play: () => set(play(state, shape())),
    step: (d) => set(step(state, d, shape())),
    seek: (b) => set(seek(state, b, shape())),
    stopForDeck: () => set(stopForDeck(state)),
  };
}

export type DeckTransport = {
  /** The store for one chapter id; the same store every time. */
  chapter: (id: string) => ChapterTransport;
  /** Stop every chapter. One-directional: calling it again changes nothing. */
  stopAll: (opts?: { remember?: boolean }) => void;
  /** Restart every chapter. The only deck-wide way back to autoplay. */
  playAll: () => void;
  /** True while any chapter is in autoplay: what the header button reads. */
  anyPlaying: () => boolean;
  subscribe: (fn: Listener) => () => void;
};

/**
 * The deck: one transport per chapter plus the header's stop-all. `write`
 * persists the per-viewer stop ("1" to remember, null to forget); a throwing
 * write is swallowed, because losing a convenience must never break the button.
 */
export function createDeckTransport(persist: { write?: (value: string | null) => void } = {}): DeckTransport {
  const chapters = new Map<string, ChapterTransport>();
  const listeners = new Set<Listener>();
  let deckStopped = false;
  const emit = () => {
    for (const fn of listeners) fn();
  };
  const remember = (value: string | null) => {
    try {
      persist.write?.(value);
    } catch {
      /* best-effort: the stored stop is a per-viewer convenience, never a requirement */
    }
  };

  const chapter = (id: string): ChapterTransport => {
    let c = chapters.get(id);
    if (!c) {
      c = createChapterTransport(deckStopped ? stopForDeck(INITIAL) : INITIAL);
      c.subscribe(emit);
      chapters.set(id, c);
    }
    return c;
  };

  return {
    chapter,
    stopAll(opts = {}) {
      deckStopped = true;
      for (const c of chapters.values()) c.stopForDeck();
      if (opts.remember !== false) remember("1");
    },
    playAll() {
      deckStopped = false;
      for (const c of chapters.values()) c.play();
      remember(null);
    },
    anyPlaying: () => [...chapters.values()].some((c) => c.getSnapshot().user === "auto"),
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
