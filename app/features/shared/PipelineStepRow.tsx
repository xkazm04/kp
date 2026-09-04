"use client";

// ONE editable pipeline column, as a form row — the shape both axis editors use.
//
// Two surfaces edit the board's columns under the same rules (pipelineAxisDraft.ts)
// and with the same words (usePipelineAxisCopy.ts): Settings → Hiring and the
// first-run wizard's Pipeline step. Until now they also each drew their own row,
// which is how they drifted — different control order, different widths, so the
// two lists of the same five columns did not even line up the same way. The RULES
// were shared, the WORDS were shared; this shares the ROW.
//
// Layout, fixed for both callers:
//
//     1.  [ type ▾ ] │ [ what you call it ] │ < policy >  <meta>   ↑ ↓ ✕
//         └ w-40 ───┘                         └ w-23rem ┘
//
// In TABULAR mode the columns are separated by a hairline rule with 2px of air on
// each side, drawn as a left border on the cell that follows it — so the divider
// and the content it precedes can never drift apart, and the header row (which
// reuses the same cell classes) lines up with the cells by construction rather
// than by two width literals agreeing. The cells stretch to the row's height, so a
// row whose policy runs two lines still shows one unbroken rule.
//
// The POLICY slot is the merged editor's half: what runs at this column and who
// approves it (Settings → Hiring). It is fixed-width and always rendered when the
// caller supplies the slot at all — including for columns that carry no policy,
// which render an em dash rather than collapsing, because a row that silently
// loses a cell breaks the alignment of every row under it. The wizard passes no
// policy at all and the column disappears for every row equally.
//
// TYPE FIRST, then the name. The type is the closed vocabulary every product rule
// resolves through (the fairness gate, the move menu's terminal exclusion, org
// benchmarks) and it is what makes the free-text name legible — reading "Tech
// screen" tells you nothing until you know it is an Interview. It is also the only
// cell with a fixed width, so a column of pickers lines up down the list and the
// elastic name field is the one thing that flexes.
//
// What differs between callers is passed in, never branched on here: which roles
// are assignable, whether this row's type is FIXED (the wizard pins its entry and
// terminal columns), what `meta` says (a stored id, a "new" badge, an occupancy
// count), and every accessible name — the two callers read from different catalog
// namespaces and must keep their own sentences.
import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { ReactNode } from "react";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_GHOST, BTN_SECONDARY } from "@/app/_components/ui/recipes";
import type { PipelineStageRoleWire } from "@/app/_lib/decision-config-schema";

/** The type cell's width, in both editors. Exported so a caller rendering its own
 *  cell in that column (a fixed-type chip, a header label) stays in the grid. */
export const PIPELINE_STEP_TYPE_WIDTH = "w-40";
/** A column that follows a divider: the hairline, then 2px of air on each side.
 *  The header uses the same class, which is what keeps the rule and the column it
 *  separates in lockstep. */
export const PIPELINE_STEP_CELL = "flex items-center self-stretch border-l border-stone-200 px-0.5";
/** The first column after the row number — same box, no rule to its left. */
export const PIPELINE_STEP_CELL_FIRST = "flex items-center self-stretch px-0.5";
/** The name column's width in tabular mode. Half of what it was: rich title
 *  editing is not what this row is for, a column's name is short by nature, and
 *  the space buys policy labels that do not truncate. It still flexes below the
 *  cap so the row degrades on a narrow window rather than overflowing. */
export const PIPELINE_STEP_LABEL_WIDTH = "min-w-24 max-w-[15rem] flex-1";
/** The policy cell's width — one ROUND's decisions on one line: who reaches it,
 *  who runs it, who approves it, and a remove. Each is ONE button showing its
 *  current value, so the line fits without wrapping; a column running two rounds
 *  stacks them vertically inside this width. The name field gives up the space; a
 *  column's name is short and rich title editing is not what this row is for. */
export const PIPELINE_STEP_POLICY_WIDTH = "w-[23rem]";

export type PipelineStepRowAria = {
  /** Name of the label field ("Name of step 3"). */
  label: string;
  /** Name of the type picker ("What Screened means in the process"). */
  role: string;
  moveUp: string;
  moveDown: string;
  remove: string;
};

