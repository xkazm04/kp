"use client";

import { useId, type ReactNode } from "react";
import "./scene.css";

/** The token a level's plane is tinted with: steel (the default), moss, coral, amber, stone. */
export type LevelTone = "steel" | "moss" | "coral" | "amber" | "stone";

/**
 * @catalog The frame every level below a stack's root is written in: the trail, a head (kicker, the level's heading, one lead line, at most one action), an optional drawing beside the sheet, the sheet, and a foot (a stepper, the level's keys).
 *
 * `tone` tints the level's plane with one token, quietly in Studio Light and as a deep ground in
 * Spark Dark. The heading takes focus when the level opens (`data-level-heading`, `tabIndex -1`,
 * no ring: a landmark, not a control). `trail` is a `LevelTrail`, `keys` a `KeyHints`. The art
 * column folds under the sheet when the surface's size container is 900px or narrower.
 */
export function LevelFrame({ tone = "steel", kicker, title, lead, actions, art, artPlace = "side", trail, foot, keys, children }: {
  tone?: LevelTone;
  kicker: string;
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  /** A drawing of the place (decorative, with its condition beside it). */
  art?: ReactNode;
  /** `side`: its own column beside the sheet; `head`: small, in the sheet's head (a body that
   *  needs the full width, e.g. a table with a reading pane). */
  artPlace?: "side" | "head";
  trail: ReactNode;
  foot?: ReactNode;
  keys?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  const side = art && artPlace === "side";
  return (
    <section className="k-lvl" data-tone={tone} aria-labelledby={headingId}>
      <div className="k-lvl__bar">{trail}</div>
      <div className="k-lvl__body" data-art={side ? "1" : undefined}>
        {side ? <div className="k-lvl__art">{art}</div> : null}
        <div className="k-lvl__sheet">
          <div className="k-lvl__head">
            {art && artPlace === "head" ? <div className="k-lvl__art k-lvl__art--head">{art}</div> : null}
            <div className="k-lvl__titles">
              <p className="k-lvl__kicker">{kicker}</p>
              <h2 id={headingId} className="k-lvl__title" tabIndex={-1} data-level-heading="">
                {title}
              </h2>
              {lead ? <p className="k-lvl__lead">{lead}</p> : null}
            </div>
            {actions ? <div className="k-lvl__acts">{actions}</div> : null}
          </div>
          {children}
        </div>
      </div>
      <div className="k-lvl__foot">
        {foot}
        {keys}
      </div>
    </section>
  );
}
