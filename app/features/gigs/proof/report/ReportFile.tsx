"use client";

import { useTranslations } from "next-intl";
import { Button, KitIcon, Mark } from "@/app/_components/kit";
import type { Gig } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { reportAnchor } from "../../logic/report";
import type { AfterWrite } from "../../logic/wire";
import { useReportFile } from "./useReportFile";

// The card under the hero: the gig's full report, an HTML file the model writes and rewrites
// as the gig moves (researched, planned, accepted, drafted, sent, closed). The long read -
// plans compared, progress, evidence, the record - lives in that file, opened in a new tab
// (GET /api/gigs/[id]/report serves it sandboxed) or straight from disk by its path. The card
// says what the file covers (the stage it was written at, when, by a model or by kp with no
// model and why, what the call cost when reported), shows a quiet "Writing" while a rewrite
// runs (useReportFile re-reads every 5 s), a failed rewrite's reason, and Regenerate.

export function ReportFile({ gig, onChanged, onFlash }: { gig: Gig; onChanged: AfterWrite; onFlash: (message: string) => void }) {
  const t = useTranslations("gigs.report.file");
  const tb = useTranslations("gigs.brief");
  const fmt = useGigsFormat();
  const { report, writing, busy, error, regenerate } = useReportFile(gig, onChanged);
  const why = (code: string | null) => {
    const key = code?.startsWith("llm_error") ? "llm_error" : code;
    return key && tb.has(`fallback.${key}` as Parameters<typeof tb>[0]) ? tb(`fallback.${key}` as Parameters<typeof tb>[0]) : (code ?? "").replace(/_/g, " ") || t("noReason");
  };
  const copy = () => {
    if (!report) return;
    const done = () => onFlash(t("copied"));
    const failed = () => onFlash(t("copyFailed"));
    if (navigator.clipboard) void navigator.clipboard.writeText(report.path).then(done, failed);
    else failed();
  };
  const state = writing ? "writing" : (report?.status ?? "none");
  const covers = report
    ? [
        t("covers", { stage: t(`stage.${report.stage}`), date: fmt.dateTime(report.generatedAt) }),
        report.source === "llm" ? t("byModel") : t("byKp", { reason: why(report.fallbackReason) }),
        report.costUsd !== null ? t("cost", { usd: fmt.usd(report.costUsd) }) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <section className={`rpf is-${state}`} aria-labelledby={reportAnchor("file")}>
      <div className="rpf-main">
        <div className="rpf-head">
          <h3 id={reportAnchor("file")} tabIndex={-1} className="rpf-title">
            {t("title")}
          </h3>
          {state === "none" ? null : (
            <span className="rpf-state" role={state === "writing" ? "status" : undefined}>
              <Mark kind={state === "writing" ? "wait" : state === "failed" ? "fail" : "ok"} />
              {t(`status.${state}`)}
            </span>
          )}
        </div>
        {report ? (
          <>
            <p className="rpf-covers">{covers}</p>
            <div className="rpf-path">
              <code>{report.path}</code>
              <Button label={t("copy")} icon="copy" size="sm" variant="ghost" onClick={copy} />
            </div>
          </>
        ) : (
          <p className="rpf-covers">{writing ? t("firstWriting") : t("none")}</p>
        )}
        {writing ? <p className="rpf-note">{t("writingNote")}</p> : null}
        {state === "failed" ? (
          <p role="alert" className="rpf-fail">
            {t("failed", { reason: why(report?.fallbackReason ?? null) })}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="rpf-acts">
        {report ? (
          <a className="k-btn k-btn--primary" href={`/api/gigs/${encodeURIComponent(gig.id)}/report`} target="_blank" rel="noopener noreferrer">
            <KitIcon name="open" />
            {t("open")}
          </a>
        ) : null}
        <Button
          label={t("regenerate")}
          tip={gig.brief ? t("regenerateTip") : t("regenerateNeedsBrief")}
          variant={report ? "secondary" : "primary"}
          loading={busy}
          loadingLabel={t("regenerating")}
          disabled={!gig.brief || writing}
          onClick={() => void regenerate()}
        />
      </div>
    </section>
  );
}
