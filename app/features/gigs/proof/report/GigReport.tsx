"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";
import { briefChallenges } from "@/app/_lib/gigs/withdraw-reasons";
import { useGigsFormat } from "../../data/useGigsFormat";
import { milestoneRows, milestoneTotals } from "../../logic/pairing";
import { planView } from "../../logic/plans";
import { briefAsks, REPORT_SECTIONS, reportOpen, spendSoFar, type ReportSection as SectionId } from "../../logic/report";
import type { SummaryText } from "../../logic/summary";
import type { AfterWrite, SpecialistRow } from "../../logic/wire";
import type { ChallengeWithdraw } from "../panels/BriefChallenges";
import type { GigRecord } from "../panels/useGigRecord";
import type { PlansState } from "../panels/usePlans";
import { Figure, ReportSection } from "./parts";
import { ReportAsks } from "./ReportAsks";
import { ReportEvidence } from "./ReportEvidence";
import { ReportHero } from "./ReportHero";
import { ReportIndex } from "./ReportIndex";
import { ReportPlans } from "./ReportPlans";
import { ReportProgress } from "./ReportProgress";
import { ReportRecord } from "./ReportRecord";

// The gig's report: the proof's Summary tab (proofTabs.tsx), one page that grows with the
// gig in place of the old Summary, Plans, Draft and Evidence tabs. Set the way the contest's
// design report is set (styles/report.css): the gig as a hero with stat cards, a numbered
// index, then numbered sections - what it asks, the plans, the progress, the draft, the
// evidence, the record - each a figure, a table or a timeline in HTML, never rendered
// Markdown. A section whose time has not come is only a greyed index line saying when it
// appears (logic/report.ts reportOpen). At a wide proof column a compact index rides beside.

const N = (s: SectionId) => REPORT_SECTIONS.indexOf(s) + 1;

export function GigReport({
  gig,
  attempt,
  summary,
  now,
  record,
  recordError,
  persona,
  plansState,
  draft,
  withdraw,
  onChanged,
  onFlash,
  onOpenTab,
}: {
  gig: Gig;
  attempt: GigAttempt | null;
  summary: SummaryText;
  now: Date;
  record: GigRecord | null;
  recordError: string | null;
  persona: SpecialistRow | null;
  plansState: PlansState;
  draft: ReactNode;
  withdraw: ChallengeWithdraw;
  onChanged: AfterWrite;
  onFlash: (message: string) => void;
  onOpenTab: (tab: "listing" | "history") => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const asks = useMemo(() => briefAsks(gig.brief?.markdown), [gig.brief]);
  const challenges = useMemo(() => briefChallenges(gig.brief), [gig.brief]);
  const view = useMemo(() => planView(plansState.plans), [plansState.plans]);
  const accepted = view.accepted;
  const attempts = record?.attempts ?? (attempt ? [attempt] : []);
  const spend = spendSoFar(plansState.plans, attempts);
  const dl = attempt?.deliverable ?? null;
  const totals = milestoneTotals(milestoneRows(accepted));
  const failed = dl ? dl.evidence.filter((e) => e.passed === false).length : 0;
  const open = reportOpen({
    brief: gig.brief !== null,
    asks: asks.length + challenges.length,
    paired: accepted !== null && (persona !== null || accepted.progress !== null),
    attempt: attempt !== null,
    suspect: gig.status === "suspect",
    deliverable: dl !== null,
    attempts: record ? record.attempts.length : null,
  });
  const notes: Partial<Record<SectionId, string>> = {
    asks: t("report.note.asks", { asks: asks.length, challenges: challenges.length }),
    plans: view.shown ? t("report.note.plans", { count: view.shown.rows.length, accepted: accepted ? "yes" : "no" }) : gig.brief ? t("report.note.noPlans") : t("report.note.researchFirst"),
    progress: t("report.note.progress", { pct: totals.pct, done: totals.done, total: totals.total }),
    draft: attempt ? fmt.attemptStatus(attempt.status) : undefined,
    evidence: dl ? t("report.note.evidence", { count: dl.evidence.length, failed }) : undefined,
    record: t("report.note.record", { count: attempts.length }),
  };
  let f = 0;
  const fig = { asks: open.asks ? ++f : 0, plans: view.shown ? ++f : 0, progress: open.progress ? ++f : 0, draft: open.draft ? ++f : 0 };

  return (
    <article className="rp" aria-label={t("report.label")}>
      <div className="rp-main">
        <ReportHero gig={gig} summary={summary} now={now} spend={spend} onOpenListing={() => onOpenTab("listing")} />
        <ReportIndex open={open} notes={notes} />

        {open.asks && gig.brief ? (
          <ReportSection id="asks" n={N("asks")} title={t("report.sec.asks")}>
            <ReportAsks brief={gig.brief} asks={asks} challenges={challenges} withdraw={withdraw} figure={fig.asks} />
          </ReportSection>
        ) : null}

        <ReportSection id="plans" n={N("plans")} title={t("report.sec.plans")}>
          <ReportPlans gig={gig} plansState={plansState} figure={fig.plans} onChanged={onChanged} onFlash={onFlash} />
        </ReportSection>

        {open.progress && accepted ? (
          <ReportSection id="progress" n={N("progress")} title={t("report.sec.progress")}>
            <ReportProgress accepted={accepted} figure={fig.progress} />
          </ReportSection>
        ) : null}

        {open.draft ? (
          <ReportSection id="draft" n={N("draft")} title={t("report.sec.draft")}>
            <Figure n={fig.draft} what={t("report.draft.caption")} source={attempt ? t("report.draft.source", { date: fmt.dateTime(attempt.updatedAt) }) : undefined} plain>
              {draft}
            </Figure>
          </ReportSection>
        ) : null}

        {open.evidence && dl ? (
          <ReportSection id="evidence" n={N("evidence")} title={t("report.sec.evidence")}>
            <ReportEvidence deliverable={dl} />
          </ReportSection>
        ) : null}

        {open.record ? (
          <ReportSection id="record" n={N("record")} title={t("report.sec.record")}>
            <ReportRecord record={record} error={recordError} onOpenHistory={() => onOpenTab("history")} />
          </ReportSection>
        ) : null}
      </div>
      <ReportIndex open={open} notes={notes} compact />
    </article>
  );
}
