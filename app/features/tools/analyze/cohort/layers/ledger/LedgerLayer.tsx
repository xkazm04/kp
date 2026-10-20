"use client";

// The Verdict ledger (spark analyze-v2-cohort round 2): the nested dimension layer as a ledger ranked
// by this dimension's rating. Each line says WHY its number is what it is — the one-line why, the
// decisive pros and cons, notes as a quiet third line — and opens into every reason with its evidence
// and the rating's exact anatomy. One component for all seven dimensions; the claim strip on top keeps
// the lead / within-the-noise / below-floor / salary-never-ranked vocabulary.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { ChipRow, type Chip } from "@/app/_components/kit";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { DimensionLayerProps } from "../../cohortTypes";
import { DimensionClaim } from "../../dimensions/DimensionClaim";
import { DimensionTips } from "../../dimensions/DimensionTips";
import { makeStops, stepMember } from "../../dimensions/dimensionModel";
import { buildLedger, filterRows, hasMusts, type LedgerFilter } from "./ledgerModel";
import { LedgerRow } from "./LedgerRow";
import { LedgerRest } from "./LedgerRest";
import "../../dimensions/dimensions.css";
import "./ledger.css";

/** The workspace's chord window: a key within it after a bare `g` belongs to the `g` chord. */
const CHORD_WINDOW_MS = 1500;
const isEditable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
const stopSelector = (id: string) => `[data-dim-stop][data-dim-member="${CSS.escape(id)}"]`;

export function LedgerLayer({ view, dimension, focusMemberId, onFocusMember, onOpenReport }: DimensionLayerProps) {
  const t = useTranslations("analyzeCohort");
  const tl = useTranslations("analyzeCohort.layerLedger");
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const lastG = useRef(0);
  const [picked, setPicked] = useState<LedgerFilter>("all");
  // The row the descent came from opens expanded: arriving from a candidate shows their whole why.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(focusMemberId ? [focusMemberId] : []));

  const ledger = useMemo(() => buildLedger(view, dimension), [view, dimension]);
  const criteria = view.criteria[dimension] ?? [];
  const musts = hasMusts(criteria);
  const filter: LedgerFilter = picked === "mustMiss" && !musts ? "all" : picked;
  const rows = filterRows(ledger.rows, filter, criteria);
  const missCount = musts ? filterRows(ledger.rows, "mustMiss", criteria).length : 0;

  // Scroll only on a focus CHANGE (pressed, or reached by j/k), never on mount: the world owns the
  // descent's positioning, and a scroll there would yank the viewport mid-animation.
  const prevFocus = useRef(focusMemberId);
  useEffect(() => {
    if (prevFocus.current === focusMemberId) return;
    prevFocus.current = focusMemberId;
    if (!focusMemberId) return;
    root.current?.querySelector<HTMLElement>(stopSelector(focusMemberId))?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [focusMemberId, reduced]);

  // j/k and up/down walk the rows while focus is inside the ledger; yields like the dimension pages:
  // a modifier, a field, a key already handled, the second key of a workspace `g` chord.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
    if (e.key.toLowerCase() === "g" && !e.shiftKey) {
      lastG.current = Date.now();
      return;
    }
    const delta = e.key === "j" || e.key === "ArrowDown" ? 1 : e.key === "k" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    if (lastG.current && Date.now() - lastG.current < CHORD_WINDOW_MS) {
      lastG.current = 0;
      return;
    }
    const stops = [...(root.current?.querySelectorAll<HTMLElement>("[data-dim-stop]") ?? [])];
    const ids = stops.map((el) => el.dataset.dimMember ?? "");
    const here = e.target instanceof Element ? (e.target.closest("[data-dim-member]") as HTMLElement | null)?.dataset.dimMember : undefined;
    const next = stepMember(ids, here ?? focusMemberId, delta);
    if (!next) return;
    e.preventDefault();
    stops[ids.indexOf(next)]?.focus();
    onFocusMember(next);
  };

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const chips: Chip[] = [
    { id: "all", label: tl("filter.all"), pressed: filter === "all", onPress: () => setPicked("all") },
    { id: "cons", label: tl("filter.cons"), pressed: filter === "cons", onPress: () => setPicked("cons") },
    ...(musts
      ? [{ id: "mustMiss", label: tl("filter.mustMiss"), count: missCount, disabled: missCount === 0, pressed: filter === "mustMiss", onPress: () => setPicked("mustMiss") }]
      : []),
  ];
  const stops = makeStops();
  const rest = [...(ledger.pending.length ? [{ reason: "pending" as const, members: ledger.pending }] : []), ...ledger.absent];
  return (
    <div
      ref={root}
      className="cd-dim lg k-kit"
      data-cohort-layer="ledger"
      data-dimension={dimension}
      data-filter={filter}
      data-kind={ledger.positionKind}
      role="region"
      aria-label={tl("region", { dimension: t(`dims.${dimension}`) })}
      onKeyDown={onKeyDown}
    >
      <DimensionClaim view={view} dimension={dimension} />
      <div className="lg-bar">
        <span className="lg-bar__k">{tl("filter.label")}</span>
        <ChipRow chips={chips} />
        {dimension === "fit" ? <span className="lg-bar__model">{tl("modelGivenBar")}</span> : null}
        <span className="lg-bar__count k-nums" aria-live="polite">
          {tl("count", { shown: rows.length, rated: ledger.rows.length, total: view.members.length })}
        </span>
      </div>
      <div className="lg-table">
        <div className="lg-head" aria-hidden>
          <span>{tl(`col.${ledger.positionKind}`)}</span>
          <span>{tl("col.candidate")}</span>
          <span>{tl("col.rating")}</span>
          <span className="lg-head__why">{tl("col.why")}</span>
          {filter === "cons" ? null : <span className="lg-head__pros">{tl("col.pros")}</span>}
          <span className="lg-head__cons">{tl(filter === "mustMiss" ? "col.misses" : "col.cons")}</span>
        </div>
        <ol className="lg-rows" aria-label={tl("list", { dimension: t(`dims.${dimension}`), count: rows.length })}>
          {rows.map((row) => (
            <LedgerRow
              key={row.member.memberId}
              row={row}
              first={ledger.positionKind === "rank" && row !== ledger.rows[0] ? ledger.rows[0].why : null}
              view={view}
              dimension={dimension}
              kind={ledger.positionKind}
              filter={filter}
              criteria={criteria}
              focusId={focusMemberId}
              stop={stops(row.member.memberId, "row")}
              expanded={open.has(row.member.memberId)}
              onToggle={() => toggle(row.member.memberId)}
              onFocusMember={onFocusMember}
              onOpenReport={onOpenReport}
            />
          ))}
        </ol>
        {rest.map((g) => (
          <LedgerRest key={g.reason} view={view} dimension={dimension} reason={g.reason} members={g.members} focusId={focusMemberId} stops={stops} onFocusMember={onFocusMember} onOpenReport={onOpenReport} />
        ))}
      </div>
      <DimensionTips root={root} />
    </div>
  );
}
