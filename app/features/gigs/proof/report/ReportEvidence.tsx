"use client";

import { useTranslations } from "next-intl";
import type { GigDeliverable } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { evidenceState, type EvidenceState } from "../../logic/facts";
import { Pill, StatCard, type Tone } from "./parts";

// Section 6, evidence: what the agent reports running, as a table in the design report's
// style - a dark header (Check · Command · Result), the check in bold at the left with its
// status pill, the command as code, the result as the agent wrote it. Three states, never
// two: `passed: null` ran with no pass/fail meaning and is NOT VERIFIED, not failed. The
// agent's confidence is a stat, never a score. Rows carry `gd-ev-<n>` ids: the proof slip's
// "go to evidence" link marks them (DraftTab.tsx useSlipJump).

const TONE: Readonly<Record<EvidenceState, Tone>> = { passed: "moss", failed: "coral", unverified: "steel" };

export function ReportEvidence({ deliverable: dl }: { deliverable: GigDeliverable }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const states = dl.evidence.map((e) => evidenceState(e.passed));
  const n = (s: EvidenceState) => states.filter((x) => x === s).length;
  return (
    <>
      <div className="rp-stats is-four">
        <StatCard value={fmt.number(n("passed"))} label={t("tabs.passed")} caption={t("report.evidence.passedCap")} tone={n("passed") ? "moss" : undefined} />
        <StatCard value={fmt.number(n("failed"))} label={t("tabs.failed")} caption={t("report.evidence.failedCap")} tone={n("failed") ? "coral" : undefined} />
        <StatCard value={fmt.number(n("unverified"))} label={t("tabs.unverified")} caption={t("report.evidence.unverifiedCap")} />
        <StatCard value={fmt.percent(Math.round(dl.confidence * 100))} label={t("tabs.confidence")} caption={t("tabs.confidenceTip")} />
      </div>
      {dl.evidence.length === 0 ? (
        <p className="panel-empty">{t("desk.noEvidence")}</p>
      ) : (
        <div className="rp-tablewrap">
          <table className="rp-table">
            <caption>{t("report.evidence.caption", { count: dl.evidence.length })}</caption>
            <thead>
              <tr>
                <th scope="col">{t("report.evidence.check")}</th>
                <th scope="col">{t("report.evidence.command")}</th>
                <th scope="col">{t("report.evidence.result")}</th>
              </tr>
            </thead>
            <tbody>
              {dl.evidence.map((e, i) => {
                const st = states[i];
                const kind = t.has(`evidenceKind.${e.kind}`) ? t(`evidenceKind.${e.kind}`) : e.kind;
                return (
                  <tr key={i} id={`gd-ev-${i}`} className={`is-${st}`}>
                    <th scope="row">
                      <span className="rp-ev-n">{i + 1}</span> {kind}
                      <br />
                      <Pill tone={TONE[st]}>{t(`evidenceState.${st}`)}</Pill>
                    </th>
                    <td>{e.command ? <code className="rp-code">$ {e.command}</code> : <span className="ev-nocmd">{t("desk.noCommand")}</span>}</td>
                    <td className="rp-res">{e.result}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
