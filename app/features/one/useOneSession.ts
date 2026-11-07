"use client";

// React wrapper around the pure session reducer (engine/session.ts) + the conductor
// (engine/resolve.ts) + the one validation door (engine/validate.ts).
//
// A reply's screen ops are applied after PENDING_MS — long enough for the "opening the
// views" narration to be read and for the user's own hand to land first (which drops
// them, said in the change line), never padded to look thoughtful: resolve() is local
// and instant, and the beat is the only wait.
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { AttentionCounts } from "@/app/_lib/attention";
import { resolve } from "./engine/resolve";
import { currentOf, initialSession, positionOf, sessionReducer, type CurrentAnswer, type SessionState } from "./engine/session";
import { validateReply } from "./engine/validate";
import type { ActKind, OneInput, PanelKind } from "./types";

export const PENDING_MS = 450;

export type OneSession = SessionState & {
  /** Ask the conductor (a chip or typed words). */
  submit: (input: OneInput) => void;
  /** Halt anything pending and restore the screen from before the turn. */
  stop: () => void;
  undo: () => void;
  canUndo: boolean;
  /** Walk the answers (navigation, never an undo step). Both are ignored while a reply's
   *  beat is pending. */
  stepBack: () => void;
  stepForward: () => void;
  /** The answer in view: what was asked, what One said, the views and the proposals it
   *  left. null on the first beat (nothing asked yet). */
  current: CurrentAnswer | null;
  /** `index` is 0-based (-1 = nothing asked yet); show `index + 1` of `total`. */
  position: { index: number; total: number; canBack: boolean; canForward: boolean };
  /** The user's own hand on the region. */
  show: (kind: PanelKind, params?: Record<string, string>) => void;
  focus: (panelId: string) => void;
  close: (panelId: string) => void;
  pin: (panelId: string) => void;
  unpin: (panelId: string) => void;
  /** A panel row's own act (the user's press) → a ConsentCard. */
  propose: (act: ActKind, params: Record<string, string>) => void;
  dismissProposal: (proposalId: string) => void;
  /** Bumped after a data act; panels re-read on change. */
  epoch: number;
  bumpEpoch: () => void;
};

export function useOneSession(attention: AttentionCounts | null): OneSession {
  const [state, dispatch] = useReducer(sessionReducer, undefined, initialSession);
  const [epoch, setEpoch] = useState(0);

  // The pending beat. Keyed on the pending turn, so a superseding turn restarts it and a
  // hand action (which clears `pending`) cancels it.
  const pendingTurn = state.pending?.turnId ?? null;
  useEffect(() => {
    if (!pendingTurn) return;
    const timer = setTimeout(() => dispatch({ type: "applyPending" }), PENDING_MS);
    return () => clearTimeout(timer);
  }, [pendingTurn]);

  const submit = useCallback(
    (input: OneInput) => {
      const text = input.text?.trim();
      if (!input.chip && !text) return;
      const raw = resolve(input, { attention });
      // Every reply passes the one door, even our own deterministic one.
      const { reply, dropped } = validateReply(raw, { panelIds: new Set(state.panels.map((p) => p.id)) });
      dispatch({ type: "submit", input, reply, dropped });
    },
    [attention, state.panels]
  );

  const actions = useMemo(
    () => ({
      stop: () => dispatch({ type: "stop" }),
      undo: () => dispatch({ type: "undo" }),
      stepBack: () => dispatch({ type: "stepBack" }),
      stepForward: () => dispatch({ type: "stepForward" }),
      show: (kind: PanelKind, params?: Record<string, string>) => dispatch({ type: "show", kind, params }),
      focus: (panelId: string) => dispatch({ type: "focus", panelId }),
      close: (panelId: string) => dispatch({ type: "close", panelId }),
      pin: (panelId: string) => dispatch({ type: "pin", panelId }),
      unpin: (panelId: string) => dispatch({ type: "unpin", panelId }),
      propose: (act: ActKind, params: Record<string, string>) => dispatch({ type: "propose", act, params }),
      dismissProposal: (proposalId: string) => dispatch({ type: "dismissProposal", proposalId }),
      bumpEpoch: () => setEpoch((n) => n + 1),
    }),
    []
  );

  const current = useMemo(() => currentOf(state), [state]);
  const base = positionOf(state);
  const position = {
    ...base,
    canBack: !state.pending && base.index > 0,
    canForward: !state.pending && base.index >= 0 && base.index < base.total - 1,
  };
  return { ...state, ...actions, submit, canUndo: state.history.length > 0, epoch, current, position };
}
