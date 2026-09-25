"use client";

import type { ReactNode } from "react";
import { Measure } from "./Measure";
import { Mark } from "./Mark";
import { SAVE_MARK, saveBarClass, type SaveTone } from "./fields";
import "./kit.css";

/**
 * @catalog The save bar of a draft-then-save surface: sticky at the sheet's foot, on the measure; its mark's shape and edge say clean / dirty / blocked / saving, one status line says why, the discard and save actions sit in the figure-to-act tracks.
 */
export function SaveBar({ tone, status, actions }: {
  tone: SaveTone;
  /** One line: what is saved, what is not, or why a save is refused. */
  status: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Measure className={saveBarClass(tone)} data-part="save-bar" data-role="kit-save-bar">
      <div className="k-row__mark" aria-hidden>
        <Mark kind={SAVE_MARK[tone]} />
      </div>
      <div className="k-savebar__status" role="status" data-role="kit-save-status">{status}</div>
      <div className="k-savebar__acts">{actions}</div>
    </Measure>
  );
}
