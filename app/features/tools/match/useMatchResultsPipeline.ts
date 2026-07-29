// Add-to-pipeline (single + bulk) state and network calls, split out of
// MatchResults.tsx: owns the per-role added/adding/error sets, the bulk-select
// ledger, and the compare-toggle, so the component only wires them to markup.
import { useState } from "react";
import type { useTranslations } from "next-intl";
import { matchScoreForPipeline } from "@/app/features/shared/matchTypes";
import type { MatchResponse, MatchResult } from "@/app/features/shared/matchTypes";

type Translator = ReturnType<typeof useTranslations>;

export function useMatchResultsPipeline(args: {
  t: Translator;
  candidateId: string;
  candidate: MatchResponse["candidate"];
  archetype: string;
  matches: MatchResult[];
  onFiled?: (jobId: string, jobTitle: string, entryId: string) => void;
}) {
  const { t, candidateId, candidate, archetype, matches, onFiled } = args;
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  // Bulk shortlist: which roles are ticked, and whether a batch add is running.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // MAT5: compare the ticked roles side by side (reuses the same selection).
  const [comparing, setComparing] = useState(false);

  // Add this candidate to one role's pipeline. Returns whether it landed, so the
  // bulk runner can keep only the failures selected for a retry.
  const addToPipeline = async (m: MatchResult): Promise<boolean> => {
    if (!candidateId || added.has(m.jobId) || adding.has(m.jobId)) return false;
    setAdding((s) => new Set(s).add(m.jobId));
    // Clear any prior failure so a retry doesn't show a stale banner.
    setErrors((e) => {
      if (!e.has(m.jobId)) return e;
      const n = new Map(e);
      n.delete(m.jobId);
      return n;
    });
    try {
      const r = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          candidateLabel: candidate.label,
          archetype,
          roleFamily: m.roleFamily,
          jobId: m.jobId,
          jobTitle: m.title,
          // Write the FRESH match recompute back as the entry's snapshot so it stops
          // diverging from the never-updated stored score; null-honest (a non-finite
          // total is stored absent, never as a fabricated 0). source:"match" stamps
          // where it came from.
          matchScore: matchScoreForPipeline(m.total),
          stage: "Screened",
          source: "match",
          // shortlist-to-group-eval — a Match add files the candidate as a pending
          // KEY DECISION, so shortlisted candidates land in the Decisions cohort
          // (RoleDecisionRow) where the group-eval comparison lives. Match is the
          // ONLY add path that requests this; the route validates the closed set.
          approvalKind: "decision",
        }),
      });
      if (r.ok) {
        setAdded((s) => new Set(s).add(m.jobId));
        // Record the filed entry in the session ledger so the "Compare N in group
        // eval" handoff can form across candidates. Only a confirmed decision-gated
        // entry counts: an idempotent re-add can return a pre-existing entry that
        // never entered the Decisions cohort, and counting it would promise a
        // comparison the pre-arm would silently drop.
        const payload = (await r.json().catch(() => null)) as {
          entry?: { id?: unknown; approvalKind?: unknown };
        } | null;
        const entry = payload?.entry;
        if (onFiled && entry && typeof entry.id === "string" && entry.approvalKind === "decision") {
          onFiled(m.jobId, m.title, entry.id);
        }
        return true;
      }
      const payload = await r.json().catch(() => null);
      const message = (payload as { error?: string } | null)?.error ?? t("addFailedStatus", { status: r.status });
      setErrors((e) => new Map(e).set(m.jobId, message));
      return false;
    } catch {
      setErrors((e) => new Map(e).set(m.jobId, t("addFailedNetwork")));
      return false;
    } finally {
      setAdding((s) => {
        const n = new Set(s);
        n.delete(m.jobId);
        return n;
      });
    }
  };

  // Roles this candidate isn't already filed under — the only ones worth selecting.
  const addableMatches = matches.filter((m) => !added.has(m.jobId));

  const toggleSelect = (jobId: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(jobId)) n.delete(jobId);
      else n.add(jobId);
      return n;
    });

  const shortlistTop = (n: number) => setSelected(new Set(addableMatches.slice(0, n).map((m) => m.jobId)));

  // File the candidate under every ticked role in one go (sequentially, so the
  // per-card added/adding/error state stays coherent). Failures are kept selected
  // for a one-click retry; successes drop out via the local `failed` set (React
  // state is async, so we can't read `added` mid-loop).
  const addSelected = async () => {
    if (bulkBusy) return;
    setBulkBusy(true);
    const targets = matches.filter((m) => selected.has(m.jobId) && !added.has(m.jobId));
    const failed = new Set<string>();
    for (const m of targets) {
      const ok = await addToPipeline(m);
      if (!ok) failed.add(m.jobId);
    }
    setSelected(failed);
    setBulkBusy(false);
  };

  return {
    added, adding, errors,
    selected, setSelected,
    bulkBusy,
    comparing, setComparing,
    addableMatches,
    addToPipeline,
    toggleSelect,
    shortlistTop,
    addSelected,
  };
}
