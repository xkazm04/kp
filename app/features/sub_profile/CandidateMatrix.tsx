"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import type { ArchetypeDef, CandidateRow } from "./ProfileTypes";

export function CandidateMatrix({
  archetypes,
  onNewProfile,
}: {
  archetypes: ArchetypeDef[];
  onNewProfile: () => void;
}) {
  const [candidates, setCandidates] = useState<CandidateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/profile/candidates")
      .then((r) => r.json())
      .then((p) => {
        if (!alive) return;
        if (p.error) setError(p.error);
        else setCandidates((p.candidates as CandidateRow[]) ?? []);
      })
      .catch(() => {
        if (alive) setError("Couldn't load candidates.");
      });
    return () => {
      alive = false;
    };
  }, []);

  // Columns = the registry archetypes, plus any archetype that appears on a
  // candidate but isn't (or no longer is) in the registry, so no candidate is
  // dropped from the matrix.
  const columns = useMemo(() => {
    const cols = archetypes.map((a) => ({ id: a.id, label: a.label }));
    const known = new Set(cols.map((c) => c.id));
    const extra = [...new Set((candidates ?? []).map((c) => c.archetype).filter((id) => !known.has(id)))];
    return [...cols, ...extra.map((id) => ({ id, label: id }))];
  }, [archetypes, candidates]);

  // Sort by column order then score desc, so each candidate's single filled cell
  // clusters under its archetype column and reads as a grouped block.
  const rows = useMemo(() => {
    if (!candidates) return [];
    const order = new Map(columns.map((c, i) => [c.id, i]));
    return [...candidates].sort(
      (a, b) =>
        (order.get(a.archetype) ?? 99) - (order.get(b.archetype) ?? 99) || (b.score ?? -1) - (a.score ?? -1)
    );
  }, [candidates, columns]);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <p className="text-meta uppercase text-coral">Candidates</p>
          <h2 className="mt-1 font-serif text-h2 text-ink">Candidates by archetype</h2>
          <p className="mt-2 max-w-3xl text-body text-steel">
            Every analyzed candidate, placed in the archetype they were routed to. Open one to see its full Analyze
            output.
          </p>
        </div>
        <button
          type="button"
          onClick={onNewProfile}
          className="focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:bg-paper"
        >
          <Plus size={15} /> Build candidate profile
        </button>
      </header>

      <div className="mt-4">
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
        ) : candidates == null ? (
          <div className="h-32 animate-pulse rounded-lg bg-stone-100" aria-hidden />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-paper px-4 py-10 text-center">
            <Users className="h-7 w-7 text-steel" aria-hidden />
            <p className="mt-2 font-semibold text-ink">No analyzed candidates yet</p>
            <p className="mt-1 max-w-sm text-sm text-steel">
              Run a CV in the <strong>Analyze</strong> tab — each result is routed to an archetype and appears here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full table-fixed divide-y divide-stone-200">
              <thead className="bg-paper">
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.id}
                      scope="col"
                      className="px-3 py-2.5 text-left text-sm font-semibold uppercase tracking-wide text-steel"
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((cand) => (
                  <tr key={cand.slug} className="align-top">
                    {columns.map((c) => (
                      <td key={c.id} className="px-3 py-2">
                        {c.id === cand.archetype ? <CandidateCell cand={cand} /> : <span className="text-stone-300">·</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function CandidateCell({ cand }: { cand: CandidateRow }) {
  return (
    <Link
      href={`/history/${cand.slug}`}
      className="focus-ring group block rounded-md border border-stone-200 bg-white px-2.5 py-1.5 hover:border-coral/50 hover:bg-coral/5"
      title={`Open ${cand.name}'s analysis`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-semibold text-ink group-hover:text-coral">{cand.name}</span>
        <ScoreBadge score={cand.score} />
      </div>
      <p className="mt-0.5 truncate text-sm capitalize text-steel">
        {cand.role ?? "—"}
        {cand.seniority ? ` · ${cand.seniority}` : ""}
      </p>
    </Link>
  );
}
