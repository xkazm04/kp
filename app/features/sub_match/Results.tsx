"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { MatchRef, MatchResponse, MatchResult } from "./MatchTypes";
import { archetypeDisplayKey, isEarlyCareer, matchScoreForPipeline } from "./MatchTypes";
import { Chip, KoReasonsNote, NoMatchesExplainer, useMatchLabels } from "./MatchShared";
import { MatchCard } from "./MatchCard";
import { WeightsPanel } from "./WeightsPanel";
import { JobCompare } from "./JobCompare";
import { buildUrl } from "@/app/features/tabs";
import { ARM_PARAM, buildArmParam } from "@/app/features/sub_decisions/group-eval-arm";
import { GROUP_EVAL_CAP } from "@/app/_lib/group-eval-cohort";
import { Download, RefreshCw, Scale, Sparkles } from "lucide-react";
import { PotentialBadge } from "@/app/_components/PotentialBadge";
import { downloadFile, toCsv } from "@/app/_lib/export-utils";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { WeightVector } from "./MatchTypes";

// Below this many survivors the result reads as "thin", so we name the dominant KO
// blocker inline; a full corpus that simply hits the limit shouldn't trigger it.
const THIN_RESULT_MAX = 4;

export function Results({
  result,
  matchRef,
  loading = false,
  error = null,
  staleness = null,
  onReweight,
  filed,
  onFiled,
}: {
  result: MatchResponse;
  matchRef: MatchRef;
  // MAT1: re-run the match with a recruiter weight override (undefined = reset to
  // the archetype baseline). Omitted where re-weighting isn't wired.
  loading?: boolean;
  // A re-rank/re-weight that failed while this (still-valid) ranking is on screen:
  // shown as a non-destructive banner ABOVE the results, never replacing them.
  error?: string | null;
  // Profile ↔ CV staleness: set when this ranking is for a profile-sourced candidate
  // whose source CV has a NEWER analysis. Null for analysis-sourced runs and
  // hand-built profiles (never stale) ⇒ no badge, no chrome.
  staleness?: { newerSlug: string; newerAnalyzedAt: string } | null;
  onReweight?: (weights?: WeightVector) => void;
  // shortlist-to-group-eval — the cross-candidate session ledger (owned by
  // MatchTab; this component remounts per candidate) of pipeline entries filed
  // from Match, keyed by jobId. Roles with ≥ 2 entries surface the
  // "Compare N in group eval" handoff banner; onFiled records each successful,
  // decision-gated add's entry id. Both optional so Results renders unchanged
  // where the handoff isn't wired.
  filed?: Record<string, { jobTitle: string; entryIds: string[] }>;
  onFiled?: (jobId: string, jobTitle: string, entryId: string) => void;
}) {
  const t = useTranslations("match.results");
  const { assumptions: assumptionLabels } = useMatchLabels();
  const enumLabel = useEnumLabel();
  const router = useRouter();
  const { candidate, meta, matches } = result;
  // The routing value we CARRY (posted to the pipeline, passed to MatchCard, fed to
  // isEarlyCareer): honour the matcher's fail-closed "unknown" sentinel instead of
  // fabricating "bau" — "bau" would strip the fairness shield off an unrouted
  // (student/switcher/unclassified) candidate downstream. The chip below shows this
  // honestly as "Unrouted", never "Experienced".
  const archetype = candidate.archetype ?? "unknown";
  const early = isEarlyCareer(archetype);

  const candidateId = matchRef.profileId ?? matchRef.analysisSlug ?? "";
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

  // Export the ranking as CSV (Theme C) — a hiring decision happens in a meeting
  // or email thread outside the app, so the ranking has to be able to leave it.
  // Built entirely from data already on screen; no backend call.
  const exportCsv = () => {
    const header = [t("csv.rank"), t("csv.role"), t("csv.company"), t("csv.score"), t("csv.confLow"), t("csv.confHigh"), t("csv.fitTier"), t("csv.matchedSkills"), t("csv.missingSkills")];
    const rows = matches.map((m, i) => [
      i + 1,
      m.title,
      m.company ?? "",
      m.total,
      m.confidence.low,
      m.confidence.high,
      m.fitTier,
      (m.matchedSkills ?? []).join("; "),
      (m.missingSkills ?? []).join("; "),
    ]);
    const safe = (candidate.label ?? "candidate").replace(/[^\w-]+/g, "_").slice(0, 60) || "candidate";
    downloadFile(`matches-${safe}.csv`, toCsv([header, ...rows]), "text/csv");
  };

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

  return (
    <div>
      {/* Non-destructive re-rank error: the results below are the last good ranking. */}
      {error ? (
        <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {staleness && matchRef.profileId ? (
        // Profile ↔ CV staleness: this ranking is off a profile built from an older
        // CV than a newer analysis on file. Neutral (amber) banner + one-click
        // rebuild-from-latest so the recruiter isn't ranking on a stale snapshot.
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <RefreshCw size={14} aria-hidden />
          <span className="font-semibold">{t("staleBanner")}</span>
          <span className="text-amber-700">
            {t("staleBannerDetail", { date: new Date(staleness.newerAnalyzedAt).toLocaleDateString() })}
          </span>
          <button
            type="button"
            onClick={() =>
              router.push(buildUrl({ tab: "profile", fromAnalysis: staleness.newerSlug, rebuild: matchRef.profileId! }, ""))
            }
            className="focus-ring ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100"
          >
            <RefreshCw size={13} /> {t("staleRebuild")}
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Chip label={t("chipCandidate")} value={candidate.label ?? "—"} />
        <Chip label={t("chipArchetype")} value={enumLabel("archetype", archetypeDisplayKey(archetype))} tone={early ? "green" : "neutral"} />
        <Chip label={t("chipProfile")} value={`${candidate.roleFamily ? enumLabel("family", candidate.roleFamily) : "—"} / ${candidate.seniority ?? "—"}`} />
        <Chip label={t("chipEvaluated")} value={meta.evaluated ?? 0} />
        <Chip label={t("chipKoFiltered")} value={meta.koFiltered ?? 0} tone="amber" />
        <Chip label={t("chipRanked")} value={meta.returned ?? matches.length} tone="green" />
        {early && candidate.potentialScore != null ? (
          <PotentialBadge
            potential={{
              score: candidate.potentialScore,
              learningSignals: candidate.learningSignals,
              transferableSkills: candidate.transferableSkills,
              domainDistance: candidate.domainDistance,
            }}
          />
        ) : null}
        {matches.length > 0 ? (
          <button
            type="button"
            onClick={exportCsv}
            className="focus-ring ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-sm font-semibold text-ink hover:bg-paper"
          >
            <Download size={14} className="text-steel" /> {t("exportCsv")}
          </button>
        ) : null}
      </div>
      {early ? (
        <p className="mt-2 text-sm text-steel">
          {t.rich("earlyNote", { b: (chunks) => <strong>{chunks}</strong> })}
        </p>
      ) : null}
      {candidate.assumptions?.length ? (
        <p className="mt-1 text-sm text-steel">
          <span className="font-semibold uppercase">{t("assumptions")}</span>{" "}
          {assumptionLabels(candidate.assumptionCodes, candidate.assumptions).join(" · ")}
        </p>
      ) : null}

      {onReweight && candidate.weights && candidate.weightBounds ? (
        <WeightsPanel
          weights={candidate.weights}
          bounds={candidate.weightBounds}
          archetype={archetype}
          busy={loading}
          onApply={(w) => onReweight(w)}
          onReset={() => onReweight(undefined)}
        />
      ) : null}

      {/* shortlist-to-group-eval — the composition moment: once ≥ 2 candidates
          from this session sit in the SAME role's pipeline, offer to compare them
          in the Decisions group eval. Deep-links with the explicit selection
          pre-armed (?job=&arm=, one-shot); the recruiter runs the (paid) eval
          there — this button only navigates. No qualifying role → no banner:
          a 1-candidate "comparison" is a dead affordance. */}
      {(() => {
        const compareReady = Object.entries(filed ?? {}).filter(([, v]) => v.entryIds.length >= 2);
        if (compareReady.length === 0) return null;
        return (
          <div className="mt-4 space-y-2 rounded-md border border-moss/40 bg-moss/5 px-3 py-2">
            {compareReady.map(([jobId, v]) => {
              // Cap client-side like the picker does; the server re-enforces.
              const ids = v.entryIds.slice(0, GROUP_EVAL_CAP);
              return (
                <div key={jobId} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 text-sm text-ink">
                    <strong>{v.jobTitle}</strong>{" "}
                    <span className="text-steel">· {t("groupEvalReady", { count: v.entryIds.length })}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      router.push(buildUrl({ tab: "decisions", job: jobId, [ARM_PARAM]: buildArmParam(ids) }, ""))
                    }
                    className="focus-ring ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-moss/40 bg-white px-2.5 text-sm font-semibold text-moss hover:bg-moss/10"
                  >
                    <Sparkles size={14} /> {t("groupEvalCta", { count: ids.length })}
                  </button>
                </div>
              );
            })}
            <p className="text-meta text-steel">{t("groupEvalHint")}</p>
          </div>
        );
      })()}

      {matches.length === 0 ? (
        <div className="mt-4">
          <NoMatchesExplainer meta={meta} archetype={archetype} />
        </div>
      ) : (
        <>
          {matches.length <= THIN_RESULT_MAX ? (
            <KoReasonsNote koFiltered={meta.koFiltered ?? 0} reasons={meta.koReasons ?? []} />
          ) : null}
          {candidateId && addableMatches.length > 1 ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-stone-200 bg-paper px-3 py-2">
              <span className="text-sm font-semibold text-ink">
                {selected.size > 0 ? t("selectedCount", { count: selected.size }) : t("shortlistRoles")}
              </span>
              <button
                type="button"
                onClick={addSelected}
                disabled={selected.size === 0 || bulkBusy}
                className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-40"
              >
                {bulkBusy ? t("adding") : selected.size > 0 ? t("addN", { count: selected.size }) : t("addToPipeline")}
              </button>
              <button
                type="button"
                onClick={() => shortlistTop(Math.min(5, addableMatches.length))}
                disabled={bulkBusy}
                className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-ink hover:bg-paper disabled:opacity-40"
              >
                {t("shortlistTopN", { n: Math.min(5, addableMatches.length) })}
              </button>
              {/* MAT5: compare the ticked roles side by side (2–4 reads best). */}
              {selected.size >= 2 && selected.size <= 4 ? (
                <button
                  type="button"
                  onClick={() => setComparing((v) => !v)}
                  aria-pressed={comparing}
                  className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold ${
                    comparing ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-ink hover:bg-paper"
                  }`}
                >
                  <Scale size={14} /> {t("compareN", { count: selected.size })}
                </button>
              ) : null}
              {selected.size > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  disabled={bulkBusy}
                  className="focus-ring inline-flex h-8 items-center rounded-md px-2 text-sm font-semibold text-steel hover:text-ink disabled:opacity-40"
                >
                  {t("clear")}
                </button>
              ) : null}
              <span className="text-meta text-steel">{t("tickHint")}</span>
            </div>
          ) : null}
          {comparing && selected.size >= 2 ? (
            <JobCompare matches={matches.filter((m) => selected.has(m.jobId))} onClose={() => setComparing(false)} />
          ) : null}
          <ol className="mt-4 space-y-2">
            {matches.map((m, i) => (
              <MatchCard
                key={m.jobId}
                m={m}
                index={i}
                matchRef={matchRef}
                archetype={archetype}
                canAdd={Boolean(candidateId)}
                added={added.has(m.jobId)}
                adding={adding.has(m.jobId)}
                addError={errors.get(m.jobId)}
                onAdd={() => addToPipeline(m)}
                selectable={Boolean(candidateId)}
                selected={selected.has(m.jobId)}
                onToggleSelect={() => toggleSelect(m.jobId)}
              />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
