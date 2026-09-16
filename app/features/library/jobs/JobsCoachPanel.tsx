"use client";

import { AlertTriangle, ListChecks, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { jdSlugOfJobId } from "@/app/_lib/jd-limits";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { EmptyState } from "./JobsShared";
import { buildCoachEditParam, COACH_EDIT_PARAM, type CoachEditKind } from "./jobsCoachApply";
import { CoachLedger } from "./coach/CoachLedger";
import { useRolePatterns } from "./coach/useRolePatterns";
import type { RolePattern } from "./coach/rolePatterns";

// The role coach, rebuilt as a LEDGER OF PATTERNS (replacing the winnability verdict
// banner). The grade underneath is the same production scorer — what changed is what
// the recruiter does with it: every finding the pool shows against the role is a row
// they can WEIGH on a three-level scale, and the weighting is durable per (role, team)
// instead of being re-decided from scratch on every visit.
//
// One layout (coach/CoachLedger.tsx): the 2026-09 prototype round's Ledger as the
// baseline, fused with the Dial variant's notched priority control. The Stack and
// Dial layouts did not survive the round.

export function CoachPanel({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const t = useTranslations("jobs.coach");
  // The cap admission is the candidates ranking's sentence, read from ITS namespace
  // rather than copied into this one: the coach grades the same capped pool, so the
  // two surfaces must never drift into two different accounts of the same cap.
  const tc = useTranslations("jobs.candidates");
  const router = useRouter();
  const search = useSearchParams();
  const { patterns, win, priorities, loading, error, saveError, reload, setPriority } = useRolePatterns(jobId);

  // The coach never mutates the job. A "loosen this" row can hand off into the
  // EXISTING JD editor with the change STAGED for the recruiter to confirm; only
  // JD-backed jobs (id `jd-<slug>`) have an editable description, so the affordance
  // is honestly absent on a seeded/corpus role. Nothing auto-saves.
  const jdSlug = jdSlugOfJobId(jobId);
  const EDIT_KIND: Record<string, CoachEditKind> = { language: "language", education: "education", skill: "mustHave" };
  const stageEdit = (pattern: RolePattern) => {
    const kind = EDIT_KIND[pattern.kind];
    if (!jdSlug || !kind) return;
    const param = buildCoachEditParam({ kind, slug: jdSlug, delta: pattern.gain, value: pattern.value });
    if (!param) return;
    router.push(buildUrl({ tab: "library", ...clearedTabScopedParams(), [COACH_EDIT_PARAM]: param }, search.toString()));
  };

  if (error) {
    return (
      <div className="text-base text-coral">
        {error}{" "}
        <button type="button" onClick={reload} className="focus-ring cursor-pointer underline hover:text-ink">
          {t("retry")}
        </button>
      </div>
    );
  }
  if (loading)
    // Multi-second CLI grade: reserve the shape quietly (no skeleton bars) — the short
    // copy line is the only signal, per docs/design/loading-choreography.md.
    return (
      <div className="reveal-quiet min-h-[14rem] space-y-3" aria-busy="true">
        <p className="text-sm text-steel">{t("grading")}</p>
      </div>
    );
  if (!win || win.poolSize === 0) {
    return <EmptyState icon={Users} title={t("emptyPoolTitle")} body={t("emptyPoolBody")} />;
  }

  const skippedCount = win.skipped?.length ?? 0;
  return (
    <div className="space-y-4">
      <p className="text-base text-ink">{t("intro", { jobTitle })}</p>

      {win.poolTruncated ? (
        <p className={`${PANEL_SUNKEN} px-3 py-2 text-sm text-steel`}>{tc("poolTruncatedNote")}</p>
      ) : null}

      {skippedCount > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-dial-amber/40 bg-dial-amber/10 px-3 py-2 text-base text-ink">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-dial-amber" aria-hidden />
          <p>{t("notAssessed", { n: skippedCount })}</p>
        </div>
      ) : null}

      {saveError ? (
        <p role="status" className="rounded-lg border border-coral/40 bg-coral/5 px-3 py-2 text-base text-coral">
          {saveError}
        </p>
      ) : null}

      {patterns.length === 0 ? (
        <EmptyState icon={ListChecks} title={t("noPatternsTitle")} body={t("noPatternsBody")} />
      ) : (
        <CoachLedger patterns={patterns} priorities={priorities} win={win} onPriority={setPriority} onEdit={jdSlug ? stageEdit : null} />
      )}

      <p className="text-meta text-steel">{t("footnote")}</p>
    </div>
  );
}
