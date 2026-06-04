"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatRelativeTime } from "@/app/_lib/format";

type AnalysisRow = {
  slug: string;
  candidate_label: string;
  jd_slug: string | null;
  score: number | null;
  role_family: string | null;
  seniority: string | null;
  created_at: string;
};

export function HistoryTab() {
  const [rows, setRows] = useState<AnalysisRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/analyses")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Load failed (${response.status}).`);
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        setRows((payload.analyses as AnalysisRow[]) ?? []);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Load failed.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">Workspace</p>
        <h2 className="mt-1 font-serif text-display text-ink">History</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          Every successful run is auto-persisted with a stable slug. Open one to reload the full
          result or share the slug with the team.
        </p>
      </header>

      <div className="mt-5">
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
        ) : rows == null ? (
          <p className="text-base text-steel">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-md bg-paper p-4 text-base text-steel">
            No saved runs yet. Run one from the <strong>Analyze</strong> tab; it will appear here.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full divide-y divide-stone-200">
              <thead className="bg-paper">
                <tr>
                  <Th>Slug</Th>
                  <Th>Candidate</Th>
                  <Th>Role family</Th>
                  <Th>Seniority</Th>
                  <Th>Score</Th>
                  <Th>JD</Th>
                  <Th>Saved</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {rows.map((row) => (
                  <tr key={row.slug} className="hover:bg-paper/60">
                    <Td>
                      <Link
                        href={`/history/${row.slug}`}
                        className="font-mono text-base font-medium text-coral hover:underline"
                      >
                        {row.slug}
                      </Link>
                    </Td>
                    <Td>{row.candidate_label}</Td>
                    <Td className="capitalize">{row.role_family ?? "—"}</Td>
                    <Td className="capitalize">{row.seniority ?? "—"}</Td>
                    <Td>{row.score ?? "—"}</Td>
                    <Td>
                      {row.jd_slug ? (
                        <Link
                          href={`/?tab=library&jd=${row.jd_slug}`}
                          className="font-mono text-sm text-coral hover:underline"
                        >
                          {row.jd_slug}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>{formatRelative(row.created_at)}</Td>
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide text-steel"
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-base text-ink ${className}`}>{children}</td>;
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return iso;
  // Within a day: the shared relative "ago" renderer. Older: an absolute date,
  // which reads better than "37d ago" for a history view.
  if (Date.now() - ts < 86_400_000) return formatRelativeTime(iso);
  return new Date(iso).toLocaleDateString();
}
