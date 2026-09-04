"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import { useAnalyzingPoll } from "./jdsBuildPoll";
import { Modal } from "@/app/_components/Modal";
import { BTN_PRIMARY, BTN_SECONDARY, PANEL } from "@/app/_components/ui/recipes";
import { Markdown } from "@/app/_components/Markdown";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useIngestJob, useJdDetail } from "./jdsHooks";
import { builderLintFindings, isUnlinked, jdMarketResearchAvailable, jdMustHaveCount, LINT_MIN_BODY_CHARS, type JdRow } from "./jdsLibrary";
import { JdLintPanel } from "./JdsLintPanel";
import type { CoachEdit } from "@/app/features/library/jobs/jobsCoachApply";
import { BuildingPanel, CaseCard, FailedPanel, RepoGroundingCard, SalaryCard } from "./JdsLedgerDetailPanels";
import { hasCaseContent, hasRepoGrounding, parseArtifacts, readBuildIntent, type CaseArtifact } from "./jdsLedgerArtifacts";
import { BuildHeldBand, BuildIntentLine } from "./JdsLedgerBuildProvenance";
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
  held = false,
  openHistory = false,
  onClose,
  onDuplicate,
  duplicating,
  onIngested,
}: {
  row: JdRow;
  // winnability-apply — when this row was opened from a coach recommendation, the
  // staged edit to surface as a suggestion banner inside the editor. null otherwise.
  stagedSuggestion?: CoachEdit | null;
  /** This build's markdown was filed as a revision instead of published — the row
   *  reads "ready" either way, so the modal has to say it (see useHeldBuilds). */
  held?: boolean;
  /** Opened FROM the held-build chip: land in the editor with its history already
   *  expanded, because the held draft is one of those revision rows. */
  openHistory?: boolean;
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
  const [editing, setEditing] = useState(openHistory);
  // One-shot: the deep-open expands the history on the editor's FIRST mount only,
  // so a later manual Edit in the same modal session opens clean.
  const [historySpent, setHistorySpent] = useState(false);
  // winnability-apply — a coach handoff opens straight into edit mode. Latched off
  // once the recruiter exits the editor so the staged session can't re-open itself.
  const [stagedExited, setStagedExited] = useState(false);
  // Does the editor hold typing that has not been saved? Reported up by the editor,
  // because two of the three ways out of it are this modal's (the header X /
  // Escape / backdrop, and the rail's Edit toggle) and both used to discard silently.
  const [dirty, setDirty] = useState(false);
  const onDirtyChange = useCallback((next: boolean) => setDirty(next), []);
  // The exit the recruiter asked for, held while we ask whether to discard. null =
  // nothing pending. Confirming runs it; "keep editing" drops it and changes nothing.
  const [pendingExit, setPendingExit] = useState<null | "close" | "toggle">(null);

  // While the build runs, poll the detail so it flips to the result in place —
  // through the shared, visibility-gated, backing-off, bounded helper both readers
  // use (jdsBuildPoll.ts). `stalled` is the poll giving up, and it is SAID.
  const stalled = useAnalyzingPoll(analyzing, refresh);
  // The owning jd_build task's live progress line. The polled task list carries
  // progressMsg for free, so this is a lookup, not a request: `analysis_task_id`
  // has ridden the JD row since the build was backgrounded and nothing read it.
  const { tasks } = useTasks();
  const taskId = jd?.analysis_task_id ?? row.analysis_task_id ?? null;
  const buildProgress = taskId ? tasks.find((task) => task.id === taskId)?.progressMsg ?? null : null;

  // Structured artifacts (salary / case) the build stored beside the markdown body.
  // Parsed inline (the modal renders infrequently and the blob is small).
  const artifacts = parseArtifacts(jd?.analysis_json);
  // What the build RAN with (template / output language / seniority). null for a
  // draft save or a pre-migration row — the provenance line is simply not drawn.
  const buildIntent = readBuildIntent(jd?.build_input_json);
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
  const openHeldDraft = () => {
    setHistorySpent(false);
    enterEdit();
  };
  const exitEdit = () => {
    setEditing(false);
    setStagedExited(true);
    setHistorySpent(true);
  };
  const toggleEdit = () => (inEdit ? exitEdit() : enterEdit());
  // The guard. An exit with no unsaved draft behaves exactly as before — the
  // confirmation only appears when there is something real to lose.
  const guardedExit = (exit: "close" | "toggle") => {
    if (inEdit && dirty) {
      setPendingExit(exit);
      return;
    }
    if (exit === "close") onClose();
    else toggleEdit();
  };
  const discardAndExit = () => {
    const exit = pendingExit;
    setPendingExit(null);
    setDirty(false);
    if (exit === "close") onClose();
    else exitEdit();
  };
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
    <Modal title={row.title} subtitle={row.slug} onClose={() => guardedExit("close")} size="4xl">
      <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
        {/* Metadata rail */}
        <JdsLedgerDetailRail
          row={row}
          effRow={effRow}
          analyzing={analyzing}
          canEdit={canEdit}
          inEdit={inEdit}
          toggleEdit={() => guardedExit("toggle")}
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
              initialHistoryOpen={openHistory && !historySpent}
              onDirtyChange={onDirtyChange}
              onCancel={() => guardedExit("toggle")}
              onDone={() => {
                exitEdit();
                refresh();
              }}
            />
          ) : analyzing ? (
            <BuildingPanel progress={buildProgress} stalled={stalled} />
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
              {held ? <BuildHeldBand onOpenDraft={openHeldDraft} /> : null}
              {buildIntent ? <BuildIntentLine intent={buildIntent} /> : null}
              {artifacts?.salary ? <SalaryCard salary={artifacts.salary} sources={artifacts.salarySources} source={artifacts.salarySource} /> : null}
              {hasRepoGrounding(artifacts?.snapshot) ? <RepoGroundingCard snapshot={artifacts.snapshot} /> : null}
              {jd.body.trim() ? (
                <>
                  <article className={`${PANEL} p-5`}>
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
      {/* Stacked over the detail modal — the shared Modal's dialog stack keeps
          Escape and the focus trap acting on THIS one while it is open. */}
      {pendingExit ? (
        <Modal
          title={t("unsavedTitle")}
          onClose={() => setPendingExit(null)}
          size="md"
          footer={
            <>
              <button type="button" onClick={() => setPendingExit(null)} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
                {t("unsavedKeep")}
              </button>
              <button type="button" onClick={discardAndExit} className={`${BTN_PRIMARY} h-9 px-3 text-sm`}>
                {t("unsavedDiscard")}
              </button>
            </>
          }
        >
          <p className="text-sm text-steel">{t("unsavedBody")}</p>
        </Modal>
      ) : null}
    </Modal>
  );
}
