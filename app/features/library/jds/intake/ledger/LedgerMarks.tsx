"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Tooltip } from "@/app/_components/Tooltip";
import { SHAPE_HUE, SHAPE_KEY, STATUS_MARK, tickRun, type LedgerStatus } from "./ledgerKit";
import type { IntakeShape } from "../jdsIntakeLogic";

// THE THREE MARKS every record is made of. They are the whole visual argument
// of this coat: a kind, a length and an outcome, drawn once here and reused
// identically by the plane and by the dossier — so the row a reader clicks and
// the record the rail expands are plainly the same object.
//
// Each mark is an `img` with a real name, so a screen reader gets the fact
// without the tooltip and the tip is the pointer affordance on top. Only the
// promoted mark takes focus, because only it is a door: three focus stops per
// record would make a 20-row plane a 60-stop tab order for information that is
// already read out.

/** The kind of run, in a fixed gutter. A column you can scan straight down. */
export function ShapeMark({ shape }: { shape: IntakeShape }) {
  const t = useTranslations("library.tab.intake");
  const label = shape ? t(SHAPE_KEY[shape]) : t("ledger.shapeNone");
  return (
    <Tooltip label={label} side="right">
      <span role="img" aria-label={label} className="flex h-4 w-4 items-center justify-center">
        <span
          aria-hidden
          className={`h-2 w-2 rounded-sm ${shape ? SHAPE_HUE[shape] : "border border-stone-300"}`}
        />
      </span>
    </Tooltip>
  );
}

/** HOW LONG WAS THIS CONVERSATION — one tick per turn, borrowed from the
 *  console coat's timeline rail and laid on its side. The number is still
 *  there for anyone who wants it (and for every screen reader), it is simply
 *  not what the eye has to parse first. */
export function TurnTicks({ turns }: { turns: number }) {
  const t = useTranslations("library.tab.intake");
  const { ticks, overflow } = tickRun(turns);
  const label = t("turns", { count: turns });
  return (
    <Tooltip label={label} side="top">
      <span role="img" aria-label={label} className="flex items-center gap-[3px] py-1">
        {ticks === 0 ? <span aria-hidden className="h-px w-4 bg-stone-200" /> : null}
        {Array.from({ length: ticks }, (_, i) => (
          <span key={i} aria-hidden className="h-2.5 w-px bg-stone-400" />
        ))}
        {overflow > 0 ? <span aria-hidden className="pl-1 text-sm text-stone-400 nums">{turns}</span> : null}
      </span>
    </Tooltip>
  );
}

/** WHERE THE RUN ENDED. A promoted run's mark is the door to the JD it made —
 *  the one question the old `promoted` pill raised and could not answer. */
export function StatusMark({ status, jdSlug }: { status: LedgerStatus; jdSlug: string | null }) {
  const t = useTranslations("library.tab.intake");
  const statusLabel = t(`status.${status}`);
  const mark = <span aria-hidden className={STATUS_MARK[status]} />;

  if (status === "promoted" && jdSlug) {
    const label = `${statusLabel} — ${t("ledger.summaryJd")}`;
    return (
      <Tooltip label={label} side="left">
        <Link
          href={`/jds/${encodeURIComponent(jdSlug)}`}
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className="focus-ring flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-coral/10"
        >
          {mark}
        </Link>
      </Tooltip>
    );
  }
  return (
    <Tooltip label={statusLabel} side="left">
      <span role="img" aria-label={statusLabel} className="flex h-6 w-6 items-center justify-center">
        {mark}
      </span>
    </Tooltip>
  );
}

/** An empty region draws the SHAPE of what will fill it — record rows in
 *  outline, gutter mark and all — never a sentence promising that it will. */
export function LedgerGhost({ rows = 3 }: { rows?: number }) {
  const widths = ["w-2/5", "w-1/2", "w-1/3", "w-3/5"];
  return (
    <div aria-hidden className="space-y-4 py-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="h-2 w-2 shrink-0 rounded-sm border border-stone-200" />
          <span className={`h-px ${widths[i % widths.length]} bg-stone-200`} />
          <span className="ml-auto flex items-center gap-[3px]">
            {Array.from({ length: 4 + i }, (_, k) => (
              <span key={k} className="h-2 w-px bg-stone-200" />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
