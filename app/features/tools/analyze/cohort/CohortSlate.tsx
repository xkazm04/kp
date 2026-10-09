"use client";

// The studio's call sheet: the role being compared as the display title, and the three acts of
// the role-first flow on one rule (role, who is compared, the comparison), each with what it
// holds so far. An act already passed is a way back; the act ahead is drawn, not offered.
import { useTranslations } from "next-intl";
import { CHIP_QUIET, EYEBROW, INTRO, META_LABEL, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { ABSENT } from "@/app/_components/kit/figure";
import type { CohortStatus } from "./cohortTypes";
import { actIndex, STUDIO_ACTS, type StudioAct, type StudioStep } from "./cohortShell";

const ACT_BTN = "cs-act__btn focus-ring";

export function CohortSlate({
  step,
  roleTitle,
  castCount,
  status,
  fixture = null,
  reachable = [],
  onAct,
}: {
  step: StudioStep;
  roleTitle: string | null;
  castCount: number | null;
  status: CohortStatus | null;
  fixture?: "done" | "running" | null;
  /** Acts the reader may go back (or forward) to from here. */
  reachable?: readonly StudioAct[];
  onAct?: (act: StudioAct) => void;
}) {
  const t = useTranslations("analyzeCohort.shell.slate");
  const current = actIndex(step);
  const value = (act: StudioAct): string => {
    if (act === "role") return roleTitle ?? t("value.noRole");
    if (act === "cast") return castCount != null ? t("value.cast", { n: castCount }) : ABSENT;
    return status ? t(`value.status.${status}`) : t("value.notStarted");
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <h2 className={`${TITLE_DISPLAY} break-words`}>{roleTitle ?? t("title")}</h2>
          <p className={INTRO}>{t(`intro.${step.act}`)}</p>
        </div>
        {fixture ? <span className={`${CHIP_QUIET} shrink-0`}>{t(`fixture.${fixture}`)}</span> : null}
      </div>
      <nav aria-label={t("label")}>
        <ol className="cs-acts border-y border-stone-200 py-2">
          {STUDIO_ACTS.map((act, i) => {
            const state = i < current ? "done" : i === current ? "current" : "ahead";
            const canGo = !!onAct && i !== current && reachable.includes(act);
            return (
              <li key={act} className="cs-act" data-state={state}>
                <button
                  type="button"
                  className={ACT_BTN}
                  disabled={!canGo}
                  aria-current={state === "current" ? "step" : undefined}
                  onClick={canGo ? () => onAct?.(act) : undefined}
                >
                  <span className="cs-act__n text-h3" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="cs-act__text">
                    <span className={META_LABEL}>{t(`act.${act}`)}</span>
                    <span className={`cs-act__value text-body ${state === "ahead" ? "text-steel" : "text-ink"}`}>{value(act)}</span>
                  </span>
                </button>
                {i < STUDIO_ACTS.length - 1 ? <span className="cs-act__rule" aria-hidden /> : null}
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
