"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { SAMPLE } from "../sample";
import { Chip, Ico, ReplayButton, WhoBadge, reducedNow, useRestart, vars, type IconName, type Who } from "./kit";

/*
 * Offer to sealed hire (B/3 `offer`, prototype land/mocks.js §8). The scene
 * panel is a working SIGN flow: the drafted letter waits for a person; SIGN
 * inks the signature and stamps it, then the candidate accepts (1.4 s) and the
 * hire is sealed and mirrored (2.8 s). Reduced motion goes straight to sealed.
 * "Look closer" is the four steps with an accepts / declines switch.
 */
type Stage = "draft" | "signed" | "accepted" | "sealed";
type StepState = "todo" | "now" | "done";

const LADDER_STATE: Record<Stage, readonly [StepState, StepState, StepState]> = {
  draft: ["todo", "todo", "todo"],
  signed: ["now", "todo", "todo"],
  accepted: ["done", "now", "todo"],
  sealed: ["done", "done", "done"]
};

const LADDER: readonly { label: "accepted" | "sealed" | "mirrored"; icon: IconName; via: boolean }[] = [
  { label: "accepted", icon: "link", via: true },
  { label: "sealed", icon: "seal", via: false },
  { label: "mirrored", icon: "dup", via: false }
];

const RULES = [
  { w: "96%", d: ".45s" },
  { w: "82%", d: ".75s" },
  { w: "90%", d: "1.05s" },
  { w: "70%", d: "1.35s" },
  { w: "94%", d: "1.65s" },
  { w: "48%", d: "1.95s" }
];

const FLOW: readonly { key: "flow1" | "flow2" | "flow3" | "flow4"; who: Who }[] = [
  { key: "flow1", who: "machine" },
  { key: "flow2", who: "person" },
  { key: "flow3", who: "candidate" },
  { key: "flow4", who: "machine" }
];

function Signature() {
  return (
    <svg className="mk-of-sg" viewBox="0 0 132 44" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5 30C14 8 24 6 25 20c1 12 9 14 15-2 4-10 8-9 8-1 0 9 7 9 13-1 5-8 9-6 8 2-1 6 6 6 10-2 3-6 7-5 6 1-1 5 2 6 8 3 6-3 10-6 22-12" />
      <path d="M60 38c18-4 42-5 68-3" />
    </svg>
  );
}

function Amount() {
  return (
    <>
      {SAMPLE.offerAmount} <small>{SAMPLE.offerCurrency}</small>
    </>
  );
}

