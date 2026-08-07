"use client";

// The board's DATA plane: the entries/events fetch (self-sequencing load()), the
// 30s live poll, the render-diet signatures, and the one optimistic writer of the
// entries array (drag-to-move). Split out of usePipelineTabState; `setEntries` stays
// private to this module so the board array has exactly one mutator.

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveRefresh } from "@/app/features/shell/live-refresh";
import { sharedGetJson } from "@/app/features/shared/sharedGet";
import { boardSignature, eventsSignature } from "./pipelineRenderDiet";
import { postPipelineAction } from "@/app/_lib/useAddToPipeline";
import type { Entry, PipelineEvent } from "@/app/features/shared/pipelineTypes";
import { pipelineActionReason } from "./pipelineTabHelpers";
import type { PipelineTabTranslator } from "./pipelineTranslator";

export function usePipelineBoardData({
  t,
  slaOverrides,
  drawerOpen,
}: {
  t: PipelineTabTranslator;
  slaOverrides: Record<string, number>;
  /** Pauses the poll while a drawer is open — read through a ref so the interval
   *  never restarts its countdown on a drawer toggle. */
  drawerOpen: boolean;
}) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Activity-feed health is tracked separately from the board: a failed events
  // fetch must read as "couldn't load activity", never as a genuine empty feed.
  const [eventsError, setEventsError] = useState<string | null>(null);
  // Transient feedback when a drag-to-move fails (optimistic move rolled back).
  const [moveError, setMoveError] = useState<string | null>(null);

  // load() fires from many triggers (mount, live refresh, batch-done, the pass,
  // the scheduler, the drawer), so it self-sequences: each call aborts the prior
  // call's in-flight fetches, and a superseded response writes no state. That
  // kills two failure modes at once — a slow earlier response can't clobber a
  // newer board, and (because success always clears `error`) a single transient
  // fetch blip can't latch the error screen: the next good poll recovers the
  // view without a hard refresh.
  const abortRef = useRef<AbortController | null>(null);
  // Cursor into the events feed (idea-85f043ea): after the initial page, every
  // poll asks only for events strictly newer than the last id seen, so a burst
  // of automation activity can never scroll past a fixed-size window between
  // polls and vanish unseen. null = initial page not yet loaded.
  const eventsCursorRef = useRef<number | null>(null);
  // Poll-tick render diet: the content signature of the LAST board/events payload
  // we committed to state. A poll whose payload signature matches skips the state
  // set entirely — no new array identity, so bucketLaneEntries doesn't recompute
  // and no StageCell/CandidateRow reconciles. null = nothing committed yet (first
  // load always writes).
  const lastEntriesSigRef = useRef<string | null>(null);
  const lastEventsSigRef = useRef<string | null>(null);
  // The board signature folds each entry's DERIVED aging bucket, which depends on the
  // recruiter's per-board SLA overrides — read via a ref so the (stable, [t]-only)
  // load callback and its 30s poll see the current overrides without being recreated
  // on every override keystroke. Override EDITS reflect immediately via re-render
  // (isStale/staleCount recompute); the ref only keeps the poll gate consistent.
  const slaOverridesRef = useRef<Record<string, number>>({});
  useEffect(() => {
    slaOverridesRef.current = slaOverrides;
  }, [slaOverrides]);
  // Sharing is OPT-IN (`shared: true`), never the default: `load` is handed to the
  // drawer, the bulk bar and the automation pass, and every one of those calls it
  // AFTER a mutation, where attaching to a request that started before the write
  // would show pre-write data. Only the mount read opts in — it shares its
  // `/api/pipeline` request with the control dock, which mounts in the same tick and
  // reads the same board (features/shared/sharedGet.ts). The abort machinery is
  // unchanged: a shared request isn't cancellable, but it is the post-resolution
  // `signal.aborted` guard that actually stops a superseded load writing state.
  const load = useCallback((opts?: { shared?: boolean }) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    sharedGetJson<{ entries?: Entry[]; error?: string }>("/api/pipeline", { refresh: !opts?.shared })
      .then((p) => {
        if (signal.aborted) return; // a newer load superseded this one
        if (p.error) throw new Error(p.error);
        const next = (p.entries as Entry[]) ?? [];
        // Content-equality short-circuit: only reset the entries array when the
        // rendered content actually changed. setError(null) below is a no-op
        // re-render when error is already null (React bails on an identical value).
        const sig = boardSignature(next, { overrides: slaOverridesRef.current });
        if (sig !== lastEntriesSigRef.current) {
          lastEntriesSigRef.current = sig;
          setEntries(next);
        }
        setError(null); // success clears any prior transient error
      })
      .catch((e) => {
        if (signal.aborted) return; // ignore aborted/stale failures
        setError(e instanceof Error ? e.message : t("loadFailed"));
      });
    const since = eventsCursorRef.current;
    fetch(since == null ? "/api/pipeline/events" : `/api/pipeline/events?since=${since}`, { signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((p) => {
        if (signal.aborted) return;
        if (p.error) throw new Error(p.error);
        const incoming = (p.events as PipelineEvent[]) ?? [];
        if (since == null) {
          // Initial page, newest-first. Same content-equality short-circuit as the
          // board: a re-fetched identical first page doesn't reset the list. (Poll
          // ticks use the delta branch below, which only sets on genuinely new
          // events, so the feed already no-ops on a quiet poll.)
          const sig = eventsSignature(incoming);
          if (sig !== lastEventsSigRef.current) {
            lastEventsSigRef.current = sig;
            setEvents(incoming);
          }
        } else if (incoming.length > 0) {
          // Delta mode returns oldest-first — newest belongs on top. Keep a
          // bounded in-memory tail; the list renders the top 12 anyway.
          const newestFirst = [...incoming].reverse();
          setEvents((prev) => [...newestFirst, ...prev].slice(0, 100));
        }
        if (typeof p.cursor === "number") eventsCursorRef.current = p.cursor;
        setEventsError(null);
      })
      .catch(() => {
        if (signal.aborted) return;
        setEventsError(t("eventsError"));
      });
  }, [t]);
  useEffect(() => {
    load({ shared: true }); // the only trigger that may ride the dock's request
    return () => abortRef.current?.abort(); // drop in-flight fetches on unmount
  }, [load]);
  useLiveRefresh(load); // re-fetch the board live when the simulation (or any actor) changes state

  // Live board poll. The automation clock (instrumentation.ts heartbeat) mutates
  // pipeline_entries SERVER-side with no client signal — useLiveRefresh only fires on
  // same-document changes — so an open board silently went stale under automation (and the
  // SchedulerControl bar could show "ran · 3 advanced" while the lanes didn't move). Poll
  // every 30s, reusing load()'s abort+cursor machinery (one /api/pipeline + one delta
  // /api/pipeline/events?since= per tick). Paused while a drawer is open (don't yank state
  // mid-action) or the tab is hidden. Drawer state is read via a ref so the interval stays
  // stable instead of restarting its countdown on every drawer toggle.
  const drawerOpenRef = useRef(false);
  useEffect(() => {
    drawerOpenRef.current = drawerOpen;
  }, [drawerOpen]);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (drawerOpenRef.current || document.hidden) return;
      load();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  // cea12908 — drag a candidate to a new stage column. Optimistic: reflect the
  // move immediately, then POST set_stage with the card's PRIOR stage as
  // expectedStage (the same CAS guard the bulk move + AI actions use). On any
  // failure roll back; load() always reconciles the board with the server (a 409
  // means a concurrent actor moved them in the gap).
  const moveEntry = async (entry: Entry, toStage: string) => {
    if (entry.stage === toStage) return;
    const prevStage = entry.stage;
    const restage = (id: string, stage: string) =>
      setEntries((cur) => (cur ? cur.map((e) => (e.id === id ? { ...e, stage } : e)) : cur));
    restage(entry.id, toStage);
    setMoveError(null);
    try {
      const r = await postPipelineAction(entry.id, { action: "set_stage", toStage, expectedStage: prevStage });
      // On any failure roll back AND tell the recruiter the SERVER's reason — the
      // 409 "changed since you opened it" (a concurrent actor moved them) vs the
      // 422 "route through Offer → extend an offer" guidance, distinguished and
      // verbatim, exactly like the drawer's moveStage. The blanket moveFailed hid
      // the one sentence telling the recruiter what to do instead. A body with no
      // reason (a network-level failure) falls back to the generic copy.
      if (!r.ok) {
        restage(entry.id, prevStage);
        setMoveError((await pipelineActionReason(r)) ?? t("moveFailed"));
      }
    } catch {
      restage(entry.id, prevStage);
      setMoveError(t("moveFailed"));
    } finally {
      await load();
    }
  };

  return { entries, events, error, eventsError, load, moveError, setMoveError, moveEntry };
}

export type PipelineBoardData = ReturnType<typeof usePipelineBoardData>;
