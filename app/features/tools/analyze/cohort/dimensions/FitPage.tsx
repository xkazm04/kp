"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { CommentMark, DecoyMark, makeStops, MemberName, MemberPress, Remainder, type PageProps } from "./dimensionParts";
import { pctOn } from "./dimensionModel";
import { fitModel } from "./fitModel";
import { FitFocus } from "./FitFocus";

const span = (from: number, to: number, min: number, max: number) => {
  const left = pctOn(from, min, max);
  return { left: `${left}%`, width: `${Math.max(0, pctOn(to, min, max) - left)}%` };
};

/**
 * Fit: a band ruler. Every rated member is a row: rank, name, the uncertainty band with its
 * point, the rating. The gap the leader would need is DRAWN across the top two rows: open air
 * (moss) when #1's floor clears #2's ceiling, a hatched shared stretch when the bands overlap.
 * Pending members are rows still waiting; the absent are listed below with their reasons.
 */
export function FitPage({ view, focusMemberId, onFocusMember, onOpenReport }: PageProps) {
  const t = useTranslations("analyzeCohort.pages.fit");
  const tc = useTranslations("analyzeCohort.pages.common");
  const model = useMemo(() => fitModel(view), [view]);
  const stops = makeStops();
  const { min, max, ticks } = model.scale;
  const gap = model.gap;
  const gapIds = gap.kind === "none" ? [] : [gap.leaderId, gap.runnerId];
  // The words over the ruler: what the gap between #1 and #2 is, measured.
  const line =
    gap.kind === "clears"
      ? t("gapClears", { width: gap.width, from: gap.from, to: gap.to })
      : gap.kind === "overlap"
        ? gap.width === 0
          ? t("gapTouch", { at: gap.from })
          : t("gapOverlap", { width: gap.width, from: gap.from, to: gap.to })
        : null;

  return (
    <div className="cd-split">
      <div className="cd-fit">
        {line ? (
          <p className="cd-fit__gapline" data-kind={gap.kind}>
            {line}
          </p>
        ) : null}
        <div className="cd-fit__axis" aria-hidden>
          {ticks.map((v) => (
            <span key={v} data-major={v % 20 === 0 ? "" : undefined} style={{ left: `${pctOn(v, min, max)}%` }}>
              {v}
            </span>
          ))}
        </div>
        <ol className="cd-fit__rows" aria-label={t("list")}>
          {model.rows.map((r) => {
            const id = r.member.memberId;
            const inGap = gapIds.includes(id);
            return (
              <li key={id} className="cd-fit__row" data-on={focusMemberId === id ? "" : undefined} data-tier={r.member.cells.fit.tier}>
                <span className="cd-fit__rank k-nums">{r.rank != null ? t("rank", { rank: r.rank }) : null}</span>
                <span className="cd-fit__who">
                  <MemberName member={r.member} onOpenReport={onOpenReport} />
                  {gap.kind === "clears" && gap.leaderId === id && view.claims.byDimension.fit.leader === id ? <span className="cd-lead">{t("leads")}</span> : null}
                  <DecoyMark member={r.member} view={view} />
                  <CommentMark name={r.member.label} text={r.member.cells.fit.comment} />
                </span>
                <MemberPress
                  member={r.member}
                  focusId={focusMemberId}
                  stop={stops(id, "row")}
                  onFocusMember={onFocusMember}
                  label={t("row", { name: r.member.label, rating: r.rating, lo: r.lo, hi: r.hi })}
                  className="cd-fit__track"
                >
                  {ticks.map((v) => (
                    <i key={v} className="cd-fit__tick" style={{ left: `${pctOn(v, min, max)}%` }} />
                  ))}
                  {inGap && gap.kind !== "none" ? <i className="cd-fit__gap" data-kind={gap.kind} style={span(gap.from, gap.to, min, max)} /> : null}
                  <i className="cd-fit__band" style={span(r.lo, r.hi, min, max)} />
                  <i className="cd-fit__point" style={{ left: `${pctOn(r.rating, min, max)}%` }} />
                </MemberPress>
                <span className="cd-fit__value k-nums">{r.rating}</span>
              </li>
            );
          })}
          {model.pending.map((m) => (
            <li key={m.memberId} className="cd-fit__row" data-pending="" data-on={focusMemberId === m.memberId ? "" : undefined}>
              <span className="cd-fit__rank" />
              <span className="cd-fit__who">
                <MemberName member={m} onOpenReport={onOpenReport} />
              </span>
              <MemberPress
                member={m}
                focusId={focusMemberId}
                stop={stops(m.memberId, "row")}
                onFocusMember={onFocusMember}
                label={tc("absentMember", { name: m.label, reason: tc("pendingWord") })}
                className="cd-fit__track cd-fit__track--pending"
              >
                <span className="cd-fit__waiting">{tc("pendingWord")}</span>
              </MemberPress>
              <span className="cd-fit__value" />
            </li>
          ))}
        </ol>
        <Remainder pending={[]} groups={model.absent} focusId={focusMemberId} onFocusMember={onFocusMember} stops={stops} />
      </div>
      <FitFocus view={view} rows={model.rows} focusMemberId={focusMemberId} />
    </div>
  );
}
