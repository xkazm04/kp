"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@/app/_components/Markdown";
import { briefDraftHasContent, briefDraftMarkdown } from "@/app/_lib/intake-draft";
import type { RoleBrief } from "@/app/_lib/rolespec";
import type { IntakeAttachment } from "./jdsIntakeLogic";

// The live JD draft — the "watch it being written" pane: a deterministic
// posting-shaped render of the current RoleBrief that updates after every
// exchange (no LLM cost; the FINAL JD is still generated at Promote). Each
// brief change fades the document in (keyed re-render), instant under reduced
// motion.
//
// The pane is now DOCUMENT ONLY. It used to open with a title row ("Job
// description draft" + a working-draft chip) and a two-line explainer of what
// the pane is, then put the posting inside a second bordered card — three
// chrome layers between the leaf header and the words the requestor came to
// read, one of them repeating the leaf header's own title. The title and its
// status chip are now ONE row, owned by the leaf header
// (JdsIntakeLayoutTriptych's `draftChip`), and the markdown renders straight
// into the leaf: `Markdown` already emits its own root element, so the entrance
// class rides on that instead of an extra wrapper.

export function JdsIntakeDraftPane({ brief, attachments }: { brief: RoleBrief | null; attachments: IntakeAttachment[] }) {
  const t = useTranslations("library.tab.intake.draft");
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

  if (!briefDraftHasContent(brief)) {
    return <p className="text-body text-steel">{t("empty")}</p>;
  }
  return (
    <>
      {hasJdAttachment ? <p className="mb-3 text-meta text-steel">{t("supersedeNote")}</p> : null}
      {/* Keyed on the rendered markdown so every brief change replays the fade —
          the "watch it being written" beat, in one CSS class instead of an
          AnimatePresence wrapper element (globals.css drops it under reduced
          motion). */}
      <Markdown key={md} content={md} className="animate-arrive-in" />
    </>
  );
}
