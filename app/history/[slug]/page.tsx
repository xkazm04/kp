import Link from "next/link";
import { notFound } from "next/navigation";
import { History } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { ResultPanel } from "@/app/_components/results/ResultPanel";
import { ReportActions } from "@/app/_components/results/ReportActions";
import { DispositionEditor } from "@/app/_components/results/DispositionEditor";
import { WorkspaceShell } from "@/app/features/WorkspaceNav";
import { RecordRecent } from "@/app/features/RecordRecent";
import { findActiveEntriesByCandidateLabel, hasLabelCollision, jdLastEditedAt, listAnalysesByCvHash, loadAnalysis, parseStoredGithubAnalysis, type PipelineEntry } from "@/app/_lib/db";
import { isScoreStale } from "@/app/features/sub_decisions/DecisionsTypes";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { analysisSchema } from "@/app/_lib/schemas";
import type { ResultPanelGithub } from "@/app/_components/results/ResultPanel";


// GH1 — revive the persisted GitHub deep-dive for the saved report. Defensive
// end to end (parse + schema-validate + log via the shared
// parseStoredGithubAnalysis): a corrupt column or a payload from an older schema
// renders the report WITHOUT the GitHub tab (exactly the pre-persistence
// behavior), never a crash. Wrap the non-null result into the panel shape.
function parseGithub(githubJson: string | null | undefined, slug: string): ResultPanelGithub | undefined {
  const analysis = parseStoredGithubAnalysis(githubJson, slug);
  if (!analysis) return undefined;
  return { status: "done", analysis, error: null, warning: null };
}

