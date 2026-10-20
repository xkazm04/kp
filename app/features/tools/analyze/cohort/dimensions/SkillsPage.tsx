"use client";

import { useMemo, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { ABSENT } from "@/app/_components/kit";
import { makeStops, MemberName, MemberPress, Remainder, type PageProps } from "./dimensionParts";
import { absentGroups, pendingOn, shortName } from "./dimensionModel";
import { SKILL_MARKS, skillsModel, type SkillMark } from "./skillsModel";
import { useAbsentWord } from "./useCohortLabel";

/** One shape per reading (meaning by SHAPE, colour second): a full disc, a half disc, a cross, a dashed ring. */
export function SkillGlyph({ mark }: { mark: SkillMark }) {
  return (
    <svg className="cd-glyph" viewBox="0 0 16 16" aria-hidden data-mark={mark}>
      {mark === "matched" ? <circle cx="8" cy="8" r="5.5" /> : null}
      {mark === "unproven" ? (
        <>
          <circle className="cd-glyph__ring" cx="8" cy="8" r="5" />
          <path d="M8 3a5 5 0 0 0 0 10Z" />
        </>
      ) : null}
      {mark === "missing" ? <path className="cd-glyph__x" d="m4 4 8 8m0-8-8 8" /> : null}
      {mark === "unlisted" ? <circle className="cd-glyph__dash" cx="8" cy="8" r="4.5" /> : null}
    </svg>
  );
}

/**
 * Skills: a coverage grid. Rows are the role's required skills (the union across members), the
 * skills the most members lack first; columns are the members, best covered first, then those
 * still analyzing, then those with no reading (hatched, the reason in their column's name). The
 * last row counts what each CV lists beyond the role; the focused member's extras are spelled out.
 */
export function SkillsPage({ view, focusMemberId, onFocusMember, onOpenReport }: PageProps) {
  const t = useTranslations("analyzeCohort.pages.skills");
  const reasonWord = useAbsentWord();
  const model = useMemo(() => skillsModel(view), [view]);
  const stops = makeStops();
  const focused = model.columns.find((m) => m.memberId === focusMemberId);
  const extra = focused ? model.extra[focused.memberId] : undefined;
  const on = (id: string) => (focusMemberId === id ? "" : undefined);
  const word = (m: SkillMark) => t(`marks.${m}`);

  return (
    <div className="cd-skills">
      <div className="cd-grid-wrap">
        <div className="cd-grid" role="table" aria-label={t("grid")} style={{ "--cols": model.columns.length } as CSSProperties}>
          <div role="row" className="cd-grid__row cd-grid__row--head">
            <span role="columnheader" className="cd-grid__corner">
              {t("rows")}
            </span>
            {model.columns.map((m) => {
              const cell = m.cells.skills;
              const state = cell.rating != null ? cell.tier : cell.absentReason === "pending" ? "pending" : "absent";
              const fact = cell.rating != null ? t("colRated", { rating: cell.rating }) : reasonWord(cell.absentReason ?? "notRead");
              return (
                <span key={m.memberId} role="columnheader" className="cd-grid__col" data-state={state} data-on={on(m.memberId)}>
                  <MemberPress
                    member={m}
                    focusId={focusMemberId}
                    stop={stops(m.memberId, "col")}
                    onFocusMember={onFocusMember}
                    label={t("column", { name: m.label, fact })}
                    tip={`${m.label} · ${fact}`}
                    className="cd-colhead"
                  >
                    <span className="cd-colhead__short">{shortName(m.label)}</span>
                    <span className="cd-colhead__fig k-nums">{cell.rating ?? ABSENT}</span>
                  </MemberPress>
                </span>
              );
            })}
            <span role="columnheader" className="cd-grid__lackhead">
              {t("lackHead")}
            </span>
          </div>
          {model.rows.map((r) => (
            <div key={r.key} role="row" className="cd-grid__row" data-discriminating={r.missing + r.unproven > 0 ? "" : undefined}>
              <span role="rowheader" className="cd-grid__skill">
                {r.label}
              </span>
              {model.columns.map((m) => {
                const mark = r.marks[m.memberId];
                return (
                  <span
                    key={m.memberId}
                    role="cell"
                    className="cd-grid__cell"
                    data-mark={mark ?? m.cells.skills.absentReason ?? "notRead"}
                    data-on={on(m.memberId)}
                    aria-label={t("cell", { name: m.label, skill: r.label, mark: mark ? word(mark) : reasonWord(m.cells.skills.absentReason ?? "notRead") })}
                  >
                    {mark ? <SkillGlyph mark={mark} /> : null}
                  </span>
                );
              })}
              <span role="cell" className="cd-grid__lack k-nums">
                {t("rowLack", { n: r.missing, unproven: r.unproven })}
              </span>
            </div>
          ))}
          <div role="row" className="cd-grid__row cd-grid__row--extra">
            <span role="rowheader" className="cd-grid__skill">
              {t("extra")}
            </span>
            {model.columns.map((m) => (
              <span key={m.memberId} role="cell" className="cd-grid__cell cd-grid__cell--extra k-nums" data-on={on(m.memberId)}>
                {model.extra[m.memberId]?.length ?? ABSENT}
              </span>
            ))}
            <span role="cell" className="cd-grid__lack" />
          </div>
        </div>
      </div>
      <ul className="cd-legend" aria-label={t("legend")}>
        {SKILL_MARKS.map((m) => (
          <li key={m}>
            <SkillGlyph mark={m} />
            {word(m)}
          </li>
        ))}
      </ul>
      {focused ? (
        <p className="cd-skills__extra" aria-live="polite">
          <MemberName member={focused} onOpenReport={onOpenReport} />{" "}
          {extra?.length ? t("extraOf", { list: extra.join(", ") }) : extra ? t("extraNone") : reasonWord(focused.cells.skills.absentReason ?? "notRead")}
        </p>
      ) : null}
      <Remainder pending={pendingOn(view, "skills")} groups={absentGroups(view, "skills")} focusId={focusMemberId} onFocusMember={onFocusMember} stops={stops} />
    </div>
  );
}
