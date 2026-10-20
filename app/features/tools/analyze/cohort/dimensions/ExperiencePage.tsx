"use client";

import { useMemo, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { CommentMark, makeStops, MemberName, MemberPress, Remainder, type PageProps } from "./dimensionParts";
import { pctOn, shortName } from "./dimensionModel";
import { EDUCATION_LEVELS, experienceModel, type EducationLevel } from "./experienceModel";
import { useCohortLabel } from "./useCohortLabel";

/** Education, the secondary mark: a small square filled to the level (dashed and empty when unknown). */
export function EduMark({ level }: { level: EducationLevel }) {
  const fill = { phd: 10, master: 7.5, bachelor: 5, secondary: 2.5, unknown: 0 }[level];
  return (
    <svg className="cd-edu" viewBox="0 0 12 12" aria-hidden data-edu={level}>
      <rect className="cd-edu__box" x="1" y="1" width="10" height="10" rx="2" />
      {fill ? <rect className="cd-edu__fill" x="1" y={11 - fill} width="10" height={fill} rx="1.5" /> : null}
    </svg>
  );
}

/**
 * Experience: a years-by-seniority track. Years run left to right, seniority lanes stack top
 * (lead) to bottom (level unknown); each member is a mark at (years, lane) with education as a
 * small square beside it. People who would sit on top of each other stack inside the lane. The
 * focused member's evidence lines (the roles the CV lists) are read out beside the track.
 */
export function ExperiencePage({ view, focusMemberId, onFocusMember, onOpenReport }: PageProps) {
  const t = useTranslations("analyzeCohort.pages.experience");
  const label = useCohortLabel();
  const model = useMemo(() => experienceModel(view), [view]);
  const stops = makeStops();
  const focused = model.marks.find((m) => m.member.memberId === focusMemberId);
  const years = (n: number | null) => (n == null ? t("yearsUnknown") : t("years", { n }));

  return (
    <div className="cd-split">
      <div className="cd-exp">
        <div className="cd-track" role="group" aria-label={t("track")}>
          {model.lanes.map((lane) => (
            <div key={lane.lane} className="cd-lane" data-lane={lane.lane} style={{ "--rows": lane.rows } as CSSProperties}>
              <span className="cd-lane__name">{t(`lanes.${lane.lane}`)}</span>
              <div className="cd-lane__field">
                {model.marks
                  .filter((m) => m.lane === lane.lane)
                  .map((m) => (
                    <MemberPress
                      key={m.member.memberId}
                      member={m.member}
                      focusId={focusMemberId}
                      stop={stops(m.member.memberId, "mark")}
                      onFocusMember={onFocusMember}
                      label={t("mark", { name: m.member.label, years: years(m.years), lane: t(`lanes.${m.lane}`), education: t(`education.${m.education}`), rating: m.rating })}
                      tip={`${m.member.label} · ${years(m.years)}`}
                      className="cd-xmark"
                      style={{ "--x": `${m.x ?? 0}%`, "--stack": m.stack } as CSSProperties}
                    >
                      <span
                        className="cd-xmark__in"
                        data-tier={m.member.cells.experience.tier}
                        data-noyears={m.x == null ? "" : undefined}
                        data-comment={m.member.cells.experience.comment ? "" : undefined}
                      >
                        <span className="cd-xmark__dot">{shortName(m.member.label)}</span>
                        <EduMark level={m.education} />
                      </span>
                    </MemberPress>
                  ))}
              </div>
            </div>
          ))}
          <div className="cd-track__axis" aria-hidden>
            {model.axis.ticks.map((v) => (
              <span key={v} style={{ left: `${pctOn(v, 0, model.axis.max)}%` }}>
                {v}
              </span>
            ))}
          </div>
          <p className="cd-track__title">{t("axis")}</p>
        </div>
        <ul className="cd-legend" aria-label={t("legend")}>
          {EDUCATION_LEVELS.map((e) => (
            <li key={e}>
              <EduMark level={e} />
              {t(`education.${e}`)}
            </li>
          ))}
        </ul>
        <Remainder pending={model.pending} groups={model.absent} focusId={focusMemberId} onFocusMember={onFocusMember} stops={stops} />
      </div>
      <aside className="cd-focus" aria-live="polite">
        {focused ? (
          <>
            <p className="cd-focus__kicker">{t("focusKicker")}</p>
            <h3 className="cd-focus__name">
              <MemberName member={focused.member} onOpenReport={onOpenReport} />
              <CommentMark name={focused.member.label} text={focused.member.cells.experience.comment} />
            </h3>
            <p className="cd-focus__figure k-nums">{label(focused.member.cells.experience.label)}</p>
            <p className="cd-focus__quiet">
              {t(`education.${focused.education}`)} · {t("rating", { rating: focused.rating })}
            </p>
            <h4 className="cd-focus__h">{t("evidence")}</h4>
            {focused.member.detail.experience?.evidence.length ? (
              <ul className="cd-focus__list">
                {focused.member.detail.experience.evidence.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="cd-focus__quiet">{t("evidenceNone")}</p>
            )}
          </>
        ) : (
          <p className="cd-focus__prompt">{t("focusPrompt")}</p>
        )}
      </aside>
    </div>
  );
}
