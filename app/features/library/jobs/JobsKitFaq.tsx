"use client";

// The interview kit's recruiter FAQ and the author's note — the two parts of a kit that
// are not asked. FAQ answers ARE said to candidates (both provider briefs carry them as
// role facts), so they are written as facts about the role, never as a promise about the
// candidate; the note is never read aloud at all. Same row grammar as the competencies.
import { Plus } from "lucide-react";
import { useId } from "react";
import type { useTranslations } from "next-intl";
import { TextArea } from "@/app/_components/TextArea";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_GHOST, META_LABEL } from "@/app/_components/ui/recipes";
import { KIT_MAX_FAQ, KIT_MAX_FAQ_ANSWER_CHARS, KIT_MAX_TEXT_CHARS } from "@/app/_lib/interview-kit-types";
import { PipelineStepRowControls } from "@/app/features/shared/PipelineStepRow";
import { addFaq, canAddFaq, moveFaq, patchFaq, removeFaq, setNote, type KitDraft } from "./jobsKitModel";

type KitT = ReturnType<typeof useTranslations<"jobs.kit">>;

export function JobsKitFaq({ draft, onChange, t }: { draft: KitDraft; onChange: (next: KitDraft) => void; t: KitT }) {
  const noteId = useId();
  const noteHintId = useId();
  return (
    <>
      <section aria-label={t("faq")} className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-ink">{t("faq")}</h4>
          <span className={`${META_LABEL} nums`}>{t("countMeta", { count: draft.faq.length, max: KIT_MAX_FAQ })}</span>
        </div>
        <p className="text-sm text-steel">{t("faqIntro")}</p>
        {draft.faq.length > 0 ? (
          <ol className="space-y-2">
            {draft.faq.map((f, i) => {
              const n = i + 1;
              return (
                <li key={f.id} className="flex items-start gap-2 rounded-md border border-stone-200 bg-paper/50 px-2.5 py-2">
                  <span className="nums w-5 shrink-0 pt-2 text-sm text-stone-400">{n}.</span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <TextInput
                      type="text"
                      value={f.question}
                      onChange={(e) => onChange(patchFaq(draft, f.id, { question: e.target.value }))}
                      aria-label={t("faqQuestionAria", { n })}
                      placeholder={t("faqQuestionPlaceholder")}
                      maxLength={KIT_MAX_TEXT_CHARS}
                      sizeVariant="sm"
                    />
                    <TextArea
                      value={f.answer}
                      onChange={(e) => onChange(patchFaq(draft, f.id, { answer: e.target.value }))}
                      aria-label={t("faqAnswerAria", { n })}
                      placeholder={t("faqAnswerPlaceholder")}
                      maxLength={KIT_MAX_FAQ_ANSWER_CHARS}
                      rows={2}
                      sizeVariant="sm"
                    />
                  </div>
                  <PipelineStepRowControls
                    onMove={(delta) => onChange(moveFaq(draft, f.id, delta))}
                    canMoveUp={i > 0}
                    canMoveDown={i < draft.faq.length - 1}
                    onRemove={() => onChange(removeFaq(draft, f.id))}
                    aria={{
                      moveUp: t("faqMoveUpAria", { n }),
                      moveDown: t("faqMoveDownAria", { n }),
                      remove: t("faqRemoveAria", { n }),
                    }}
                    className="pt-1"
                  />
                </li>
              );
            })}
          </ol>
        ) : null}
        <button
          type="button"
          onClick={() => onChange(addFaq(draft))}
          disabled={!canAddFaq(draft)}
          className={`${BTN_GHOST} px-2 py-1 text-sm`}
        >
          <Plus size={13} className="text-coral" aria-hidden /> {t("addFaq")}
        </button>
      </section>

      <section className="space-y-1.5">
        <label htmlFor={noteId} className="text-sm font-semibold text-ink">
          {t("note")}
        </label>
        <p id={noteHintId} className="text-sm text-steel">
          {t("noteHint")}
        </p>
        <TextArea
          id={noteId}
          value={draft.note}
          onChange={(e) => onChange(setNote(draft, e.target.value))}
          aria-describedby={noteHintId}
          maxLength={KIT_MAX_FAQ_ANSWER_CHARS}
          rows={3}
          sizeVariant="sm"
        />
        <p className="text-right text-sm text-steel nums">
          {t("countMeta", { count: draft.note.length, max: KIT_MAX_FAQ_ANSWER_CHARS })}
        </p>
      </section>
    </>
  );
}
