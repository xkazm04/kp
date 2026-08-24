"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompanionTurn } from "@/app/_lib/db/companion";
import {
  completeTurn,
  enqueueUtterance,
  initialOrchestratorState,
  type OrchestratorState,
} from "@/app/features/library/jds/intake/voiceOrchestration";

/*
 * The dock's client half: one conversation, loaded or created on first open,
 * with sends serialized through the SHARED orchestration state machine
 * (voiceOrchestration.ts — reused, not copied). That machine already owns the
 * two decisions this surface needs and has unit tests for both: never race a
 * second request against an in-flight turn, and coalesce whatever arrived while
 * busy into ONE next message.
 *
 * Why a queue at all when the composer disables itself while busy: sends do not
 * only come from the composer. The command palette ("Ask Candi: <query>") and
 * the ControlDock affordance both seed a message from outside, and either can
 * fire mid-turn.
 *
 * Optimistic bubbles are provisional. Every exchange replaces the whole list
 * with the server's stored turns, which is how a coalesced pair of typed
 * messages reconciles into the single message that was actually sent — the
 * screen never claims a shape the database does not have.
 */

export type CompanionThreadState = {
  turns: CompanionTurn[];
  busy: boolean;
  /** Machine error code from the route ("RATE_LIMITED" …) or a transport failure. */
  error: string | null;
  ready: boolean;
  /** Resolves false when the exchange did not land — the composer restores the draft. */
  send: (message: string) => Promise<boolean>;
  /** Start a fresh conversation and swap to it. The old one is not deleted —
   *  it stays in the ledger, which is what makes this a cheap, undoable act. */
  newThread: () => Promise<boolean>;
};

type Pending = { resolve: (ok: boolean) => void };

type ExchangeCtx = {
  machine: { current: OrchestratorState };
  /** The thread the SCREEN is showing. An exchange dispatched against a thread
   *  the operator has since left must not repaint the one they moved to — the
   *  reply is still stored, it is just no longer what is on screen. */
  activeThread: { current: string | null };
  waiting: { current: Pending[] };
  /** Whether the dock is on screen right now — a ref, because a reply can land
   *  long after the render that dispatched it. */
  visible: { current: boolean };
  onReplyWhileClosed: { current: (() => void) | undefined };
  setTurns: (turns: CompanionTurn[]) => void;
  setBusy: (busy: boolean) => void;
  setError: (code: string | null) => void;
};

let optimisticSeq = 0;

/** ONE exchange, then whatever the machine coalesced behind it. Module scope so
 *  the tail call is an ordinary recursion rather than a hook referring to itself. */
