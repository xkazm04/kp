"use client";

// Settings → Hiring — the hiring-pipeline composer (the "Matrix" control board,
// winner of the /prototype round, 2026-08-10): how this workspace combines AI
// and human interview rounds and where humans approve, with the impact strip
// narrating what the composed plan does to Overview / Decisions / Schedule.
//
// PERSISTENCE, save-gated on purpose: edits accumulate as a local DRAFT and
// nothing is stored until the recruiter presses Save — a stray click on a
// preset chip or a gate toggle can never silently override the workspace's
// live policy. Dirty state is structural (planEqualsStored), Discard restores
// the last-saved plan, and the plan persists as the "interviewPlan" phase of
// the tiered decision-config store (team override tier) through the existing
// operator-gated /api/decisions/config route.
import { useEffect, useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { EYEBROW, INTRO, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { InterviewPlanRule } from "@/app/_lib/decision-config-schema";
import { fromStoredPlan, planEqualsStored, toStoredPlan, type PipelinePlan } from "./pipelineComposerModel";
import { PlanImpactStrip } from "./PipelineComposerBits";
import { PipelineComposerMatrix } from "./PipelineComposerMatrix";

export function HiringTab() {
  const t = useTranslations("hiringPlan");
  const errMsg = useErrorMessage();
  const [plan, setPlan] = useState<PipelinePlan | null>(null);
  // The last-saved wire shape — the dirty baseline Discard restores.
  const [saved, setSaved] = useState<InterviewPlanRule | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/decisions/config")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((p) => {
        if (!alive) return;
        const rule = (p.configs?.interviewPlan as InterviewPlanRule | undefined) ?? null;
        if (!rule) throw new Error();
        setSaved(rule);
        setPlan(fromStoredPlan(rule));
      })
      .catch(() => alive && setLoadFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const dirty = plan != null && saved != null && !planEqualsStored(plan, saved);

  const save = async () => {
    if (!plan || saving) return;
    setSaving(true);
    try {
      const config = toStoredPlan(plan);
      const r = await fetch("/api/decisions/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Team-tier override: this workspace's own plan, not the org baseline.
        body: JSON.stringify({ phase: "interviewPlan", config, scope: "team" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(errMsg(d, t("saveFailed")));
      const stored = (d.configs?.interviewPlan as InterviewPlanRule | undefined) ?? config;
      setSaved(stored);
      // Adopt the server's validated/normalized plan so the draft can't drift
      // from what was actually persisted (e.g. a clamped topN).
      setPlan(fromStoredPlan(stored));
      toast.success(t("savedToast"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stagger-children space-y-6">
      <header>
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <h2 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h2>
        <p className={`mt-1 max-w-2xl ${INTRO}`}>{t("intro")}</p>
      </header>

      {loadFailed ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-base text-red-700">{t("loadFailed")}</p>
      ) : plan == null ? (
        <div className="reveal-quiet min-h-[20rem]" aria-hidden />
      ) : (
        <>
          <PipelineComposerMatrix plan={plan} onChange={setPlan} />

          {/* Save bar — the plan is a DRAFT until saved; nothing overrides the
              live policy on a stray click. */}
          <div className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 ${dirty ? "border-amber-300 bg-amber-50" : "border-stone-200 bg-paper/50"}`}>
            <span className={`text-sm ${dirty ? "font-semibold text-amber-800" : "text-steel"}`} role="status">
              {dirty ? t("unsaved") : t("allSaved")}
            </span>
            <span className="ml-auto flex items-center gap-2">
              {dirty ? (
                <button
                  type="button"
                  onClick={() => saved && setPlan(fromStoredPlan(saved))}
                  disabled={saving}
                  className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-steel hover:bg-stone-100 hover:text-ink disabled:opacity-50"
                >
                  <RotateCcw size={13} aria-hidden /> {t("discard")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void save()}
                disabled={!dirty || saving}
                className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-moss px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Save size={13} aria-hidden />}
                {saving ? t("saving") : t("save")}
              </button>
            </span>
          </div>

          <PlanImpactStrip plan={plan} />
        </>
      )}
    </div>
  );
}
