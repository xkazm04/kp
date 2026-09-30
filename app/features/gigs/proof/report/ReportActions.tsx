"use client";

import { useTranslations } from "next-intl";
import { Button, KitIcon, Mark } from "@/app/_components/kit";
import type { Gig } from "@/app/_lib/gigs/types";
import type { AfterWrite } from "../../logic/wire";
import { useReportFile } from "./useReportFile";

// The hero's report row: the gig's full report, an HTML file the model writes and rewrites
// as the gig moves (GET /api/gigs/[id]/report serves it sandboxed, in a new tab), and
// Regenerate. While a rewrite runs the row says "Writing" (useReportFile re-reads every 5 s);
// a failed rewrite says why. Where the file is on disk, and what it covers, is in the
// metadata sidebar (meta/GigMeta.tsx).

export function ReportActions({ gig, onChanged }: { gig: Gig; onChanged: AfterWrite }) {
  const t = useTranslations("gigs.report.file");
  const tb = useTranslations("gigs.brief");
  const { report, writing, busy, error, regenerate } = useReportFile(gig, onChanged);
  const why = (code: string | null) => {
    const key = code?.startsWith("llm_error") ? "llm_error" : code;
    return key && tb.has(`fallback.${key}` as Parameters<typeof tb>[0]) ? tb(`fallback.${key}` as Parameters<typeof tb>[0]) : (code ?? "").replace(/_/g, " ") || t("noReason");
  };
  const state = writing ? "writing" : (report?.status ?? "none");

  return (
    <div className="rp-acts">
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
      {state === "writing" ? (
        <span className="rp-acts-state is-writing" role="status">
          <Mark kind="wait" />
          {report ? t("status.writing") : t("firstWriting")}
        </span>
      ) : state === "none" ? (
        <span className="rp-acts-state">{t("none")}</span>
      ) : null}
      {state === "failed" ? (
        <p role="alert" className="rp-acts-fail">
          {t("failed", { reason: why(report?.fallbackReason ?? null) })}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
