"use client";

// The commit window's STORE (decisions-review-ui/B): one module-scoped holder, one
// timer, read through useSyncExternalStore — so the ledger section and the candidate
// modal share ONE window, and a decision armed on the Decisions tab outlives the tab
// when the recruiter switches ?tab= (the timer keeps running and commits on time).
//
// The lifecycle is the pure reducer in decisionsCommitWindow.ts; this file is only
// the clock, the page lifecycle and the network around it. Every write goes through
// commitDecision (a keepalive POST carrying the expectedStage CAS) — never through
// useDecisionsQueue's act, whose plain request the browser cancels when the page goes
// away. `pagehide` flushes synchronously: the keepalive request is issued inside the
// handler, before the document is gone.
//
// After a commit answers, notifyDataChanged() tells the queue (and other windows) to
// re-read: a landed row is then absent from the read and its overlay is pruned; a
// refused one comes back with its fresh state and the strip says it did not land.
import { useSyncExternalStore } from "react";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import {
  arm,
  commitDecision,
  dismissFailure,
  expire,
  initialWindow,
  prune,
  settled,
  teardown,
  undo,
  type CommitCommand,
  type Step,
  type WindowDecision,
  type WindowState,
} from "./decisionsCommitWindow";

const SERVER_STATE = initialWindow();
let state: WindowState = SERVER_STATE;
let timer: ReturnType<typeof setTimeout> | undefined;
let pageHideBound = false;
const listeners = new Set<() => void>();

function schedule(): void {
  clearTimeout(timer);
  timer = undefined;
  if (state.kind !== "pending") return;
  timer = setTimeout(() => dispatch((s) => expire(s, Date.now())), Math.max(0, state.deadline - Date.now()));
}

function run(commands: readonly CommitCommand[]): void {
  for (const c of commands) {
    void commitDecision(c.entryId, c.action, c.expectedStage).then((outcome) => {
      dispatch((s) => settled(s, outcome.ok ? { entryId: c.entryId, ok: true } : { entryId: c.entryId, ok: false, failure: outcome.failure }));
      // The server moved (or refused to move) the row — every view re-reads it.
      notifyDataChanged();
    });
  }
}

function dispatch(step: (s: WindowState) => Step): void {
  const next = step(state);
  if (next.state !== state) {
    state = next.state;
    schedule();
    for (const l of listeners) l();
  }
  run(next.commands);
}

// Leaving the page COMMITS a pending decision, synchronously, inside the handler.
const onPageHide = () => {
  dispatch((s) => teardown(s));
};

function bindPageHide(): void {
  if (pageHideBound || typeof window === "undefined") return;
  pageHideBound = true;
  window.addEventListener("pagehide", onPageHide);
}

/** The click: arm (flushing any decision already in the window). */
export function armDecision(decision: WindowDecision): void {
  bindPageHide();
  dispatch((s) => arm(s, decision, Date.now()));
}
export const undoDecision = (): void => dispatch(undo);
export const dismissDecisionFailure = (): void => dispatch(dismissFailure);
export const pruneLandedDecisions = (presentIds: ReadonlySet<string>): void => dispatch((s) => prune(s, presentIds));

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The shared window's current state. */
export function useDecisionCommitWindow(): WindowState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE
  );
}
