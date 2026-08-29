// State machine for the Personas bridge card (IntegrationsPersonasPanel.tsx),
// split out so the panel file stays under the 200-line cap. Owns the two-phase
// pairing flow: POST pair {phase:"start"} → poll {phase:"claim"} every ~2s until
// the human approves in the Personas desktop app, times out (the 300s in-memory
// TTL on the Personas side), or errors — plus the disconnect call.
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

const CLAIM_POLL_MS = 2_000;

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
      if (attemptRef.current !== attempt) return;
      setState({ phase: "waiting", nonce: p.nonce, deadline: Date.now() + ttlS * 1000 });
    } catch (e) {
      if (attemptRef.current !== attempt) return;
      setState({ phase: "error", message: e instanceof Error && e.message ? e.message : t("pairFailed") });
    }
  };

  const cancel = () => {
    attemptRef.current++;
    setState({ phase: "idle" });
  };

  // Claim poll — one attempt every 2s while waiting. A transient network failure
  // just retries on the next tick; a server error or the TTL deadline ends the
  // flow with an explicit retry path (never a silent forever-spinner).
  useEffect(() => {
    if (state.phase !== "waiting") return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() > state.deadline) {
        setState({ phase: "timeout" });
        return;
      }
      try {
        const r = await fetch("/api/agents/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: "claim", nonce: state.nonce }),
        });
        const p = (await r.json().catch(() => null)) as { paired?: boolean; error?: string; code?: string } | null;
        if (cancelled) return;
        if (r.ok && p?.paired === true) {
          setState({ phase: "idle" });
          setNote({ text: t("paired"), ok: true });
          onPaired();
          return;
        }
        if (!r.ok) {
          setState({ phase: "error", message: errMsgRef.current(p, t("pairFailed")) });
          return;
        }
      } catch {
        /* transient — the next tick retries */
      }
      timer = window.setTimeout(tick, CLAIM_POLL_MS);
    };
    timer = window.setTimeout(tick, CLAIM_POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
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
