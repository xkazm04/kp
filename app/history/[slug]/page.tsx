import Link from "next/link";
import { notFound } from "next/navigation";
import { ResultPanel } from "@/app/_components/results/ResultPanel";
import { WorkspaceShell } from "@/app/features/WorkspaceNav";
import { loadAnalysis } from "@/app/_lib/db";
import { analysisSchema } from "@/app/_lib/schemas";

export const dynamic = "force-dynamic";

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let found: ReturnType<typeof loadAnalysis>;
  try {
    found = loadAnalysis(slug);
  } catch (error) {
    // Log the full error server-side; render a styled panel instead of letting
    // a transient DB lock / IO error (SQLITE_BUSY, disk, seed failure) crash the
    // Server Component into a raw 500. Mirrors the /api/analyses/[slug] route.
    console.error(`[history] failed to load analysis "${slug}"`, error);
    return (
      <WorkspaceShell active="analyze">
        <p className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          We couldn&apos;t load this analysis right now. Please try again in a moment.
        </p>
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
        <p className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          This run was saved in an older schema and can&apos;t be rendered.
        </p>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell active="analyze">
      <header className="flex flex-col gap-3 border-b border-stone-200 pb-5">
        <p className="text-meta uppercase text-coral">History · {slug}</p>
        <h1 className="font-serif text-display text-ink">{found.row.candidate_label}</h1>
        <p className="text-sm text-steel">
          {found.row.role_family ?? "—"} · {found.row.seniority ?? "—"} · score{" "}
          {found.row.score ?? "—"} · saved {new Date(found.row.created_at).toLocaleString()}
          {found.row.jd_slug ? (
            <>
              {" · "}
              <Link href={`/jds/${found.row.jd_slug}`} className="font-mono text-coral hover:underline">
                JD {found.row.jd_slug}
              </Link>
            </>
          ) : null}
        </p>
      </header>

      <div className="mt-6">
        <ResultPanel analysis={parsed.data} />
      </div>
    </WorkspaceShell>
  );
}
