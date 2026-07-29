"use client";

// Variant A — "the first day, laid out as a plan".
//
// Metaphor: onboarding is not a folder of admin, it is somebody's FIRST DAY, and
// the template you already own is the plan for it. So the empty state renders the
// plan itself — the active template's real tasks, in their authored order, as an
// unticked agenda, bookended by what happens before day one (the pre-boarding
// questionnaire) and what gets signed. The recruiter reads the day before anyone
// has one, and starting a run is just "give this plan to a person".
//
// Differs from Variant B by looking FORWARD at the experience the new joiner will
// have, rather than at the record the company will hold afterwards.

import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import type { OnboardingTask, QuestionnaireField } from "@/app/_lib/onboarding";
import { ChainEmptyState } from "@/app/_components/ChainEmptyState";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { ONBOARDING_RUN_GLYPH } from "@/app/_components/glyph/glyphs/onboardingRunGlyph";
import { Select } from "@/app/_components/Select";
import {
  BTN_PRIMARY,
  CARD_PAD,
  DIVIDER,
  EYEBROW,
  INTRO,
  META_LABEL,
  PANEL,
  PANEL_SUNKEN,
  TITLE_DISPLAY,
} from "@/app/_components/ui/recipes";

export type WaitingHire = { entryId: string; candidateLabel: string | null; jobTitle: string | null };
export type PlanTemplate = { id: string; name: string; tasks: OnboardingTask[]; questionnaire: QuestionnaireField[] };

// One agenda line of the unticked plan. An empty square, not a checkbox input —
// nothing here is togglable until a run exists.
function PlanStep({ index, label }: { index: number; label: string }) {
  return (
    <li className="flex items-start gap-3 py-1.5">
      <span
        aria-hidden
        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border border-dashed border-stone-300 bg-white text-meta text-steel"
      >
        {index}
      </span>
      <span className="text-base text-ink">{label}</span>
    </li>
  );
}

export function OnboardingEmptyFirstDay({
  hired,
  templates,
  templateId,
  onTemplateChange,
  onStart,
}: {
  hired: WaitingHire[];
  templates: PlanTemplate[];
  templateId: string;
  onTemplateChange: (id: string) => void;
  onStart: (entryId: string) => void;
}) {
  const t = useTranslations("onboarding");
  const active = templates.find((tpl) => tpl.id === templateId) ?? templates[0];
  const tasks = active?.tasks ?? [];
  const questions = active?.questionnaire ?? [];
  const starved = hired.length === 0;

  return (
    <div className="space-y-6">
      {/* Upstream-starved: nobody is Hired, so there is no plan to hand to anyone.
          Point back up the chain instead of dangling a dead "Start onboarding". */}
      {starved ? (
        <ChainEmptyState
          glyph={ONBOARDING_RUN_GLYPH}
          title="Nobody has been hired yet"
          body="Onboarding is the last link in the chain: it starts the moment a candidate reaches Hired. Move someone to Hired in the pipeline — usually straight after an accepted offer — and their first day appears here."
          links={[
            { tab: "pipeline", label: "Open the pipeline" },
            { tab: "decisions", label: "Review decisions" },
          ]}
        />
      ) : (
        <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
          <MotionizedGlyph
            data={ONBOARDING_RUN_GLYPH.data}
            viewBox={ONBOARDING_RUN_GLYPH.viewBox}
            className="h-24 w-24 shrink-0 sm:h-28 sm:w-28"
          />
          <div>
            <p className={EYEBROW}>First day</p>
            <h3 className={`mt-1 ${TITLE_DISPLAY}`}>
              {hired.length === 1 ? "One hire is waiting for a first day" : `${hired.length} hires are waiting for a first day`}
            </h3>
            <p className={`mt-2 max-w-xl ${INTRO}`}>
              The plan below already exists. Starting a run hands it to a named person, opens their pre-boarding
              questionnaire, and begins tracking what has actually been done.
            </p>
          </div>
        </div>
      )}

      {/* The plan itself — the active template's real tasks, in order, unticked. */}
      <section className={`${PANEL} ${CARD_PAD}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className={META_LABEL}>The day this plan describes</p>
            <p className="mt-0.5 text-base font-semibold text-ink">{active?.name ?? t("templatesTitle")}</p>
          </div>
          {templates.length > 1 ? (
            <label className="flex items-center gap-2 text-sm text-steel">
              {t("withTemplate")}
              <Select
                ariaLabel={t("withTemplate")}
                value={templateId}
                onChange={onTemplateChange}
                size="sm"
                options={templates.map((tpl) => ({ value: tpl.id, label: tpl.name }))}
              />
            </label>
          ) : (
            <span className="text-sm text-steel">Only the standard plan exists so far — edit or add one below.</span>
          )}
        </div>

        <div className={`mt-4 ${PANEL_SUNKEN} p-4`}>
          <p className={META_LABEL}>Before day one</p>
          <p className="mt-1 text-base text-ink">
            {questions.length > 0
              ? `${questions.length} pre-boarding questions go to the new hire — ${questions
                  .slice(0, 3)
                  .map((q) => q.label.toLowerCase())
                  .join(", ")}${questions.length > 3 ? "…" : ""}`
              : "This plan asks the new hire nothing before day one."}
          </p>
        </div>

        <p className={`mt-4 ${META_LABEL}`}>Then, in order · {t("progress", { done: 0, total: tasks.length })}</p>
        <ol className="mt-1.5">
          {tasks.map((task, i) => (
            <PlanStep key={task.id} index={i + 1} label={task.label} />
          ))}
        </ol>
        <p className={`mt-3 pt-3 text-sm text-steel ${DIVIDER}`}>{t("signSeamNote")}</p>
      </section>

      {/* Who the plan is for. Rendered only when there is genuinely someone to
          hand it to — the starved branch above never reaches here. */}
      {starved ? null : (
        <section className={`${PANEL} ${CARD_PAD}`}>
          <p className={META_LABEL}>{t("readyTitle")}</p>
          <ul className="mt-2 divide-y divide-stone-200" role="list">
            {hired.map((h) => (
              <li key={h.entryId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-base font-semibold text-ink">{h.candidateLabel ?? t("aCandidate")}</p>
                  {h.jobTitle ? <p className="text-meta text-steel">{h.jobTitle}</p> : null}
                </div>
                <button type="button" onClick={() => onStart(h.entryId)} className={`${BTN_PRIMARY} h-9 px-3 text-sm`}>
                  <UserPlus size={14} aria-hidden /> {t("startCta")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
