"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { EYEBROW } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import {
  readStoredColumns,
  storeColumns,
  toggleColumn,
  type IntakeColumnKey,
  type IntakeLayoutProps,
} from "./intakeLayoutShared";

// Variant A — "Triptych" (studio desk). Metaphor: three leaves of one hinged
// desk piece — JD draft · conversation · live brief — always physically
// present. Hiding a leaf FOLDS it to a slim vertical spine (rotated label +
// count) that stays clickable, so the desk keeps its shape while the open
// leaves breathe wider (framer `layout` reflow; instant under reduced motion).
// Editorial register: EYEBROW headers, calm borders, no toolbar chrome.
// Materials live quietly at the foot of the draft leaf — reference matter
// belongs with the document it feeds.

const STORAGE_KEY = "kp-intake-triptych-cols";
const LEAVES: IntakeColumnKey[] = ["draft", "chat", "brief"];
const DEFAULT_OPEN: IntakeColumnKey[] = ["draft", "chat", "brief"];

export function JdsIntakeLayoutTriptych(props: IntakeLayoutProps) {
  const t = useTranslations("library.tab.intake.proto");
  const reduced = useReducedMotion();
  const [open, setOpen] = useState<IntakeColumnKey[]>(() => readStoredColumns(STORAGE_KEY, DEFAULT_OPEN));

  const flip = (key: IntakeColumnKey) => {
    setOpen((prev) => {
      const next = toggleColumn(prev, key);
      storeColumns(STORAGE_KEY, next);
      return next;
    });
  };

  const countFor = (key: IntakeColumnKey): number =>
    key === "chat" ? props.counts.turns : key === "brief" ? props.counts.requirements : props.counts.attachments;

  return (
    <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-stretch">
      {LEAVES.map((key) => {
        const isOpen = open.includes(key);
        const label = t(`col.${key}`);
        const lastOpen = isOpen && open.length === 1;
        if (!isOpen) {
          return (
            <motion.button
              key={key}
              layout={!reduced}
              type="button"
              onClick={() => flip(key)}
              aria-expanded={false}
              aria-label={t("show", { column: label })}
              className="focus-ring flex shrink-0 items-center justify-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-steel transition-colors hover:border-stone-400 hover:text-ink xl:h-auto xl:w-10 xl:flex-col xl:px-0 xl:py-4 dark:rounded-2xl"
            >
              <span className="text-meta uppercase tracking-wide xl:[writing-mode:vertical-rl]">{label}</span>
              <span className="rounded-full bg-stone-100 px-1.5 text-sm text-steel nums">{countFor(key)}</span>
            </motion.button>
          );
        }
        return (
          <motion.section
            key={key}
            layout={!reduced}
            className={`flex min-w-0 flex-col rounded-lg border border-stone-200 bg-white p-4 dark:rounded-2xl dark:shadow-sticker-sm ${
              key === "chat" ? "xl:flex-[1.5]" : "xl:flex-1"
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className={EYEBROW}>{label}</span>
              <button
                type="button"
                onClick={() => flip(key)}
                disabled={lastOpen}
                aria-expanded
                aria-label={t("hide", { column: label })}
                title={lastOpen ? t("lastOpen") : t("hide", { column: label })}
                className="focus-ring rounded-md px-2 py-0.5 text-sm text-steel transition-colors hover:bg-stone-100 hover:text-ink disabled:opacity-40"
              >
                {/* eslint-disable-next-line i18next/no-literal-string -- fold glyph, not copy */}
                <span aria-hidden>⟨⟩</span>
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {key === "chat" ? props.chat : key === "brief" ? props.brief : (
                <div className="space-y-4">
                  {props.draft}
                  {/* Reference matter folds under the document it feeds. */}
                  <details className="group rounded-lg border border-stone-200 bg-stone-50 p-3 dark:rounded-2xl">
                    <summary className="focus-ring cursor-pointer list-none text-meta uppercase tracking-wide text-steel transition-colors hover:text-ink">
                      {t("col.materials")}
                      <span className="ml-1.5 rounded-full bg-stone-100 px-1.5 text-sm nums">{props.counts.attachments}</span>
                    </summary>
                    <div className="mt-3">{props.materials}</div>
                  </details>
                </div>
              )}
            </div>
          </motion.section>
        );
      })}
    </div>
  );
}
