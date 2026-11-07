// /one's read lifecycle (round 5, docs/design/one-interface.md "Motion orchestration") — the
// PURE half of panels/read.ts: a module-level, last-good cache per URL that every view on
// that URL reads (stale-while-revalidate), and the fold from a cache entry to what a view
// draws. No React here, so the rules are pinned by readCache.test.ts.
//
//   - A URL that has answered keeps its last good body. A view mounting on it draws that
//     body at once (`ready`, `refreshing` while its own request runs) — never a LoadingGap.
//   - `loading` is ONLY "this URL has never answered".
//   - A refresh that fails after data keeps the data and carries `refreshFailed` (a quiet
//     inline line), never a full error swap.
//   - Requests are keyed `${url}#${epoch}#${attempt}`: views mounting together share ONE
//     request; a key that settled less than FRESH_MS ago is not asked again (a sheet push a
//     second after the list read draws the list's answer, it does not re-ask).
import type { ApiErrorPayload } from "@/app/_lib/use-error-message";

export type Read<T> =
  | { state: "loading" }
  | {
      state: "ready";
      data: T;
      /** A newer answer is on its way (the data shown is the last good one). */
      refreshing?: boolean;
      /** The newest refresh failed; the data shown is the last good one. */
      refreshFailed?: { payload: ApiErrorPayload | null };
    }
  | { state: "error"; payload: ApiErrorPayload | null };

export type Raw = { ok: boolean; body: unknown };

/** One request's outcome. `at` = when it settled (ms). */
export type Req = { status: "pending" } | { status: "ok"; at: number } | { status: "error"; at: number; payload: ApiErrorPayload | null };

/** Everything known about one URL. Immutable: every change replaces the entry, so a React
 *  external-store snapshot compares by identity. */
export type UrlEntry = {
  /** The last OK body and when it landed. */
  good: { body: unknown; at: number } | null;
  reqs: Readonly<Record<string, Req>>;
};

/** A request settled this recently is answered from the cache, not asked again. */
export const FRESH_MS = 4000;
/** Settled request records older than this are dropped on the next write. */
const KEEP_MS = 120_000;

export const asPayload = (body: unknown): ApiErrorPayload | null =>
  body != null && typeof body === "object" && typeof (body as { code?: unknown }).code === "string" ? { code: (body as { code: string }).code } : null;

export const requestKey = (url: string, epoch: number, attempt: number) => `${url}#${epoch}#${attempt}`;

/** Must a view whose request key is `key` ask the network now? */
export function needsFetch(entry: UrlEntry | undefined, key: string, now: number): boolean {
  const req = entry?.reqs[key];
  if (!req) return true;
  if (req.status === "pending") return false;
  return now - req.at >= FRESH_MS;
}

function prune(reqs: Readonly<Record<string, Req>>, now: number): Record<string, Req> {
  const out: Record<string, Req> = {};
  for (const [k, r] of Object.entries(reqs)) if (r.status === "pending" || now - r.at < KEEP_MS) out[k] = r;
  return out;
}

export function markPending(entry: UrlEntry | undefined, key: string, now: number): UrlEntry {
  return { good: entry?.good ?? null, reqs: { ...prune(entry?.reqs ?? {}, now), [key]: { status: "pending" } } };
}

/** A request answered (or threw: `raw` null). An OK answer becomes the URL's last good body. */
export function settle(entry: UrlEntry | undefined, key: string, raw: Raw | null, now: number): UrlEntry {
  const reqs = prune(entry?.reqs ?? {}, now);
  if (raw && raw.ok) return { good: { body: raw.body, at: now }, reqs: { ...reqs, [key]: { status: "ok", at: now } } };
  return { good: entry?.good ?? null, reqs: { ...reqs, [key]: { status: "error", at: now, payload: raw ? asPayload(raw.body) : null } } };
}

/** Parse once per (parser, body): the same body yields the SAME object, so a view's data
 *  keeps its identity across renders and across views (memo deps, row identity). */
const parsed = new WeakMap<object, Map<unknown, unknown>>();
export function parseOnce<T>(parse: (body: unknown) => T | null, body: unknown): T | null {
  if (body === null || typeof body !== "object") return parse(body);
  let byParser = parsed.get(body);
  if (!byParser) {
    byParser = new Map();
    parsed.set(body, byParser);
  }
  if (byParser.has(parse)) return byParser.get(parse) as T | null;
  const out = parse(body);
  byParser.set(parse, out);
  return out;
}

/** What a view on `key` draws. */
export function foldRead<T>(entry: UrlEntry | undefined, key: string | null, parse: (body: unknown) => T | null): Read<T> {
  if (!key) return { state: "loading" };
  const req = entry?.reqs[key];
  const good = entry?.good ?? null;
  if (good) {
    const data = parseOnce(parse, good.body);
    // A body the parser does not recognise is an error, never "nothing here".
    if (data === null) return { state: "error", payload: null };
    const refreshing = !req || req.status === "pending";
    // A failure older than the good body (another view's request landed since) is history.
    const failed = req && req.status === "error" && req.at >= good.at ? { payload: req.payload } : undefined;
    return failed ? { state: "ready", data, refreshing: false, refreshFailed: failed } : { state: "ready", data, refreshing };
  }
  if (req && req.status === "error") return { state: "error", payload: req.payload };
  return { state: "loading" };
}

/** The module-level store every /one view shares (one per page; One is mounted once). */
export function createReadStore(fetchRaw: (url: string) => Promise<Raw>, clock: () => number = Date.now) {
  const entries = new Map<string, UrlEntry>();
  const listeners = new Map<string, Set<() => void>>();
  const inflight = new Map<string, Promise<void>>();
  const emit = (url: string) => listeners.get(url)?.forEach((l) => l());
  const put = (url: string, e: UrlEntry) => {
    entries.set(url, e);
    emit(url);
  };
  return {
    get: (url: string): UrlEntry | undefined => entries.get(url),
    subscribe(url: string, l: () => void): () => void {
      let set = listeners.get(url);
      if (!set) {
        set = new Set();
        listeners.set(url, set);
      }
      set.add(l);
      return () => {
        set.delete(l);
      };
    },
    /** Ask for `key` unless it is pending or freshly settled. */
    request(url: string, key: string): Promise<void> {
      const hit = inflight.get(key);
      if (hit) return hit;
      if (!needsFetch(entries.get(url), key, clock())) return Promise.resolve();
      put(url, markPending(entries.get(url), key, clock()));
      const p = fetchRaw(url)
        .then(
          (raw) => put(url, settle(entries.get(url), key, raw, clock())),
          () => put(url, settle(entries.get(url), key, null, clock()))
        )
        .finally(() => {
          inflight.delete(key);
        });
      inflight.set(key, p);
      return p;
    },
  };
}
