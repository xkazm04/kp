"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { GigPlanRow } from "@/app/_lib/gigs/types";
import { sendJson } from "../../data/useGigsData";
import { plansBusy } from "../../logic/plans";

/** How often the tab re-reads while a seat is still writing. */
const POLL_MS = 4000;

export type PlansState = {
  /** Every seat's row of every round (GET /api/gigs/[id]/plans); null until read. */
  plans: GigPlanRow[] | null;
  /** The read failed: a machine code (or null for an unreachable server). */
  failure: { code: string | null } | null;
  reload: () => Promise<void>;
  /** A round was just proposed: keep polling until its rows appear (the task creates them
   *  a moment after the 202), for at most a minute. */
  expectRound: () => void;
};

/** One gig's plan proposals, read when the proof opens and re-read every 4 s while any seat
 *  is queued or running; the timer stops when none is, and on unmount. The proof reads it
 *  once and shares it: the report's plans section, the tab row's mark and the dispatch gate. */
export function usePlans(gigId: string | null): PlansState {
  const [state, setState] = useState<{ id: string; plans: GigPlanRow[] | null; failure: { code: string | null } | null } | null>(null);
  const [expecting, setExpecting] = useState<{ since: string | null; until: number } | null>(null);
  const alive = useRef(true);

  const load = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/gigs/${encodeURIComponent(id)}/plans`);
      const body = (await res.json().catch(() => null)) as { plans?: GigPlanRow[]; code?: unknown } | null;
      if (!alive.current) return;
      if (!res.ok || !body || !Array.isArray(body.plans)) {
        setState((s) => ({ id, plans: s?.id === id ? s.plans : null, failure: { code: body && typeof body.code === "string" ? body.code : null } }));
      } else {
        setState({ id, plans: body.plans, failure: null });
        const newest = body.plans[0]?.createdAt ?? null;
        setExpecting((e) => (e && (newest !== e.since || Date.now() > e.until) ? null : e));
      }
    } catch {
      // Unreachable server: no code to resolve; keep what is on screen and say it failed.
      if (alive.current) setState((s) => ({ id, plans: s?.id === id ? s.plans : null, failure: { code: null } }));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (gigId) void Promise.resolve().then(() => load(gigId));
    return () => {
      alive.current = false;
    };
  }, [gigId, load]);

  const current = state && state.id === gigId ? state : null;
  const busy = plansBusy(current?.plans ?? null) || expecting !== null;
  useEffect(() => {
    if (!gigId || !busy) return;
    const timer = window.setInterval(() => void load(gigId), POLL_MS);
    return () => window.clearInterval(timer);
  }, [gigId, busy, load]);

  const reload = useCallback(async () => {
    if (gigId) await load(gigId);
  }, [gigId, load]);

  const newest = current?.plans?.[0]?.createdAt ?? null;
  const expectRound = useCallback(() => setExpecting({ since: newest, until: Date.now() + 60_000 }), [newest]);

  return { plans: current?.plans ?? null, failure: current?.failure ?? null, reload, expectRound };
}

/** Propose (a new round: one to three seats by the brief's difficulty) and accept one plan
 *  with the operator's note. Answers whether the accept landed; the plans are re-read either
 *  way. The report's plans section (report/ReportPlans.tsx) holds the buttons. */
export function usePlanActions(gigId: string, plansState: PlansState, onFlash: (message: string) => void, seats: number) {
  const t = useTranslations("gigs.plans");
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/gigs/${encodeURIComponent(gigId)}/plans`;
  const { reload, expectRound } = plansState;

  async function propose() {
    setBusy(true);
    setError(null);
    const res = await sendJson(base, "POST", {});
    setBusy(false);
    if (!res.ok) return setError(resolveError(res.body as ApiErrorPayload | null, t("proposeFailed")));
    expectRound();
    onFlash(t("proposedFlash", { count: seats }));
    await reload();
  }

  async function accept(planId: string, note: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await sendJson(`${base}/${encodeURIComponent(planId)}/accept`, "POST", { note });
    setBusy(false);
    if (!res.ok) setError(resolveError(res.body as ApiErrorPayload | null, t("acceptFailed")));
    else onFlash(t("acceptedFlash"));
    await reload();
    return res.ok;
  }

  return { busy, error, propose, accept };
}
