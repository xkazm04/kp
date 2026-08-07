"use client";

// Coalesce CONCURRENT identical GETs into one request.
//
// Independent hooks on the same tab legitimately want the same list — the Schedule
// tab's grid (useScheduleTab) and its invite-lifecycle panel
// (useScheduleInviteLifecycle) both need `/api/schedule`, and both fetch it on
// mount, so a single tab open fired the same request 2–4 times (visible in the dev
// log as a run of identical `GET /api/schedule` lines). Passing the data down
// instead is the better fix where one component owns the other; these two are
// siblings behind a dynamic import, so a shared in-flight promise is the honest
// seam.
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
