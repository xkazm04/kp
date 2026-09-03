// State machine for the Personas bridge card (IntegrationsPersonasPanel.tsx),
// split out so the panel file stays under the 200-line cap. Owns the two-phase
// pairing flow: POST pair {phase:"start"} -> poll {phase:"claim"} on a backing-off
// interval (2s, x1.5, capped at 15s, paused while the page is hidden) until the human
// approves in the Personas desktop app, times out (the 300s in-memory TTL on the
// Personas side), or errors - plus the disconnect call.
//
// The pure pieces of that flow (the backoff curve, one round's branch table, the
// superseded-attempt guard) are exported and pinned by integrationsLogic.test.ts; the
// hook below is the DOM wiring around them.
"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";

export type PairState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "waiting"; nonce: string; deadline: number }
  | { phase: "timeout" }
  | { phase: "error"; message: string };

/** The FIRST gap between claim attempts. Fast, because the common case is an operator
 *  with the Personas desktop app already in front of them: approval lands in seconds. */
export const CLAIM_POLL_MS = 2_000;
/** ...and the ceiling the gap grows to. A fixed 2s tick ran for the whole 300s TTL -
 *  150 requests to watch a human decide, every one of them identical, on a window the
 *  operator has usually walked away from. The uncommon case (they went to find the
 *  other machine) is exactly the one that must not cost 150 round trips. */
export const CLAIM_POLL_MAX_MS = 15_000;
/** Gentle geometric growth: 2 -> 3 -> 4.5 -> 6.75 -> 10.1 -> 15 -> 15..., so a quick
 *  approval is still noticed within a few seconds while a five-minute wait costs ~25
 *  requests instead of 150. */
export const CLAIM_POLL_FACTOR = 1.5;

/** The stated curve, as one pure function. */
export function nextClaimDelayMs(previousMs: number): number {
  return Math.min(Math.round(previousMs * CLAIM_POLL_FACTOR), CLAIM_POLL_MAX_MS);
}

/** What one claim round should do next. `response` is the parsed answer, or null when
 *  nothing was fetched (the pre-round deadline check, or a transient network failure).
 *  Extracted from the effect so the branch table - including the two branches that END
 *  the flow - can be pinned without a DOM. The deadline is checked FIRST in every case:
 *  a claim that lands after the Personas-side TTL has lapsed is not a pairing, whatever
 *  it says. */
export type ClaimStep = "timeout" | "paired" | "error" | "retry";
export function claimStep(input: {
  nowMs: number;
  deadline: number;
  response?: { ok: boolean; paired: boolean } | null;
}): ClaimStep {
  if (input.nowMs > input.deadline) return "timeout";
  if (!input.response) return "retry";
  if (!input.response.ok) return "error";
  return input.response.paired ? "paired" : "retry";
}

/** True when a continuation belongs to an attempt the operator has already superseded
 *  (started again, or cancelled). Cancel is offered DURING "starting", so a cancel can
 *  land while the start POST is still in flight; without this guard its continuation
 *  re-entered the waiting state the operator had just dismissed, or raised an error
 *  banner for a request they abandoned. */
export function isSupersededAttempt(current: number, mine: number): boolean {
  return current !== mine;
}

