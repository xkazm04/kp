"use client";

import { useEffect, useState } from "react";

// SHELL3 — "remember where I was". Deep links exist for every entity but
// nothing recorded them, and the shell's param-clearing contract erases the
// selection on every tab switch — so picking a candidate back up after an
// interruption meant re-finding them from scratch. A capped localStorage list
// (client-only, no schema — the kp.pipelineViews precedent) records each
// entity the recruiter actually opened; the sidebar and the palette's resting
// state render it.
//
// TENANCY (KP_MULTI_WORKSPACE): the list is keyed PER WORKSPACE, because a
// workspace IS a team. It used to live under one bare `kp.recents` for the whole
// browser, and localStorage is scoped to the ORIGIN, not to the session — so
// after switching teams in Settings -> Workspaces the sidebar's Recent group and
// the command palette's resting state still listed the PREVIOUS team's candidate
// and JD names. Following one 404'd, but by then a recruiter had already read
// the name of someone they are no longer allowed to see. The tenant is now part
// of the key, and nothing is read until we know which tenant we are in.

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

const KEY_PREFIX = "kp.recents:";
// The pre-tenancy key. Whatever it holds was recorded by whichever team that
// browser was last signed into, and nothing in it says which — so it is dropped
// once the tenant is known rather than adopted into the current team, which
// would be the very leak this scoping closes.
const LEGACY_KEY = "kp.recents";
// Five: the palette's resting state leads with these, and more than a handful
// stops being "where was I" and starts being a second list to scan.
const CAP = 5;
// Same-document change signal so every mounted consumer (sidebar, palette)
// re-reads when any of them records — and when the tenant finally resolves.
const EVENT = "kp:recents-changed";

/** Storage key for one workspace's list. Exported so a caller that already knows
 *  the tenant can derive it instead of re-typing the shape. */
export function recentsStorageKey(workspaceId: string): string {
  return KEY_PREFIX + workspaceId;
}

// The tenant this document belongs to, once known; `null` = not resolved yet.
// This is client code: there is no currentWorkspace() here, and the session
// cookie that carries the workspace is httpOnly, so the one door the browser has
// is GET /api/workspaces, whose payload exposes `current` (the same field the
// Workspaces console reads through useWorkspaceAdmin). Resolved ONCE per
// document and shared by every consumer — and it cannot go stale mid-session,
// because switching teams does a full reload (WorkspaceTab.switchTo).
let workspaceId: string | null = null;
let resolving: Promise<void> | null = null;
// Records made before the tenant was known. A server-rendered detail page
// records on MOUNT (the RecordRecent island on /jds/<slug>, /history/<slug>) —
// the same tick the resolve starts — so without this queue, opening a JD by deep
// link would never be remembered on any deployment.
let pending: RecentItem[] = [];

/** Seed the tenant synchronously when the caller already knows it (a shell that
 *  resolved `currentWorkspace()` server-side can hand it down): skips the fetch,
 *  and makes even the first record of the document correctly scoped. */
export function primeRecentsWorkspace(id: string): void {
  if (!id || workspaceId === id) return;
  workspaceId = id;
  resolving = Promise.resolve();
  onWorkspaceResolved();
}

function ensureWorkspace(): void {
  if (workspaceId || resolving) return;
  resolving = fetch("/api/workspaces")
    .then((r) => (r.ok ? (r.json() as Promise<{ current?: unknown }>) : null))
    .then((body) => {
      const current = body && typeof body.current === "string" ? body.current : "";
      if (!current) throw new Error("no current workspace in /api/workspaces");
      workspaceId = current;
      try {
        localStorage.removeItem(LEGACY_KEY); // one-time cleanup — see LEGACY_KEY
      } catch {
        /* storage unavailable — nothing to clean up either */
      }
      onWorkspaceResolved();
    })
    .catch(() => {
      // Tenant unknown (offline blip, or a caller without `read`) = NO recents,
      // rather than a browser-wide list that survives a team switch. Clearing
      // `resolving` lets the next mount or record retry, so one failed request
      // doesn't disable the feature for the whole session.
      pending = [];
      resolving = null;
    });
}

function onWorkspaceResolved(): void {
  const queued = pending;
  pending = [];
  for (const entry of queued) write(entry); // oldest first — write() unshifts
  // Consumers that mounted before the tenant was known are holding an empty
  // list; the same signal a record uses tells them to re-read.
  // (`prime` may be called from a client component's SSR pass, where there is no
  // window — the guard keeps that from throwing on the server.)
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

function readList(key: string): RecentItem[] {
  try {
    const raw = localStorage.getItem(key);
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
    ).slice(0, CAP); // a list stored under an older, larger cap is trimmed on read
  } catch {
    return []; // corrupt / unavailable storage — start empty
  }
}

export function readRecents(): RecentItem[] {
  // Kicks off the tenant resolve on the first read of the document; until it
  // lands we render NOTHING, because a list we cannot attribute to a team is
  // exactly what leaked. The EVENT fired on resolve turns this into the real
  // list a tick later.
  ensureWorkspace();
  if (!workspaceId) return [];
  return readList(recentsStorageKey(workspaceId));
}

/** Record an opened entity (call from the event handler / effect that resolved
 *  it). Re-opening an item moves it to the front rather than duplicating. */
export function recordRecent(item: Omit<RecentItem, "at">): void {
  // Stamped now, not at flush time: the recruiter opened it now.
  const entry: RecentItem = { ...item, at: Date.now() };
  ensureWorkspace();
  if (!workspaceId) {
    // Hold it until we know whose list it belongs to — writing it "somewhere"
    // would be a write onto the wrong team. Capped like the list itself.
    pending.push(entry);
    if (pending.length > CAP) pending = pending.slice(-CAP);
    return;
  }
  write(entry);
}

function write(entry: RecentItem): void {
  if (!workspaceId) return;
  try {
    const key = recentsStorageKey(workspaceId);
    const list = readList(key).filter((r) => !(r.type === entry.type && r.id === entry.id));
    list.unshift(entry);
    localStorage.setItem(key, JSON.stringify(list.slice(0, CAP)));
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
    // consumer in sync with same-document records AND with the tenant resolve,
    // which is what turns the initially-empty list into this team's list.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecents(readRecents());
    const onChange = () => setRecents(readRecents());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return recents;
}
