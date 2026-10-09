"use client";

// The Criteria matrix (spark analyze-v2-cohort round 2, layer `matrix`): the nested dimension
// layer as the role's checklist against the field. Rows are the role's criteria for this
// dimension (must, target, nice, then observed signals; the most splitting first inside each),
// columns are the candidates (by this dimension's rating; salary by figure, never ranked), and
// every cell is a status glyph whose note opens on focus. Under it, the reader's column explained:
// the one-line why, how the number was built, the pros and cons with evidence, and the rows where
// they differ from the column they are read against. One component for all seven dimensions.
import { useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { KeyHints } from "@/app/_components/kit/scene";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { DimensionLayerProps } from "../../cohortTypes";
import { DimensionClaim } from "../../dimensions/DimensionClaim";
import { DimensionTips } from "../../dimensions/DimensionTips";
import { Remainder, makeStops } from "../../dimensions/dimensionParts";
import { absentGroups } from "../../dimensions/dimensionModel";
import { differences, headClaim, matrixColumns, matrixGroups, readPair } from "./matrixModel";
import { MatrixGlyph } from "./MatrixGlyph";
import { MatrixGrid } from "./MatrixGrid";
import { MatrixReadout } from "./MatrixReadout";
import "../../dimensions/dimensions.css";
import "./matrix.css";

const LEGEND = ["meets", "partial", "misses", "unknown"] as const;

export function MatrixLayer({ view, dimension: d, focusMemberId, onFocusMember, onOpenReport }: DimensionLayerProps) {
  const t = useTranslations("analyzeCohort.layerMatrix");
  const tDim = useTranslations("analyzeCohort.dims");
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const columns = useMemo(() => matrixColumns(view, d), [view, d]);
  const groups = useMemo(() => matrixGroups(view.criteria[d], columns, d), [view, d, columns]);
  const head = useMemo(() => headClaim(view, d, columns), [view, d, columns]);
  const { focus, ref } = readPair(columns, focusMemberId);
  const diffs = useMemo(() => (focus && ref ? differences(groups, d, focus.member, ref.member) : []), [groups, d, focus, ref]);
  const differs = useMemo(() => new Set(diffs.map((x) => x.criterion.id)), [diffs]);
  const pendingFocus = columns.find((c) => c.member.memberId === focusMemberId && c.state === "pending")?.member.label ?? null;
  const voiceForLegend = d === "trust" ? "trust" : d === "signals" ? "signal" : "req";

  // A focus that changes AFTER mount scrolls its column into view; the first render never scrolls
  // (the world owns the descent's positioning, as on the round-1 pages).
  const prevFocus = useRef(focusMemberId);
  useEffect(() => {
    if (prevFocus.current === focusMemberId) return;
    prevFocus.current = focusMemberId;
    if (!focusMemberId) return;
    // Sideways only, inside the matrix's own scroller: the column comes out from under the sticky
    // criteria, and the page never jumps (a reader deep in the rows keeps their place).
    const sc = root.current?.querySelector<HTMLElement>(".mx-scroll");
    const el = sc?.querySelector<HTMLElement>(`.mx-c--head[data-mx-col="${CSS.escape(focusMemberId)}"]`);
    if (!sc || !el) return;
    const label = sc.querySelector(".mx-corner")?.getBoundingClientRect().width ?? 0;
    const s = sc.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const dx = r.left < s.left + label ? r.left - s.left - label : r.right > s.right ? r.right - s.right : 0;
    if (dx) sc.scrollBy({ left: dx, behavior: reduced ? "auto" : "smooth" });
  }, [focusMemberId, reduced]);

  const stops = makeStops();
  return (
    <div
      ref={root}
      className="cd-dim mx k-kit"
      data-cohort-layer="matrix"
      data-dimension={d}
      data-members={view.members.length}
      role="region"
      aria-label={t("region", { dimension: tDim(d) })}
    >
      <DimensionClaim view={view} dimension={d} />
      <div className="mx-legend">
        <ul className="mx-legend__marks">
          {LEGEND.map((s) => (
            <li key={s}>
              <MatrixGlyph status={s} />
              {t(`status.${voiceForLegend}.${s}`)}
            </li>
          ))}
        </ul>
        <KeyHints
          label={t("keys")}
          hints={[
            { id: "cells", keys: [t("keyNames.arrows")], act: t("keyCells") },
            { id: "ends", keys: [t("keyNames.home"), t("keyNames.end")], act: t("keyEnds") },
            { id: "read", keys: [t("keyNames.enter")], act: t("keyRead") },
          ]}
        />
      </div>
      {columns.length ? (
        <MatrixGrid d={d} columns={columns} groups={groups} head={head} focusId={focus?.member.memberId ?? null} refId={ref?.member.memberId ?? null} differs={differs} onFocusMember={onFocusMember} />
      ) : null}
      {focus ? (
        <MatrixReadout
          view={view}
          d={d}
          focus={focus}
          refCol={ref}
          diffs={diffs}
          chosen={focus.member.memberId === focusMemberId}
          pendingName={pendingFocus}
          onOpenReport={onOpenReport}
        />
      ) : (
        <p className="mx-nobody">{t("readout.nobody")}</p>
      )}
      <Remainder pending={[]} groups={absentGroups(view, d)} focusId={focusMemberId} onFocusMember={onFocusMember} stops={stops} />
      <DimensionTips root={root} />
    </div>
  );
}
