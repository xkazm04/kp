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
export function useLiveRefresh(handler: () => void, debounceMs = 250): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler; // keep the latest handler without re-subscribing
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ref.current(), debounceMs);
    };
    window.addEventListener(EVENT, onChange);
    const bc = getChannel();
    bc?.addEventListener("message", onChange);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(EVENT, onChange);
      bc?.removeEventListener("message", onChange);
    };
  }, [debounceMs]);
}
