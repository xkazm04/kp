"use client";

import { useCallback, useEffect, useState } from "react";
import type { JdDetail, JdRow } from "./jd-library";

// Shared JD-list fetch for the two-level surface: same abort-on-unmount +
// deferred-kickoff contract the original LibraryTab used, extracted so all three
// styling variants read one list and one reload path.
export function useJdLibrary() {
  const [rows, setRows] = useState<JdRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `silent` fetches WITHOUT blanking rows to the skeleton — for the analyzing-JD
  // poll, which must update rows in place rather than flicker the whole table every
  // few seconds. The initial load and user-triggered reloads blank as before.
  const load = useCallback(async (signal?: AbortSignal, opts?: { silent?: boolean }) => {
    setError(null);
    if (!opts?.silent) setRows(null);
    try {
      const res = await fetch("/api/jds", { signal });
      if (!res.ok) throw new Error(`Couldn't load your library (status ${res.status}).`);
      const payload = await res.json();
      if (signal?.aborted) return;
      setRows((payload.jds as JdRow[]) ?? []);
    } catch (caught) {
      if (signal?.aborted || (caught instanceof DOMException && caught.name === "AbortError")) return;
      setError(caught instanceof Error ? caught.message : "Couldn't load your library.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  // In-place refresh (no skeleton flash) — used by the analyzing-JD poll.
  const refresh = useCallback(() => {
    void load(undefined, { silent: true });
  }, [load]);

  return { rows, error, reload, refresh };
}

// Detail fetch behind the modal: keyed on the open slug. The modal only mounts
// with a real slug, so status initializes to "loading" (never a flash of the
// error/empty branch). The reset + fetch run inside a deferred 0 ms callback —
// the same kickoff the list loader uses — so no setState fires synchronously in
// the effect body (react-hooks/set-state-in-effect).
export function useJdDetail(slug: string | null) {
  const [jd, setJd] = useState<JdDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Shared fetch. `silent` refreshes in place (no skeleton flash) — the analyzing
  // detail polls this until the build finishes.
  const fetchDetail = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!slug) return;
      if (!opts?.silent) {
        setStatus("loading");
        setJd(null);
      }
      fetch(`/api/jds/${encodeURIComponent(slug)}`)
        .then((r) => {
          if (!r.ok) throw new Error();
          return r.json();
        })
        .then((data) => {
          setJd(data as JdDetail);
          setStatus("ready");
        })
        .catch(() => setStatus("error"));
    },
    [slug]
  );

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    // Deferred kickoff (no synchronous setState in the effect body).
    const timer = window.setTimeout(() => {
      if (!cancelled) fetchDetail();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slug, fetchDetail]);

  const refresh = useCallback(() => fetchDetail({ silent: true }), [fetchDetail]);

  return { jd, status, refresh };
}

export type ActionState = "idle" | "busy" | "error";

// Turn a pasted JD into a matchable role via the hardened ingest bridge. Reports
// the (possibly pre-existing) job id up so the success band can deep-link to it.
export function useIngestJob(slug: string, onDone: (jobId: string | null) => void) {
  const [state, setState] = useState<ActionState>("idle");
  const run = useCallback(async () => {
    setState((s) => (s === "busy" ? s : "busy"));
    try {
      const r = await fetch(`/api/jds/${encodeURIComponent(slug)}/ingest-job`, { method: "POST" });
      if (!r.ok) throw new Error();
      const payload = (await r.json().catch(() => null)) as { jobId?: string } | null;
      setState("idle");
      onDone(typeof payload?.jobId === "string" ? payload.jobId : null);
    } catch {
      setState("error");
    }
  }, [slug, onDone]);
  return { state, run };
}