// Blocked under Cache Components: dynamic per-request route (previously
// force-dynamic) with no useful static shell to prerender.
export const instant = false;

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations("report"); // RES2 — the report frame is bilingual

  // Capture the tenant once: it scopes BOTH the analysis load and the board-chip
  // lookup below, so the chip can only resolve to entries in the SAME workspace.
  const ws = await currentWorkspace();
  let found: ReturnType<typeof loadAnalysis>;
  try {
    found = loadAnalysis(slug, ws);
  } catch (error) {
    // Log the full error server-side; render a styled panel instead of letting
    // a transient DB lock / IO error (SQLITE_BUSY, disk, seed failure) crash the
    // Server Component into a raw 500. Mirrors the /api/analyses/[slug] route.
    console.error(`[history] failed to load analysis "${slug}"`, error);
    return (
      <WorkspaceShell active="analyze">
        <p className="rounded-md bg-red-50 p-4 text-sm text-red-700">{t("histLoadFailed")}</p>
      </WorkspaceShell>
    );
  }

  // notFound() throws the NEXT_NOT_FOUND signal — keep it outside the try/catch
  // above so the 404 path is never swallowed by the DB error handler.
  if (!found) notFound();

  const parsed = analysisSchema.safeParse(found.payload);
  if (!parsed.success) {
    return (
      <WorkspaceShell active="analyze">
        <p className="rounded-md bg-red-50 p-4 text-sm text-red-700">{t("histSchemaOld")}</p>
      </WorkspaceShell>
    );
  }

  // RES4 — the detected archetype rides the Add-to-pipeline ref. It was
  // hardcoded null even while ArchetypeBanner announced "Detected archetype: X"
  // on the same page — and the null has acquired real cost since RES2 shipped:
  // entry.archetype now selects the human-scorecard rubric (PREP1) and feeds
  // the screening wave's unknown-archetype audit path. Same best-effort
  // narrowing the banner uses on the loosely-typed v2Profile record.
  const v2Profile = parsed.data.v2Profile as { archetype?: unknown } | null | undefined;
  const detectedArchetype = typeof v2Profile?.archetype === "string" && v2Profile.archetype ? v2Profile.archetype : null;

  // d95fed6d — the reverse leg of the disposition echo: if the analyzed
  // candidate is live on the board, say where, and link into the board filtered
  // to them. Best-effort: a store fault hides the chip, never breaks the report.
  let onBoard: PipelineEntry[] = [];
  try {
    onBoard = findActiveEntriesByCandidateLabel(found.row.candidate_label, ws);
  } catch (error) {
    console.error(`[history] board lookup failed for "${slug}"`, error);
  }
  const tEnums = await getTranslations("enums");
  const stageLabel = (stage: string) => {
    const key = `stage.${stage}` as Parameters<typeof tEnums>[0];
    return tEnums.has(key) ? tEnums(key) : stage;
  };

  // Content-addressed identity (cv_hash) surfaces two things, both best-effort so a
  // store fault never breaks the report:
  //  1. Cross-job linkage — the SAME CV content analyzed against OTHER jobs, so the
  //     recruiter sees the candidate's full footprint. Deduped to one link per JD,
  //     newest first (the store returns newest-first), workspace-scoped.
  //  2. Label collision — another saved analysis shares this filename-derived label
  //     but a DIFFERENT CV, i.e. two different people under one "CV.pdf"-style name.
  const alsoAnalyzed: { jdSlug: string; slug: string }[] = [];
  let labelCollision = false;
  try {
    const seenJds = new Set<string>();
    for (const other of listAnalysesByCvHash(found.row.cv_hash, ws, slug)) {
      if (!other.jd_slug || other.jd_slug === found.row.jd_slug || seenJds.has(other.jd_slug)) continue;
      seenJds.add(other.jd_slug);
      alsoAnalyzed.push({ jdSlug: other.jd_slug, slug: other.slug });
    }
    labelCollision = hasLabelCollision(found.row.candidate_label, found.row.cv_hash, ws);
  } catch (error) {
    console.error(`[history] identity lookup failed for "${slug}"`, error);
  }

  // Direction 2 (saved-report-whole-truth) — "JD edited since this analysis" cue.
  // Server-derived (this is a Server Component; no client fetch): the SAME shared
  // rule the decisions cards / pipeline drawer use — a score computed strictly
  // BEFORE the JD's last content edit reflects the earlier text. Best-effort like
  // every other lookup on this page: a store fault hides the chip, never breaks the
  // report. Only meaningful when the analysis was run against a saved JD.
  const locale = await getLocale();
  let jdEditedAt: string | null = null;
  try {
    if (found.row.jd_slug) jdEditedAt = jdLastEditedAt(found.row.jd_slug, ws);
  } catch (error) {
    console.error(`[history] jd-edit lookup failed for "${slug}"`, error);
  }
  const scoreStale = isScoreStale(found.row.created_at, jdEditedAt);
  const staleDate = jdEditedAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(jdEditedAt)) : "";

  // Direction 2 (a) — the honest disabled-reason the LIVE tab shows. The saved
  // report can only be JD-less (it always persisted), so the sole reason here is
  // "board lanes are keyed by a job". Reuse the analyze catalog's wording (single
  // source) instead of a second copy, mirroring deriveAnalyzePipelineAffordance's
  // "jdless" branch.
  const tAnalyze = await getTranslations("analyze");

  return (
    <WorkspaceShell active="analyze">
      {/* SHELL3: visiting the saved report IS opening the entity — record it. */}
      <RecordRecent
        type="analysis"
        id={slug}
        label={found.row.candidate_label || slug}
        href={`/history/${encodeURIComponent(slug)}`}
      />
      <header className="flex flex-col gap-3 border-b border-stone-200 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-meta uppercase text-coral">{t("histEyebrow", { slug })}</p>
          {/* idea-0832ec48 — pass the parsed analysis so the report can export an
              evidence-linked provenance dossier alongside copy-link / print. */}
          <ReportActions
            analysis={parsed.data}
            candidateLabel={found.row.candidate_label}
            savedAt={new Date(found.row.created_at).toLocaleDateString()}
          />
        </div>
        <h1 className="font-serif text-display text-ink">{found.row.candidate_label}</h1>
        <p className="text-sm text-steel">
          {found.row.role_family ?? "—"} · {found.row.seniority ?? "—"} · {t("histScore", { score: found.row.score ?? "—" })} · {t("histSaved", { date: new Date(found.row.created_at).toLocaleString() })}
          {found.row.jd_slug ? (
            <>
              {" · "}
              <Link href={`/jds/${found.row.jd_slug}`} className="font-mono text-coral hover:underline">
                JD {found.row.jd_slug}
              </Link>
            </>
          ) : null}
          {onBoard.length > 0 ? (
            <>
              {" · "}
              <Link
                href={`/?tab=pipeline&q=${encodeURIComponent(found.row.candidate_label)}`}
                className="font-semibold text-coral hover:underline"
              >
                {t("histOnBoard", { job: onBoard[0].jobTitle ?? "—", stage: stageLabel(onBoard[0].stage) })}
              </Link>
            </>
          ) : null}
        </p>
        {alsoAnalyzed.length > 0 ? (
          <p className="text-sm text-steel">
            {t("alsoAnalyzedFor")}{" "}
            {alsoAnalyzed.map((entry, i) => (
              <span key={entry.slug}>
                {i > 0 ? ", " : ""}
                <Link href={`/history/${encodeURIComponent(entry.slug)}`} className="font-mono text-coral hover:underline">
                  JD {entry.jdSlug}
                </Link>
              </span>
            ))}
          </p>
        ) : null}
        {scoreStale ? (
          <span
            className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-sm font-semibold text-amber-800"
            title={t("jdEditedTitle", { date: staleDate })}
          >
            <History size={12} aria-hidden /> {t("jdEditedBadge", { date: staleDate })}
          </span>
        ) : null}
        {labelCollision ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t("labelCollision")}
          </p>
        ) : null}
        <DispositionEditor
          slug={slug}
          initialDisposition={found.row.disposition ?? null}
          initialNote={found.row.decision_note ?? null}
        />
      </header>

      <div className="mt-6">
        <ResultPanel
          analysis={parsed.data}
          analysisSlug={slug}
          // When this candidate is live on the board, hand the Interview tab the
          // real pipeline entry id so it can push its question kit into the actual
          // interview-prep pack (Direction 2). Off-board → undefined → no import
          // affordance. Same on-board lookup that drives the header chip above.
          prepEntryId={onBoard[0]?.id}
          github={parseGithub(found.row.github_json, slug)}
          // Offer "Add to pipeline" only when the analysis was run against a saved
          // JD — that slug is the role the candidate is filed under (the board keys
          // lanes by jobId), and POST /api/pipeline requires it. A JD-less analysis
          // has no role to add the candidate to, so the action is hidden.
          pipelineRef={
            found.row.jd_slug
              ? {
                  candidateId: slug,
                  candidateLabel: found.row.candidate_label,
                  archetype: detectedArchetype,
                  matchScore: found.row.score ?? null,
                  roleFamily: found.row.role_family ?? null,
                  jobId: found.row.jd_slug,
                  jobTitle: `JD ${found.row.jd_slug}`,
                }
              : undefined
          }
          // Direction 2 (a) — a JD-less saved report now shows the SAME honest
          // disabled-reason note the live tab does, instead of a silent blank where
          // the add affordance would be. Ignored by ResultPanel when pipelineRef is
          // present (the button wins).
          pipelineDisabledReason={found.row.jd_slug ? undefined : tAnalyze("addToPipelineJdless")}
        />
      </div>
    </WorkspaceShell>
  );
}
