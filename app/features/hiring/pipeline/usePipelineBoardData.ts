"use client";

// The board's DATA plane: the entries/events fetch (self-sequencing load()), the
// 30s live poll (backing off on failure, resuming on visibility), the render-diet
// signatures, and the one optimistic writer of the
// entries array (drag-to-move). Split out of usePipelineTabState; `setEntries` stays
// private to this module so the board array has exactly one mutator.

import { useCallback, useEffect, useRef, useState } from "react";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useLiveRefresh } from "@/app/features/shell/live-refresh";
import { sharedGetJson } from "@/app/features/shared/sharedGet";
import { boardSignature, eventsSignature } from "./pipelineRenderDiet";
import { postPipelineAction } from "@/app/_lib/useAddToPipeline";
import { DEFAULT_BOARD_AXIS, type Entry, type PipelineEvent, type StageDef } from "@/app/features/shared/pipelineTypes";
import { pipelineActionReason } from "./pipelineTabHelpers";
import { mergeMovedRow, moveOutcome, restageEntries, shouldCommitBoard } from "./pipelineBoardMove";
import { POLL_BASE_MS, nextPollDelay } from "./schedulerRunState";
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
  // The board's COLUMNS, resolved per workspace and served alongside the entries.
  // Seeded with the shipped axis so the first frame paints the right number of
  // columns instead of flashing an empty grid; the payload replaces it.
  const [axis, setAxis] = useState<readonly StageDef[]>(DEFAULT_BOARD_AXIS);
  const [retiredStages, setRetiredStages] = useState<readonly StageDef[]>([]);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Activity-feed health is tracked separately from the board: a failed events
  // fetch must read as "couldn't load activity", never as a genuine empty feed.
  const [eventsError, setEventsError] = useState<string | null>(null);
  // Transient feedback when a drag-to-move fails (optimistic move rolled back).
  // `moveErrorEntryId` names the card that BOUNCED, so the board can put the reason
  // next to it: the page-level banner is far from a wide, scrolled board, and a card
  // that silently slides back to where it started reads as a dropped gesture rather
  // than a refusal. Cleared together — one refusal, one reason, one card.
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveErrorEntryId, setMoveErrorEntryId] = useState<string | null>(null);
  // Codes, never messages: the route answers PIPELINE_MOVE_CONFLICT /
  // PIPELINE_TERMINAL_NOT_MANUAL and the reader sees them in their own language.
  const errorMessage = useErrorMessage();

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
  // Returns the poll's HEALTH verdict (true = every request this call made reached
  // the server), so the live poll below can back off instead of hammering a dead
  // endpoint at a flat 30s forever. An ABORT is not a failure — it is this hook
  // superseding its own request.
  const load = useCallback((opts?: { shared?: boolean; eventsOnly?: boolean }): Promise<boolean> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    // `eventsOnly` skips the board half: a drag-move already knows the one row that
    // changed (the server hands it back), so re-reading the WHOLE active board to
    // learn nothing new is the expensive half of a cheap operation. The activity
    // feed still has to hear about the move, and its delta read is one small
    // `?since=` request — so that half always runs.
    const boardDone: Promise<boolean> = opts?.eventsOnly
      ? Promise.resolve(true)
      : sharedGetJson<{ entries?: Entry[]; stages?: StageDef[]; retiredStages?: StageDef[]; error?: string }>("/api/pipeline", {
        refresh: !opts?.shared,
      })
        .then((p) => {
          if (signal.aborted) return true; // a newer load superseded this one
          if (p.error) throw new Error(p.error);
          const next = (p.entries as Entry[]) ?? [];
          // Committed by identity comparison, not a signature: the axis changes
          // rarely (a Settings save) and is a handful of objects, so the cheap
          // JSON compare keeps the board from re-bucketing on every 30s poll.
          if (Array.isArray(p.stages) && p.stages.length > 0) {
            setAxis((cur) => (JSON.stringify(cur) === JSON.stringify(p.stages) ? cur : p.stages!));
          }
          setRetiredStages((cur) => {
            const incoming = p.retiredStages ?? [];
            return JSON.stringify(cur) === JSON.stringify(incoming) ? cur : incoming;
          });
          // Content-equality short-circuit: only reset the entries array when the
          // rendered content actually changed. setError(null) below is a no-op
          // re-render when error is already null (React bails on an identical value).
          const sig = boardSignature(next, { overrides: slaOverridesRef.current });
          if (shouldCommitBoard(sig, lastEntriesSigRef.current)) {
            lastEntriesSigRef.current = sig;
            setEntries(next);
          }
          setError(null); // success clears any prior transient error
          return true;
        })
        .catch((e) => {
          if (signal.aborted) return true; // ignore aborted/stale failures
          setError(e instanceof Error ? e.message : t("loadFailed"));
          return false;
        });
    const since = eventsCursorRef.current;
    const eventsDone: Promise<boolean> = fetch(since == null ? "/api/pipeline/events" : `/api/pipeline/events?since=${since}`, { signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((p) => {
        if (signal.aborted) return true;
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
        return true;
      })
      .catch(() => {
        if (signal.aborted) return true;
        setEventsError(t("eventsError"));
        return false;
      });
    return Promise.all([boardDone, eventsDone]).then(([board, events]) => board && events);
  }, [t]);
  useEffect(() => {
    void load({ shared: true }); // the only trigger that may ride the dock's request
    return () => abortRef.current?.abort(); // drop in-flight fetches on unmount
  }, [load]);
  useLiveRefresh(load); // re-fetch the board live when the simulation (or any actor) changes state

  // Live board poll. The automation clock (instrumentation.ts heartbeat) mutates
  // pipeline_entries SERVER-side with no client signal — useLiveRefresh only fires on
  // same-document changes — so an open board silently went stale under automation (and the
  // SchedulerControl bar could show "ran · 3 advanced" while the lanes didn't move). Poll
  // every 30s, reusing load()'s abort+cursor machinery (one /api/pipeline + one delta
  // /api/pipeline/events?since= per tick). Paused while a drawer is open (don't yank state
  // mid-action) or the tab is hidden, refreshed ONCE on becoming visible again, and backed
  // off on consecutive failures. Drawer state and `load` are read via refs so the loop
  // stays mounted once instead of restarting its countdown on every drawer toggle.
  const drawerOpenRef = useRef(false);
  useEffect(() => {
    drawerOpenRef.current = drawerOpen;
  }, [drawerOpen]);
  // The poll must always call the LATEST load (it closes over `t`), and the delay
  // changes tick to tick — so a self-rescheduling timeout, not setInterval.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    // Consecutive failed polls. The loop used to re-arm at a FLAT 30s whether or not
    // the last tick reached the server: against a restarting server, a laptop off the
    // network or a 500 loop that is 120 failing round trips an hour from every open
    // tab, for ever. One success resets it, so the curve costs nothing when things
    // work. Same curve (and the same pure `nextPollDelay`) the scheduler bar's poll
    // uses: 30s -> 60s -> 2m -> 4m -> 5m.
    let failures = 0;
    const arm = () => {
      if (stopped) return;
      timer = window.setTimeout(
        async () => {
          if (!drawerOpenRef.current && !document.hidden) {
            const ok = await loadRef.current();
            failures = ok ? 0 : failures + 1;
          }
          arm();
        },
        document.hidden ? POLL_BASE_MS : nextPollDelay(failures)
      );
    };
    // Coming BACK to the tab refreshes once immediately rather than waiting out the
    // rest of a tick (or a five-minute backoff) — the board an operator returns to is
    // the one thing that must not be stale. A deliberate return also deserves a fresh
    // try, so the failure count resets.
    const onVisible = () => {
      if (document.hidden || drawerOpenRef.current) return;
      failures = 0;
      void loadRef.current();
      if (timer !== undefined) window.clearTimeout(timer);
      arm();
    };
    arm();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // cea12908 — drag a candidate to a new stage column. Optimistic: reflect the
  // move immediately, then POST set_stage with the card's PRIOR stage as
  // expectedStage (the same CAS guard the bulk move + AI actions use). A SUCCESS
  // applies the row the route hands back (no board refetch); a REFUSAL rolls the
  // card back, says why on the card, and reconciles with load() — a lost CAS means
  // a concurrent actor moved them in the gap, so the board's view is suspect.
  const moveEntry = async (entry: Entry, toStage: string) => {
    if (entry.stage === toStage) return;
    const prevStage = entry.stage;
    // The optimistic paint and its rollback are the SAME pure transform, so they can
    // never drift apart (pipelineBoardMove.ts, pinned by pipelineBoardMove.test.ts).
    const restage = (id: string, stage: string) => setEntries((cur) => restageEntries(cur, id, stage));
    restage(entry.id, toStage);
    setMoveError(null);
    setMoveErrorEntryId(null);
    // The refusal path needs the response body for its CODE, so read it before the
    // outcome is decided; a 2xx body carries the moved row instead.
    const rollback = (reason: string) => {
      restage(entry.id, prevStage);
      setMoveError(reason);
      setMoveErrorEntryId(entry.id);
    };
    try {
      const r = await postPipelineAction(entry.id, { action: "set_stage", toStage, expectedStage: prevStage });
      if (!r.ok) {
        // Roll back AND tell the recruiter the SERVER's reason — the 409 "changed since
        // you opened it" (a concurrent actor moved them) vs the 422 "route through the
        // offer flow" guidance, resolved from the refusal CODE so the sentence is in the
        // reader's language. A body with no reason at all (a network-level failure)
        // falls back to the generic copy.
        rollback(errorMessage(await pipelineActionReason(r), t("moveFailed")));
        // A refusal is the one case where the board's own view is suspect (a lost CAS
        // means somebody else moved the row), so reconcile against the server.
        await load();
        return;
      }
      // board-poll-carries-only-what-it-draws — the success path used to `await load()`
      // in a `finally`, re-reading the entire active board to learn the one thing it
      // already knew. The route answers with the moved row, so apply THAT.
      const moved = (await r.json().catch(() => null)) as { entry?: Partial<Entry> } | null;
      const outcome = moveOutcome(true, moved?.entry);
      if (outcome.kind === "applied") {
        setEntries((cur) => mergeMovedRow(cur, entry.id, outcome.entry));
        // The board array just changed under the poll's content-equality gate; clear
        // the committed signature so the next poll is free to write a genuinely
        // different payload rather than comparing against a stale one.
        lastEntriesSigRef.current = null;
        // The move produced a pipeline event — the activity feed still hears about it
        // through the delta read, without the board refetch riding along.
        void load({ eventsOnly: true });
      } else {
        // No usable row came back (an older route, an unparseable body): fall back to
        // the full reconcile rather than trusting the optimistic write.
        await load();
      }
    } catch {
      rollback(t("moveFailed"));
      await load();
    }
  };

  // One dismissal clears both halves of the refusal — the page banner and the chip
  // on the bounced card are the same message in two places, never two states.
  const dismissMoveError = useCallback(() => {
    setMoveError(null);
    setMoveErrorEntryId(null);
  }, []);

  return {
    entries,
    axis,
    retiredStages,
    events,
    error,
    eventsError,
    load,
    moveError,
    moveErrorEntryId,
    dismissMoveError,
    moveEntry,
  };
}

export type PipelineBoardData = ReturnType<typeof usePipelineBoardData>;
