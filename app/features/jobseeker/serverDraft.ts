/*
 * Saving what the seeker is typing or picking to the server, without ever losing it.
 *
 * The designed-CV choices and the per-posting cover-note drafts live on the server now
 * (PUT /api/jobseeker/ui-state) so they follow the seeker to another browser. The page
 * keeps its own copy — in state, and in browser storage as an instant first paint — and
 * this saver carries each change over:
 *
 *   - DEBOUNCED: a burst of keystrokes is one write, after `delayMs` of quiet;
 *   - KEYED: one pending value per key (a posting id, "design"), latest wins per key,
 *     so moving to another posting never drops the previous one's unsaved note;
 *   - RETRIED: a failed write stays pending and is tried again on a backoff
 *     (`retryMs`, the last step repeating) until it lands or a newer value replaces it —
 *     the page says "not saved yet" meanwhile and the text stays where it was typed;
 *   - ORDERED: one write at a time; a value that changed while its write was in flight
 *     is written again afterwards, so the server always ends on the newest.
 *
 * Pure apart from the timers it is handed, so a test drives every branch by hand.
 */

export type SaveState = "pending" | "saving" | "saved" | "failed";

export type SaverTimers = {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

const WINDOW_TIMERS: SaverTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export type KeyedSaver<V> = {
  /** A new value for `key`: saved after the debounce, replacing any unsaved one. */
  push(key: string, value: V): void;
  /** Write everything pending now (a posting switch, a page leaving). */
  flush(): void;
  /** Whether `key` has a value the server has not confirmed yet. */
  isPending(key: string): boolean;
  /** Stop the timers. Pending values are flushed once, best-effort. */
  dispose(): void;
};

export function createKeyedSaver<V>(
  save: (key: string, value: V) => Promise<boolean>,
  onState: (key: string, state: SaveState) => void,
  opts: { delayMs?: number; retryMs?: readonly number[]; timers?: SaverTimers } = {}
): KeyedSaver<V> {
  const delayMs = opts.delayMs ?? 800;
  const retryMs = opts.retryMs && opts.retryMs.length ? opts.retryMs : [2_000, 5_000, 15_000, 30_000];
  const timers = opts.timers ?? WINDOW_TIMERS;
  const pending = new Map<string, V>();
  let timer: unknown = null;
  let running = false;
  let failures = 0;
  let disposed = false;

  const schedule = (ms: number) => {
    if (timer !== null) timers.clear(timer);
    timer = timers.set(() => {
      timer = null;
      void drain();
    }, ms);
  };

  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    let failed = false;
    try {
      while (pending.size > 0 && !failed) {
        for (const [key, value] of [...pending.entries()]) {
          onState(key, "saving");
          let ok = false;
          try {
            ok = await save(key, value);
          } catch {
            /* a thrown save is a failed save: the value stays pending and is retried */
            ok = false;
          }
          // A newer value arrived while this one was in flight: leave it pending, the
          // loop writes it next. Otherwise the answer settles this key.
          if (pending.get(key) !== value) continue;
          if (ok) {
            pending.delete(key);
            onState(key, "saved");
          } else {
            failed = true;
            onState(key, "failed");
          }
        }
      }
    } finally {
      running = false;
    }
    if (failed) {
      if (!disposed) schedule(retryMs[Math.min(failures, retryMs.length - 1)]!);
      failures += 1;
    } else {
      failures = 0;
    }
  }

  return {
    push(key, value) {
      if (disposed) return;
      pending.set(key, value);
      onState(key, "pending");
      schedule(delayMs);
    },
    flush() {
      if (timer !== null) timers.clear(timer);
      timer = null;
      void drain();
    },
    isPending(key) {
      return pending.has(key);
    },
    dispose() {
      if (timer !== null) timers.clear(timer);
      timer = null;
      disposed = true;
      if (pending.size > 0) void drain();
    },
  };
}

/** PUT a JSON body; true only on a 2xx. Never throws (a dead network is `false`). */
export async function putJson(url: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true });
    return res.ok;
  } catch {
    /* offline or the tab is going away: reported as a failed save, which is retried */
    return false;
  }
}
