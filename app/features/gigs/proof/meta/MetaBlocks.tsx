"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import type { Gig } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { proposalHasFile, trackOf } from "../../logic/proposal";
import { useFallbackWhy } from "../report/useGigFile";

// The metadata sidebar's text blocks under the figures (GigMeta.tsx holds the head and the
// figures): the gig's track, which both tracks show, and the files kp wrote for it - the
// report, and on a freelance bid the client proposal - each with what it covers and its path
// to copy. An absent cost is left out of the line, never printed as $0.

type Copy = (text: string, done: string, failed: string) => void;

/** Which workflow the gig is on (logic/proposal.ts): a freelance bid gets a proposal and
 *  nothing is built; every other arena is open-ended and the work is the entry. */
export function TrackBlock({ gig }: { gig: Gig }) {
  const t = useTranslations("gigs.proposal.meta");
  const bid = trackOf(gig) === "proposal";
  return (
    <div className="aside-block meta-track">
      <p className="caps dim">{t("track")}</p>
      <p className="meta-track-v">{bid ? t("proposal") : t("build")}</p>
      <p className="t-meta">{bid ? t("proposalSub") : t("buildSub")}</p>
    </div>
  );
}

export function ReportFileBlock({ gig, copy }: { gig: Gig; copy: Copy }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const report = gig.report;
  if (!report) return null;
  return (
    <div className="aside-block meta-report">
      <p className="caps dim">{t("meta.reportFile")}</p>
      <p className="t-meta">
        {[
          t("report.file.covers", { stage: t(`report.file.stage.${report.stage}`), date: fmt.dateTime(report.generatedAt) }),
          report.source === "llm" ? t("report.file.byModel") : t("meta.byKp"),
          report.costUsd !== null ? t("report.file.cost", { usd: fmt.usd(report.costUsd) }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <code className="meta-path">{report.path}</code>
      <Button label={t("report.file.copy")} icon="copy" size="sm" variant="ghost" onClick={() => copy(report.path, t("report.file.copied"), t("report.file.copyFailed"))} />
    </div>
  );
}

/** The client proposal as the report file block sets it: what it was written from, when, by
 *  a model or by kp, its cost when one was reported; its state while a write runs or after
 *  one failed; the path to copy once a file exists. */
export function ProposalFileBlock({ gig, copy }: { gig: Gig; copy: Copy }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const why = useFallbackWhy();
  const p = gig.proposal;
  if (!p || trackOf(gig) !== "proposal") return null;
  const hasFile = proposalHasFile(p);
  return (
    <div className="aside-block meta-report">
      <p className="caps dim">{t("proposal.meta.file")}</p>
      {hasFile ? (
        <p className="t-meta">
          {[
            p.planId ? t("proposal.meta.fromPlan", { date: fmt.dateTime(p.generatedAt) }) : t("proposal.meta.fromBrief", { date: fmt.dateTime(p.generatedAt) }),
            p.source === "llm" ? t("report.file.byModel") : t("meta.byKp"),
            p.costUsd !== null ? t("report.file.cost", { usd: fmt.usd(p.costUsd) }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      {p.status === "writing" ? <p className="t-meta meta-state">{t("proposal.meta.writing")}</p> : null}
      {p.status === "failed" ? <p className="t-meta coral">{t("proposal.meta.failed", { reason: why(p.fallbackReason) })}</p> : null}
      {hasFile ? (
        <>
          <code className="meta-path">{p.path}</code>
          <Button label={t("report.file.copy")} icon="copy" size="sm" variant="ghost" onClick={() => copy(p.path, t("proposal.meta.copied"), t("report.file.copyFailed"))} />
        </>
      ) : null}
    </div>
  );
}
