"use client";

import { useState } from "react";
import { FileCode2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { Markdown } from "@/app/_components/Markdown";
import { CompareSubmissions } from "./DevCompareSubmissions";
import { InterviewKit } from "./DevInterviewKit";
import { caseToMarkdown } from "./DevHelpers";
import { DevCaseDetailHeader } from "./DevCaseDetailHeader";
import { DevCaseDetailInternal } from "./DevCaseDetailInternal";
import { DevCaseDetailShortlist } from "./DevCaseDetailShortlist";
import { DevCaseDetailChannels } from "./DevCaseDetailChannels";
// #3 + #5 (bug-ui-scan-2026-07-09) — publish-gate + seed-preview logic extracted to
// pure siblings so they are unit-testable (node --test can't load this .tsx).
import { canConfirmPublish, degradedReasons, isDegradedPublish } from "./DevCaseDetail.publish";
import { seedPreview } from "./DevCaseDetail.seed";
import type { DevCaseDetail, Posting, SeedFile } from "./DevTypes";

/** The readable case document: the candidate-facing assignment rendered as
 *  formatted Markdown (caseToMarkdown — probes can never leak into it), followed
 *  by clearly-marked INTERNAL panels (probes + decision spaces, rubric, role
 *  spec) and this case's postings/submissions with their evaluations. */
export function CaseDetail({
  kase,
  postings,
  onBack,
  publish,
  publishing,
  source,
  sourcing,
  sourcedCounts,
  loadPostings,
}: {
  kase: DevCaseDetail;
  postings: Posting[];
  onBack: () => void;
  publish: (caseId: string) => void;
  publishing?: boolean;
  source: (caseId: string) => void;
  sourcing: string | null;
  sourcedCounts: Record<string, number>;
  loadPostings: () => void;
}) {
  const t = useTranslations("devcase.studio.detail");
  const tWaiting = useTranslations("devcase.studio.waiting");
  const c = kase.case ?? {};
  const role = kase.role ?? null;
  // GH4 — the role spec flattened to JD-ish text, so an author's-GitHub
  // assessment launched from a submission reads against the role being hired
  // for (jobFitSignals are JD-driven) instead of running JD-blind.
  const roleJdText = role
    ? [
        role.title,
        role.seniority,
        ...(role.mustHaves ?? []),
        ...(role.niceToHaves ?? []),
        ...(role.responsibilities ?? []),
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const casePostings = postings.filter((p) => p.caseId === kase.id);
  const published = casePostings.length > 0;
  // fec3e23a — every submission across this case's postings, for the cohort
  // probe-miss roll-up in the internal section.
  const caseSubmissions = casePostings.flatMap((p) => p.submissions ?? []);
  // 8d4f38b9 — the winning submission (highest transfer fit among those evaluated)
  // for its auto-generated interview kit.
  const topSubmission = caseSubmissions
    .filter((s) => s.evaluation?.followups?.questions?.length)
    .sort((a, b) => (b.transferScore ?? -1) - (a.transferScore ?? -1))[0];
  // 99288c0e — one cross-channel leaderboard: every submission across all of this
  // case's postings, ranked by transfer fit and tagged with its channel, so the
  // true #1 for the assignment is visible regardless of which channel they applied
  // through. The per-posting cards keep only the apply link + intake form.
  const shortlist = casePostings
    .flatMap((p) => (p.submissions ?? []).map((s) => ({ s, channel: p.channel })))
    .sort((a, b) => (b.s.transferScore ?? -1) - (a.s.transferScore ?? -1));
  const hasScenario = Array.isArray(kase.scenario?.phases) && (kase.scenario?.phases?.length ?? 0) > 0;
  // Provenance persisted with each generated blob (devcase-orchestrator) — same visual
  // language as the ProvenanceStrip: moss = real LLM output, amber = degraded/template.
  // A non-"llm" source means the generation fell back: the scenario carries generic
  // template probes, the seed is the prose-only skeleton. Records saved before
  // provenance was persisted carry no `source` and keep the plain badges.
  const scenarioDegraded = hasScenario && kase.scenario?.source != null && kase.scenario.source !== "llm";
  const seedDegraded = kase.seed?.source != null && kase.seed.source !== "llm";

  // #3 — Publish is effectively IRREVERSIBLE here (mints a live apply token + sources
  // real candidates) and used to fire on a single unguarded click, degraded or not. Gate
  // it behind an explicit confirm step; a degraded case additionally needs the "publish
  // anyway" acknowledgement (canConfirmPublish). NOTE: the fix sketch's third leg — an
  // in-surface "Close posting" control — is intentionally SKIPPED here: there is no
  // per-posting close endpoint (only /api/devcase/lifecycle/[id]/close, which dispatches
  // candidate rejections and is owned by the lifecycle context), so adding a live button
  // with no safe backing endpoint would be worse than deferring it.
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [ackDegraded, setAckDegraded] = useState(false);
  const degraded = isDegradedPublish({ scenarioDegraded, seedDegraded });
  const publishReasons = degradedReasons({ scenarioDegraded, seedDegraded });
  const canPublishNow = canConfirmPublish({ scenarioDegraded, seedDegraded, acknowledgedDegraded: ackDegraded });
  const confirmPublish = () => {
    if (!canPublishNow) return;
    setConfirmingPublish(false);
    setAckDegraded(false);
    publish(kase.id);
  };
  const cancelPublish = () => {
    setConfirmingPublish(false);
    setAckDegraded(false);
  };

  // #5 — the materialized seed the candidate is actually handed (the apply page ships
  // these via LiveWorkSurface). Narrowed defensively, same shape as the apply page, so
  // the author can preview the concrete deliverable before publishing — not just the
  // prose brief. A degraded/skeleton seed is then visible, not only hinted by a pill.
  const seedFiles: SeedFile[] = Array.isArray(kase.seed?.files)
    ? (kase.seed.files as unknown[]).filter(
        (f): f is SeedFile =>
          typeof f === "object" && f !== null &&
          typeof (f as SeedFile).path === "string" &&
          typeof (f as SeedFile).contents === "string",
      )
    : [];

  return (
    <div className="space-y-4">
      <DevCaseDetailHeader
        kase={kase}
        onBack={onBack}
        published={published}
        publishing={publishing}
        source={source}
        sourcing={sourcing}
        sourcedCounts={sourcedCounts}
        hasScenario={hasScenario}
        scenarioDegraded={scenarioDegraded}
        seedDegraded={seedDegraded}
        degraded={degraded}
        publishReasons={publishReasons}
        confirmingPublish={confirmingPublish}
        setConfirmingPublish={setConfirmingPublish}
        ackDegraded={ackDegraded}
        setAckDegraded={setAckDegraded}
        canPublishNow={canPublishNow}
        confirmPublish={confirmPublish}
        cancelPublish={cancelPublish}
      />

      {/* the assignment, as the candidate would read it */}
      <article className={`${PANEL} px-6 py-5 sm:px-8 sm:py-6`}>
        <Markdown content={caseToMarkdown(c, role)} className="max-w-3xl" />
      </article>

      {/* #5 — the materialized seed the candidate is actually handed (collapsed). Lets the
          author verify the concrete starter files before publishing, not only the brief. */}
      {seedFiles.length > 0 ? (
        <details className={PANEL}>
          <summary className="focus-ring flex cursor-pointer list-none items-center gap-1.5 px-4 py-3 text-meta font-semibold uppercase tracking-wide text-steel">
            <FileCode2 size={13} className="text-coral" /> {t("seedSummary")}
            <span className="text-coral">· {t("seedFiles", { count: seedFiles.length })}</span>
          </summary>
          <div className="space-y-3 border-t border-stone-200 px-4 py-3">
            {seedDegraded ? (
              <p className="text-micro text-amber-700">{t("seedSkeletonWarning")}</p>
            ) : null}
            {seedFiles.map((f) => (
              <div key={f.path}>
                <p className="font-mono text-micro font-semibold text-ink">{f.path}</p>
                <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 font-mono text-micro leading-relaxed text-steel">
                  {seedPreview(f.contents)}
                </pre>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {/* internal material — everything a candidate must never see */}
      <DevCaseDetailInternal c={c} role={role} caseSubmissions={caseSubmissions} />

      {/* A published assignment with no applicants used to render THREE nothings in a
          row: CompareSubmissions needs two evaluated submissions, the shortlist needs
          one, and the interview kit needs a scored top — so the page just stopped after
          the internal panels with no word about what it was waiting for. Say it once,
          in place of all three, and only when the assignment is actually live (an
          unpublished one has nothing to wait for and its Publish button says so). */}
      {published && caseSubmissions.length === 0 ? (
        <section className={`${PANEL_SUNKEN} p-4`}>
          <p className="text-base font-semibold text-ink">{tWaiting("title")}</p>
          <p className="mt-1 max-w-prose text-sm text-steel">{tWaiting("body")}</p>
        </section>
      ) : (
        <>
          {/* b268f5e5 — read who leads on each rubric axis across the case's cohort. */}
          <CompareSubmissions rubricDims={c.rubricDimensions ?? []} submissions={caseSubmissions} />

          {/* 8d4f38b9 — the winning candidate's interview kit, ready to copy/export. */}
          {topSubmission ? <InterviewKit caseTitle={kase.title ?? c.title ?? ""} top={topSubmission} /> : null}

          {/* 99288c0e — the case-wide shortlist: all candidates, every channel, one ranking. */}
          <DevCaseDetailShortlist shortlist={shortlist} roleJdText={roleJdText} onChanged={loadPostings} />
        </>
      )}

      {/* distribution + intake for THIS case — postings are the apply channels;
          the candidates they collect are ranked together in the shortlist above. */}
      <DevCaseDetailChannels casePostings={casePostings} onDone={loadPostings} />
    </div>
  );
}