async function runExchange(ctx: ExchangeCtx, id: string, message: string): Promise<void> {
  // Everything waiting right now is answered by THIS request; anything that
  // arrives while it is in flight belongs to the next one.
  const carried = ctx.waiting.current;
  ctx.waiting.current = [];
  let ok = false;
  try {
    const res = await fetch(`/api/companion/${encodeURIComponent(id)}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const body = (await res.json()) as { turns?: CompanionTurn[]; code?: string };
    if (ctx.activeThread.current !== id) {
      // The operator started a new conversation while this one was in flight.
      // The turn landed in the database either way; it just is not this screen.
      for (const pending of carried) pending.resolve(true);
      return;
    }
    if (res.ok && body.turns) {
      ctx.setTurns(body.turns);
      ctx.setError(null);
      ok = true;
      // An answer arrived at a dock nobody is looking at: that is the ONLY
      // honest source of the rest affordance's dot.
      if (!ctx.visible.current) ctx.onReplyWhileClosed.current?.();
    } else {
      ctx.setError(body.code ?? "COMPANION_MESSAGE_FAILED");
    }
  } catch {
    ctx.setError("COMPANION_MESSAGE_FAILED");
  }
  for (const pending of carried) pending.resolve(ok);
  // A refused message goes back to the FRONT of the machine's queue (its
  // documented contract) so it rides the next send instead of being lost, and is
  // deliberately NOT retried on its own: that would turn a rate limit into a loop
  // against a paid endpoint. Its optimistic bubble is dropped by the reconcile
  // above on the next successful exchange.
  const next = completeTurn(ctx.machine.current, false, ok ? null : message);
  ctx.machine.current = next.state;
  ctx.setBusy(next.state.busy);
  if (next.next) await runExchange(ctx, id, next.next);
}

export function useCompanionThread(active: boolean, onReplyWhileClosed?: () => void): CompanionThreadState {
  const [turns, setTurns] = useState<CompanionTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const machine = useRef<OrchestratorState>(initialOrchestratorState);
  // Every send waiting on the dispatch that carries it. Resolved together when
  // that request settles, because coalescing means one request answers several.
  const waiting = useRef<Pending[]>([]);
  const loading = useRef(false);
  const activeThread = useRef<string | null>(null);
  const visible = useRef(active);
  const unreadCb = useRef(onReplyWhileClosed);
  useEffect(() => {
    visible.current = active;
    unreadCb.current = onReplyWhileClosed;
  }, [active, onReplyWhileClosed]);

  useEffect(() => {
    if (!active || threadId || loading.current) return;
    loading.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/companion/threads");
        const body = (await res.json()) as { threads?: { id: string }[]; turns?: CompanionTurn[]; code?: string };
        if (res.ok && body.threads && body.threads.length > 0) {
          activeThread.current = body.threads[0].id;
          setThreadId(body.threads[0].id);
          setTurns(body.turns ?? []);
          return;
        }
        if (!res.ok) throw new Error(body.code ?? "COMPANION_THREADS_FAILED");
        const created = await fetch("/api/companion/threads", { method: "POST" });
        const thread = (await created.json()) as { id?: string; code?: string };
        if (!created.ok || !thread.id) throw new Error(thread.code ?? "COMPANION_THREAD_CREATE_FAILED");
        activeThread.current = thread.id;
        setThreadId(thread.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "COMPANION_THREADS_FAILED");
      } finally {
        loading.current = false;
      }
    })();
  }, [active, threadId]);

  // The exchange loop lives at module scope (below) so its own recursive call is
  // not a hook reading a binding it is still declaring. Every piece it needs is
  // stable: React setters never change identity, and refs are refs.
  const ctx = useMemo<ExchangeCtx>(
    () => ({ machine, waiting, activeThread, visible, onReplyWhileClosed: unreadCb, setTurns, setBusy, setError }),
    []
  );
  const dispatch = useCallback((id: string, message: string) => runExchange(ctx, id, message), [ctx]);

  const send = useCallback(
    (message: string): Promise<boolean> => {
      const text = message.trim();
      if (!text || !threadId) return Promise.resolve(false);
      setTurns((prev) => [
        ...prev,
        {
          id: `optimistic-${(optimisticSeq += 1)}`,
          threadId,
          workspaceId: "",
          role: "user" as const,
          content: text,
          meta: null,
          createdAt: new Date().toISOString(),
        },
      ]);
      const step = enqueueUtterance(machine.current, text);
      machine.current = step.state;
      setBusy(step.state.busy);
      const settled = new Promise<boolean>((resolve) => waiting.current.push({ resolve }));
      if (step.dispatch) void dispatch(threadId, step.dispatch);
      return settled;
    },
    [threadId, dispatch]
  );

  /** The toolbar's new-conversation action. Only reachable when no turn is in
   *  flight (the button disables while busy), so there is no exchange to orphan;
   *  the machine and the queue are still reset, because a state machine that is
   *  only correct when its caller behaves is not a state machine. */
  const newThread = useCallback(async (): Promise<boolean> => {
    try {
      const created = await fetch("/api/companion/threads", { method: "POST" });
      const thread = (await created.json()) as { id?: string; code?: string };
      if (!created.ok || !thread.id) {
        setError(thread.code ?? "COMPANION_THREAD_CREATE_FAILED");
        return false;
      }
      machine.current = initialOrchestratorState;
      for (const pending of waiting.current) pending.resolve(false);
      waiting.current = [];
      activeThread.current = thread.id;
      setThreadId(thread.id);
      setTurns([]);
      setBusy(false);
      setError(null);
      return true;
    } catch {
      setError("COMPANION_THREAD_CREATE_FAILED");
      return false;
    }
  }, []);

  return { turns, busy, error, ready: threadId !== null, send, newThread };
}
