"use client";

import { useTranslations } from "next-intl";
import { SAMPLE } from "../sample";
import { vars } from "./kit";

/*
 * The three features that keep B/1's own right-hand panel (prototype
 * land/art.js MOCKS): job-fit scoring, talent rediscovery, self-scheduling.
 * Static drawings whose entrance (dial, bars, the picked slot) is CSS keyed on
 * the open scene (css/land-scene.css). "Look closer" keeps the same panel and
 * shows the feature's three pins below it.
 */
function Caption() {
  const t = useTranslations("siteFeatures");
  return <p className="m-cap">{t("scene.caption")}</p>;
}

const FACTORS = [
  { key: "skills", tone: "moss" },
  { key: "seniority", tone: "moss" },
  { key: "domain", tone: "amber" }
] as const;

export function ScorePanel() {
  const t = useTranslations("siteFeatures");
  const tl = useTranslations("landing");
  return (
    <>
      <div className="m-score">
        <div className="m-dial">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="46" fill="none" stroke="#dce7d0" strokeWidth="14" />
            <circle className="arc" cx="60" cy="60" r="46" fill="none" stroke="#526b4f" strokeWidth="14" strokeLinecap="round" strokeDasharray="251.5 289" transform="rotate(-90 60 60)" />
          </svg>
          <b>{SAMPLE.fit}</b>
        </div>
        <div className="m-bars">
          {FACTORS.map((f, i) => (
            <div key={f.key} className="m-bar">
              <span>{tl(`previews.score.factors.${f.key}`)}</span>
              <em>{SAMPLE.fitSubs[i]}</em>
              <i className={f.tone} style={vars({ "--v": `${SAMPLE.fitSubs[i]}%` })} />
            </div>
          ))}
        </div>
      </div>
      <p className="m-say">{t("b1.score.say")}</p>
      <p className="m-hand">{tl("previews.score.note")}</p>
      <Caption />
    </>
  );
}

export function RediscoverPanel() {
  const t = useTranslations("siteFeatures");
  return (
    <>
      <div className="m-re">
        <b>{t("b1.rediscover.role")}</b>
        <small>{t("b1.rediscover.rescoring")}</small>
        <ol>
          <li className="top">
            <span className="mm" aria-hidden="true">
              {SAMPLE.medallistRank}
            </span>
            <div>
              <b>{t("b1.rediscover.medallist")}</b>
              <small>{t("b1.rediscover.medallistMeta")}</small>
            </div>
            <em>{t("b1.rediscover.first")}</em>
          </li>
          {[0, 1].map((i) => (
            <li key={i} className="dim">
              <span className="dot" aria-hidden="true" />
              <div>
                <b>{t("b1.rediscover.earlier")}</b>
                <small>{t("b1.rediscover.earlierMeta")}</small>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <p className="m-say">{t("b1.rediscover.noSpend")}</p>
      <Caption />
    </>
  );
}

/** The picked slot: Tuesday, second time. */
const PICK = { day: 1, time: 1 };

export function SchedulePanel() {
  const t = useTranslations("siteFeatures");
  const tl = useTranslations("landing");
  // Weekday abbreviations per language, as today's schedule preview reads them.
  const days = tl.raw("previews.schedule.days") as string[];
  const times = SAMPLE.weekTimes;
  return (
    <>
      <div className="m-week">
        <div className="hd">
          {days.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="bd">
          {times.map((time, j) =>
            days.map((d, i) => (
              <i key={`${d}-${time}`} className={i === PICK.day && j === PICK.time ? "pick" : (i + j) % 3 === 0 ? "off" : ""}>
                {time}
              </i>
            ))
          )}
        </div>
      </div>
      <p className="m-say">{t("b1.schedule.say", { slot: `${days[PICK.day]} ${times[PICK.time]}` })}</p>
      <Caption />
    </>
  );
}
