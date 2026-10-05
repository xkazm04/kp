"use client";

import { useTranslations } from "next-intl";
import { SAMPLE } from "../sample";
import { Chip, Ico, ReplayButton, useRestart, vars } from "./kit";

/*
 * Verified work samples (B/3 `work`, prototype land/mocks.js §3): the listing
 * with its planted flaw, the prompts the candidate actually used, and the
 * measured distance from a bare one-shot; "Look closer" is the process on
 * record, prompt by prompt, the planted flaws caught or missed, and the two
 * decisions the interview asks them to defend. The code is sample data, never
 * translated; everything said about it is.
 */
const PROMPTS = ["prompt1", "prompt2", "prompt3", "prompt4"] as const;
const NOTES = ["note1", "note2", "note3", "note4"] as const;
const FLAWS = [
  { key: "flaw1", caught: true },
  { key: "flaw2", caught: false },
  { key: "flaw3", caught: true }
] as const;
const DECISIONS = ["decision1", "decision2"] as const;

/** The listing's non-breaking indentation (the prototype swapped spaces for U+00A0). */
const nb = (line: string) => line.replace(/ /g, " ");

function Code() {
  const t = useTranslations("siteFeatures");
  return (
    <div className="mk-code" role="img" aria-label={t("work.codeLabel")}>
      {SAMPLE.code.map((line, i) => {
        const flaw = i === SAMPLE.codeFlawLine;
        return (
          <div key={i} className={flaw ? "mk-ln is-flaw" : "mk-ln"}>
            <b>{i + 1}</b>
            <span>{nb(line)}</span>
            {flaw ? <em className="mk-flag">{t("work.flag")}</em> : null}
          </div>
        );
      })}
    </div>
  );
}

function Distance() {
  const t = useTranslations("siteFeatures");
  return (
    <div className="mk-dist">
      <span className="sil">{t("work.distTitle")}</span>
      <div className="mk-track" style={vars({ "--from": "8%", "--to": "74%" })}>
        <i />
        <span className="mk-pt a" />
        <span className="mk-pt b" />
      </div>
      <div className="mk-dist-l">
        <span>{t("work.distFrom")}</span>
        <span>{t("work.distTo")}</span>
      </div>
    </div>
  );
}

function Badges() {
  const t = useTranslations("siteFeatures");
  const tl = useTranslations("landing");
  return (
    <>
      <Chip className="is-a">
        <Ico name="check" />
        {tl("previews.cases.aiAllowed")}
      </Chip>
      <Chip>
        <Ico name="eye" />
        {t("work.delegation")}
      </Chip>
    </>
  );
}

export default function WorkPanel({ detail }: { detail: boolean }) {
  const t = useTranslations("siteFeatures");
  const [ref, restart] = useRestart();

  if (!detail) {
    return (
      <div className="mock mk-work" ref={ref}>
        <div className="mk-hd">
          <span className="mk-ttl">{t("work.title")}</span>
          <span className="sil">{t("work.sub")}</span>
          <ReplayButton onReplay={restart} />
        </div>
        <div className="mk-cols" style={vars({ "--c1": "1.05fr", "--c2": "1fr" })}>
          <div className="mk-wk-l">
            <Code />
            <Distance />
          </div>
          <div className="mk-wk-r">
            <div className="mk-prompts">
              <span className="sil">{t("work.promptsTitle")}</span>
              <ol>
                {PROMPTS.map((p, i) => (
                  <li key={p} className="mk-pr mk-rise" style={vars({ "--d": `${0.3 + i * 0.1}s` })}>
                    <b>{i + 1}</b>
                    <span>{t(`work.${p}`)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
        <div className="mk-chips">
          <Badges />
        </div>
      </div>
    );
  }

  return (
    <div className="mock mk-detail mk-work-d" ref={ref}>
      <div className="mk-hd">
        <span className="mk-ttl">{t("work.detailTitle")}</span>
        <Badges />
        <ReplayButton onReplay={restart} />
      </div>
      <div className="mk-work-d-grid">
        <section className="mk-panel">
          <span className="sil">{t("work.timeline")}</span>
          <ol className="mk-tl">
            {PROMPTS.map((p, i) => (
              <li key={p} className="mk-rise" style={vars({ "--d": `${i * 0.12}s` })}>
                <span className="mk-pr">
                  <b>{i + 1}</b>
                  <span>{t(`work.${p}`)}</span>
                </span>
                <em>{t(`work.${NOTES[i]}`)}</em>
              </li>
            ))}
          </ol>
        </section>
        <section className="mk-panel">
          <span className="sil">{t("work.flawsTitle")}</span>
          <ul className="mk-fl">
            {FLAWS.map((f) => (
              <li key={f.key} className={f.caught ? "is-caught" : "is-missed"}>
                <span className="mk-fi">
                  <Ico name={f.caught ? "check" : "x"} />
                </span>
                <span>{t(`work.${f.key}`)}</span>
                <span className="mk-chip">{f.caught ? t("work.caught") : t("work.missed")}</span>
              </li>
            ))}
          </ul>
          <Distance />
        </section>
        <section className="mk-panel">
          <span className="sil">{t("work.decisionsTitle")}</span>
          <ol className="mk-dec">
            {DECISIONS.map((d, i) => (
              <li key={d}>
                <b>{i + 1}</b>
                <span>{t(`work.${d}`)}</span>
              </li>
            ))}
          </ol>
          <p className="mk-note mk-dim">{t("work.decisionsNote")}</p>
        </section>
      </div>
    </div>
  );
}
