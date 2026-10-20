"use client";

import { useTranslations } from "next-intl";
import { SAMPLE } from "../sample";
import { Chip, Ico, ReplayButton, useRestart, vars, type IconName } from "./kit";

/*
 * One inbox, five doors (B/3 `inbox`, prototype land/mocks.js §5): five ways
 * in converge on one pipeline, and every candidate starts on the same line;
 * "Look closer" says how each door delivers. Door names are today's
 * `landing.previews.inbox.channels.*`.
 */
const DOORS: readonly { key: "apply" | "email" | "boards" | "sourcing" | "manual"; icon: IconName }[] = [
  { key: "apply", icon: "portal" },
  { key: "email", icon: "mail" },
  { key: "boards", icon: "boards" },
  { key: "sourcing", icon: "search" },
  { key: "manual", icon: "plus" }
];
const STAGES = ["stage1", "stage2", "stage3", "stage4"] as const;
const LANES = [10, 30, 50, 70, 90];

export default function InboxPanel({ detail }: { detail: boolean }) {
  const t = useTranslations("siteFeatures");
  const tl = useTranslations("landing");
  const [ref, restart] = useRestart();
  return (
    <div className={detail ? "mock mk-detail mk-inbox-d" : "mock mk-inbox"} ref={ref}>
      <div className="mk-hd">
        <span className="mk-ttl">{detail ? t("inbox.detailTitle") : tl("features.inbox.title")}</span>
        <ReplayButton onReplay={restart} />
      </div>
      <div className="mk-in">
        <div className="mk-doors">
          {DOORS.map((d, i) => (
            <div key={d.key} className="mk-door mk-rise" style={vars({ "--d": `${i * 0.08}s` })}>
              <span className="mk-door-i">
                <Ico name={d.icon} />
              </span>
              <span className="mk-door-t">
                <b>{tl(`previews.inbox.channels.${d.key}`)}</b>
                {detail ? <em>{t(`inbox.doors.${d.key}`)}</em> : null}
              </span>
              <Ico name="arrow" className="mk-door-a" />
            </div>
          ))}
        </div>
        <svg className="mk-conv" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          {LANES.map((y, i) => (
            <path key={y} d={`M0 ${y} C 55 ${y}, 45 22, 100 22`} style={vars({ "--i": i })} />
          ))}
        </svg>
        <span className="mk-conv-v" aria-hidden="true">
          <Ico name="arrow" />
        </span>
        <div className="mk-pipe">
          {STAGES.map((s, i) =>
            i === 0 ? (
              <div key={s} className="mk-stage is-first">
                <span className="mk-stage-h">
                  <b>{i + 1}</b>
                  {t(`inbox.${s}`)}
                </span>
                <Chip className="is-a">{t("inbox.sameLine")}</Chip>
                <div className="mk-toks">
                  {SAMPLE.tokens.map(([initials, name], k) => (
                    <span key={initials} className="mk-tok" style={vars({ "--i": k })}>
                      <i>{initials}</i>
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div key={s} className="mk-stage">
                <span className="mk-stage-h">
                  <b>{i + 1}</b>
                  {t(`inbox.${s}`)}
                </span>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
