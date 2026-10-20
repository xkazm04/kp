"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SAMPLE } from "../sample";
import { Chip, Ico, ReplayButton, WhoBadge, useRestart, vars, type Who } from "./kit";

/*
 * Gates & receipts (B/3 `gates`, prototype land/mocks.js §9): the audit trail
 * as sealed receipt slips, and a working kill switch: flip it and every row
 * that runs unattended shows "paused · nothing new runs" (CSS on
 * `[data-paused="1"]`), while the signed rows stay signed. "Look closer" adds
 * how one receipt is built and the one gate that never unlocks: rejection.
 */
type Slip = { decision: "advance" | "kindPass" | "offer"; name: string; run: boolean };

const SLIPS: readonly Slip[] = [
  { decision: "advance", name: SAMPLE.petr, run: true },
  { decision: "kindPass", name: SAMPLE.alex, run: false },
  { decision: "advance", name: SAMPLE.jana, run: true },
  { decision: "offer", name: SAMPLE.jana, run: false }
];
/** "Look closer" shows three of them, signed first. */
const DETAIL_SLIPS = [SLIPS[1], SLIPS[0], SLIPS[3]];

const FLOW: readonly { key: "flow1" | "flow2" | "flow3" | "flow4"; who: Who }[] = [
  { key: "flow1", who: "machine" },
  { key: "flow2", who: "person" },
  { key: "flow3", who: "machine" },
  { key: "flow4", who: "candidate" }
];

function Ledger({ slips }: { slips: readonly Slip[] }) {
  const t = useTranslations("siteFeatures");
  return (
    <ol className="mk-gt-led" aria-label={t("gates.ledgerLabel")}>
      {slips.map((r, i) => (
        <li key={i} className={`mk-gt-slip mk-rise ${r.run ? "is-run" : "is-sign"}`} style={vars({ "--d": `${0.2 + i * 0.22}s` })}>
          {i ? (
            <span className="mk-gt-lk" aria-hidden="true">
              <Ico name="link" />
            </span>
          ) : null}
          <span className="mk-gt-nd" aria-hidden="true">
            {r.run ? (
              <>
                <span className="i1">
                  <Ico name="play" />
                </span>
                <span className="i2">
                  <Ico name="pause" />
                </span>
              </>
            ) : (
              <Ico name="check" />
            )}
          </span>
          <div className="mk-gt-b">
            <div className="mk-gt-l1">
              <span className="mk-gt-dec">{t(`gates.${r.decision}`)}</span>
              <b className="mk-gt-nm">{r.name}</b>
            </div>
            <p className="mk-gt-m">
              {r.run ? (
                <>
                  <span className="mk-gt-run">{t("gates.runs")}</span>
                  <span className="mk-gt-hold">
                    <Ico name="pause" />
                    {t("gates.held")}
                  </span>
                </>
              ) : (
                <>
                  <Ico name="pen" />
                  {t("gates.signed", { name: SAMPLE.signer })}
                </>
              )}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function KillSwitch({ paused, onFlip }: { paused: boolean; onFlip: () => void }) {
  const t = useTranslations("siteFeatures");
  return (
    <div className="mk-gt-kill">
      <span className="sil mk-gt-kt">
        <Ico name="lock" />
        {t("gates.kill")}
      </span>
      <div className="mk-gt-hous">
        <span className="mk-gt-scr s1" aria-hidden="true" />
        <span className="mk-gt-scr s2" aria-hidden="true" />
        <span className="mk-gt-guard" aria-hidden="true" />
        <button type="button" className="mk-gt-sw" role="switch" aria-checked={paused} aria-label={t("gates.kill")} onClick={onFlip}>
          <span className="mk-gt-trk">
            <span className="mk-gt-tx">
              <span className="t-run sil">{t("gates.running")}</span>
              <span className="t-hold sil">{t("gates.paused")}</span>
            </span>
            <span className="mk-gt-knob">
              <span className="k-run">
                <Ico name="play" />
              </span>
              <span className="k-hold">
                <Ico name="pause" />
              </span>
            </span>
          </span>
        </button>
      </div>
      <p className="mk-gt-say" role="status">
        <span className="mk-gt-si">
          <Ico name={paused ? "pause" : "play"} />
        </span>
        <span>{paused ? t("gates.sayPaused") : t("gates.sayRunning")}</span>
      </p>
    </div>
  );
}

export default function GatesPanel({ detail }: { detail: boolean }) {
  const t = useTranslations("siteFeatures");
  const [ref, restart] = useRestart();
  const [paused, setPaused] = useState(false);
  const replay = () => {
    setPaused(false);
    restart();
  };
  const flip = () => setPaused((p) => !p);

  if (!detail) {
    return (
      <div className="mock mk-gates" data-paused={paused ? "1" : "0"} ref={ref}>
        <div className="mk-hd">
          <span className="mk-ttl">{t("gates.title")}</span>
          <Chip>
            <Ico name="link" />
            {t("gates.chain")}
          </Chip>
          <ReplayButton onReplay={replay} />
        </div>
        <div className="mk-gt-main">
          <Ledger slips={SLIPS} />
          <div className="mk-gt-r">
            <KillSwitch paused={paused} onFlip={flip} />
            <p className="mk-note mk-dim mk-gt-one">{t("gates.flip")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mock mk-detail mk-gates-d" data-paused={paused ? "1" : "0"} ref={ref}>
      <div className="mk-hd">
        <span className="mk-ttl">{t("gates.detailTitle")}</span>
        <Chip>{t("kit.sample")}</Chip>
        <ReplayButton onReplay={replay} />
      </div>
      <ol className="mk-gt-flow" aria-label={t("gates.flowLabel")}>
        {FLOW.map((s, i) => (
          <li key={s.key} className="mk-gt-fs mk-rise" style={vars({ "--d": `${i * 0.14}s` })}>
            <div className="mk-gt-fh">
              <span className="mk-gt-n" aria-hidden="true">
                {i + 1}
              </span>
              <WhoBadge who={s.who} />
            </div>
            <span className="mk-ttl">{t(`gates.${s.key}`)}</span>
            <p>{t(`gates.${s.key}Text`)}</p>
          </li>
        ))}
      </ol>
      <div className="mk-gt-low">
        <Ledger slips={DETAIL_SLIPS} />
        <div className="mk-gt-r">
          <div className="mk-gt-never">
            <span className="mk-gt-hatch" aria-hidden="true">
              <Ico name="lock" />
            </span>
            <div className="mk-gt-nt">
              <span className="sil">{t("gates.rejection")}</span>
              <b>{t("gates.neverUnlocks")}</b>
              <p>{t("gates.neverText")}</p>
            </div>
          </div>
          <KillSwitch paused={paused} onFlip={flip} />
          <p className="mk-note mk-dim mk-gt-one">{t("gates.detailNote")}</p>
        </div>
      </div>
    </div>
  );
}
