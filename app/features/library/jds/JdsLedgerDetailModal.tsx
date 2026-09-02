"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { Markdown } from "@/app/_components/Markdown";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useIngestJob, useJdDetail } from "./jdsHooks";
import { builderLintFindings, isUnlinked, jdMarketResearchAvailable, jdMustHaveCount, LINT_MIN_BODY_CHARS, type JdRow } from "./jdsLibrary";
import { JdLintPanel } from "./JdsLintPanel";
import type { CoachEdit } from "@/app/features/library/jobs/jobsCoachApply";
import { BuildingPanel, CaseCard, FailedPanel, RepoGroundingCard, SalaryCard } from "./JdsLedgerDetailPanels";
import { hasCaseContent, hasRepoGrounding, parseArtifacts, type CaseArtifact } from "./jdsLedgerArtifacts";
import { JdsLedgerDetailRail } from "./JdsLedgerDetailRail";

const JdModalEditor = dynamic(() => import("./JdsModalEditor").then((m) => ({ default: m.JdModalEditor })), {
  loading: () => <div className="reveal-quiet min-h-[16rem]" aria-hidden />,
});

// The saved-JD detail modal (metadata rail + rendered posting / editor / build
// states) — extracted verbatim from LibrarySavedJdsLedger.tsx so that file stays
// under the 200-line split threshold.
export function LedgerDetailModal({
  row,
  stagedSuggestion,
  onClose,
  onDuplicate,
  duplicating,
  onIngested,
}: {
  row: JdRow;
  // winnability-apply — when this row was opened from a coach recommendation, the
  // staged edit to surface as a suggestion banner inside the editor. null otherwise.
  stagedSuggestion?: CoachEdit | null;
  onClose: () => void;
  onDuplicate: (row: JdRow) => void;
  duplicating: boolean;
  onIngested: (jobId: string | null) => void;
}) {
  const t = useTranslations("library.tab");
  // API failures resolve from the machine `code`, never the server's English
  // `error` string — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const { jd, status, refresh } = useJdDetail(row.slug);
  // Prefer the freshly-fetched detail's state over the (snapshot) row, so a
  // poll-driven flip to ready/failed is reflected without reopening.
  const analysisStatus = jd?.analysis_status ?? row.analysis_status ?? null;
  const analyzing = analysisStatus === "analyzing";
  const failed = analysisStatus === "failed";
  const effRow = { ...row, analysis_status: analysisStatus };
  const ing = useIngestJob(row.slug, (jobId) => onIngested(jobId));
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  // Direction 1 — in-place edit inside the modal (title + body → the existing PATCH).
  const [editing, setEditing] = useState(false);
  // winnability-apply — a coach handoff opens straight into edit mode. Latched off
  // once the recruiter exits the editor so the staged session can't re-open itself.
  const [stagedExited, setStagedExited] = useState(false);

  // While the build runs, poll the detail so it flips to the result in place.
  useEffect(() => {
    if (!analyzing) return;
    const id = setInterval(refresh, 3500);
    return () => clearInterval(id);
  }, [analyzing, refresh]);

  // Structured artifacts (salary / case) the build stored beside the markdown body.
  // Parsed inline (the modal renders infrequently and the blob is small).
  const artifacts = parseArtifacts(jd?.analysis_json);
  // Edit is offered only for a settled JD (never mid-build / failed) once the body
  // has loaded. A grounded market band feeds the lint's salary-suppression seam.
  const canEdit = Boolean(jd) && !analyzing && !failed && status === "ready";
  const marketResearch = jdMarketResearchAvailable(artifacts);

  // winnability-apply — the coach handoff auto-enters edit mode by DERIVATION (no
  // effect-set state): the staged session is live while a suggestion is present, the
  // JD is editable, and the recruiter hasn't exited yet. `inEdit` merges that with a
  // manual Edit toggle; exiting the editor (save / cancel) latches the session shut.
  const stagedActive = Boolean(stagedSuggestion) && canEdit && !stagedExited;
  const inEdit = editing || stagedActive;
  const enterEdit = () => {
    setEditing(true);
    setStagedExited(false);
  };
  const exitEdit = () => {
    setEditing(false);
    setStagedExited(true);
  };
  const toggleEdit = () => (inEdit ? exitEdit() : enterEdit());
  const showStaged = stagedActive ? stagedSuggestion : null;

  const retry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const r = await fetch(`/api/jds/${encodeURIComponent(row.slug)}/retry-analysis`, { method: "POST" });
      // A retry replays the paid AI build, so the route is operator-gated — surface
      // the refusal honestly rather than a generic "couldn't retry".
      if (r.status === 401 || r.status === 403) throw new Error(t("notPermitted"));
      if (!r.ok) {
        const p = await r.json().catch(() => ({}));
        throw new Error(errMsg(p, t("retryFailed")));
      }
      refresh(); // reflects the reset-to-analyzing state; the poll then tracks it
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : t("retryFailed"));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Modal title={row.title} subtitle={row.slug} onClose={onClose} size="4xl">
      <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
        {/* Metadata rail */}
        <JdsLedgerDetailRail
          row={row}
          effRow={effRow}
          analyzing={analyzing}
          canEdit={canEdit}
          inEdit={inEdit}
          toggleEdit={toggleEdit}
          onDuplicate={onDuplicate}
          duplicating={duplicating}
          ing={ing}
          t={t}
        />

        {/* Rendered posting — plus the in-progress / failed states of a backgrounded build. */}
        <section className="min-w-0">
          {inEdit && jd ? (
            <JdModalEditor
              slug={row.slug}
              initialTitle={jd.title}
              initialBody={jd.body}
              marketResearch={marketResearch}
              // Whether a jd-<slug> job actually exists. PATCH /api/jds/[slug]
              // re-ingests the linked role ONLY inside `if (getJob(jobId))`, so on an
              // unlinked JD the editor's "edits update the linked role too" note
              // described a write the server never performs — while the rail beside
              // it showed the Unlinked chip and an "Ingest as job" button.
              linked={!isUnlinked(effRow)}
              stagedSuggestion={showStaged}
              onDone={() => {
                exitEdit();
                refresh();
              }}
            />
          ) : analyzing ? (
            <BuildingPanel />
          ) : failed ? (
            <FailedPanel error={jd?.analysis_error ?? null} retrying={retrying} retryError={retryError} onRetry={retry} />
          ) : status === "loading" ? (
            // Tier 2: the detail fetch is in flight and there's nothing to show yet —
            // hold the reader's height quietly instead of pulsing fake heading/body bars.
            <div className="reveal-quiet min-h-[10rem]" aria-hidden />
          ) : status === "error" || !jd ? (
            <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{t("detailLoadError")}</p>
          ) : (
            <div className="space-y-4">
              {artifacts?.salary ? <SalaryCard salary={artifacts.salary} sources={artifacts.salarySources} source={artifacts.salarySource} /> : null}
              {hasRepoGrounding(artifacts?.snapshot) ? <RepoGroundingCard snapshot={artifacts.snapshot} /> : null}
              {jd.body.trim() ? (
                <>
                  <article className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
                    <Markdown content={jd.body} />
                  </article>
                  {/* lint-the-artifact — a Generated JD publishes UNLINTED (JdBuilder lints
                      only the recruiter's PROMPT). The primary read-view now runs the SAME
                      advisory specificity/inclusivity engine the editor uses over the
                      rendered body, threading the same salary-suppression seam (a grounded
                      market band ⇒ don't flag missing salary). The all-clear state renders
                      too, so a clean JD says so — but ONLY once the body is long enough for
                      the engine to have actually run: builderLintFindings returns [] below
                      LINT_MIN_BODY_CHARS (the anti-nagging threshold), and this is the one
                      surface that renders zero findings as a positive verdict. A short
                      hand-saved JD ("Senior React developer needed.") therefore claimed
                      "pay, place, no boilerplate" about text carrying neither. Below the
                      threshold the panel stays silent instead of vouching for an unlinted
                      body. */}
                  {jd.body.trim().length >= LINT_MIN_BODY_CHARS ? (
                    <JdLintPanel findings={builderLintFindings(jd.body, { marketResearch, mustHaveCount: jdMustHaveCount(artifacts) })} />
                  ) : null}
                </>
              ) : (
                <p className="text-sm italic text-steel">{t("noDescriptionYet")}</p>
              )}
              {hasCaseContent(artifacts?.case) ? <CaseCard kase={artifacts!.case as CaseArtifact} /> : null}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
