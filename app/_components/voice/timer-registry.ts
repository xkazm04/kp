// Every timer the voice call schedules, in one place that unmount can empty
// (wave 18b).
//
// VoiceInterview scheduled three kinds of delayed work and tracked exactly one
// of them: `connectTimerRef` (cleared on unmount), the ElevenLabs
// disconnect-grace fallback (`window.setTimeout` in `end()`, untracked) and the
// 100 ms poll inside `waitUntil` during finalize (untracked). The untracked two
// only failed to bite because `finalizedRef` happens to latch first — a
// correctness argument that lives in a different function from the code it
// protects, which is the shape a later edit breaks silently. A candidate who
// closes the tab mid-hang-up leaves callbacks running against a torn-down call.
//
// The registry is deliberately pure and clock-injected so the behaviour is
// testable without React, a DOM or real time.

export type TimerHandle = unknown;
export type Clock = {
  set(fn: () => void, ms: number): TimerHandle;
  clear(handle: TimerHandle): void;
};

const realClock: Clock = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export type TimerRegistry = {
  /** Schedule `fn`; it is forgotten once it fires, and never runs after `clearAll`. */
  set(fn: () => void, ms: number): void;
  /** Await `ms`, or resolve IMMEDIATELY if the registry is cleared meanwhile.
   *  Resolving (rather than hanging) matters: the finalize path awaits this, and
   *  a promise that never settles on unmount leaks the whole closure. */
  sleep(ms: number): Promise<void>;
  /** Cancel everything outstanding. Idempotent; the registry stays usable-but-inert
   *  afterwards, so a late callback path cannot resurrect a torn-down call. */
  clearAll(): void;
  /** Outstanding timers — the assertion an unmount test needs. */
  readonly pending: number;
  readonly cleared: boolean;
};

export function createTimerRegistry(clock: Clock = realClock): TimerRegistry {
  const handles = new Set<TimerHandle>();
  const wakers = new Set<() => void>();
  let cleared = false;

  const set = (fn: () => void, ms: number): void => {
    if (cleared) return;
    // The handle has to be reachable from inside its own callback (so a fired
    // timer forgets itself) — a box, because the value only exists after the call.
    const box: { handle?: TimerHandle } = {};
    box.handle = clock.set(() => {
      handles.delete(box.handle);
      fn();
    }, ms);
    handles.add(box.handle);
  };

  return {
    set,
    sleep(ms: number) {
      if (cleared) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const wake = () => {
          wakers.delete(wake);
          resolve();
        };
        wakers.add(wake);
        set(wake, ms);
      });
    },
    clearAll() {
      cleared = true;
      for (const h of handles) clock.clear(h);
      handles.clear();
      // Settle every sleeper so an awaiting caller unwinds instead of hanging.
      for (const wake of [...wakers]) wake();
      wakers.clear();
    },
    get pending() {
      return handles.size;
    },
    get cleared() {
      return cleared;
    },
  };
}
