"use client";

// The position row's context menu (right-click, or the keyboard's menu key on the
// row header): three actions on everyone standing in the row's ENTRY column — the
// CVs that arrived and nobody has looked at yet. Accept all passes them to the next
// column, Reject all closes them (armed by a second click — it emails everyone),
// AI evaluate runs the screener over them as one background task.
//
// Fixed at the pointer, portalled to <body> so no board transform can clip it; a
// click outside, Escape or any choice closes it. Arrow keys walk the items.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Ban, Check, Sparkles, type LucideIcon } from "lucide-react";
import { META_LABEL, POPOVER } from "@/app/_components/ui/recipes";
import type { LineAction } from "../mapTypes";

const ITEMS: { id: LineAction; icon: LucideIcon; tone: string }[] = [
  { id: "acceptAll", icon: Check, tone: "text-moss" },
  { id: "aiEvaluate", icon: Sparkles, tone: "text-coral" },
  { id: "rejectAll", icon: Ban, tone: "text-red-700" },
];

export function LineContextMenu({
  at,
  count,
  onPick,
  onClose,
}: {
  at: { x: number; y: number };
  /** How many entry-column candidates the actions would touch. */
  count: number;
  onPick: (action: LineAction) => void;
  onClose: () => void;
}) {
  const t = useTranslations("pipeline.board.lineMenu");
  const ref = useRef<HTMLDivElement | null>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
      next?.focus();
      e.preventDefault();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep the menu on screen near the pointer.
  const style = { left: Math.min(at.x, window.innerWidth - 240), top: Math.min(at.y, window.innerHeight - 160) };
  const pick = (id: LineAction) => {
    if (id === "rejectAll" && !armed) {
      setArmed(true);
      return;
    }
    onPick(id);
    onClose();
  };

  return createPortal(
    <div ref={ref} role="menu" aria-label={t("aria", { count })} style={style} className={`${POPOVER} fixed z-50 w-56 p-1`}>
      <p className={`${META_LABEL} px-2 py-1.5`}>{t("scope", { count })}</p>
      {ITEMS.map(({ id, icon: Icon, tone }) => {
        const arming = id === "rejectAll" && armed;
        return (
          <button
            key={id}
            type="button"
            role="menuitem"
            disabled={count === 0}
            onClick={() => pick(id)}
            className={`focus-ring flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-stone-100 disabled:cursor-default disabled:opacity-50 ${
              arming ? "bg-red-50 font-semibold text-red-700" : ""
            }`}
          >
            <Icon size={14} className={`shrink-0 ${tone}`} aria-hidden />
            {arming ? t("confirmRejectAll", { count }) : t(id)}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