export function PipelineStepRow({
  index,
  label,
  onLabel,
  role,
  roleOptions,
  roleLabel,
  onRole,
  roleFixed = false,
  meta,
  policy,
  tabular = false,
  labelTitle,
  onMove,
  canMoveUp,
  canMoveDown,
  onRemove,
  canRemove = true,
  removeTitle,
  aria,
}: {
  /** Zero-based position; rendered 1-based. */
  index: number;
  label: string;
  onLabel: (value: string) => void;
  role: string;
  /** Roles this caller lets the reader assign (the wizard withholds entry/terminal). */
  roleOptions: readonly string[];
  roleLabel: (role: string) => string;
  onRole: (role: PipelineStageRoleWire) => void;
  /** Structural column: its type is stated, not offered. Same cell, same width. */
  roleFixed?: boolean;
  /** Facts about this row that only one caller has (stored id, occupancy…). */
  meta?: ReactNode;
  /** What runs here and who approves it. Supply `null` for a column that carries
   *  no policy — the cell still reserves its width, so the rows stay in a grid.
   *  Omit the prop entirely (the wizard) and the column does not exist. */
  policy?: ReactNode;
  /** Rendered as a TABLE — under column headings, with dividers between columns
   *  and the policy column present. Settings → Hiring sets it; the wizard's
   *  fine-tune list is a plain list and leaves it off. */
  tabular?: boolean;
  /** Hover text for the name field. Settings puts the stored key here now that it
   *  has no column of its own. */
  labelTitle?: string;
  onMove: (delta: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Omit entirely to render NO remove control (a column that can never go). */
  onRemove?: () => void;
  canRemove?: boolean;
  /** Why remove is disabled, when it is — shown on hover. */
  removeTitle?: string;
  aria: PipelineStepRowAria;
}) {
  // Dividers and the halved name field are TABLE chrome: they separate headed
  // columns. The wizard's list has no headings, so a rule there would separate
  // nothing named, and it keeps the roomier plain-list spacing.
  const cellFirst = tabular ? PIPELINE_STEP_CELL_FIRST : "flex items-center";
  const cell = tabular ? PIPELINE_STEP_CELL : "flex items-center";

  return (
    <li
      className={`flex flex-wrap items-stretch rounded-md border border-stone-200 bg-paper/50 px-2.5 py-2 ${
        tabular ? "gap-0" : "gap-2"
      }`}
    >
      <span className="nums flex w-5 shrink-0 items-center pr-0.5 text-sm text-stone-400">{index + 1}.</span>

      <span className={`${cellFirst} ${PIPELINE_STEP_TYPE_WIDTH} shrink-0`}>
        {roleFixed ? (
          // Not a disabled Select: a control that can never be operated reads as
          // broken. It states the role, in the picker's slot and at the picker's
          // width, so the rows below it still line up.
          <span className="flex h-9 w-full items-center rounded-md border border-dashed border-stone-300 px-2.5 text-sm font-semibold text-moss">
            {roleLabel(role)}
          </span>
        ) : (
          <Select
            value={role}
            onChange={(next) => onRole(next as PipelineStageRoleWire)}
            ariaLabel={aria.role}
            sizeVariant="sm"
            className="w-full"
            options={roleOptions.map((r) => ({ value: r, label: roleLabel(r) }))}
          />
        )}
      </span>

      <span className={`${cell} ${tabular ? PIPELINE_STEP_LABEL_WIDTH : "min-w-40 flex-1"}`}>
        <TextInput
          type="text"
          value={label}
          onChange={(e) => onLabel(e.target.value)}
          aria-label={aria.label}
          title={labelTitle}
          sizeVariant="sm"
          className="w-full"
        />
      </span>

      {tabular ? (
        // A COLUMN, not a wrapping row: each child is one self-contained line
        // (a round, or a column-level gate), so a two-round column reads as two
        // lines instead of one ragged block. No rule of its own — the cohort slot
        // inside carries the divider, so header and cell share one source.
        <span className={`${PIPELINE_STEP_POLICY_WIDTH} flex shrink-0 flex-col items-start gap-1 self-stretch`}>
          {policy ?? <span className="flex h-8 items-center px-2 text-sm text-stone-400">—</span>}
        </span>
      ) : null}

      {meta}

      <span className="ml-auto flex shrink-0 items-center gap-1 self-center pl-2">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={!canMoveUp}
          aria-label={aria.moveUp}
          className={`${BTN_SECONDARY} h-7 w-7 justify-center p-0`}
        >
          <ArrowUp size={13} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={!canMoveDown}
          aria-label={aria.moveDown}
          className={`${BTN_SECONDARY} h-7 w-7 justify-center p-0`}
        >
          <ArrowDown size={13} aria-hidden />
        </button>
        {/* A row with no `onRemove` gets no button at all — a permanently disabled
            control would only be furniture. A row that CAN'T be removed right now
            (candidates standing on it) keeps the disabled button, because there the
            reason is real, temporary, and worth saying. */}
        {/* BTN_GHOST is the quiet, borderless action recipe (focus ring, steel rest,
            soft hover wash, dark sticker radius); the destructive HOVER tone and the
            sharper disabled fade are the two things a remove genuinely differs by, so
            they are all that is added to it. The hand-typed string this replaces had
            no dark-mode radius at all. */}
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={!canRemove}
            title={removeTitle}
            aria-label={aria.remove}
            className={`${BTN_GHOST} p-1 hover:bg-transparent hover:text-coral disabled:opacity-40 disabled:hover:text-steel`}
          >
            <X size={14} aria-hidden />
          </button>
        ) : null}
      </span>
    </li>
  );
}