export function usePersonasPairing(onPaired: () => void) {
  const t = useTranslations("integrations.personas");
  // Both routes answer with safeJsonError's `{ error, code }` (AGENT_PAIR_FAILED /
  // AGENT_BRIDGE_FAILED). Resolve the code — `error` is English for the server log.
  const errMsg = useErrorMessage();
  // The resolver is a fresh closure each render; the claim poll below reads it
  // through a ref so it never becomes an effect dep that restarts the 2s timer.
  const errMsgRef = useRef(errMsg);
  useEffect(() => {
    errMsgRef.current = errMsg;
  });
  const [state, setState] = useState<PairState>({ phase: "idle" });
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // Attempt counter. Cancel is offered DURING the "starting" phase (the panel's waiting
  // card covers starting + waiting), so a cancel can land while the start POST is still in
  // flight — and its continuation would then re-enter the waiting state the operator had
  // just dismissed, or raise an error banner for a request they abandoned. Every start and
  // every cancel bumps this; a continuation from a superseded attempt drops its result.
  const attemptRef = useRef(0);

  const start = async (baseUrl: string) => {
    if (state.phase === "starting" || state.phase === "waiting") return;
    const attempt = ++attemptRef.current;
    setState({ phase: "starting" });
    setNote(null);
    try {
      const r = await fetch("/api/agents/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // An explicit base URL rides the start phase — the route persists it
        // before registering the pairing request ("point kp at my Personas").
        body: JSON.stringify({ phase: "start", ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}) }),
      });
      const p = (await r.json().catch(() => null)) as { nonce?: string; expiresInS?: number; error?: string; code?: string } | null;
      if (!r.ok || !p?.nonce) throw new Error(errMsg(p, t("pairFailed")));
      const ttlS = typeof p.expiresInS === "number" && p.expiresInS > 0 ? p.expiresInS : 300;
      if (isSupersededAttempt(attemptRef.current, attempt)) return;
      setState({ phase: "waiting", nonce: p.nonce, deadline: Date.now() + ttlS * 1000 });
    } catch (e) {
      if (isSupersededAttempt(attemptRef.current, attempt)) return;
      setState({ phase: "error", message: e instanceof Error && e.message ? e.message : t("pairFailed") });
    }
  };

  const cancel = () => {
    attemptRef.current++;
    setState({ phase: "idle" });
  };

  // Claim poll while waiting. A transient network failure just retries on the next
  // tick; a server error or the TTL deadline ends the flow with an explicit retry path
  // (never a silent forever-spinner).
  //
  // Two things bound the cost. The gap BACKS OFF along the stated curve (2s, x1.5,
  // capped at 15s), because the fixed 2s tick spent 150 identical requests watching a
  // human decide. And the poll STOPS while the page is hidden: a settings tab left open
  // behind other work polled for the full five minutes with nobody there to approve
  // anything. Returning to the tab resumes immediately, at the fast gap again - the
  // operator coming back is exactly when an approval is most likely to be waiting.
  useEffect(() => {
    if (state.phase !== "waiting") return;
    let cancelled = false;
    let timer = 0;
    let delay = CLAIM_POLL_MS;
    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
    const tick = async () => {
      if (cancelled) return;
      // The deadline is checked before the round AND after it (claimStep again below),
      // so a wait that lapsed while the tab was hidden ends the moment it is looked at.
      if (claimStep({ nowMs: Date.now(), deadline: state.deadline }) === "timeout") {
        setState({ phase: "timeout" });
        return;
      }
      // Nobody is watching: park, and let the visibility listener below restart us.
      if (hidden()) return;
      try {
        const r = await fetch("/api/agents/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: "claim", nonce: state.nonce }),
        });
        const p = (await r.json().catch(() => null)) as { paired?: boolean; error?: string; code?: string } | null;
        if (cancelled) return;
        const response = { ok: r.ok, paired: p?.paired === true };
        switch (claimStep({ nowMs: Date.now(), deadline: state.deadline, response })) {
          case "timeout":
            setState({ phase: "timeout" });
            return;
          case "paired":
            setState({ phase: "idle" });
            setNote({ text: t("paired"), ok: true });
            onPaired();
            return;
          case "error":
            setState({ phase: "error", message: errMsgRef.current(p, t("pairFailed")) });
            return;
          case "retry":
            break;
        }
      } catch {
        /* transient - the next tick retries, one step further along the backoff */
      }
      delay = nextClaimDelayMs(delay);
      timer = window.setTimeout(tick, delay);
    };
    const onVisible = () => {
      if (cancelled || hidden()) return;
      // Back from another tab: drop whatever is pending, reset to the fast gap and check
      // right away rather than waiting out a 15s step.
      window.clearTimeout(timer);
      delay = CLAIM_POLL_MS;
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    timer = window.setTimeout(tick, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state, onPaired, t]);

  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/agents/bridge", { method: "DELETE" });
      const p = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
      if (!r.ok) throw new Error(errMsg(p, t("disconnectFailed")));
      setNote({ text: t("disconnected"), ok: true });
    } catch (e) {
      setNote({ text: e instanceof Error && e.message ? e.message : t("disconnectFailed"), ok: false });
    } finally {
      setBusy(false);
      // "Either way" — which is what this line always claimed, from inside the
      // try, where a failure skipped it. A DELETE that answers non-2xx has still
      // touched the server: it may have cleared the key before failing, or it may
      // have 401'd because the session expired. Re-reading the bridge is how the
      // card stops asserting a state nobody confirmed, and it is exactly the case
      // where the operator most needs the panel to be telling the truth.
      onPaired();
    }
  };

  return { t, state, note, busy, start, cancel, disconnect };
}
