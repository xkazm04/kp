"use client";

// Coalesce CONCURRENT identical GETs into one request.
//
// Independent hooks legitimately want the same payload at the same moment — the
// shell's attention badges (useAttention) and the Channels tab (useChannelsData) both
// read `/api/attention`, and neither renders the other, so an open Channels tab would
// otherwise fire the same request twice. Coalescing is the seam for SIBLINGS like
// those, where no component owns the other.
// Where one does, pass the data down instead: the Schedule tab's invite-lifecycle
// panel used to be this file's example, fetching `/api/schedule` beside its own
// parent, and now takes the agenda from its owner as props
// (useScheduleTab -> scheduleAgenda.ts), one read per mount by construction.
//
// ONLY in-flight requests are shared. Nothing is cached: once a request settles it
// leaves the map, so the next call goes to the network. That is deliberate — a
// cache here would need invalidation on every mutation, and a stale agenda is
// worse than a duplicate request.
//
// `refresh: true` always starts a NEW request. Use it after a mutation: attaching
// to a request that started BEFORE the write would return pre-write data.

const inflight = new Map<string, Promise<unknown>>();

export function sharedGetJson<T>(url: string, opts?: { refresh?: boolean }): Promise<T> {
  if (!opts?.refresh) {
    const existing = inflight.get(url);
    if (existing) return existing as Promise<T>;
  }
  const p: Promise<unknown> = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    // Only clear the slot if it is still OURS — a `refresh` call replaces the entry,
    // and the older request settling must not delete the newer one's promise.
    .finally(() => {
      if (inflight.get(url) === p) inflight.delete(url);
    });
  inflight.set(url, p);
  return p as Promise<T>;
}
