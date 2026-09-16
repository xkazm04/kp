"use client";

import { useState } from "react";
import { AlertTriangle, ListChecks, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PANEL_SUNKEN, TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";
import { jdSlugOfJobId } from "@/app/_lib/jd-limits";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { EmptyState } from "./JobsShared";
import { buildCoachEditParam, COACH_EDIT_PARAM, type CoachEditKind } from "./jobsCoachApply";
import { CoachDial } from "./coach/CoachDial";
import { CoachLedger } from "./coach/CoachLedger";
import { CoachStack } from "./coach/CoachStack";
import { useRolePatterns } from "./coach/useRolePatterns";
import type { RolePattern } from "./coach/rolePatterns";

// The role coach, rebuilt as a LEDGER OF PATTERNS (replacing the winnability verdict
// banner). The grade underneath is the same production scorer — what changed is what
// the recruiter does with it: every finding the pool shows against the role is a row
// they can WEIGH on a three-level scale, and the weighting is durable per (role, team)
// instead of being re-decided from scratch on every visit.
//
// Three variants sit behind the switcher because the same ledger is read three ways:
// audited (Ledger), sorted (Stack), or tuned against one consequence (Dial). The choice
// is remembered per browser — it is a reading preference, not data.

const VARIANTS = ["ledger", "stack", "dial"] as const;
type Variant = (typeof VARIANTS)[number];
const VARIANT_KEY = "kp.coach.variant";

function isVariant(v: string | null): v is Variant {
  return v !== null && (VARIANTS as readonly string[]).includes(v);
}

/** The remembered layout, or the default. Never throws: a blocked storage jar
 *  (a private window, site data off) costs the memory, never the panel. */
function readVariant(): Variant {
  if (typeof window === "undefined") return "ledger";
  try {
    const stored = window.localStorage.getItem(VARIANT_KEY);
    return isVariant(stored) ? stored : "ledger";
  } catch {
    /* best-effort: storage is unavailable, so the default layout stands */
    return "ledger";
  }
}

export function CoachPanel({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const t = useTranslations("jobs.coach");
  // The cap admission is the candidates ranking's sentence, read from ITS namespace
  // rather than copied into this one: the coach grades the same capped pool, so the
  // two surfaces must never drift into two different accounts of the same cap.
  const tc = useTranslations("jobs.candidates");
  const router = useRouter();
  const search = useSearchParams();
  const { patterns, win, priorities, loading, error, saveError, reload, setPriority } = useRolePatterns(jobId);

  // A LAZY initializer, not a mount effect: reading storage in an effect and calling
  // setState from it is the cascading-render shape react-hooks/set-state-in-effect
  // exists to stop, and this value never changes underneath us. Guarded on `window`
  // so the server render (the panel is dynamically imported, so it can be attempted)
  // takes the default instead of throwing.
  const [variant, setVariant] = useState<Variant>(() => readVariant());
  const pickVariant = (next: Variant) => {
    setVariant(next);
    try {
      window.localStorage.setItem(VARIANT_KEY, next);
    } catch {
      /* best-effort: the choice still applies for this session */
    }
  };

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
  const labels: Record<Variant, string> = {
    ledger: t("variant.ledger"),
    stack: t("variant.stack"),
    dial: t("variant.dial"),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base text-ink">{t("intro", { jobTitle })}</p>
        <div className={TOGGLE_GROUP} role="group" aria-label={t("variant.label")}>
          {VARIANTS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={variant === v}
              onClick={() => pickVariant(v)}
              className={`focus-ring cursor-pointer rounded px-2.5 py-1 text-sm font-semibold transition-colors ${toggleBtn(variant === v)}`}
            >
              {labels[v]}
            </button>
          ))}
        </div>
      </div>

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
      ) : variant === "ledger" ? (
        <CoachLedger patterns={patterns} priorities={priorities} win={win} onPriority={setPriority} onEdit={jdSlug ? stageEdit : null} />
      ) : variant === "stack" ? (
        <CoachStack patterns={patterns} priorities={priorities} win={win} onPriority={setPriority} />
      ) : (
        <CoachDial patterns={patterns} priorities={priorities} win={win} onPriority={setPriority} />
      )}

      <p className="text-meta text-steel">{t("footnote")}</p>
    </div>
  );
}
