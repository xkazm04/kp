"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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

// The session layout ("Triptych", the /prototype round winner). Metaphor:
// three leaves of one hinged desk piece — JD draft · conversation · live
// brief — always physically present. Hiding a leaf FOLDS it to a slim
// vertical spine (rotated label + count) that stays clickable, so the desk
// keeps its shape while the open leaves breathe wider. The fold animates as
// the INVERSE of expansion: each leaf is ONE always-mounted motion.section
// whose width tweens between leaf and spine (framer `layout`), while the
// leaf content and the spine label crossfade inside it — symmetric both
// directions, instant under reduced motion. Editorial register: EYEBROW
// headers, calm borders, no toolbar chrome. Materials live quietly at the
// foot of the draft leaf — reference matter belongs with the document it
// feeds.

const STORAGE_KEY = "kp-intake-triptych-cols";
const LEAVES: IntakeColumnKey[] = ["draft", "chat", "brief"];
const DEFAULT_OPEN: IntakeColumnKey[] = ["draft", "chat", "brief"];

export function JdsIntakeLayoutTriptych(props: IntakeLayoutProps) {
  const t = useTranslations("library.tab.intake.columns");
  const reduced = useReducedMotion();
  const [open, setOpen] = useState<IntakeColumnKey[]>(() => readStoredColumns(STORAGE_KEY, DEFAULT_OPEN));

  const flip = (key: IntakeColumnKey) => {
    setOpen((prev) => {
      const next = toggleColumn(prev, key);
      storeColumns(STORAGE_KEY, next);
      return next;
    });
  };

  // Every spine badge reports its OWN leaf (UAT L1-EVA-10 · L1-HRBP-15 ·
  // L1-TOM-5 convergent ×3, widened by L2-CONV-1 — two of three spines badged
  // `0` over a full session: the draft spine counted attachments, the brief
  // spine counted `requirements`, empty in every live session). Fixed per
  // branch: chat counts turns (already correct, re-audited); brief counts what
  // the brief actually holds; draft renders the purpose-built `draftReady`
  // state — a document is ready or it isn't, so it gets a marker, not a number.
  const badgeFor = (key: IntakeColumnKey): { text: string; hint: string } => {
    if (key === "chat") return { text: String(props.counts.turns), hint: t("badge.turns", { count: props.counts.turns }) };
    if (key === "brief") return { text: String(props.counts.briefItems), hint: t("badge.briefItems", { count: props.counts.briefItems }) };
    // Glyphs, not copy — the translated meaning rides in `hint`.
    return props.counts.draftReady
      ? { text: "✓", hint: t("badge.draftReady") }
      : { text: "·", hint: t("badge.draftEmpty") };
  };

  const fade = {
    initial: { opacity: reduced ? 1 : 0 },
    animate: { opacity: 1 },
    exit: { opacity: reduced ? 1 : 0 },
    transition: { duration: reduced ? 0 : 0.18, ease: "easeOut" as const },
  };

  return (
    <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-stretch">
      {LEAVES.map((key) => {
        const isOpen = open.includes(key);
        const label = t(`col.${key}`);
        const lastOpen = isOpen && open.length === 1;
        return (
          <motion.section
            key={key}
            layout={!reduced}
            transition={{ layout: { duration: reduced ? 0 : 0.25, ease: "easeOut" } }}
            className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-stone-200 dark:rounded-2xl ${
              isOpen
                ? `bg-white p-4 dark:shadow-sticker-sm ${key === "chat" ? "xl:flex-[1.5]" : "xl:flex-1"}`
                : "shrink-0 bg-stone-50 xl:w-10"
            }`}
          >
            <AnimatePresence mode="wait" initial={false}>
              {isOpen ? (
                <motion.div key="leaf" className="flex min-h-0 flex-1 flex-col" {...fade}>
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
                </motion.div>
              ) : (
                <motion.button
                  key="spine"
                  type="button"
                  onClick={() => flip(key)}
                  aria-expanded={false}
                  aria-label={t("show", { column: label })}
                  className="focus-ring flex flex-1 items-center justify-center gap-2 px-3 py-2 text-steel transition-colors hover:text-ink xl:flex-col xl:px-0 xl:py-4"
                  {...fade}
                >
                  <span className="text-meta uppercase tracking-wide xl:[writing-mode:vertical-rl]">{label}</span>
                  <span className="rounded-full bg-stone-100 px-1.5 text-sm text-steel nums" title={badgeFor(key).hint}>
                    <span aria-hidden>{badgeFor(key).text}</span>
                    <span className="sr-only">{badgeFor(key).hint}</span>
                  </span>
                </motion.button>
              )}
            </AnimatePresence>
          </motion.section>
        );
      })}
    </div>
  );
}
