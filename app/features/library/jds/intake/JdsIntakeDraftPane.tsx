"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Markdown } from "@/app/_components/Markdown";
import { CHIP_QUIET, META_LABEL } from "@/app/_components/ui/recipes";
import { briefDraftHasContent, briefDraftMarkdown } from "@/app/_lib/intake-draft";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { RoleBrief } from "@/app/_lib/rolespec";
import type { IntakeAttachment } from "./jdsIntakeLogic";

// The live JD draft — the "watch it being written" pane: a deterministic
// posting-shaped render of the current RoleBrief that updates after every
// exchange (no LLM cost; the FINAL JD is still generated at Promote, and the
// working-draft note says so). Each brief change crossfades the document in
// (keyed re-render), reduced-motion drops to an instant swap.

export function JdsIntakeDraftPane({
  brief,
  attachments,
  // UAT L1-HRBP-11: mirrors the promote row's market-research checkbox so this
  // working note never asserts a comp read the requestor has declined. Default
  // true = the shipped behaviour.
  marketResearch = true,
}: {
  brief: RoleBrief | null;
  attachments: IntakeAttachment[];
  marketResearch?: boolean;
}) {
  const t = useTranslations("library.tab.intake.draft");
  const reduced = useReducedMotion();
  const md = useMemo(
    () =>
      briefDraftMarkdown(brief, {
        untitled: t("untitled"),
        level: (seniority) => t("level", { seniority }),
        aboutRole: t("aboutRole"),
        outcomes: t("outcomes"),
        responsibilities: t("responsibilities"),
        whatBring: t("whatBring"),
        niceToHave: t("niceToHave"),
        languages: t("languages"),
      }),
    [brief, t]
  );
  const hasJdAttachment = attachments.some((a) => a.kind === "jd");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={META_LABEL}>{t("title")}</span>
        <span className={CHIP_QUIET}>{t("workingChip")}</span>
      </div>
      <p className="text-meta text-steel">{marketResearch ? t("workingNote") : t("workingNoteNoMarket")}</p>
      {hasJdAttachment ? <p className="text-meta text-steel">{t("supersedeNote")}</p> : null}
      {briefDraftHasContent(brief) ? (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={md}
            initial={{ opacity: reduced ? 1 : 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: reduced ? 1 : 0 }}
            transition={{ duration: reduced ? 0 : 0.22, ease: "easeOut" }}
            className="rounded-lg border border-stone-200 bg-white p-4 dark:rounded-2xl dark:shadow-sticker-sm"
          >
            <Markdown content={md} />
          </motion.div>
        </AnimatePresence>
      ) : (
        <p className="text-body text-steel">{t("empty")}</p>
      )}
    </div>
  );
}
