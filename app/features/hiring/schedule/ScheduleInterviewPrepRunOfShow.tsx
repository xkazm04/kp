"use client";

// The "Run of show" section of the interview-prep modal: the timed chronology
// blocks, each checkable, with any woven imported questions (Direction 3)
// rendered inline and removable back to the imported section. Split out of
// ScheduleInterviewPrepModal.tsx to keep the modal file under the 200-line cap.

import { Clock, Sparkles, X } from "lucide-react";
import { Checkbox } from "@/app/_components/Checkbox";
import type { useTranslations } from "next-intl";
import type { ImportedEntry, Prep } from "./scheduleInterviewPrepTypes";

export function RunOfShow({
  prep,
  checked,
  setChecked,
  markEdited,
  wovenForBlock,
  wovenKeyOf,
  setBlock,
  t,
}: {
  prep: Prep;
  checked: Record<string, boolean>;
  setChecked: (updater: (s: Record<string, boolean>) => Record<string, boolean>) => void;
  markEdited: () => void;
  wovenForBlock: (topic: string) => ImportedEntry[];
  wovenKeyOf: (question: string) => string;
  setBlock: (question: string, blockRef: string | null) => void;
  t: ReturnType<typeof useTranslations<"scheduleTab.prep">>;
}) {
  return (
    <section>
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <Clock size={13} /> {t("runOfShow", { min: prep.durationMin })}
      </p>
      <ol className="mt-2 space-y-1.5">
        {prep.chronology.map((b, i) => {
          const key = `c-${i}`;
          const on = Boolean(checked[key]);
          const woven = wovenForBlock(b.topic);
          return (
            <li key={key} className={`rounded-md border p-2.5 transition-colors ${on ? "border-moss/40 bg-moss/5" : "border-stone-200"}`}>
              <label className="flex cursor-pointer items-start gap-2.5">
                <Checkbox
                  checked={on}
                  onChange={(e) => {
                    markEdited();
                    setChecked((s) => ({ ...s, [key]: e.target.checked }));
                  }}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`text-sm font-semibold ${on ? "text-steel line-through" : "text-ink"}`}>{b.topic}</span>
                    <span className="shrink-0 rounded bg-paper px-1.5 py-0.5 text-sm nums text-steel">{t("minRange", { from: b.fromMin, to: b.toMin })}</span>
                  </span>
                  <span className="mt-0.5 block text-sm text-steel">{b.goal}</span>
                  {b.questions.map((q, j) => (
                    <span key={j} className="mt-1 block text-sm text-ink">“{q}”</span>
                  ))}
                  {b.followUp ? <span className="mt-0.5 block text-sm text-steel">{t("followUp", { text: b.followUp })}</span> : null}
                </span>
              </label>
              {/* Woven imported questions (Direction 3): checkable, counted in
                  the meter, each removable back to the imported section. */}
              {woven.length ? (
                <ul className="mt-1.5 space-y-1 border-t border-stone-200 pt-1.5">
                  {woven.map((w) => {
                    const wkey = wovenKeyOf(w.question);
                    const won = Boolean(checked[wkey]);
                    return (
                      <li key={wkey} className="flex items-start gap-1.5">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-sm text-ink">
                          <Checkbox
                            checked={won}
                            onChange={(e) => {
                              markEdited();
                              setChecked((s) => ({ ...s, [wkey]: e.target.checked }));
                            }}
                            className="mt-0.5"
                          />
                          <span className={`min-w-0 ${won ? "text-steel line-through" : ""}`}>
                            “{w.question}”
                            <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-paper px-1 py-0.5 align-middle text-meta font-semibold text-steel">
                              <Sparkles size={10} aria-hidden /> {t("importedTag")}
                            </span>
                          </span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setBlock(w.question, null)}
                          aria-label={t("removeFromPlanAria")}
                          title={t("removeFromPlan")}
                          className="focus-ring mt-0.5 shrink-0 rounded p-0.5 text-steel hover:text-coral"
                        >
                          <X size={13} aria-hidden />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
