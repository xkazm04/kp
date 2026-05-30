import Link from "next/link";
import { notFound } from "next/navigation";
import { Send } from "lucide-react";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { WorkspaceShell } from "@/app/features/WorkspaceNav";
import { listAnalysesByJd, loadJd } from "@/app/_lib/db";
import { JdBody } from "./JdBody";

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
    <WorkspaceShell active="library">
      <header className="flex flex-col gap-3 border-b border-stone-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-meta uppercase text-coral">Job description · {slug}</p>
          <h1 className="mt-1 font-serif text-display text-ink">{jd.title}</h1>
          <p className="mt-2 text-sm text-steel">
            Saved {new Date(jd.created_at).toLocaleString()} · {analyses.length} candidate
            {analyses.length === 1 ? "" : "s"} analyzed against this JD
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row lg:items-end">
          <button
            type="button"
            disabled
            title="Job-board publishing integration coming soon"
            className="inline-flex h-10 cursor-not-allowed items-center justify-center gap-2 rounded-md border border-stone-200 px-3 text-sm font-semibold text-steel opacity-70"
          >
            <Send size={15} /> Publish
          </button>
          <Link
            href={`/?tab=analyze&jd=${encodeURIComponent(slug)}`}
            className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel"
          >
            Analyze CV
          </Link>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <JdBody markdown={jd.body} />

        <aside className="self-start rounded-lg border border-stone-200 bg-white shadow-panel">
          <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
            <h2 className="font-serif text-h3 text-ink">Candidates</h2>
            <span className="text-sm uppercase tracking-wide text-steel">by score</span>
          </div>
          {analyses.length === 0 ? (
            <p className="px-5 py-8 text-sm text-steel">
              No candidates analyzed against this JD yet. Generated roles also source candidates into the Pipeline.
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
                  <p className="mt-1 text-sm capitalize text-steel">
                    {row.role_family ?? "—"} · {row.seniority ?? "—"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </WorkspaceShell>
  );
}
