"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Maximize2, Minimize2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { IconAction } from "@/app/_components/IconAction";
import type { IntakeColumnKey } from "../studioContract";

// ATELIER — the desk's PLANE, and the zone that lives on it.
//
// The classic desk nests: three rounded, bordered cards floating inside another
// rounded bordered card. Atelier keeps the same three zones and the same
// information and removes the boxes. There is ONE surface; a zone is separated
// from its neighbour by a hairline, and its hierarchy comes from type and space
// — an uppercase mark, a bare tabular numeral, a band of air — not from a radius
// and a shadow.
//
// The head is quiet by construction: the fold control is invisible until the
// pointer or the keyboard is inside the zone (`group-hover` / `group-focus-within`),
// so a reader looking at a brief sees the brief and not three chrome buttons.
//
// FOLDING IS A WIDTH TWEEN, not a swap. The section is always mounted and framer's
// `layout` animates the width; the COUNT is the shared element that survives the
// fold — same `layoutId` on the head numeral and on the rail numeral, so the one
// fact the folded zone still owes the reader visibly travels rather than blinking
// out on one side and in on the other.

/** House ease (docs/design/README.md · AnalyzeWorkspace's segmented standard). */
export const ATELIER_EASE = [0.16, 1, 0.3, 1] as const;
export const ATELIER_SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };

export function AtelierZone({
  zoneKey,
  label,
  count,
  countHint,
  open,
  canFold,
  onToggle,
  busy = false,
  first = false,
  grow = "xl:flex-1",
  scroll = true,
  children,
}: {
  zoneKey: IntakeColumnKey;
  label: string;
  /** A bare numeral, or the draft's one-glyph state. Never a pill. */
  count: string;
  /** What the numeral means — carried in the fold control's tooltip and read out. */
  countHint: string;
  open: boolean;
  /** False on the last open zone: the desk never folds to nothing. */
  canFold: boolean;
  onToggle: () => void;
  /** The reply in flight will rewrite this zone. A fact about the zone, not a spinner. */
  busy?: boolean;
  first?: boolean;
  grow?: string;
  /** False where the child owns its own scroller (the conversation). */
  scroll?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("library.tab.intake.columns");
  const reduced = useReducedMotion();

  return (
    <motion.section
      layout={!reduced}
      transition={{ layout: { duration: reduced ? 0 : 0.28, ease: ATELIER_EASE } }}
      className={`group/zone flex min-w-0 flex-col ${
        first ? "" : "border-t border-stone-200 pt-3 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-4"
      } ${open ? `max-h-[50dvh] xl:max-h-none xl:pr-4 ${grow}` : "shrink-0 xl:w-11"}`}
    >
      {open ? (
        <>
          <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-2 bg-white pb-2">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className={`${META_LABEL} truncate ${busy ? "animate-pulse" : ""}`}>{label}</span>
              <motion.span layoutId={`atelier-count-${zoneKey}`} className="shrink-0 text-sm text-stone-400 nums">
                {count}
              </motion.span>
            </span>
            <span className="opacity-0 transition-opacity group-focus-within/zone:opacity-100 group-hover/zone:opacity-100">
              <IconAction
                icon={Minimize2}
                label={t("hide", { column: label })}
                hint={countHint}
                side="bottom"
                size={14}
                disabled={!canFold}
                onClick={onToggle}
              />
            </span>
          </div>
          <div className={`min-h-0 flex-1 ${scroll ? "overflow-y-auto pr-1" : "flex flex-col"}`}>{children}</div>
        </>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          aria-label={t("show", { column: label })}
          title={countHint}
          className="focus-ring flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-steel transition-colors hover:text-ink xl:flex-col xl:py-4"
        >
          <Maximize2 size={13} aria-hidden className="opacity-0 transition-opacity group-hover/zone:opacity-100" />
          <span className={`text-meta uppercase ${busy ? "animate-pulse" : ""} xl:[writing-mode:vertical-rl]`}>{label}</span>
          <motion.span layoutId={`atelier-count-${zoneKey}`} className="text-sm text-stone-400 nums">
            {count}
          </motion.span>
        </button>
      )}
    </motion.section>
  );
}

/** An empty region shows the SHAPE of what will fill it — a hairline skeleton of
 *  the rows to come — never a sentence promising that it will. Decorative by
 *  construction, so it is hidden from assistive tech: there is nothing to read. */
export function AtelierGhost({ rows = 4, gutter = true }: { rows?: number; gutter?: boolean }) {
  const widths = ["w-4/5", "w-3/5", "w-11/12", "w-2/3", "w-3/4", "w-1/2"];
  return (
    <div aria-hidden className="space-y-3.5 pt-1">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          {gutter ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-stone-200" /> : null}
          <span className={`h-px ${widths[i % widths.length]} bg-stone-200`} />
        </div>
      ))}
    </div>
  );
}
