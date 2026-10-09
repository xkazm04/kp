"use client";

// The HEAD-TO-HEAD structure of the nested dimension layer (spark analyze-v2-cohort round 2).
// Two to four candidates side by side on ONE dimension, as corners of a weigh-in card: each
// corner says where the rating sits and the one sentence why; the role's criteria run across as
// rows, the rows where they DIFFER open and emphasised at the top, the rows where they agree
// folded into one line per shared status; the pros and cons outside the criteria follow, the
// shared ones aligned. The field beside it is the picker: a name press puts that candidate in
// focus (the first corner, which j/k walks), a pin adds or takes out a rival. One component for
// all seven dimensions: everything it draws comes from why / criteria / anatomy.
import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import type { CohortDimension, CohortMember, DimensionLayerProps } from "../../cohortTypes";
import { stepMember } from "../../dimensions/dimensionModel";
import { DimensionClaim } from "../../dimensions/DimensionClaim";
import { DimensionTips } from "../../dimensions/DimensionTips";
import { H2H_MAX, columnsOf, defaultRivals, fieldOf, fieldOrder, toggleRival } from "./headToHeadModel";
import { H2HHead } from "./H2HHead";
import { H2HCriteria } from "./H2HCriteria";
import { H2HLoose } from "./H2HLoose";
import { H2HField } from "./H2HField";
import "./headToHead.css";

/** The workspace's chord window: a key within it after a bare `g` belongs to the `g` chord. */
const CHORD_WINDOW_MS = 1500;

const isEditable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

export function HeadToHeadLayer({ view, dimension, focusMemberId, onFocusMember, onOpenReport }: DimensionLayerProps) {
  const t = useTranslations("analyzeCohort");
  const root = useRef<HTMLDivElement>(null);
  const lastG = useRef(0);
  // The rivals the reader chose, per dimension; a dimension nobody edited opens on its defaults.
  const [picked, setPicked] = useState<Partial<Record<CohortDimension, string[]>>>({});
  const rivals = picked[dimension] ?? defaultRivals(view, dimension, focusMemberId);
  const cols = columnsOf(view, dimension, focusMemberId, rivals);
  const focusId = cols.some((m) => m.memberId === focusMemberId) ? focusMemberId : null;
  const field = fieldOf(view, dimension);
  const ranks = new Map(field.rated.map((r) => [r.member.memberId, r]));
  const inBoard = new Set(cols.map((m) => m.memberId));

  const setRivals = (next: string[]) => setPicked((p) => ({ ...p, [dimension]: next }));
  const onRemove = (m: CohortMember) => (m.memberId === focusId ? onFocusMember(null) : setRivals(rivals.filter((id) => id !== m.memberId)));
  const onPin = (m: CohortMember) => setRivals(toggleRival(rivals, m.memberId, cols.length));

  // j/k and up/down walk the FOCUS through the field (the first corner changes, the rivals stay).
  // Yields like the dimension pages: a modifier, a field, a handled key, a workspace `g` chord.
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
    const ids = fieldOrder(field);
    const here = e.target instanceof Element ? (e.target.closest("[data-h2h-stop]") as HTMLElement | null)?.dataset.dimMember : undefined;
    const next = stepMember(ids, here ?? focusMemberId, delta);
    if (!next) return;
    e.preventDefault();
    root.current?.querySelector<HTMLElement>(`[data-h2h-stop][data-dim-member="${CSS.escape(next)}"]`)?.focus();
    onFocusMember(next);
  };

  const dim = t(`dims.${dimension}`);
  return (
    <div
      ref={root}
      className="cd-dim hh k-kit"
      data-cohort-layer="headToHead"
      data-dimension={dimension}
      data-members={view.members.length}
      role="region"
      aria-label={t("layerHeadToHead.region", { dimension: dim })}
      onKeyDown={onKeyDown}
    >
      <DimensionClaim view={view} dimension={dimension} />
      <div className="hh-stage">
        <div className="hh-main">
          <div className="hh-board" role="table" aria-label={t("layerHeadToHead.board", { dimension: dim, n: cols.length })} style={{ "--hh-n": Math.max(cols.length, 1) } as CSSProperties}>
            <H2HHead view={view} dimension={dimension} cols={cols} focusId={focusId} ranks={ranks} onRemove={onRemove} onOpenReport={onOpenReport} />
            {cols.length ? <H2HCriteria view={view} dimension={dimension} cols={cols} /> : null}
            {cols.length ? <H2HLoose view={view} dimension={dimension} cols={cols} /> : null}
          </div>
          {cols.length < 2 ? <p className="hh-empty">{t("layerHeadToHead.pickMore")}</p> : null}
          <p className="sr-only" aria-live="polite">
            {t("layerHeadToHead.live", { names: cols.map((m) => m.label).join(", "), n: cols.length })}
          </p>
        </div>
        <H2HField dimension={dimension} field={field} focusId={focusId} inBoard={inBoard} full={cols.length >= H2H_MAX} onFocus={onFocusMember} onPin={onPin} />
      </div>
      <DimensionTips root={root} />
    </div>
  );
}
