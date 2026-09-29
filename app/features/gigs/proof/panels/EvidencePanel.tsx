"use client";

import { useTranslations } from "next-intl";
import { Mark, StatStrip, Tag } from "@/app/_components/kit";
import type { GigAttempt } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { evidenceState } from "../../logic/facts";
import { Panel } from "./Panel";

// What the agent reports running: passed, failed, NOT VERIFIED (never two states) - a stat
// strip, then one card per item with its command and result.

export function EvidencePanel({ attempt }: { attempt: GigAttempt | null }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const dl = attempt?.deliverable ?? null;
  if (!dl) {
    return (
      <Panel title={t("back.evidence")}>
        <p className="panel-empty">{t("tabs.noEvidenceYet")}</p>
      </Panel>
    );
  }
  const states = dl.evidence.map((e) => evidenceState(e.passed));
  const n = (s: string) => states.filter((x) => x === s).length;
  return (
    <Panel title={t("back.evidence")} sub={t("tabs.evidenceSub", { count: dl.evidence.length })}>
      <StatStrip
        items={[
          { label: t("tabs.passed"), value: n("passed") },
          { label: t("tabs.failed"), value: n("failed"), tone: n("failed") ? "needs" : "default" },
          { label: t("tabs.unverified"), value: n("unverified") },
          { label: t("tabs.confidence"), value: fmt.percent(Math.round(dl.confidence * 100)), tip: t("tabs.confidenceTip") },
        ]}
      />
      {dl.evidence.length === 0 ? (
        <p className="panel-empty">{t("desk.noEvidence")}</p>
      ) : (
        <ol className="ev-list">
          {dl.evidence.map((e, i) => {
            const st = states[i];
            const kind = t.has(`evidenceKind.${e.kind}`) ? t(`evidenceKind.${e.kind}`) : e.kind;
            return (
              <li key={i} id={`gd-ev-${i}`} className={`ev-item is-${st}`}>
                <Mark kind={st === "passed" ? "ok" : st === "failed" ? "fail" : "unknown"} tip={t(`evidenceState.${st}`)} />
                <div className="ev-body">
                  <div className="ev-head">
                    <span className="ev-n">{i + 1}</span>
                    <Tag label={kind} />
                    <span className={`ev-state is-${st}`}>{t(`evidenceState.${st}`)}</span>
                  </div>
                  {e.command ? (
                    <pre className="ev-cmd">
                      <span aria-hidden>$ </span>
                      {e.command}
                    </pre>
                  ) : (
                    <p className="ev-nocmd">{t("desk.noCommand")}</p>
                  )}
                  <p className="ev-res">{e.result}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
