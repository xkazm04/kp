"use client";

import { Send, ShieldCheck, Users } from "lucide-react";
import type { ApprovedCase, Posting } from "./DevTypes";

export function ApprovedCasesSection({
  approvedCases,
  postings,
  publish,
  source,
  sourcing,
  sourcedCounts,
}: {
  approvedCases: ApprovedCase[];
  postings: Posting[];
  publish: (caseId: string) => void;
  source: (caseId: string) => void;
  sourcing: string | null;
  sourcedCounts: Record<string, number>;
}) {
  if (approvedCases.length === 0) return null;
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <ShieldCheck size={13} className="text-moss" /> Approved assignments <span className="text-coral">· {approvedCases.length}</span>
      </h3>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {approvedCases.map((c, ci) => {
          const published = postings.some((p) => p.caseId === c.id);
          return (
            <li
              key={c.id}
              style={{ animationDelay: `${ci * 40}ms` }}
              className="animate-fade-in flex flex-col rounded-lg border border-stone-200 bg-white p-3 shadow-panel transition-shadow motion-reduce:animate-none hover:-translate-y-0.5 hover:shadow-lg"
            >
              <p className="truncate text-sm font-semibold text-ink">{c.title || "Assignment"}</p>
              <p className="truncate text-micro text-steel">{c.roleTitle} · {c.seniority}</p>
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => publish(c.id)}
                  disabled={published}
                  className="focus-ring inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-stone-200 px-2 text-micro font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
                >
                  <Send size={12} /> {published ? "Published" : "Publish"}
                </button>
                <button
                  type="button"
                  onClick={() => source(c.id)}
                  disabled={sourcing === c.id}
                  title="Rank the existing candidate DB against this role and seed the pipeline at Sourced"
                  className="focus-ring inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-stone-200 px-2 text-micro font-semibold text-coral hover:border-coral/40 disabled:opacity-50"
                >
                  <Users size={12} />
                  {sourcing === c.id ? "…" : sourcedCounts[c.id] != null ? `sourced ${sourcedCounts[c.id]}` : "Source DB"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