function OfferMock() {
  const t = useTranslations("siteFeatures");
  const [ref, restart] = useRestart();
  const [stage, setStage] = useState<Stage>("draft");
  const timers = useRef<number[]>([]);
  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const signed = stage !== "draft";
  const by = SAMPLE.signer;
  const ladder = LADDER_STATE[stage];
  const live =
    stage === "signed"
      ? t("offer.liveSigned", { name: by })
      : stage === "accepted"
        ? t("offer.liveAccepted")
        : stage === "sealed"
          ? t("offer.liveSealed")
          : "";

  const sign = () => {
    if (stage !== "draft") return;
    clearTimers();
    if (reducedNow()) {
      setStage("sealed");
      return;
    }
    setStage("signed");
    timers.current = [window.setTimeout(() => setStage("accepted"), 1400), window.setTimeout(() => setStage("sealed"), 2800)];
  };

  const replay = () => {
    clearTimers();
    setStage("draft");
    restart();
  };

  return (
    <div className="mock mk-offer" data-st={stage} ref={ref}>
      <div className="mk-hd">
        <span className="mk-of-gl" aria-hidden="true">
          <Ico name="doc" />
        </span>
        <span className="mk-ttl">{t("offer.title")}</span>
        <Chip>{t("kit.candidateChip", { name: SAMPLE.jana })}</Chip>
        <ReplayButton onReplay={replay} />
      </div>
      <div className="mk-of-main">
        <div className="mk-of-letter mk-paper" role="group" aria-label={t("offer.letterLabel")}>
          <div className="mk-of-top">
            <span className="mk-of-tag sil">{signed ? t("offer.signed") : t("offer.draft")}</span>
          </div>
          <div className="mk-of-fig">
            <b className="mk-of-amt">
              <Amount />
            </b>
            <span className="mk-of-eq">{t("offer.formula")}</span>
            <span className="mk-of-band" aria-hidden="true">
              <i />
              <em />
            </span>
          </div>
          <div className="mk-of-rules" aria-hidden="true">
            {RULES.map((r, i) => (
              <i key={i} style={vars({ "--w": r.w, "--d": r.d })} />
            ))}
          </div>
          <div className="mk-of-sig">
            <div className="mk-of-ink" aria-hidden="true">
              <Signature />
              <span className="mk-of-veil" />
            </div>
            <p className="mk-of-by">{signed ? t("offer.signedBy", { name: by }) : t("offer.awaiting")}</p>
          </div>
          <span className="mk-of-stamp" aria-hidden="true">
            {t("offer.stamp")}
          </span>
          <span className="mk-of-wax" aria-hidden="true">
            <Ico name="seal" />
          </span>
        </div>
        <div className="mk-of-side">
          <div className="mk-of-act">
            <button type="button" className="mk-of-sign" aria-pressed={signed} onClick={sign}>
              <Ico name={signed ? "check" : "pen"} />
              <span>{signed ? t("offer.signed") : t("offer.sign")}</span>
            </button>
            <p className="mk-of-hint">
              <WhoBadge who="person" />
              <span>{signed ? t("offer.hintSigned", { name: by }) : t("offer.hintWaiting")}</span>
            </p>
          </div>
          <ol className="mk-of-lad" aria-label={t("offer.ladderLabel")}>
            {LADDER.map((s, i) => (
              <li key={s.label} className="mk-of-st mk-rise" data-s={ladder[i]} style={vars({ "--d": `${0.5 + i * 0.15}s` })}>
                <span className="mk-of-nd" aria-hidden="true">
                  <span className="i1">
                    <Ico name={s.icon} />
                  </span>
                  <span className="i2">
                    <Ico name="check" />
                  </span>
                </span>
                <span className="mk-of-tx">
                  <b>{t(`offer.${s.label}`)}</b>
                  {s.via ? <em>{t("offer.acceptedVia")}</em> : null}
                </span>
                <span className="mk-of-ss sil">{ladder[i] === "done" ? t("offer.done") : t("offer.waiting")}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="mk-vh" role="status" aria-live="polite">
        {live}
      </p>
    </div>
  );
}

function OfferDetail() {
  const t = useTranslations("siteFeatures");
  const [ref, restart] = useRestart();
  const [path, setPath] = useState<"accept" | "decline">("accept");
  const [live, setLive] = useState("");
  const decline = path === "decline";

  const choose = (p: "accept" | "decline") => {
    setPath(p);
    setLive(p === "decline" ? t("offer.liveDecline") : t("offer.liveAccept"));
  };

  return (
    <div className="mock mk-detail mk-offer-d" data-path={path} ref={ref}>
      <div className="mk-hd">
        <span className="mk-of-gl" aria-hidden="true">
          <Ico name="doc" />
        </span>
        <span className="mk-ttl">{t("offer.detailTitle")}</span>
        <Chip>{t("kit.sample")}</Chip>
        <div className="mk-of-ctl mk-end">
          <div className="mk-of-seg" role="group" aria-label={t("offer.pathLabel")}>
            <button type="button" aria-pressed={!decline} onClick={() => choose("accept")}>
              <Ico name="check" />
              {t("offer.accepts")}
            </button>
            <button type="button" aria-pressed={decline} onClick={() => choose("decline")}>
              <Ico name="x" />
              {t("offer.declines")}
            </button>
          </div>
          <ReplayButton
            onReplay={() => {
              choose("accept");
              restart();
            }}
          />
        </div>
      </div>
      <ol className="mk-of-flow" aria-label={t("offer.flowLabel")}>
        {FLOW.map((s, i) => (
          <li key={s.key} className="mk-of-fs mk-rise" data-i={i} style={vars({ "--d": `${i * 0.14}s` })}>
            <div className="mk-of-fh">
              <span className="mk-of-n" aria-hidden="true">
                {i + 1}
              </span>
              <WhoBadge who={s.who} />
            </div>
            <span className="mk-ttl">{t(`offer.${s.key}`)}</span>
            <p>{t(`offer.${s.key}Text`)}</p>
            {i === 2 ? (
              <span className="mk-of-oc">
                <Ico name={decline ? "x" : "check"} />
                {decline ? t("offer.declined") : t("offer.accepted")}
              </span>
            ) : i === 3 ? (
              <span className="mk-of-oc">
                <Ico name={decline ? "x" : "check"} />
                {decline ? t("offer.notReached") : t("offer.sealed")}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="mk-of-low">
        <div className="mk-of-mini mk-paper">
          <div className="mk-of-mh">
            <span className="sil">{t("offer.mini")}</span>
            <span className="mk-of-amt">
              <Amount />
            </span>
          </div>
          <p className="mk-of-eq">{t("offer.formula")}</p>
          <div className="mk-of-rules" aria-hidden="true">
            {["92%", "78%", "56%"].map((w) => (
              <i key={w} style={vars({ "--w": w })} />
            ))}
          </div>
          <p className="mk-of-by">
            <Ico name="pen" />
            {t("offer.signedBy", { name: SAMPLE.signer })}
          </p>
          <span className="mk-of-stamp is-static" aria-hidden="true">
            {t("offer.stamp")}
          </span>
          <span className="mk-of-wax" aria-hidden="true">
            <Ico name="seal" />
          </span>
        </div>
        <div className="mk-of-branch">
          <span className="mk-of-bl" aria-hidden="true" />
          <div className="mk-of-bc">
            <span className="mk-of-bt">
              <Ico name="x" />
              {t("offer.branchTitle")}
            </span>
            <p>{t("offer.branchText")}</p>
          </div>
        </div>
      </div>
      <p className="mk-vh" role="status" aria-live="polite">
        {live}
      </p>
    </div>
  );
}

export default function OfferPanel({ detail }: { detail: boolean }) {
  return detail ? <OfferDetail /> : <OfferMock />;
}
