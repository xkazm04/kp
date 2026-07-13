"use client";

import { Fragment, useState } from "react";
import { AlertTriangle, ArrowLeft, ClipboardList, FileCode2, FileWarning, Lock, MicVocal, Send, Users } from "lucide-react";
import { Markdown } from "@/app/_components/Markdown";
import { formatRelativeTime } from "@/app/_lib/format";
import { ApplyTokenPill } from "./ApplyTokenPill";
import { CohortProbePanel } from "./CohortProbePanel";
import { CompareSubmissions } from "./CompareSubmissions";
import { InterviewKit } from "./InterviewKit";
import { ProbeStrengthBanner } from "./ProbeStrengthBanner";
import { caseToMarkdown } from "./DevHelpers";
import { MiniList, ProbeRow, RubricChip } from "./DevShared";
import { SubmissionForm } from "./SubmissionForm";
import { SubmissionRow } from "./SubmissionRow";
// #3 + #5 (bug-ui-scan-2026-07-09) — publish-gate + seed-preview logic extracted to
// pure siblings so they are unit-testable (node --test can't load this .tsx).
import { canConfirmPublish, degradedReasons, isDegradedPublish } from "./CaseDetail.publish";
import { seedPreview } from "./CaseDetail.seed";
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
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-steel hover:bg-paper hover:text-ink"
        >
          <ArrowLeft size={14} /> All cases
        </button>
        <span className="text-micro text-steel">created {formatRelativeTime(kase.createdAt) || "—"}</span>
        {hasScenario ? (
          scenarioDegraded ? (
            <span
              title="Scenario generation fell back to the deterministic template — probes are generic, not case-grounded. Re-run before interviewing on this case."
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-micro font-semibold uppercase text-amber-700"
            >
              <MicVocal size={11} /> interview scenario: template probes
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-moss/15 px-2 py-0.5 text-micro font-semibold uppercase text-moss">
              <MicVocal size={11} /> interview scenario ready
            </span>
          )
        ) : null}
        {seedDegraded ? (
          <span
            title="Seed materialization fell back to the deterministic template — candidates receive a prose-only README + DECISIONS skeleton, not concrete starter files. Re-run before sending the take-home."
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-micro font-semibold uppercase text-amber-700"
          >
            <FileWarning size={11} /> seed: skeleton only
          </span>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            // #3 — open the confirm step instead of publishing on this single click.
            onClick={() => setConfirmingPublish(true)}
            disabled={published || publishing || confirmingPublish}
            aria-haspopup="dialog"
            aria-expanded={confirmingPublish}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
          >
            <Send size={12} /> {published ? "Published" : publishing ? "Publishing…" : "Publish"}
          </button>
          <button
            type="button"
            onClick={() => source(kase.id)}
            disabled={sourcing === kase.id}
            title="Rank the existing candidate DB against this role and seed the pipeline"
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-coral hover:border-coral/40 disabled:opacity-50"
          >
            <Users size={12} /> {sourcing === kase.id ? "Sourcing…" : sourcedCounts[kase.id] != null ? `Sourced ${sourcedCounts[kase.id]}` : "Source DB"}
          </button>
        </div>
      </div>

      {/* #3 — confirm-before-publish. Publishing is effectively irreversible from here,
          so it takes an explicit confirm; a degraded case takes a "publish anyway" ack. */}
      {confirmingPublish && !published ? (
        <div role="alertdialog" aria-label="Confirm publish" className="rounded-lg border border-coral/30 bg-coral/5 p-4">
          <h3 className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-coral">
            <Send size={12} /> Publish this case?
          </h3>
          <p className="mt-2 max-w-prose text-sm text-steel">
            Publishing mints a live candidate-facing apply link and sources real candidates from your database into
            the pipeline. This can&apos;t be undone from here.
          </p>
          {degraded ? (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="flex items-center gap-1.5 text-meta font-semibold text-amber-700">
                <AlertTriangle size={13} /> This case is degraded
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-amber-800">
                {publishReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <label className="mt-2 flex items-start gap-2 text-xs font-medium text-amber-900">
                <input
                  type="checkbox"
                  checked={ackDegraded}
                  onChange={(e) => setAckDegraded(e.target.checked)}
                  className="mt-0.5"
                />
                I understand this case is degraded — publish it anyway.
              </label>
            </div>
          ) : null}
          <div className="mt-3 flex gap-1.5">
            <button
              type="button"
              onClick={confirmPublish}
              disabled={!canPublishNow || publishing}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-coral px-3 text-micro font-semibold text-white hover:bg-coral/90 disabled:opacity-50"
            >
              <Send size={12} /> {publishing ? "Publishing…" : "Confirm & publish"}
            </button>
            <button
              type="button"
              onClick={cancelPublish}
              className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-200 bg-white px-3 text-micro font-semibold text-steel hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* the assignment, as the candidate would read it */}
      <article className="rounded-lg border border-stone-200 bg-white px-6 py-5 shadow-panel sm:px-8 sm:py-6">
        <Markdown content={caseToMarkdown(c, role)} className="max-w-3xl" />
      </article>

      {/* #5 — the materialized seed the candidate is actually handed (collapsed). Lets the
          author verify the concrete starter files before publishing, not only the brief. */}
      {seedFiles.length > 0 ? (
        <details className="rounded-lg border border-stone-200 bg-white shadow-panel">
          <summary className="focus-ring flex cursor-pointer list-none items-center gap-1.5 px-4 py-3 text-meta font-semibold uppercase tracking-wide text-steel">
            <FileCode2 size={13} className="text-coral" /> Materialized seed — what the candidate receives
            <span className="text-coral">· {seedFiles.length} file{seedFiles.length === 1 ? "" : "s"}</span>
          </summary>
          <div className="space-y-3 border-t border-stone-200 px-4 py-3">
            {seedDegraded ? (
              <p className="text-xs text-amber-700">
                Skeleton only — this is the prose-only fallback, not concrete starter files. Re-run before sending.
              </p>
            ) : null}
            {seedFiles.map((f) => (
              <div key={f.path}>
                <p className="font-mono text-xs font-semibold text-ink">{f.path}</p>
                <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 font-mono text-[11px] leading-relaxed text-steel">
                  {seedPreview(f.contents)}
                </pre>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {/* internal material — everything a candidate must never see */}
      <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
        <h3 className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-amber-700">
          <Lock size={12} /> Internal — interviewer &amp; reviewer material
        </h3>

        {(c.coverProbes ?? []).length ? (
          <ul className="mt-2 space-y-2">
            {(c.coverProbes ?? []).map((p, i) => (
              <li key={p.id ?? i} className="rounded-md border border-amber-200/70 bg-white/70 p-2.5">
                <ProbeRow probe={p} tone="amber" showDecisionSpace />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-micro text-steel">No covert probes recorded on this case.</p>
        )}

        {/* bb4f5494 — does this case actually discriminate? */}
        <ProbeStrengthBanner probes={c.coverProbes ?? []} />

        {(c.rubricDimensions ?? []).length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(c.rubricDimensions ?? []).map((d) => (
              <RubricChip key={d.name} dim={d} tone="amber" />
            ))}
          </div>
        ) : null}

        {role ? (
          <div className="mt-3 grid gap-3 border-t border-amber-200/60 pt-3 sm:grid-cols-2">
            <MiniList title="Role must-haves" items={role.mustHaves ?? []} />
            <MiniList title="Role responsibilities" items={role.responsibilities ?? []} />
          </div>
        ) : null}

        <CohortProbePanel probes={c.coverProbes ?? []} submissions={caseSubmissions} />
      </section>

      {/* b268f5e5 — read who leads on each rubric axis across the case's cohort. */}
      <CompareSubmissions rubricDims={c.rubricDimensions ?? []} submissions={caseSubmissions} />

      {/* 8d4f38b9 — the winning candidate's interview kit, ready to copy/export. */}
      {topSubmission ? <InterviewKit caseTitle={kase.title ?? c.title ?? ""} top={topSubmission} /> : null}

      {/* 99288c0e — the case-wide shortlist: all candidates, every channel, one ranking. */}
      {shortlist.length > 0 ? (
        <section>
          <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
            <ClipboardList size={13} className="text-coral" /> Shortlist — all channels
            <span className="text-coral">· {shortlist.length}</span>
          </h3>
          <ul className="mt-2 space-y-1.5">
            {shortlist.map(({ s, channel }, i, arr) => {
              const rank = s.transferScore != null ? i + 1 : null;
              const isTop = rank === 1;
              return (
                <Fragment key={s.id}>
                  <SubmissionRow submission={s} rank={rank} isTop={isTop} channel={channel} onChanged={loadPostings} jdText={roleJdText} />
                  {isTop && arr.length > 1 ? <li aria-hidden className="border-t border-dashed border-stone-200" /> : null}
                </Fragment>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* distribution + intake for THIS case — postings are the apply channels;
          the candidates they collect are ranked together in the shortlist above. */}
      {casePostings.length > 0 ? (
        <section>
          <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
            <ClipboardList size={13} className="text-coral" /> Apply channels
            <span className="text-coral">· {casePostings.length}</span>
          </h3>
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            {casePostings.map((p) => (
              <div key={p.id} className="rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-paper px-2 py-0.5 text-micro font-semibold uppercase text-steel">{p.channel}</span>
                  <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{p.caseTitle || p.roleTitle || "Posting"}</span>
                  <span className="text-micro text-steel">{p.submissions?.length ?? p.submissionCount ?? 0} in</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="shrink-0 text-micro uppercase tracking-wide text-steel">Apply link</span>
                  <ApplyTokenPill token={p.token} />
                </div>
                <SubmissionForm postingId={p.id} onDone={loadPostings} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
