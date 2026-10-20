"use client";

import type { ReactNode } from "react";
import { Measure } from "./Measure";
import "./kit.css";
import "./menu.css";

/**
 * @catalog A quiet line on the measure from the name track: one lead word, then chips and small actions that wrap (a saved-views row, a mode's options). Renders nothing without children.
 */
export function ActionLine({ lead, label, children }: { lead?: string; label: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <Measure className="k-actline" role="group" aria-label={label} data-part="action-line">
      <div className="k-actline__body">
        {lead ? <span className="k-actline__lead" aria-hidden>{lead}</span> : null}
        {children}
      </div>
    </Measure>
  );
}
