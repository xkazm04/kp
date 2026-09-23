// State + data flow for JobsRediscoveryFeed.tsx — extracted verbatim (no
// behaviour change) so the feed file stays under the 200-line split threshold.
// Owns: the initial alerts load (with abort-on-unmount), the on-demand sweep,
// per-row dismiss, and the add-to-pipeline / reach-out outcome transitions. Outcomes
// are keyed by PAIR (person x role): the feed renders one row per person, and a
// person-keyed "added" once badged every role she cleared after one add.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { postPipelineAdd } from "@/app/_lib/useAddToPipeline";
import { postReachOut } from "@/app/_lib/useReachOut";
import { capabilityAwareReason, useErrorMessage } from "@/app/_lib/use-error-message";
// bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #4): the add-outcome
// transition (keep the row + badge it "Added ✓", THEN dismiss after a beat) lives in
// this pure sibling so the previously-dead success branch is reachable and testable.
import { applyAddResult, ADDED_BADGE_MS } from "./jobsRediscoveryAdd";
// The reversible-dismiss transitions, pure + pinned by jobsRediscoveryDismiss.test.ts.
import { extractRow, restoreRow, type RemovedRow } from "./jobsRediscoveryDismiss";
import { applyReachOut, emptyOutcomes, isActionable, markPair, pairKey, pairStatus } from "./jobsRediscoveryFeedGroups";
// What the sweep should SAY it did — pure, so "0 new matches" and "every ranking
// broke" can never render as the same reassuring green line.
import { sweepNote } from "./jobsRediscoverySweepNote";
import type { Alert } from "./jobsRediscoveryFeedTypes";

/** A status line plus the tone it must be painted in. A failure rendered in this
 *  app's "it worked" green is a lie the recruiter acts on, so the producer of the
 *  line — not a string comparison at the render site — declares which it is. */
export type FeedNote = { text: string; tone: "ok" | "error" };

