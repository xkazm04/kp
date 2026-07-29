// State + data flow for JobsRediscoveryFeed.tsx — extracted verbatim (no
// behaviour change) so the feed file stays under the 200-line split threshold.
// Owns: the initial alerts load (with abort-on-unmount), the on-demand sweep,
// per-row dismiss, and the add-to-pipeline outcome transition.
"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { postPipelineAdd } from "@/app/_lib/useAddToPipeline";
// bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #4): the add-outcome
// transition (keep the row + badge it "Added ✓", THEN dismiss after a beat) lives in
// this pure sibling so the previously-dead success branch is reachable and testable.
import { applyAddResult, ADDED_BADGE_MS } from "./jobsRediscoveryAdd";
import type { Alert } from "./jobsRediscoveryFeedTypes";

export function useRediscoveryFeedLogic() {
  const t = useTranslations("jobs.rediscoveryFeed");
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [rowError, setRowError] = useState<Map<string, string>>(() => new Map());
  const abortRef = useRef<AbortController | null>(null);

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
        setAlerts(r.ok && body?.alerts ? body.alerts : []);
      } catch {
        // An abort (unmount) is expected — only surface a genuine load failure.
        if (alive && !controller.signal.aborted) setAlerts([]);
      }
    })();
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, []);

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
        setNote(
          body.jobsSwept === 0
            ? t("noPublished")
            : t("swept", { jobs: body.jobsSwept ?? 0, found: body.newAlerts ?? 0 })
        );
      } else {
        setNote(t("sweepFailed"));
      }
    } catch {
      setNote(t("sweepFailed"));
    } finally {
      setSweeping(false);
    }
  };

  const dismiss = async (id: string) => {
    // Optimistic: drop it immediately, the PATCH is fire-and-forget recovery.
    setAlerts((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
    try {
      await fetch("/api/rediscovery/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      /* the row's already gone from the view; a reload would resurface it */
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
    // bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #4): route the outcome
    // through the pure transition, then HONOR its dismiss timing. On success the row is
    // KEPT so the green "Added ✓" badge actually renders, and dismissed only after a
    // beat — pre-fix the row was filtered out in the same tick, so the badge branch was
    // unreachable dead code and the candidate vanished with no confirmation. Each slice
    // derives from the LATEST state (functional updater) so a second in-flight add of a
    // different candidate can't drop the first.
    setAdded((s) => applyAddResult({ added: s, rowError: new Map() }, a.candidateId, res).added);
    setRowError((m) => applyAddResult({ added: new Set(), rowError: m }, a.candidateId, res).rowError);
    const { dismiss: timing } = applyAddResult({ added: new Set(), rowError: new Map() }, a.candidateId, res);
    if (timing === "deferred") {
      window.setTimeout(() => dismiss(a.id), ADDED_BADGE_MS);
    }
  };

  return { t, alerts, sweeping, note, added, pending, rowError, sweep, dismiss, addToPipeline };
}
