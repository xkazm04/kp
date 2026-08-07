import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ResultPanel } from "@/app/_components/results/ResultPanel";
import { ReportActions } from "@/app/_components/results/ReportActions";
import { DispositionEditor } from "@/app/_components/results/DispositionEditor";
import { WorkspaceShell } from "@/app/features/WorkspaceNav";
import { RecordRecent } from "@/app/features/RecordRecent";
import { findActiveEntriesByCandidateLabel, loadAnalysis, parseStoredGithubAnalysis, type PipelineEntry } from "@/app/_lib/db";
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
        <DispositionEditor
          slug={slug}
          initialDisposition={found.row.disposition ?? null}
          initialNote={found.row.decision_note ?? null}
        />
      </header>

      <div className="mt-6">
        <ResultPanel
          analysis={parsed.data}
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
        />
      </div>
    </WorkspaceShell>
  );
}
