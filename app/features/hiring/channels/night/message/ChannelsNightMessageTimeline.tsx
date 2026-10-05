"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Mark, type MarkKind } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import type { StepKey, TimelineStep } from "./channelsNightMessageModel";

/** Each step's stamp: its SHAPE says what happened (the words beside it say it again). */
const STAMP: Record<StepKey, MarkKind> = {
  recorded: "machine",
  receiptArrived: "machine",
  relayed: "ok",
  resent: "recovered",
  neverHanded: "nobody",
  deadLettered: "fail",
  bounced: "bounce",
  needsYou: "needs",
  needsAddress: "needs",
  unmatched: "unknown",
};

/**
 * The letter's delivery timeline (channelsNightMessageModel.deliveryTimeline): a stamp, a title and
 * the time ON RECORD for each step, or why there is none ("not yet" for a step waiting on a person,
 * "cannot happen" for one nothing will do). A detail the record carries (the failure reason, the
 * relay's bounce words) is shown as the record says it; otherwise the step's own sentence.
 */
export function ChannelsNightMessageTimeline({ steps }: { steps: readonly TimelineStep[] }) {
  const t = useTranslations("channelsNight.message.timeline");
  const tc = useTranslations("channels.comms");
  const { dateTime } = useDateFormat();
  const headingId = useId();
  const detailOf = (s: TimelineStep): string => {
    if (s.detail && s.key === "deadLettered") return tc("failureDetail", { detail: s.detail });
    if (s.detail && s.key === "bounced") return t("bounceDetail", { detail: s.detail });
    if (s.key === "neverHanded") return t(`step.neverHanded.${s.variant ?? "relayOff"}`);
    return t(`step.${s.key}.detail`);
  };
  return (
    <section className="cn-msg__part" aria-labelledby={headingId}>
      <h3 id={headingId} className="cn-msg__h">{t("title")}</h3>
      <p className="cn-msg__sub">{t("lead")}</p>
      <ol className="cn-tl">
        {steps.map((s) => (
          <li key={s.key} className="cn-tl__step" data-state={s.state} data-tone={s.tone}>
            <span className="cn-tl__stamp" aria-hidden="true">
              <Mark kind={STAMP[s.key]} />
            </span>
            <div className="cn-tl__body">
              <div className="cn-tl__head">
                <strong>{t(`step.${s.key}.title`)}</strong>
                {s.at ? (
                  <time dateTime={s.at}>{dateTime(s.at)}</time>
                ) : (
                  <span className="cn-tl__when">{s.state === "blocked" ? t("cannot") : s.state === "pending" ? t("notYet") : t("noTime")}</span>
                )}
              </div>
              <p>{detailOf(s)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
