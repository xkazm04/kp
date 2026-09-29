"use client";

import type { RefObject } from "react";
import { useTranslations } from "next-intl";
import { FlaskConical, Keyboard, Radar, RefreshCw } from "lucide-react";
import { Tooltip } from "@/app/_components/Tooltip";
import type { Gig, GigKpiCell } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../data/useGigsFormat";
import { deadlineView } from "../logic/facts";
import type { WaitCounts } from "../logic/front";
import { rateView } from "../logic/rate";

// The tab's header: the name, then the three figures that decide the day (B/2 "The Line",
// which the owner asked to sit here) - what waits on you, the first thing to do, how much
// is judged - and the tools: refresh, Scan, the keys sheet.

export function GigsHeader({
  counts,
  first,
  overall,
  now,
  scanning,
  keysRef,
  onFirst,
  onReception,
  onRefresh,
  onScan,
}: {
  counts: WaitCounts;
  first: Gig | null;
  overall: GigKpiCell | null;
  now: Date;
  scanning: boolean;
  keysRef: RefObject<HTMLDivElement | null>;
  onFirst: () => void;
  onReception: () => void;
  onRefresh: () => void;
  onScan: () => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const firstDeadline = first ? deadlineView(first.deadlineAt, now) : null;
  const rate = rateView(overall);
  const judged = overall ? overall.resolved + overall.pending : 0;
  return (
    <header className="gd-head">
      <div className="gd-title">
        <span className="eyebrow">{t("eyebrow")}</span>
        <div className="name">
          <h1>{t("title")}</h1>
          <span className="devtag">
            <FlaskConical size={13} aria-hidden /> {t("inDevelopment")}
          </span>
        </div>
      </div>

      <div className="strip" aria-label={t("head.stripLabel")} role="group">
        <div>
          <span className={`fig-n${counts.total ? " needs" : ""}`}>{counts.total}</span>
          <span className="fig-l">
            <b>{t("head.waitOnYou", { count: counts.total })}</b>
            <br />
            {t("head.waitParts", { clear: counts.clear, review: counts.review, send: counts.send })}
            {counts.record ? ` · ${t("head.toRecord", { count: counts.record })}` : null}
          </span>
        </div>
        {first ? (
          <div>
            <button type="button" className="firstbtn" onClick={onFirst}>
              <i className="mk you" aria-hidden />
              <span className="min-w-0">
                <span className="fig-l">{t("head.first")}</span>
                <span className="t">{first.title}</span>
                <span className="s">
                  {firstDeadline?.state === "soon" || firstDeadline?.state === "open" ? t("head.daysLeft", { days: Math.max(0, firstDeadline.days) }) : t("head.noDeadline")}
                  {" · "}
                  {t(`head.move.${first.status === "in_review" ? "send" : first.status === "drafted" ? "review" : first.status === "suspect" ? "clear" : "record"}`)}
                </span>
              </span>
            </button>
          </div>
        ) : null}
        <div>
          <button type="button" className="firstbtn" onClick={onReception} aria-label={t("head.judgedAria", { resolved: overall?.resolved ?? 0, sent: judged })}>
            <span className={`hollow${rate.measured ? " measured" : ""}`} aria-hidden>
              {rate.measured && rate.percent !== null ? rate.percent : "—"}
            </span>
            <span className="fig-l">
              <b>{t("head.judged", { resolved: overall?.resolved ?? 0, sent: judged })}</b>
              {overall && overall.pending ? ` · ${t("rate.pending", { count: overall.pending })}` : null}
              <br />
              {rate.measured && rate.percent !== null ? t("head.rateMeasured", { percent: fmt.percent(rate.percent), small: rate.small ? "yes" : "no" }) : t("head.rateUnmeasured")}
            </span>
          </button>
        </div>
      </div>

      <div className="tools">
        <Tooltip label={t("refresh")}>
          <button type="button" className="btn iconbtn" aria-label={t("refresh")} onClick={onRefresh}>
            <RefreshCw size={16} aria-hidden />
          </button>
        </Tooltip>
        <button type="button" className="btn primary" disabled={scanning} onClick={onScan}>
          <Radar size={16} aria-hidden /> {t("scan.button")}
        </button>
        <Tooltip label={t("keys.title")}>
          <button type="button" className="btn iconbtn" aria-label={t("keys.title")} popoverTarget="gd-keys">
            <Keyboard size={16} aria-hidden />
          </button>
        </Tooltip>
        <KeysSheet keysRef={keysRef} />
      </div>
    </header>
  );
}

/** Every bare key the tab answers, in a popover (`?` toggles it). */
function KeysSheet({ keysRef }: { keysRef: RefObject<HTMLDivElement | null> }) {
  const t = useTranslations("gigs");
  return (
    <div id="gd-keys" ref={keysRef} popover="auto" className="pop">
      <h3 className="t-h3">{t("keys.title")}</h3>
      <dl className="keys">
        <dt>
          <kbd>N</kbd>
        </dt>
        <dd>{t("keys.next")}</dd>
        <dt>
          <kbd>/</kbd>
        </dt>
        <dd>{t("keys.find")}</dd>
        <dt>
          <kbd>←</kbd> <kbd>→</kbd>
        </dt>
        <dd>{t("keys.step")}</dd>
        <dt>
          <kbd>{t("detail.escKey")}</kbd>
        </dt>
        <dd>{t("keys.back")}</dd>
        <dt>
          <kbd>D</kbd>
        </dt>
        <dd>{t("keys.decline")}</dd>
        <dt>
          <kbd>1</kbd>–<kbd>6</kbd>
        </dt>
        <dd>{t("keys.checklist")}</dd>
        <dt>
          <kbd>?</kbd>
        </dt>
        <dd>{t("keys.help")}</dd>
      </dl>
    </div>
  );
}
