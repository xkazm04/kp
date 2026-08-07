"use client";

// The interview-prep modal's "Signals to confirm" list and "Imported questions"
// section (Direction 2/3 — reference questions pulled from the candidate's
// analysis report, weavable into a chronology block via a picker). Split out of
// ScheduleInterviewPrepModal.tsx to keep the modal file under the 200-line cap.

import { ListChecks, Plus, Sparkles } from "lucide-react";
import { Checkbox } from "@/app/_components/Checkbox";
import type { useTranslations } from "next-intl";
import type { ImportedEntry, Prep } from "./scheduleInterviewPrepTypes";

export function SignalsToConfirm({
  signals,
  checked,
  setChecked,
  markEdited,
  t,
}: {
  signals: string[];
  checked: Record<string, boolean>;
  setChecked: (updater: (s: Record<string, boolean>) => Record<string, boolean>) => void;
  markEdited: () => void;
  t: ReturnType<typeof useTranslations<"scheduleTab.prep">>;
}) {
  if (!signals.length) return null;
  return (
    <section>
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <ListChecks size={13} /> {t("signalsToConfirm")}
      </p>
      <ul className="mt-1.5 space-y-1">
        {signals.map((it, ii) => {
          const key = `k-${ii}`;
          return (
            <li key={key}>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
                <Checkbox
                  checked={Boolean(checked[key])}
                  onChange={(e) => {
                    markEdited();
                    setChecked((s) => ({ ...s, [key]: e.target.checked }));
                  }}
                  className="mt-0.5"
                />
                <span className={checked[key] ? "text-steel line-through" : ""}>{it}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ImportedQuestionsSection({
  prep,
  unassigned,
  pickerFor,
  setPickerFor,
  setBlock,
  t,
}: {
  prep: Prep;
  unassigned: ImportedEntry[];
  pickerFor: string | null;
  setPickerFor: (q: string | null) => void;
  setBlock: (question: string, blockRef: string | null) => void;
  t: ReturnType<typeof useTranslations<"scheduleTab.prep">>;
}) {
  if (!unassigned.length) return null;
  return (
    <section>
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <Sparkles size={13} /> {t("importedQuestions")}
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {unassigned.map((q, i) => {
          const picking = pickerFor === q.question;
          return (
            <li key={`iq-${i}`} className="rounded-md border border-stone-200 p-2">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 flex-1 text-sm text-ink">“{q.question}”</span>
                <button
                  type="button"
                  onClick={() => setPickerFor(picking ? null : q.question)}
                  aria-expanded={picking}
                  className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-meta font-semibold text-ink hover:border-coral/40"
                >
                  <Plus size={12} className="text-coral" /> {t("addToPlan")}
                </button>
              </div>
              {/* Block picker: choose which timed block to weave this into.
                  The plan's own topics, so the choice is always valid. */}
              {picking ? (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-stone-200 pt-2">
                  {prep.chronology.length ? (
                    prep.chronology.map((b, bi) => (
                      <button
                        key={`pick-${bi}`}
                        type="button"
                        onClick={() => setBlock(q.question, b.topic)}
                        className="focus-ring rounded-full border border-stone-200 px-2.5 py-1 text-meta font-semibold text-steel hover:border-coral/40 hover:text-ink"
                      >
                        {b.topic}
                      </button>
                    ))
                  ) : (
                    <span className="text-meta text-steel">{t("noBlocksToWeave")}</span>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
