"use client";

import { GraduationCap, Languages, SlidersHorizontal } from "lucide-react";
import type { useTranslations } from "next-intl";
import type { CoachEditKind } from "./jobsCoachApply";
import { StageEditButton } from "./JobsCoachPanelStageEditButton";
import type { Gate, MustHave } from "./jobsCoachPanelTypes";

// The "loosen this gate" / "demote this must-have" recommendation list —
// extracted verbatim from JobsCoachPanel.tsx so that file stays under the
// 200-line split threshold.
export function JobsCoachPanelLoosenList({
  gates,
  musts,
  jdSlug,
  stageEdit,
  t,
}: {
  gates: Gate[];
  musts: MustHave[];
  jdSlug: string | null;
  stageEdit: (kind: CoachEditKind, value: string, delta: number) => void;
  t: ReturnType<typeof useTranslations<"jobs.coach">>;
}) {
  if (gates.length === 0 && musts.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-steel">
        <SlidersHorizontal size={14} /> {t("loosenHeading")}
      </h4>
      <ul className="space-y-1.5">
        {gates.map((g) => (
          <li key={`g-${g.value}`} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-stone-200 bg-white px-3 py-2 text-base">
            {/* The row's glyph follows the gate KIND, like its copy does: an
                education floor rendered under the translate icon read as a
                language requirement. */}
            {g.kind === "language" ? (
              <Languages size={15} className="shrink-0 text-coral" />
            ) : (
              <GraduationCap size={15} className="shrink-0 text-coral" />
            )}
            <span className="flex-1 basis-40 text-ink">
              {t.rich(g.kind === "language" ? "gateLanguage" : "gateEducation", {
                value: g.value,
                n: g.eligibleDelta,
                b: (chunks) => <span className="font-semibold">{chunks}</span>,
              })}
            </span>
            <span className="shrink-0 rounded-full bg-moss/10 px-2 py-0.5 text-sm font-semibold text-moss">
              +{g.eligibleDelta}
            </span>
            <StageEditButton
              show={Boolean(jdSlug)}
              label={t("stageEdit")}
              ariaLabel={t("stageEditAria", { value: g.value })}
              onClick={() => stageEdit(g.kind, g.value, g.eligibleDelta)}
            />
          </li>
        ))}
        {musts.map((m) => (
          <li key={`m-${m.skill}`} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-stone-200 bg-white px-3 py-2 text-base">
            <SlidersHorizontal size={15} className="shrink-0 text-coral" />
            <span className="flex-1 basis-40 text-ink">
              {t.rich("mustHave", {
                skill: m.skill,
                missing: m.missingAmongEligible,
                b: (chunks) => <span className="font-semibold">{chunks}</span>,
              })}
            </span>
            {m.qualifiedDelta > 0 ? (
              <span className="shrink-0 rounded-full bg-moss/10 px-2 py-0.5 text-sm font-semibold text-moss">
                +{m.qualifiedDelta}
              </span>
            ) : null}
            <StageEditButton
              show={Boolean(jdSlug)}
              label={t("stageEdit")}
              ariaLabel={t("stageEditAria", { value: m.skill })}
              // The staged delta is the coach's "+N" and nothing else: the editor
              // banner spends it as "could shortlist up to +N more candidates",
              // which is exactly what qualifiedDelta measures. missingAmongEligible
              // answers a DIFFERENT question ("how many eligible lack this skill")
              // — substituting it when the counterfactual came back 0 promised a
              // gain the scorer had already ruled out. 0 is honest here: the
              // banner's `=0` plural branch drops the claim and just says where
              // to edit.
              onClick={() => stageEdit("mustHave", m.skill, m.qualifiedDelta)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
