"use client";

import type { ReactNode } from "react";
import { ScenePress } from "@/app/_components/kit/scene";
import type { CellTier, CriterionStatus } from "../../cohortTypes";
import { MatrixGlyph } from "./MatrixGlyph";
import type { RowStats } from "./matrixModel";

/** What a column carries into every one of its cells: who, and how the head of the matrix marks it. */
export interface ColMarks {
  id: string;
  /** The reader's column (the focused member, else the first) and the column it is read against. */
  on: boolean;
  ref: boolean;
  pending: boolean;
  /** The claim's leader (separation clears), or inside the first column's noise. */
  lead: boolean;
  noise: boolean;
}

const colData = (c: ColMarks) => ({
  "data-mx-col": c.id,
  "data-on": c.on ? "" : undefined,
  "data-ref": c.ref ? "" : undefined,
  "data-pending": c.pending ? "" : undefined,
});

/** One navigable cell: a gridcell holding the press. `at` is "row:col", the roving focus key. */
export function GridPress({ at, tab, col, label, tip, kind, onPress, children, role = "gridcell", extra }: {
  at: string;
  tab: boolean;
  col: ColMarks;
  label: string;
  tip?: string;
  kind: "head" | "cell" | "count" | "foot";
  onPress: () => void;
  children: ReactNode;
  role?: "gridcell" | "columnheader";
  extra?: Record<string, string | undefined>;
}) {
  return (
    <div role={role} className={`mx-c mx-c--${kind}`} {...colData(col)} {...extra}>
      <ScenePress
        className="mx-press"
        data-mx-at={at}
        data-dim-member={col.id}
        tabIndex={tab ? 0 : -1}
        aria-label={label}
        data-dim-tip={tip ?? label}
        aria-current={col.on ? "true" : undefined}
        onClick={onPress}
      >
        {children}
      </ScenePress>
    </div>
  );
}

/** The column head: the claim cap (a lead, or the noise hatch), the decoy notch, the name set upright. */
export function HeadMark({ col, name, decoy }: { col: ColMarks; name: string; decoy: boolean }) {
  return (
    <>
      <span className="mx-cap" data-lead={col.lead ? "" : undefined} data-noise={col.noise ? "" : undefined} aria-hidden />
      {decoy ? <span className="mx-decoy" aria-hidden /> : null}
      <span className="mx-name">{name}</span>
    </>
  );
}

/** A status cell's drawing: the glyph, and a dot when the criterion carries a note to read. */
export function StatusMark({ status, note }: { status: CriterionStatus | "pending"; note: boolean }) {
  return (
    <>
      <MatrixGlyph status={status} />
      {note ? <span className="mx-notedot" aria-hidden /> : null}
    </>
  );
}

/** The foot: the rating as a gauge (how full) over its numeral, the tier carried by the gauge's paint; a pending column draws no gauge (an empty one would read as 0). */
export function FootMark({ rating, tier, comment }: { rating: number | null; tier: CellTier; comment: boolean }) {
  return (
    <>
      {rating == null ? (
        <MatrixGlyph status="pending" />
      ) : (
        <span className="mx-gauge" data-tier={tier} aria-hidden>
          <span className="mx-gauge__fill" style={{ blockSize: `${rating}%` }} />
        </span>
      )}
      <span className="mx-rating k-nums">{rating ?? "—"}</span>
      {comment ? <span className="mx-commentdot" aria-hidden /> : null}
    </>
  );
}

/** A row's head: the criterion, its summary in the row's voice, and the split drawn as a strip. */
export function RowHead({ phrase, summary, stats, differs, diffLabel, alike }: {
  phrase: string;
  summary: string;
  stats: RowStats;
  differs: boolean;
  diffLabel: string;
  alike: string;
}) {
  const parts = (["meets", "partial", "misses", "unknown"] as const).filter((s) => stats[s] > 0);
  return (
    <div role="rowheader" className="mx-rowhead" data-differs={differs ? "" : undefined}>
      <span className="mx-rowhead__phrase">{phrase}</span>
      <span className="mx-rowhead__sum">
        <span className="mx-split" aria-hidden>
          {parts.map((s) => (
            <span key={s} className="mx-split__seg" data-status={s} style={{ flexGrow: stats[s] }} />
          ))}
        </span>
        <span className="k-nums">{summary}</span>
        {stats.split === 0 && stats.rated > 1 ? <span className="mx-alike">{alike}</span> : null}
      </span>
      {differs ? (
        <span className="mx-differs" role="img" aria-label={diffLabel}>
          {"≠"}
        </span>
      ) : null}
    </div>
  );
}
