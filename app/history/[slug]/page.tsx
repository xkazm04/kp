import Link from "next/link";
import { notFound } from "next/navigation";
import { ResultPanel } from "@/app/_components/results/ResultPanel";
import { WorkspaceTabBarLinks } from "@/app/_components/workspace/WorkspaceTabBarLinks";
import { loadAnalysis } from "@/app/_lib/db";
import { analysisSchema } from "@/app/_lib/schemas";

export const dynamic = "force-dynamic";

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const found = loadAnalysis(slug);
  if (!found) notFound();

  const parsed = analysisSchema.safeParse(found.payload);
  if (!parsed.success) {
    return (
      <main className="min-h-screen bg-paper">
        <div className="mx-auto w-full max-w-5xl px-4 py-8">
          <p className="rounded-md bg-red-50 p-4 text-sm text-red-700">
            This run was saved in an older schema and can&apos;t be rendered.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-stone-300 pb-5">
          <p className="text-meta uppercase text-coral">History · {slug}</p>
          <h1 className="font-serif text-display text-ink">{found.row.candidate_label}</h1>
          <p className="text-sm text-steel">
            {found.row.role_family ?? "—"} · {found.row.seniority ?? "—"} · score{" "}
            {found.row.score ?? "—"} · saved {new Date(found.row.created_at).toLocaleString()}
            {found.row.jd_slug ? (
              <>
                {" · "}
                <Link
                  href={`/jds/${found.row.jd_slug}`}
                  className="font-mono text-coral hover:underline"
                >
                  JD {found.row.jd_slug}
                </Link>
              </>
            ) : null}
          </p>
        </header>

        <WorkspaceTabBarLinks active="history" />

        <ResultPanel analysis={parsed.data} />
      </div>
    </main>
  );
}
