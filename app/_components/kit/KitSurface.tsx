"use client";

import { useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Density } from "./types";
import { KitTipLayer } from "./KitTipLayer";
import { useKitKeys } from "./useKitKeys";
import "./kit.css";

/**
 * @catalog The root of a kit surface: sets the density tier, owns the one delegated tip and the j/k/Esc keys, and lays the sheet beside a reading pane that exists only while something is selected.
 */
export function KitSurface({
  density = "compact",
  pane,
  onStep,
  onClose,
  children,
}: {
  density?: Density;
  /** The ReadingPane, or null: no selection means no pane and no column for one. */
  pane?: ReactNode;
  /** j / k: step the selection through the surface's list. */
  onStep?: (delta: 1 | -1) => void;
  /** Esc: close the pane (clear the selection). */
  onClose?: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("kit.pane");
  const root = useRef<HTMLDivElement>(null);
  const open = pane != null && pane !== false;
  useKitKeys({ onStep, onClose: open ? onClose : undefined });
  return (
    <div ref={root} className="k-kit" data-density={density} data-role="kit-surface">
      <div className="k-stage" data-detail={open ? "open" : "shut"}>
        <div className="k-sheet">{children}</div>
        {open ? (
          <aside className="k-margin is-entering" aria-label={t("label")} data-role="kit-pane">
            {pane}
          </aside>
        ) : null}
      </div>
      <KitTipLayer root={root} />
    </div>
  );
}
