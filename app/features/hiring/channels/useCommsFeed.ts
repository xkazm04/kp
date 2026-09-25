"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveRefresh } from "@/app/features/shell/live-refresh";
import { EMPTY_COMMS_PAGE, mergeCommsPage, type CommsPageState } from "./channelsCommsPaging";

/** Rows per read. The ledger pages CLIENT-side inside what it has loaded, and asks
 *  the route for one cursor page at a time: `?limit=500` (the whole derivation window)
 *  made `hasMore` structurally unreachable, so the "older rows exist" fact the route
 *  answers had no way to be true and the ledger could only ever end silently. */
const COMMS_PAGE_SIZE = 200;

/**
 * The communications ledger's feed: GET /api/comms, one cursor page at a time, folded by
 * the pure reducer in channelsCommsPaging.ts. Lifted out of CommsTable unchanged so the
 * composition-kit view (behind the dev-only Gate K2 switch) reads the SAME feed instead
 * of a copy of it.
 *
 * `feed.messages` is null until the first read settles. `error` is a failed read, never
 * an empty ledger. `relayConfigured` seeds true, so a fetch in flight never accuses a
 * configured relay of dropping mail.
 */
export function useCommsFeed() {
  // One state, folded by a pure reducer (channelsCommsPaging.ts): the rows, the refs
  // and the two SEPARATE facts about size — `hasMore` (more rows a cursor reaches) and
  // `truncated` (older rows past the derivation window that no cursor reaches).
  const [feed, setFeed] = useState<CommsPageState>(EMPTY_COMMS_PAGE);
  const [error, setError] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [relayConfigured, setRelayConfigured] = useState(true);

  // One read of the feed. `cursor` null = the head of the ledger (first load and every
  // live refresh, both of which re-read the newest page); a cursor = the next older
  // page, folded onto what is already on screen.
  const read = useCallback((cursor: string | null, signal?: AbortSignal) => {
    const qs = new URLSearchParams({ limit: String(COMMS_PAGE_SIZE) });
    if (cursor) qs.set("cursor", cursor);
    return fetch(`/api/comms?${qs.toString()}`, { signal }).then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    });
  }, []);

  const load = useCallback(
    (signal?: AbortSignal) => {
      read(null, signal)
        .then((p) => {
          setRelayConfigured(p.relayConfigured !== false);
          // A body with no `messages` array is a FAILURE, not an empty ledger — the
          // reducer refuses to conjure one (channelsCommsPaging.ts). A head read
          // carries no state forward, so it folds onto EMPTY.
          const next = mergeCommsPage(EMPTY_COMMS_PAGE, p, "replace");
          setError(next === null);
          if (next) setFeed(next);
        })
        .catch(() => {
          // An abort is this component unmounting, not a load failure: raising the
          // error banner for it would paint a red ledger on the way out.
          if (!signal?.aborted) setError(true);
        });
    },
    [read]
  );
  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);
  useLiveRefresh(load);

  const loadOlder = useCallback(() => {
    if (loadingOlder || !feed.cursor) return;
    setLoadingOlder(true);
    read(feed.cursor)
      .then((p) => {
        setFeed((prev) => mergeCommsPage(prev, p, "append") ?? prev);
      })
      .catch(() => setError(true))
      .finally(() => setLoadingOlder(false));
  }, [read, feed.cursor, loadingOlder]);

  return { feed, error, relayConfigured, loadingOlder, load, loadOlder };
}