export function useRediscoveryFeedLogic() {
  const t = useTranslations("jobs.rediscoveryFeed");
  // The reach-out refusal sentences are the ones every sourcing surface already
  // speaks (useReachOut), not a forked copy.
  const tReach = useTranslations("pipeline.reachOut");
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
  const [outcomes, setOutcomes] = useState(emptyOutcomes);
  // Keyed by pairKey(candidateId, jobId), like every outcome.
  const [rowError, setRowError] = useState<Map<string, string>>(() => new Map());
  const abortRef = useRef<AbortController | null>(null);
  // The "Added ✓" badge is held for a beat, then the row auto-dismisses on a
  // timer. That timer outlived the panel: switch tabs inside the beat and it
  // still fired, running a PATCH plus setAlerts/setNote into an unmounted tree —
  // and on failure it painted a rollback note nobody could see. Every deferred
  // dismiss is registered here and cleared on teardown.
  const dismissTimers = useRef<Set<number>>(new Set());
  useEffect(
    () => () => {
      for (const id of dismissTimers.current) window.clearTimeout(id);
      dismissTimers.current.clear();
    },
    []
  );

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
        | { alerts?: Alert[]; newAlerts?: number; jobsSwept?: number; failedJobs?: number }
        | null;
      if (r.ok && body?.alerts) {
        setAlerts(body.alerts);
        // A successful sweep is also the answer to a failed initial load.
        setLoadFailed(false);
        const n = sweepNote(body);
        setNote({
          // One line per key the fold selected, in its order: what the sweep found,
          // then — only when roles actually failed — that the list is incomplete.
          text: n.keys
            .map((k) =>
              k === "noPublished"
                ? t("noPublished")
                : k === "swept"
                  ? t("swept", { jobs: n.jobs, found: n.found })
                  : t("sweptIncomplete", { count: n.failed })
            )
            .join(" "),
          tone: n.tone,
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

  // `acted` is set only for the DEFERRED dismiss that follows a successful add or
  // reach-out. It is what the rollback needs in order to undo that pair's done
  // badge: a restored row that kept its badge rendered a green success and a red
  // "couldn't dismiss" at once, and the recruiter had to guess which was true.
  const dismiss = async (id: string, acted?: Alert) => {
    // Optimistic, and REVERSIBLE. The row is dropped immediately, but the
    // position it was dropped from is remembered: a PATCH that never lands (or
    // answers non-OK) used to leave the recruiter with a candidate silently gone
    // from the view and still open on the server, resurfacing on the next reload
    // with no explanation. On failure the row goes back where it was and the panel
    // says the dismissal did not stick.
    let removed: RemovedRow<Alert> | null = null;
    setAlerts((prev) => {
      const out = extractRow(prev, id);
      removed = out.removed;
      return out.next;
    });
    const restore = () => {
      const dropped = removed as RemovedRow<Alert> | null;
      if (!dropped) return;
      setAlerts((prev) => restoreRow(prev, dropped));
      // One truth per row: the badge goes back with the row.
      if (acted) setOutcomes((s) => markPair(s, acted.candidateId, acted.jobId, "open"));
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

  // Clear one pair's error line before a retry.
  const clearError = (key: string) =>
    setRowError((m) => {
      if (!m.has(key)) return m;
      const next = new Map(m);
      next.delete(key);
      return next;
    });

  // A done pair keeps its badge for a beat, then leaves the list. Registered so an
  // unmount inside the beat cancels it (see dismissTimers); the pair travels with
  // it so a failed PATCH can undo the badge. Only THIS pair's alert is dismissed:
  // the person's other roles stay on her row, still actionable.
  const deferDismiss = (a: Alert) => {
    const timer = window.setTimeout(() => {
      dismissTimers.current.delete(timer);
      void dismiss(a.id, a);
    }, ADDED_BADGE_MS);
    dismissTimers.current.add(timer);
  };

  const addToPipeline = async (a: Alert) => {
    if (!isActionable(pairStatus(outcomes, a.candidateId, a.jobId))) return;
    const key = pairKey(a.candidateId, a.jobId);
    setOutcomes((s) => markPair(s, a.candidateId, a.jobId, "pending"));
    clearError(key);
    const res = await postPipelineAdd(a.jobId, a.jobTitle, {
      candidateId: a.candidateId,
      candidateLabel: a.label,
      archetype: a.archetype,
      matchScore: a.score,
      source: "rediscovery",
    });
    const addReason = res.ok ? "" : capabilityAwareReason(errMsg, res, t("addFailed"));
    // bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #4): route the outcome
    // through the pure transition, then HONOR its dismiss timing. On success the row is
    // KEPT so the green "Added ✓" badge actually renders, and dismissed only after a
    // beat. The transition takes the LOCALIZED message (the fold happens here, where
    // the bound resolver lives) and is keyed by the pair, not the person.
    const outcome = res.ok
      ? res
      : { ok: false as const, message: addReason };
    setOutcomes((s) => markPair(s, a.candidateId, a.jobId, res.ok ? "added" : "error"));
    setRowError((m) => applyAddResult({ added: new Set(), rowError: m }, key, outcome).rowError);
    const { dismiss: timing } = applyAddResult({ added: new Set(), rowError: new Map() }, key, outcome);
    if (timing === "deferred") deferDismiss(a);
  };

  // Reach out from the feed itself: the route files the person into THIS role's
  // pipeline and sends the first-touch message in one call, so contacting a
  // surfaced person no longer means opening the role and re-finding her in its
  // Rediscover panel. The verdict is classified (reachOutVerdict) before anything
  // claims a message went out.
  const reachOut = async (a: Alert) => {
    if (!isActionable(pairStatus(outcomes, a.candidateId, a.jobId))) return;
    const key = pairKey(a.candidateId, a.jobId);
    setOutcomes((s) => markPair(s, a.candidateId, a.jobId, "pending"));
    clearError(key);
    const result = await postReachOut(a.jobId, {
      candidateId: a.candidateId,
      candidateLabel: a.label,
      archetype: a.archetype,
      matchScore: a.score,
      source: "rediscovery",
    });
    // An anonymization refusal withholds every role on her row; any other verdict
    // moves only this pair (applyReachOut).
    setOutcomes((s) => applyReachOut(s, a.candidateId, a.jobId, result));
    if (result.ok) {
      deferDismiss(a);
      return;
    }
    const reason = result.suppression
      ? tReach(`suppressed.${result.suppression}`)
      : capabilityAwareReason(errMsg, result, tReach("failed", { name: a.label }));
    setRowError((m) => new Map(m).set(key, reason));
  };

  return { t, alerts, loadFailed, retryLoad, sweeping, note, outcomes, rowError, sweep, dismiss, addToPipeline, reachOut };
}
