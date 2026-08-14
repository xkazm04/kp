"use client";

// Shared controls + the impact strip for the hiring-pipeline composer (the
// "Matrix" control board — winner of the /prototype round, 2026-08-10). The
// impact strip is the surface's core promise: every change immediately
// narrates what Overview, Decisions and Schedule will look like under the
// composed plan — the recruiter composes consequences, not abstract config.
import { Bot, CalendarClock, LayoutDashboard, Scale, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { DEFAULT_STAGE_AXIS, type StageDef } from "@/app/_lib/pipeline-stages";
import { deriveImpact, type GateMode, type PipelinePlan, type RoundKind } from "./pipelineComposerModel";

export function GateToggle({ value, onChange, compact = false }: { value: GateMode; onChange: (v: GateMode) => void; compact?: boolean }) {
  const t = useTranslations("hiringPlan");
  const pad = compact ? "px-1.5 py-0.5" : "px-2 py-1";
  return (
    <span className={TOGGLE_GROUP} role="group" aria-label={t("gateAria")}>
      <button type="button" aria-pressed={value === "human"} onClick={() => onChange("human")} className={`focus-ring rounded ${pad} text-sm font-semibold ${toggleBtn(value === "human")}`}>
        {t("gateHuman")}
      </button>
      <button type="button" aria-pressed={value === "auto"} onClick={() => onChange("auto")} className={`focus-ring rounded ${pad} text-sm font-semibold ${toggleBtn(value === "auto")}`}>
        {t("gateAuto")}
      </button>
    </span>
  );
}

export function KindToggle({ value, onChange }: { value: RoundKind; onChange: (v: RoundKind) => void }) {
  const t = useTranslations("hiringPlan");
  return (
    <span className={TOGGLE_GROUP} role="group" aria-label={t("kindAria")}>
      <button type="button" aria-pressed={value === "ai"} onClick={() => onChange("ai")} className={`focus-ring inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-semibold ${toggleBtn(value === "ai")}`}>
        <Bot size={12} aria-hidden /> {t("kindAi")}
      </button>
      <button type="button" aria-pressed={value === "human"} onClick={() => onChange("human")} className={`focus-ring inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-semibold ${toggleBtn(value === "human")}`}>
        <UserRound size={12} aria-hidden /> {t("kindHuman")}
      </button>
    </span>
  );
}

/** Cohort reducer select: "everyone advancing" ↔ top-N. */
export function TopNControl({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const t = useTranslations("hiringPlan");
  return (
    <span className="inline-flex items-center gap-1 text-sm text-steel">
      <select
        value={value == null ? "all" : String(value)}
        onChange={(e) => onChange(e.target.value === "all" ? null : Number(e.target.value))}
        className="focus-ring rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-sm text-ink"
        aria-label={t("cohortAria")}
      >
        <option value="all">{t("cohortEveryone")}</option>
        {[2, 3, 5, 8].map((n) => (
          <option key={n} value={n}>
            {t("cohortTopN", { n })}
          </option>
        ))}
      </select>
    </span>
  );
}

// ---- Impact strip ----------------------------------------------------------

function ImpactPanel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        {icon} {title}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

export function PlanImpactStrip({ plan, axis = DEFAULT_STAGE_AXIS }: { plan: PipelinePlan; axis?: readonly StageDef[] }) {
  const t = useTranslations("hiringPlan.impact");
  // The board's OWN stage labels (enums.stage.*) — the same catalog PipelineBoard
  // renders its column headers from. The strip used to have a private label set
  // (ovScreened / ovAiInterview / …) naming stations the board does not have,
  // which is why Settings and Overview read as two unrelated products.
  const enumLabel = useEnumLabel();
  // A workspace-renamed column shows its own words; a shipped one stays localized.
  const stationLabel = (id: string): string => {
    const stage = axis.find((s) => s.id === id);
    return stage && stage.label !== stage.id ? stage.label : enumLabel("stage", id);
  };
  const impact = deriveImpact(plan, axis);
  const decLabel: Record<string, string> = {
    screening_review: t("decScreening"),
    ai_scorecard_review: t("decAiScorecard"),
    human_scorecard_review: t("decHumanScorecard"),
    offer_review: t("decOffer"),
  };
  return (
    <section aria-label={t("heading")}>
      <p className="text-meta uppercase tracking-wide text-steel">{t("heading")}</p>
      <div className="mt-2 grid gap-3 lg:grid-cols-3">
        <ImpactPanel icon={<LayoutDashboard size={12} className="text-coral" aria-hidden />} title={t("overview")}>
          {/* One chip per REAL board column, in board order, tinted by whether this
              plan runs anything there. A column carrying rounds gets them listed
              underneath — that is how the default plan's two rounds in one
              Interview column become visible instead of imaginary. */}
          {impact.overview.map((station, i) => (
            <span key={station.stageId} className="inline-flex items-center gap-1.5">
              {i > 0 ? (
                <span className="text-steel/50" aria-hidden>
                  →
                </span>
              ) : null}
              <span
                className={`rounded-full px-2 py-0.5 text-sm font-semibold ${
                  station.rounds.length > 0 ? "bg-coral/10 text-coral" : "bg-stone-100 text-steel"
                }`}
              >
                {stationLabel(station.stageId)}
                {station.rounds.length > 0 ? (
                  <span className="ml-1 font-normal">
                    {station.rounds.map((kind) => (kind === "ai" ? t("roundAi") : t("roundHuman"))).join(" → ")}
                  </span>
                ) : null}
              </span>
            </span>
          ))}
        </ImpactPanel>
        <ImpactPanel icon={<Scale size={12} className="text-coral" aria-hidden />} title={t("decisions")}>
          {impact.decisions.length === 0 ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-sm font-semibold text-amber-800">{t("decNone")}</span>
          ) : (
            impact.decisions.map((d, i) => (
              <span key={i} className="rounded-full bg-stone-100 px-2 py-0.5 text-sm font-semibold text-ink">
                {decLabel[d]}
              </span>
            ))
          )}
          <span className="nums w-full text-sm text-steel">{t("touchpoints", { count: impact.humanTouchpoints })}</span>
        </ImpactPanel>
        <ImpactPanel icon={<CalendarClock size={12} className="text-coral" aria-hidden />} title={t("schedule")}>
          {impact.schedule.aiRound ? (
            <span className="rounded-full bg-coral/10 px-2 py-0.5 text-sm font-semibold text-coral">{t("schAiDocket")}</span>
          ) : null}
          {impact.schedule.humanRound ? (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-sm font-semibold text-blue-700">{t("schCalendar")}</span>
          ) : null}
          {!impact.schedule.aiRound && !impact.schedule.humanRound ? (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-sm text-steel">{t("schNone")}</span>
          ) : null}
        </ImpactPanel>
      </div>
    </section>
  );
}
