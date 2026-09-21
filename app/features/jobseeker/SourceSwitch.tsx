"use client";

import { Loader2 } from "lucide-react";
import { Tooltip } from "@/app/_components/Tooltip";
import { TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";

// THE seeker surfaces' on/off control — one switch, used by a source row
// (`SourceCard`) and by the scan clock (`ScansPage`).
//
// It exists because those two hand-rolled the SAME control twice, with no recipe
// behind either: `bg-moss/15 text-moss` when on, `bg-stone-200 text-steel` when off
// and no `dark:` half at all. `stone-200` is a BORDER token in Spark Dark, so "off"
// read as a hole punched in the panel rather than as a control at rest.
//
// The shape is the house toggle group (`TOGGLE_GROUP` + `toggleBtn`), which already
// carries both registers through the token seam: the rail is a bordered pill, the
// active half wears the app's `bg-ink` treatment, and the inactive half is quiet with
// a stone hover. Both states are legible at once, so "Off" is a position rather than
// an absence.
//
// SEMANTICS: ONE button with `role="switch"` + `aria-checked` — the two halves are
// spans, so a screen reader is told "switch, on/off" rather than being handed two
// controls for one state. `SchedulerJobRow` (the recruiter panel's generic row) is NOT
// reused: it is a whole row with a free-minutes cadence field and a policy-pass
// history, and its own toggle is the same unrecipe'd literal this replaces.
//
// ICON SIZE, stated once for these surfaces and followed everywhere in them
// (`ProfileRosterRow` is the ledger this borrows its density from): 13 for a glyph
// inline in a row's text, 14 for the leading glyph of an action button that also
// carries a label, 16 for an `IconAction` that carries no text at all.

export function SourceSwitch({
  on,
  label,
  hint,
  onLabel,
  offLabel,
  disabled = false,
  busy = false,
  onToggle,
  testId,
}: {
  on: boolean;
  /** The control's accessible name — what it switches, not its state. */
  label: string;
  /** Why it is unavailable, or what arming it buys. Tooltip only; costs no layout. */
  hint?: string | null;
  onLabel: string;
  offLabel: string;
  disabled?: boolean;
  busy?: boolean;
  onToggle(): void;
  testId?: string;
}) {
  const seg = "inline-flex items-center gap-1 rounded-md px-2.5 py-0.5 text-sm font-semibold transition-colors dark:rounded-lg";
  return (
    <Tooltip label={hint ? `${label} — ${hint}` : label}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled || busy}
        onClick={onToggle}
        className={`focus-ring ${TOGGLE_GROUP} h-8 disabled:opacity-60 dark:rounded-xl dark:shadow-sticker-xs`}
        data-testid={testId}
      >
        <span className={`${seg} ${toggleBtn(!on)}`}>{offLabel}</span>
        <span className={`${seg} ${toggleBtn(on)}`}>
          {busy ? <Loader2 size={13} aria-hidden className="animate-spin" /> : null}
          {onLabel}
        </span>
      </button>
    </Tooltip>
  );
}
