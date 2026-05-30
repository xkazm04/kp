import Link from "next/link";
import { notFound } from "next/navigation";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { WorkspaceTabBarLinks } from "@/app/_components/workspace/WorkspaceTabBarLinks";
import { listAnalysesByJd, loadJd } from "@/app/_lib/db";

export const dynamic = "force-dynamic";

export default async function JdDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const jd = loadJd(slug);
  if (!jd) notFound();

  const analyses = listAnalysesByJd(slug);

  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-stone-300 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-meta uppercase text-coral">JD · {slug}</p>
            <h1 className="mt-2 font-serif text-display text-ink">{jd.title}</h1>
            <p className="mt-2 text-sm text-steel">
              Saved {new Date(jd.created_at).toLocaleString()} · {analyses.length} candidate
              {analyses.length === 1 ? "" : "s"} analyzed against this JD
            </p>
          </div>
          <Link
            href={`/?jd=${slug}`}
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel lg:self-end"
          >
            Analyze CV against this JD
          </Link>
        </header>

        <WorkspaceTabBarLinks active="library" />

        <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
          <article className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <h2 className="font-serif text-h2 text-ink">Body</h2>
            <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-ink">
              {jd.body}
            </pre>
          </article>

          <aside className="rounded-lg border border-stone-200 bg-white shadow-panel">
            <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
              <h2 className="font-serif text-h2 text-ink">Candidates</h2>
              <span className="text-xs uppercase tracking-wide text-steel">
                ranked by overall score
              </span>
            </div>
            {analyses.length === 0 ? (
              <p className="px-5 py-8 text-sm text-steel">
                No candidates analyzed against this JD yet.
              </p>
            ) : (
              <ul className="divide-y divide-stone-200">
                {analyses.map((row) => (
                  <li key={row.slug} className="px-5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link
                        href={`/history/${row.slug}`}
                        className="text-sm font-semibold text-ink hover:text-coral hover:underline"
                      >
                        {row.candidate_label}
                      </Link>
                      <ScoreBadge score={row.score} />
                    </div>
                    <p className="mt-1 text-xs capitalize text-steel">
                      {row.role_family ?? "—"} · {row.seniority ?? "—"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
