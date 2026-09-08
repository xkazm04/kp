"use client";

import { AnimatePresence, motion } from "framer-motion";
import { PanelRightOpen } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { IconAction } from "@/app/_components/IconAction";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { shortDate } from "../../jdsLibrary";
import type { IntakeSummary } from "../jdsIntakeLogic";
import { LEDGER_SPRING } from "./ledgerKit";
import { LedgerGhost, ShapeMark, StatusMark, TurnTicks } from "./LedgerMarks";

// THE DOSSIER — one record, opened out.
//
// It is the same object as the row beside it, drawn in the same hand: the same
// gutter mark, the same tick run, the same terminal mark. That is the point of
// the rail — a reader should never have to work out that the aside is about the
// record their cursor is on. So it is not a bordered card floating next to a
// table; it is the plane continued past a hairline.
//
// The shipped rail wrote a sentence where there was nothing to describe ("Open a
// session and its summary appears here"). An empty dossier draws the shape of
// the record that will fill it instead.

export function LedgerDossier({ row, onOpen }: { row: IntakeSummary | null; onOpen: (id: string) => void }) {
  const t = useTranslations("library.tab.intake");
  const locale = useLocale();
  const reduced = useReducedMotion();

  return (
    <aside className="mt-5 border-t border-stone-200 pt-4 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
      <div className={`${META_LABEL} border-b border-stone-200 pb-2`}>{t("ledger.summaryTitle")}</div>
      {row === null ? (
        <LedgerGhost rows={2} />
      ) : (
        // The record swaps rather than mutates: a new highlight is a different
        // object, and a crossfade says so. One instance at a time, so nothing is
        // shared-layout here — the cursor on the plane is what travels.
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={row.id}
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: reduced ? 1 : 0 }}
            transition={reduced ? { duration: 0 } : LEDGER_SPRING}
            className="pt-3"
          >
            <div className="flex items-start gap-3">
              <span className="pt-1">
                <ShapeMark shape={row.shape} />
              </span>
              <p className="min-w-0 flex-1 text-body font-medium text-ink">{row.title || t("untitled")}</p>
              <StatusMark status={row.status} jdSlug={row.jdSlug} />
            </div>
            <dl className="mt-3 space-y-2 border-t border-stone-200 pt-3">
              <div className="flex items-center justify-between gap-3">
                <dt className={META_LABEL}>{t("table.turns")}</dt>
                <dd>
                  <TurnTicks turns={row.turnCount} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className={META_LABEL}>{t("table.updated")}</dt>
                <dd className="text-meta text-steel">{shortDate(row.updatedAt ?? row.createdAt, locale)}</dd>
              </div>
            </dl>
            <div className="mt-3 flex justify-end border-t border-stone-200 pt-2">
              {/* The door back in. The JD a promoted run produced is the terminal
                  mark above — the same door the row carries, so there is one
                  place to learn it. */}
              <IconAction icon={PanelRightOpen} label={t("ledger.summaryOpen")} side="left" onClick={() => onOpen(row.id)} />
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </aside>
  );
}
