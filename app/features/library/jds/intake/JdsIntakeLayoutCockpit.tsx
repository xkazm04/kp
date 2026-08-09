"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { KBD, META_LABEL, TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import {
  readStoredColumns,
  storeColumns,
  toggleColumn,
  type IntakeColumnKey,
  type IntakeLayoutProps,
} from "./intakeLayoutShared";

// Variant B — "Cockpit" (workbench console). Metaphor: instrument panels on a
// switchboard — a compact toolbar carries one switch per panel (draft ·
// conversation · brief · materials) with keyboard hints (Alt+1..4); a switched-
// off panel fully unmounts and the bench reflows to the remaining instruments
// (AnimatePresence crossfade, instant under reduced motion). Console register:
// META_LABEL headers, denser frames, the draft shown as a compact "posting
// preview" card. Materials is a first-class fourth instrument, default off.

const STORAGE_KEY = "kp-intake-cockpit-cols";
const PANELS: IntakeColumnKey[] = ["draft", "chat", "brief", "materials"];
const DEFAULT_OPEN: IntakeColumnKey[] = ["draft", "chat", "brief"];

export function JdsIntakeLayoutCockpit(props: IntakeLayoutProps) {
  const t = useTranslations("library.tab.intake.proto");
  const reduced = useReducedMotion();
  const [open, setOpen] = useState<IntakeColumnKey[]>(() => readStoredColumns(STORAGE_KEY, DEFAULT_OPEN));

  const flip = (key: IntakeColumnKey) =>
    setOpen((prev) => {
      const next = toggleColumn(prev, key);
      storeColumns(STORAGE_KEY, next);
      return next;
    });

  // Alt+1..4 flip the instruments — never while typing (inputs/textareas own
  // their keys; the composer must keep plain digits).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const idx = ["1", "2", "3", "4"].indexOf(e.key);
      if (idx === -1) return;
      e.preventDefault();
      flip(PANELS[idx]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const countFor = (key: IntakeColumnKey): string => {
    if (key === "chat") return String(props.counts.turns);
    if (key === "brief") return String(props.counts.requirements);
    if (key === "materials") return String(props.counts.attachments);
    return props.counts.draftReady ? "●" : "○";
  };

  const visible = PANELS.filter((k) => open.includes(k));

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={META_LABEL}>{t("columnsLabel")}</span>
        <div className={TOGGLE_GROUP}>
          {PANELS.map((key, i) => {
            const isOpen = open.includes(key);
            const lastOpen = isOpen && open.length === 1;
            return (
              <button
                key={key}
                type="button"
                onClick={() => flip(key)}
                disabled={lastOpen}
                aria-pressed={isOpen}
                title={lastOpen ? t("lastOpen") : isOpen ? t("hide", { column: t(`col.${key}`) }) : t("show", { column: t(`col.${key}`) })}
                className={`focus-ring flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors disabled:opacity-60 ${toggleBtn(isOpen)}`}
              >
                {/* eslint-disable-next-line i18next/no-literal-string -- key glyph, not copy */}
                <kbd className={`${KBD} hidden text-sm leading-none sm:inline-block`}>⌥{i + 1}</kbd>
                {t(`col.${key}`)}
                <span className="nums opacity-70">{countFor(key)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div
        // Inline style would beat the responsive class at every width, so the
        // template rides a CSS var applied only ≥lg; below that the bench
        // stacks single-column.
        className="grid grid-cols-1 gap-3 lg:[grid-template-columns:var(--cockpit-cols)]"
        style={{ "--cockpit-cols": `repeat(${Math.max(visible.length, 1)}, minmax(0, 1fr))` } as React.CSSProperties}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {visible.map((key) => (
            <motion.section
              key={key}
              layout={!reduced}
              initial={{ opacity: reduced ? 1 : 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: reduced ? 1 : 0 }}
              transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
              className="min-w-0 rounded-lg border border-stone-200 bg-white p-3 dark:rounded-2xl dark:shadow-sticker-sm"
            >
              <div className={`${META_LABEL} mb-2`}>{t(`col.${key}`)}</div>
              {key === "chat" ? (
                props.chat
              ) : key === "brief" ? (
                props.brief
              ) : key === "materials" ? (
                props.materials
              ) : (
                // The compact posting-preview frame: the draft reads as the
                // artifact-in-progress it is, set off from the bench.
                <div className="rounded-md border border-stone-200 bg-stone-50 p-3 dark:rounded-2xl">{props.draft}</div>
              )}
            </motion.section>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
