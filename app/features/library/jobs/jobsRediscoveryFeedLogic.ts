// State + data flow for JobsRediscoveryFeed.tsx — extracted verbatim (no
// behaviour change) so the feed file stays under the 200-line split threshold.
// Owns: the initial alerts load (with abort-on-unmount), the on-demand sweep,
// per-row dismiss, and the add-to-pipeline outcome transition.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { postPipelineAdd } from "@/app/_lib/useAddToPipeline";
import { capabilityAwareReason, useErrorMessage } from "@/app/_lib/use-error-message";
// bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #4): the add-outcome
// transition (keep the row + badge it "Added ✓", THEN dismiss after a beat) lives in
// this pure sibling so the previously-dead success branch is reachable and testable.
import { applyAddResult, ADDED_BADGE_MS } from "./jobsRediscoveryAdd";
import type { Alert } from "./jobsRediscoveryFeedTypes";

/** A status line plus the tone it must be painted in. A failure rendered in this
 *  app's "it worked" green is a lie the recruiter acts on, so the producer of the
 *  line — not a string comparison at the render site — declares which it is. */
export type FeedNote = { text: string; tone: "ok" | "error" };

export function useRediscoveryFeedLogic() {
  const t = useTranslations("jobs.rediscoveryFeed");
  // A failed add is answered from its CODE in the reader's language. The row error
  // used to be postPipelineAdd's canonical ENGLISH, painted verbatim into every
  // locale — the capability gate's refusal was the loudest example.
  const errMsg = useErrorMessage();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [sweeping, setSweeping] = useState(false);
  // The note carries its OWN tone. It used to be a bare string the component
  // re-identified by comparing it against `t("sweepFailed")` — which worked only
  // as long as exactly one failure message existed. Now a dismiss rollback has one
  // too, so the tone travels with the text instead of being inferred from it.
  const [note, setNote] = useState<FeedNote | null>(null);
  // Distinct from "the sweep failed": this is the INITIAL load. It used to collapse
  // into emptiness — a 500 set `alerts` to `[]` and the panel said "No silver
  // medalists right now", i.e. it answered "there are none" when the truth was
  // "we could not look".
  const [loadFailed, setLoadFailed] = useState(false);
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [rowError, setRowError] = useState<Map<string, string>>(() => new Map());
  const abortRef = useRef<AbortController | null>(null);

  // `loadKey` re-runs the initial GET — the retry offered beside the failure line.
  // Deliberately NOT the sweep: re-reading the alerts the server already holds is
  // free, while a sweep re-ranks every published role's pool.
  const [loadKey, setLoadKey] = useState(0);
  const retryLoad = useCallback(() => setLoadKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    // Actually wire the abort: the long pool-sweep fetch now carries the controller's
    // signal, so navigating away mid-load cancels the in-flight request instead of
    // the ref's abort() being a no-op against a fetch that never received the signal.
    const controller = new AbortController();
    abortRef.current = controller;
    // Inlined (not a called helper) so the lint rule can see the setState lands in
    // an async callback AFTER the await — the allowed shape (cf. useJsonFetch).
    (async () => {
      try {
        const r = await fetch("/api/rediscovery/alerts", { signal: controller.signal });
        const body = (await r.json().catch(() => null)) as { alerts?: Alert[] } | null;
        if (!alive) return;
        // "We could not look" is not "there are none": a non-OK status (or a body
        // with no `alerts`) sets the failure flag, and the panel renders a retryable
        // red line instead of the reassuring empty state.
        if (!r.ok || !body?.alerts) {
          setAlerts([]);
          setLoadFailed(true);
        } else {
          setAlerts(body.alerts);
          setLoadFailed(false);
        }
      } catch {
        // An abort (unmount) is expected — only surface a genuine load failure.
        if (alive && !controller.signal.aborted) {
          setAlerts([]);
          setLoadFailed(true);
        }
      }
    })();
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [loadKey]);

  const sweep = async () => {
    if (sweeping) return;
    setSweeping(true);
    setNote(null);
    try {
      const r = await fetch("/api/rediscovery/alerts", { method: "POST" });
      const body = (await r.json().catch(() => null)) as
        | { alerts?: Alert[]; newAlerts?: number; jobsSwept?: number }
        | null;
      if (r.ok && body?.alerts) {
        setAlerts(body.alerts);
        // A successful sweep is also the answer to a failed initial load.
        setLoadFailed(false);
        setNote({
          text:
            body.jobsSwept === 0
              ? t("noPublished")
              : t("swept", { jobs: body.jobsSwept ?? 0, found: body.newAlerts ?? 0 }),
          tone: "ok",
        });
      } else {
        setNote({ text: t("sweepFailed"), tone: "error" });
      }
    } catch {
      setNote({ text: t("sweepFailed"), tone: "error" });
    } finally {
      setSweeping(false);
    }
  };

  const dismiss = async (id: string) => {
    // Optimistic, and now REVERSIBLE. The row is dropped immediately, but the
    // position it was dropped from is remembered: a PATCH that never lands (or
    // answers non-OK) used to leave the recruiter with a candidate silently gone
    // from the view and still open on the server, resurfacing on the next reload
    // with no explanation. On failure the row goes back where it was and the panel
    // says the dismissal did not stick.
    let removed: { alert: Alert; index: number } | null = null;
    setAlerts((prev) => {
      if (!prev) return prev;
      const index = prev.findIndex((a) => a.id === id);
      if (index < 0) return prev;
      removed = { alert: prev[index], index };
      return prev.filter((a) => a.id !== id);
    });
    const restore = () => {
      const dropped = removed as { alert: Alert; index: number } | null;
      if (!dropped) return;
      setAlerts((prev) => {
        if (!prev || prev.some((a) => a.id === dropped.alert.id)) return prev;
        const next = [...prev];
        next.splice(Math.min(dropped.index, next.length), 0, dropped.alert);
        return next;
      });
      setNote({ text: t("dismissFailed"), tone: "error" });
    };
    try {
      const r = await fetch("/api/rediscovery/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) restore();
    } catch {
      // A transport failure is the same outcome as a rejected one: the server still
      // holds the alert, so the view must not claim otherwise.
      restore();
    }
  };

  const addToPipeline = async (a: Alert) => {
    if (pending.has(a.candidateId) || added.has(a.candidateId)) return;
    setPending((p) => new Set(p).add(a.candidateId));
    setRowError((m) => {
      const next = new Map(m);
      next.delete(a.candidateId);
      return next;
    });
    const res = await postPipelineAdd(a.jobId, a.jobTitle, {
      candidateId: a.candidateId,
      candidateLabel: a.label,
      archetype: a.archetype,
      matchScore: a.score,
      source: "rediscovery",
    });
    setPending((p) => {
      const next = new Set(p);
      next.delete(a.candidateId);
      return next;
    });
    const addReason = res.ok ? "" : capabilityAwareReason(errMsg, res, t("addFailed"));
    // bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #4): route the outcome
    // through the pure transition, then HONOR its dismiss timing. On success the row is
    // KEPT so the green "Added ✓" badge actually renders, and dismissed only after a
    // beat — pre-fix the row was filtered out in the same tick, so the badge branch was
    // unreachable dead code and the candidate vanished with no confirmation. Each slice
    // derives from the LATEST state (functional updater) so a second in-flight add of a
    // different candidate can't drop the first.
    //
    // The transition takes a message, so it is handed the LOCALIZED one: the fold
    // happens here (where the bound resolver lives) and jobsRediscoveryAdd stays the
    // pure state machine it is, with no opinion about language.
    const outcome = res.ok
      ? res
      : { ok: false as const, message: addReason };
    setAdded((s) => applyAddResult({ added: s, rowError: new Map() }, a.candidateId, outcome).added);
    setRowError((m) => applyAddResult({ added: new Set(), rowError: m }, a.candidateId, outcome).rowError);
    const { dismiss: timing } = applyAddResult({ added: new Set(), rowError: new Map() }, a.candidateId, outcome);
    if (timing === "deferred") {
      window.setTimeout(() => dismiss(a.id), ADDED_BADGE_MS);
    }
  };

  return { t, alerts, loadFailed, retryLoad, sweeping, note, added, pending, rowError, sweep, dismiss, addToPipeline };
}
