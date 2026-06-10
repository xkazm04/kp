"use client";

import { useEffect, useState } from "react";

// SHELL3 — "remember where I was". Deep links exist for every entity but
// nothing recorded them, and the shell's param-clearing contract erases the
// selection on every tab switch — so picking a candidate back up after an
// interruption meant re-finding them from scratch. A capped localStorage list
// (client-only, no schema — the kp.pipelineViews precedent) records each
// entity the recruiter actually opened; the sidebar and the palette's resting
// state render it.

export type RecentItem = {
  type: "profile" | "entry" | "job" | "jd" | "analysis";
  id: string;
  label: string;
  // The deep link captured at record time — the same href the opening
  // navigation used, so a recent can never land somewhere the original
  // click couldn't.
  href: string;
  at: number;
};

const KEY = "kp.recents";
const CAP = 8;
// Same-document change signal so every mounted consumer (sidebar, palette)
// re-reads when any of them records.
const EVENT = "kp:recents-changed";

export function readRecents(): RecentItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RecentItem =>
        !!r &&
        typeof r === "object" &&
        typeof (r as RecentItem).id === "string" &&
        typeof (r as RecentItem).label === "string" &&
        typeof (r as RecentItem).href === "string"
    );
  } catch {
    return []; // corrupt / unavailable storage — start empty
  }
}

/** Record an opened entity (call from the event handler / effect that resolved
 *  it). Re-opening an item moves it to the front rather than duplicating. */
export function recordRecent(item: Omit<RecentItem, "at">): void {
  try {
    const list = readRecents().filter((r) => !(r.type === item.type && r.id === item.id));
    list.unshift({ ...item, at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, CAP)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage full / unavailable — recents are a convenience, never an error */
  }
}

export function useRecents(): RecentItem[] {
  const [recents, setRecents] = useState<RecentItem[]>([]);
  useEffect(() => {
    // localStorage is client-only, so hydrating in a mount effect is the
    // SSR-safe path (the kp.pipelineViews convention); the listener keeps every
    // consumer in sync with same-document records.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecents(readRecents());
    const onChange = () => setRecents(readRecents());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return recents;
}
