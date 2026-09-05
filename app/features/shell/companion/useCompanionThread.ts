"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompanionProposal, CompanionTurn } from "@/app/_lib/db/companion";
import { readProposalAnswer } from "@/app/_lib/companion-dock-states";
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
  /** The conversation as the server stored it. Each assistant turn carries its
   *  provenance in `meta` — and, since V1, the SPOKEN form of its own answer at
   *  `meta.voiceReply` (`{text, source}`). Nothing new is fetched for it: the
   *  message route and the boot request both already return whole turns, so the
   *  spoken channel arrives with the written one and a reloaded thread can be
   *  read aloud without paying for a model call. `useCompanionSpeech` is what
   *  turns one of these into an utterance. */
  turns: CompanionTurn[];
  /** Every proposal this conversation produced, live. Joined onto the turn that
   *  offered it through `meta.proposalIds`, so a reloaded transcript paints an
   *  already-answered proposal as answered instead of offering Accept again. */
  proposals: CompanionProposal[];
  busy: boolean;
  /** Machine error code from the route ("RATE_LIMITED" …) or a transport failure. */
  error: string | null;
  ready: boolean;
  /** Resolves false when the exchange did not land — the composer restores the draft. */
  send: (message: string) => Promise<boolean>;
  /** The message whose exchange did not land, still unsent. The composer has it
   *  back as a draft; this is what the error line's Retry re-sends, so recovering
   *  from a throttle is one click rather than a re-read of what you typed. Null
   *  whenever there is nothing to retry. */
  lastFailed: string | null;
  /** Re-send `lastFailed`. No-op (false) when nothing failed. */
  retry: () => Promise<boolean>;
  /** Re-read this conversation from the server. Called when the studio's open
   *  proposal count moves while the dock is open — a landed digest, or a proposal
   *  a sibling tab answered — so the transcript stops needing a remount to show
   *  what already happened. Deliberately NOT a poller: it rides `useAttention`'s
   *  existing 60s read (see shouldRefetchCompanionThread). */
  refresh: () => Promise<void>;
  /** Start a fresh conversation and swap to it. The old one is not deleted —
   *  it stays in the ledger, which is what makes this a cheap, undoable act. */
  newThread: () => Promise<boolean>;
  /** Answer one proposal. Resolves false when the answer did not land, so the
   *  card re-arms rather than sitting disabled on a request that failed. */
  resolveProposal: (id: string, decision: "accept" | "decline") => Promise<boolean>;
  /** The proposal whose answer did not land, and why. It belongs BESIDE that
   *  card, not in the dock's error line: the operator pressed a button on one
   *  row and the sentence about it has to be readable from there. Cleared by any
   *  later answer or send, so there is only ever one current failure. */
  proposalError: { id: string; code: string } | null;
  /** Whether this workspace has consented to Candi keeping a memory on this
   *  machine (WP4). Read from the SAME boot request that hydrates the thread,
   *  because the state line has to say "memory off" before a single message is
   *  sent. Defaults TRUE so a failed or slow boot never accuses a perfectly
   *  healthy install of having forgotten. */
  memoryEnabled: boolean;
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
  setProposals: (proposals: CompanionProposal[]) => void;
  setBusy: (busy: boolean) => void;
  setError: (code: string | null) => void;
  setLastFailed: (message: string | null) => void;
  setProposalError: (failure: { id: string; code: string } | null) => void;
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
    const body = (await res.json()) as { turns?: CompanionTurn[]; proposals?: CompanionProposal[]; code?: string };
    if (ctx.activeThread.current !== id) {
      // The operator started a new conversation while this one was in flight.
      // The turn landed in the database either way; it just is not this screen.
      for (const pending of carried) pending.resolve(true);
      return;
    }
    if (res.ok && body.turns) {
      ctx.setTurns(body.turns);
      ctx.setProposals(body.proposals ?? []);
      ctx.setError(null);
      ctx.setProposalError(null);
      ok = true;
      ctx.setLastFailed(null);
      // An answer arrived at a dock nobody is looking at: that is the ONLY
      // honest source of the rest affordance's dot.
      if (!ctx.visible.current) ctx.onReplyWhileClosed.current?.();
    } else {
      ctx.setError(body.code ?? "COMPANION_MESSAGE_FAILED");
      ctx.setLastFailed(message);
      ctx.setProposalError(null);
    }
  } catch {
    ctx.setError("COMPANION_MESSAGE_FAILED");
    ctx.setLastFailed(message);
    ctx.setProposalError(null);
  }
  for (const pending of carried) pending.resolve(ok);
  // A refused message is NOT put back into the machine's queue here, and this is
  // the one place the companion legitimately differs from the voice caller the
  // machine was written for. There a dropped utterance exists nowhere, and the
  // requeue is the only thing that saves it. Here the composer has already
  // RESTORED it as a draft (ChatComposer restores on a false resolve), so the
  // requeue made the same sentence exist twice: the operator's next send
  // coalesced their restored draft WITH the queued copy and Candi was asked the
  // same question twice, in one message. It also stranded anything typed while
  // the failed turn was in flight, because `completeTurn` dispatches nothing on
  // the tick that carries a `failed`. Passing null instead re-arms the queue —
  // whatever was typed meanwhile goes out now — and the refused message is held
  // in `lastFailed` for the error line's explicit Retry. Still never
  // re-dispatched on its own: that would turn a rate limit into a retry loop
  // against a paid endpoint. Its optimistic bubble is dropped by the reconcile
  // above on the next successful exchange.
  const next = completeTurn(ctx.machine.current, false, null);
  ctx.machine.current = next.state;
  ctx.setBusy(next.state.busy);
  if (next.next) await runExchange(ctx, id, next.next);
}

