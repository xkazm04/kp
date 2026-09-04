"use client";

import { useEffect, useRef } from "react";

// Tiny client-side event bus so open views update live when data changes
// elsewhere — e.g., the simulation driver mutating the pipeline. Mutators call
// notifyDataChanged(); views subscribe with useLiveRefresh(reload).
//
// SHELL6 — the bus spans BROWSER WINDOWS too: notifyDataChanged mirrors onto a
// BroadcastChannel (board on one monitor, decisions on another — the natural
// kanban setup), so a mutation in one window refreshes views in the others.
// Feature-detected; zero call-site changes — every existing caller inherits it.

const EVENT = "kp:data-changed";
const CHANNEL = "kp:data-changed";

// One shared channel per document (a channel can't receive its own posts, so
// the same instance must both send and listen — per-call instances would leak
// and the sender's own document is already covered by the window event).
let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL);
  return channel;
}

/** Signal that server-side data may have changed (call after a mutating fetch). */
export function notifyDataChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
  try {
    getChannel()?.postMessage("changed");
  } catch {
    /* channel closed mid-teardown — same-document listeners already fired */
  }
}

/**
 * Re-run `handler` whenever data changes elsewhere — in this document (window
 * event) or in another window of the app (BroadcastChannel). Always calls the
 * latest handler (no re-subscribe churn) and debounces bursts into one reload;
 * the originating window's double signal (event + channel echo is impossible —
 * a channel never receives its own posts) coalesces under the same debounce.
 */
export const LIVE_REFRESH_DEBOUNCE_MS = 250;

/**
 * The debounce, as a DOM-free object so node --test can pin it: `signal()` arms a
 * single trailing run, further signals inside the window collapse into it, and
 * `cancel()` drops a pending one. `run` is read at FIRE time, so a caller that
 * re-points it (the hook's latest-handler ref) never needs to re-subscribe.
 *
 * This is the coalescing that keeps a simulation step — or the one mutation a
 * multi-window setup announces twice, once as a window event and once over the
 * BroadcastChannel — from re-fetching every open view per signal. It had no test.
 */
export function createRefreshCoalescer(
  run: () => void,
  debounceMs: number = LIVE_REFRESH_DEBOUNCE_MS
): { signal: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    signal: () => {
      clearTimeout(timer);
      timer = setTimeout(() => run(), debounceMs);
    },
    cancel: () => clearTimeout(timer),
  };
}

export function useLiveRefresh(handler: () => void, debounceMs = LIVE_REFRESH_DEBOUNCE_MS): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler; // keep the latest handler without re-subscribing
  });
  useEffect(() => {
    const coalescer = createRefreshCoalescer(() => ref.current(), debounceMs);
    const onChange = () => coalescer.signal();
    window.addEventListener(EVENT, onChange);
    const bc = getChannel();
    bc?.addEventListener("message", onChange);
    return () => {
      coalescer.cancel();
      window.removeEventListener(EVENT, onChange);
      bc?.removeEventListener("message", onChange);
    };
  }, [debounceMs]);
}
