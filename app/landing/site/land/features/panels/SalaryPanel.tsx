"use client";

import { useTranslations } from "next-intl";
import { Chip, Ico, ReplayButton, useRestart, vars } from "./kit";

/*
 * Salary radar (B/3 `salary`, prototype land/mocks.js §6): the market band for
 * the role, shifted to the company type, with the offer's pin inside it. No
 * figures: the marks show the shape, never a salary (the panel says so).
 */
function Lane({ adjusted, labels }: { adjusted: boolean; labels: boolean }) {
  const t = useTranslations("siteFeatures");
  const band = adjusted ? { "--l": "28%", "--w": "56%", "--t": "52%" } : { "--l": "14%", "--w": "52%", "--t": "50%" };
  return (
    <div className={adjusted ? "mk-lane is-adj" : "mk-lane is-raw"}>
      <span className="sil mk-lane-t">{adjusted ? t("salary.adjustedBand") : t("salary.marketBand")}</span>
      <div className="mk-axis">
        <div className="mk-band" style={vars(band)}>
          <span className="mk-mark a" />
          <span className="mk-mark b" />
          <span className="mk-mark c" />
          {labels ? (
            <>
              <span className="mk-ml a sil">{t("salary.min")}</span>
              <span className="mk-ml b sil">{t("salary.typical")}</span>
              <span className="mk-ml c sil">{t("salary.max")}</span>
            </>
          ) : null}
          {adjusted ? (
            <svg className="mk-pin" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z" />
              <circle cx="12" cy="10" r="2.6" />
            </svg>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Shift() {
  const t = useTranslations("siteFeatures");
  return (
    <div className="mk-shift">
      <Ico name="arrow" className="mk-dn" />
      <span className="sil">{t("salary.shift")}</span>
    </div>
  );
}

const LINES = ["line1", "line2", "line3"] as const;

export default function SalaryPanel({ detail }: { detail: boolean }) {
  const t = useTranslations("siteFeatures");
  const tl = useTranslations("landing");
  const [ref, restart] = useRestart();

  if (!detail) {
    return (
      <div className="mock mk-salary" ref={ref}>
        <div className="mk-hd">
          <span className="mk-ttl">{tl("features.salary.title")}</span>
          <Chip className="is-a">{t("salary.market")}</Chip>
          <ReplayButton onReplay={restart} />
        </div>
        <div className="mk-sal">
          <Lane adjusted={false} labels={false} />
          <Shift />
          <Lane adjusted labels />
        </div>
        <p className="mk-foot-n">{t("salary.foot")}</p>
      </div>
    );
  }

  return (
    <div className="mock mk-detail mk-salary-d" ref={ref}>
      <div className="mk-hd">
        <span className="mk-ttl">{t("salary.detailTitle")}</span>
        <Chip className="is-a">{t("salary.market")}</Chip>
        <ReplayButton onReplay={restart} />
      </div>
      <div className="mk-cols" style={vars({ "--c1": "1.7fr", "--c2": "1fr" })}>
        <div className="mk-panel mk-sal is-big">
          <Lane adjusted={false} labels />
          <Shift />
          <Lane adjusted labels />
        </div>
        <div className="mk-side">
          <ol className="mk-lines">
            {LINES.map((l, i) => (
              <li key={l} className="mk-rise" style={vars({ "--d": `${0.2 + i * 0.15}s` })}>
                <b>{i + 1}</b>
                <span>{t(`salary.${l}`)}</span>
              </li>
            ))}
          </ol>
          <p className="mk-note mk-dim">{t("salary.note")}</p>
        </div>
      </div>
    </div>
  );
}
