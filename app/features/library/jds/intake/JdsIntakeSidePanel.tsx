"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { RoleBrief } from "@/app/_lib/rolespec";
import { JdsIntakeAttachmentsPane } from "./JdsIntakeAttachmentsPane";
import { JdsIntakeBriefPanel } from "./JdsIntakeBriefPanel";
import { JdsIntakeDraftPane } from "./JdsIntakeDraftPane";
import type { IntakeAttachment } from "./jdsIntakeLogic";

// The session's right-hand region: Brief (the live structured capture) ·
// Draft (the JD forming from it) · Materials (attached notes/JDs). One pane
// at a time behind the app's segmented-pill motion standard (shared-layout
// pill + AnimatePresence crossfade, both flattened under reduced motion —
// ref: AnalyzeWorkspace.tsx).

const PANES = ["brief", "draft", "materials"] as const;
type Pane = (typeof PANES)[number];

export function JdsIntakeSidePanel({
  brief,
  attachments,
  frozen,
  savingBrief,
  savingAttachment,
  onSaveBrief,
  onJumpToTurn,
  onAddAttachment,
  onRemoveAttachment,
}: {
  brief: RoleBrief | null;
  attachments: IntakeAttachment[];
  frozen: boolean;
  savingBrief: boolean;
  savingAttachment: boolean;
  onSaveBrief?: (edited: RoleBrief) => void;
  onJumpToTurn?: (turn: number) => void;
  onAddAttachment: (input: { kind: "note"; title: string; text: string } | { kind: "jd"; jdSlug: string }) => void;
  onRemoveAttachment: (index: number) => void;
}) {
  const t = useTranslations("library.tab.intake.side");
  const reduced = useReducedMotion();
  const [pane, setPane] = useState<Pane>("brief");

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="inline-flex self-start rounded-lg border border-stone-200 bg-white p-1 shadow-panel dark:rounded-2xl">
        {PANES.map((p) => {
          const active = pane === p;
          const count = p === "materials" && attachments.length > 0 ? ` (${attachments.length})` : "";
          return (
            <button
              key={p}
              type="button"
              onClick={() => setPane(p)}
              aria-pressed={active}
              className={`focus-ring relative h-8 rounded-md px-3 text-sm font-semibold transition-colors ${
                active ? "text-white" : "text-steel hover:bg-paper hover:text-ink"
              }`}
            >
              {active ? (
                <motion.span
                  layoutId="intake-side-seg"
                  className="absolute inset-0 z-0 rounded-md bg-ink"
                  transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                />
              ) : null}
              <span className="relative z-10">{`${t(p)}${count}`}</span>
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={pane}
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.12 : 0.18, ease: "easeOut" }}
          className="min-h-0 flex-1"
        >
          {pane === "brief" ? (
            <JdsIntakeBriefPanel
              brief={brief}
              frozen={frozen}
              saving={savingBrief}
              onSaveBrief={onSaveBrief}
              onJumpToTurn={onJumpToTurn}
            />
          ) : pane === "draft" ? (
            <div className={`${PANEL_SUNKEN} h-full p-4`}>
              <JdsIntakeDraftPane brief={brief} attachments={attachments} />
            </div>
          ) : (
            <div className={`${PANEL_SUNKEN} h-full p-4`}>
              <JdsIntakeAttachmentsPane
                attachments={attachments}
                frozen={frozen}
                saving={savingAttachment}
                onAdd={onAddAttachment}
                onRemove={onRemoveAttachment}
              />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
