"use client";

// ONE competency of the interview kit editor, with its questions.
//
// The row keeps the pipeline-axis editor's grammar (features/shared/PipelineStepRow):
//
//     1.  [ emphasis ▾ ] [ what the role is hired on ] [ 12 ] min      ↑ ↓ ✕
//         └ w-40 ─────┘
//         1. [ question …………………………… ] [✓ Must-ask]                  ↑ ↓ ✕
//            [ optional follow-up ……………… ]
//         + Add a question
//
// The fixed-width picker comes first for the same reason the pipeline's type cell does:
// it is the closed vocabulary and it lines the rows up. The ↑ ↓ ✕ cluster is the SAME
// component (PipelineStepRowControls), so both editors name every control per row.
//
// Emphasis is shown as a WORD, never a number: weights order nothing and are never
// added up (interview-kit-types.ts), so a "3" on screen would read as a score the
// product does not compute.
import { Plus } from "lucide-react";
import type { useTranslations } from "next-intl";
import { Checkbox } from "@/app/_components/Checkbox";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_GHOST } from "@/app/_components/ui/recipes";
import { KIT_MAX_QUESTIONS_PER_COMPETENCY, KIT_MAX_TEXT_CHARS, type KitWeight } from "@/app/_lib/interview-kit-types";
import { PIPELINE_STEP_TYPE_WIDTH, PipelineStepRowControls } from "@/app/features/shared/PipelineStepRow";
import {
  addQuestion,
  budgetValid,
  canAddQuestion,
  canMarkMustAsk,
  isKitWeight,
  KIT_WEIGHTS_DESC,
  moveQuestion,
  patchCompetency,
  patchQuestion,
  removeQuestion,
  setMustAsk,
  type KitDraft,
  type KitDraftCompetency,
} from "./jobsKitModel";

type KitT = ReturnType<typeof useTranslations<"jobs.kit">>;

export function JobsKitCompetency({
  draft,
  competency: c,
  index,
  onChange,
  onMove,
  onRemove,
  canMoveUp,
  canMoveDown,
  mustAskHintId,
  t,
}: {
  draft: KitDraft;
  competency: KitDraftCompetency;
  index: number;
  onChange: (next: KitDraft) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** The element that states the must-ask clock rule — every toggle is described by it. */
  mustAskHintId: string;
  t: KitT;
}) {
  // Accessible names need the competency's name even before it has one.
  const name = c.title.trim() || t("untitled", { n: index + 1 });

  return (
    <li className="rounded-md border border-stone-200 bg-paper/50 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="nums w-5 shrink-0 text-sm text-stone-400">{index + 1}.</span>
        <span className={`${PIPELINE_STEP_TYPE_WIDTH} shrink-0`}>
          <Select
            value={c.weight === null ? "" : String(c.weight)}
            onChange={(v) => {
              const w = Number(v);
              onChange(patchCompetency(draft, c.id, { weight: isKitWeight(w) ? (w as KitWeight) : null }));
            }}
            ariaLabel={t("weightAria", { title: name })}
            placeholder={t("weightPlaceholder")}
            sizeVariant="sm"
            className="w-full"
            invalid={c.weight === null}
            options={KIT_WEIGHTS_DESC.map((w) => ({ value: String(w), label: t(`weight.${w}`) }))}
          />
        </span>
        <span className="min-w-40 flex-1">
          <TextInput
            type="text"
            value={c.title}
            onChange={(e) => onChange(patchCompetency(draft, c.id, { title: e.target.value }))}
            aria-label={t("titleAria", { n: index + 1 })}
            placeholder={t("titlePlaceholder")}
            maxLength={KIT_MAX_TEXT_CHARS}
            invalid={!c.title.trim()}
            sizeVariant="sm"
          />
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <TextInput
            type="text"
            inputMode="numeric"
            value={c.budget}
            onChange={(e) => onChange(patchCompetency(draft, c.id, { budget: e.target.value }))}
            aria-label={t("budgetAria", { title: name })}
            invalid={!budgetValid(c.budget)}
            sizeVariant="sm"
            className="w-16 text-right"
          />
          <span className="text-sm text-steel">{t("minutes")}</span>
        </span>
        <PipelineStepRowControls
          onMove={onMove}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onRemove={onRemove}
          aria={{
            moveUp: t("moveUpAria", { title: name }),
            moveDown: t("moveDownAria", { title: name }),
            remove: t("removeAria", { title: name }),
          }}
          className="ml-auto"
        />
      </div>

      <ol className="mt-2 space-y-2 border-l border-stone-200 pl-3 sm:ml-7">
        {c.questions.map((q, qi) => {
          const n = qi + 1;
          const markable = canMarkMustAsk(draft, q);
          return (
            <li key={q.id} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="nums w-5 shrink-0 text-sm text-stone-400">{n}.</span>
                <span className="min-w-48 flex-1">
                  <TextInput
                    type="text"
                    value={q.text}
                    onChange={(e) => onChange(patchQuestion(draft, c.id, q.id, { text: e.target.value }))}
                    aria-label={t("questionAria", { n, title: name })}
                    placeholder={t("questionPlaceholder")}
                    maxLength={KIT_MAX_TEXT_CHARS}
                    sizeVariant="sm"
                  />
                </span>
                <Checkbox
                  checked={q.mustAsk}
                  disabled={!markable}
                  onChange={(e) => onChange(setMustAsk(draft, c.id, q.id, e.target.checked))}
                  aria-label={t("mustAskAria", { n, title: name })}
                  aria-describedby={mustAskHintId}
                  title={markable ? t("mustAskTitle") : t("mustAskFull")}
                  label={t("mustAsk")}
                  wrapperClassName="shrink-0"
                />
                <PipelineStepRowControls
                  onMove={(delta) => onChange(moveQuestion(draft, c.id, q.id, delta))}
                  canMoveUp={qi > 0}
                  canMoveDown={qi < c.questions.length - 1}
                  onRemove={() => onChange(removeQuestion(draft, c.id, q.id))}
                  aria={{
                    moveUp: t("questionMoveUpAria", { n, title: name }),
                    moveDown: t("questionMoveDownAria", { n, title: name }),
                    remove: t("questionRemoveAria", { n, title: name }),
                  }}
                  className="ml-auto"
                />
              </div>
              <div className="pl-7">
                <TextInput
                  type="text"
                  value={q.followUp}
                  onChange={(e) => onChange(patchQuestion(draft, c.id, q.id, { followUp: e.target.value }))}
                  aria-label={t("followUpAria", { n, title: name })}
                  placeholder={t("followUpPlaceholder")}
                  maxLength={KIT_MAX_TEXT_CHARS}
                  sizeVariant="sm"
                />
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-2 flex flex-wrap items-center gap-2 sm:ml-7">
        <button
          type="button"
          onClick={() => onChange(addQuestion(draft, c.id))}
          disabled={!canAddQuestion(c)}
          aria-label={t("addQuestionAria", { title: name })}
          className={`${BTN_GHOST} px-2 py-1 text-sm`}
        >
          <Plus size={13} className="text-coral" aria-hidden /> {t("addQuestion")}
        </button>
        <span className="text-sm text-steel nums">
          {t("questionsMeta", { count: c.questions.length, max: KIT_MAX_QUESTIONS_PER_COMPETENCY })}
        </span>
      </div>
    </li>
  );
}