export function useCompanionThread(active: boolean, onReplyWhileClosed?: () => void): CompanionThreadState {
  const [turns, setTurns] = useState<CompanionTurn[]>([]);
  const [proposals, setProposals] = useState<CompanionProposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailed, setLastFailed] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<{ id: string; code: string } | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  // Optimistic yes: the honest failure of this flag is a missing warning, not a
  // false one, and "Candi has forgotten everything" is a bad thing to say to an
  // operator whose boot request merely timed out.
  const [memoryEnabled, setMemoryEnabled] = useState(true);
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
        const body = (await res.json()) as {
          threads?: { id: string }[];
          turns?: CompanionTurn[];
          proposals?: CompanionProposal[];
          memoryEnabled?: boolean;
          code?: string;
        };
        if (res.ok) setMemoryEnabled(body.memoryEnabled !== false);
        if (res.ok && body.threads && body.threads.length > 0) {
          activeThread.current = body.threads[0].id;
          setThreadId(body.threads[0].id);
          setTurns(body.turns ?? []);
          setProposals(body.proposals ?? []);
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
    () => ({
      machine,
      waiting,
      activeThread,
      visible,
      onReplyWhileClosed: unreadCb,
      setTurns,
      setProposals,
      setBusy,
      setError,
      setLastFailed,
      setProposalError,
    }),
    []
  );
  const dispatch = useCallback((id: string, message: string) => runExchange(ctx, id, message), [ctx]);

  const send = useCallback(
    (message: string): Promise<boolean> => {
      const text = message.trim();
      if (!text || !threadId) return Promise.resolve(false);
      // A new attempt supersedes the last failure whatever its outcome: the error
      // line must never offer to retry a message that is already on its way.
      setLastFailed(null);
      setProposalError(null);
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
      setProposals([]);
      setBusy(false);
      setError(null);
      setLastFailed(null);
      setProposalError(null);
      return true;
    } catch {
      setError("COMPANION_THREAD_CREATE_FAILED");
      return false;
    }
  }, []);

  /** Re-send the message whose exchange did not land. It goes through `send`
   *  like any other message, so it queues behind an in-flight turn instead of
   *  racing it, and a second failure simply re-arms the button. */
  const retry = useCallback((): Promise<boolean> => {
    if (!lastFailed) return Promise.resolve(false);
    return send(lastFailed);
  }, [lastFailed, send]);

  /** Re-read the conversation the dock is showing.
   *
   *  It reuses the BOOT route rather than adding one: `GET /api/companion/threads`
   *  already returns the newest thread's turns and proposals in the same request
   *  as the ledger. That is also its limit, said plainly — it can only refresh the
   *  thread that is still the newest one. When the operator has started a newer
   *  conversation than the one on screen, this is a no-op rather than a thread
   *  switch: repainting the conversation someone is reading is a refresh, swapping
   *  it out from under them mid-sentence is not.
   *
   *  Never while a turn is in flight — that exchange is about to replace the whole
   *  list with server truth, and a slower refresh landing after it would repaint
   *  the transcript back to before the answer. */
  const refresh = useCallback(async (): Promise<void> => {
    const id = activeThread.current;
    if (!id || machine.current.busy) return;
    try {
      const res = await fetch("/api/companion/threads");
      const body = (await res.json()) as {
        threads?: { id: string }[];
        turns?: CompanionTurn[];
        proposals?: CompanionProposal[];
        memoryEnabled?: boolean;
      };
      if (!res.ok || !body.threads?.length) return;
      // Re-checked AFTER the round trip, both of them: the operator may have
      // started a new conversation or sent a message while it was in the air, and
      // either makes this response a stale repaint rather than a refresh.
      if (body.threads[0].id !== activeThread.current || machine.current.busy) return;
      setTurns(body.turns ?? []);
      setProposals(body.proposals ?? []);
      setMemoryEnabled(body.memoryEnabled !== false);
    } catch {
      /* best-effort: a refresh only repaints what is already on screen, so a
         failed one leaves the last known conversation exactly as it was rather
         than replacing a readable transcript with an error. The next attention
         change tries again. */
    }
  }, []);

  /** Answer one proposal. The route is the ONE door that executes anything, so
   *  this is a thin call: the server's updated row replaces the local one, which
   *  is what makes an outcome chip the server's fact rather than the client's
   *  guess about what accepting probably did.
   *
   *  A 409 (a sibling dock already answered it) is NOT surfaced as an error — the
   *  server's row is authoritative and the card simply repaints as resolved, so
   *  the response's proposal is taken whatever the status was. That only became
   *  TRUE when the route started sending the row with the 409; until then the
   *  card re-armed on a closed proposal and every further click bought another
   *  409. `readProposalAnswer` is where the rule now lives, with a test. */
  const resolveProposalById = useCallback(
    async (id: string, decision: "accept" | "decline"): Promise<boolean> => {
      try {
        const res = await fetch(`/api/companion/proposals/${encodeURIComponent(id)}/resolve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision }),
        });
        const body = (await res.json()) as { proposal?: CompanionProposal; code?: string };
        const answer = readProposalAnswer(body);
        if (answer.proposal) {
          const updated = answer.proposal;
          setProposals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
          setError(null);
          setProposalError(null);
          return true;
        }
        // Both, and on purpose: the card reads `proposalError` and voice mode —
        // which draws no card of its own — reads the thread's error line.
        setError(answer.code);
        setProposalError({ id, code: answer.code ?? "COMPANION_PROPOSAL_FAILED" });
        return false;
      } catch {
        setError("COMPANION_PROPOSAL_FAILED");
        setProposalError({ id, code: "COMPANION_PROPOSAL_FAILED" });
        return false;
      }
    },
    []
  );

  return {
    turns,
    proposals,
    busy,
    error,
    ready: threadId !== null,
    send,
    lastFailed,
    retry,
    refresh,
    newThread,
    resolveProposal: resolveProposalById,
    proposalError,
    memoryEnabled,
  };
}
