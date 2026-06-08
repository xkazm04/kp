"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

// Distinct, sorted, non-null values of a column — drives the filter dropdowns
// from whatever's actually in the loaded history.
function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort();
}

export function HistoryTab() {
  const [rows, setRows] = useState<AnalysisRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Client-side search + filter (RES3). History was an un-queryable flat table —
  // unusable past a few dozen runs. Filtering the loaded set (≤200 rows) needs no
  // schema/server change; server-side query params + tagging are a follow-up for
  // when history outgrows that cap.
  const [q, setQ] = useState("");
  const [roleFamily, setRoleFamily] = useState("");
  const [seniority, setSeniority] = useState("");

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

  const families = useMemo(() => distinct((rows ?? []).map((r) => r.role_family)), [rows]);
  const seniorities = useMemo(() => distinct((rows ?? []).map((r) => r.seniority)), [rows]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (!needle || r.candidate_label.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle)) &&
        (!roleFamily || r.role_family === roleFamily) &&
        (!seniority || r.seniority === seniority)
    );
  }, [rows, q, roleFamily, seniority]);
  const filtering = Boolean(q.trim() || roleFamily || seniority);
  const clearAll = () => {
    setQ("");
    setRoleFamily("");
    setSeniority("");
  };

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
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="history-search" className="sr-only">Search candidate or slug</label>
              <input
                id="history-search"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search candidate or slug…"
                className="focus-ring h-9 min-w-[200px] flex-1 rounded-md border border-stone-200 px-3 text-base"
              />
              <select
                value={roleFamily}
                onChange={(e) => setRoleFamily(e.target.value)}
                aria-label="Filter by role family"
                className="focus-ring h-9 rounded-md border border-stone-200 px-2 text-base capitalize"
              >
                <option value="">All role families</option>
                {families.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <select
                value={seniority}
                onChange={(e) => setSeniority(e.target.value)}
                aria-label="Filter by seniority"
                className="focus-ring h-9 rounded-md border border-stone-200 px-2 text-base capitalize"
              >
                <option value="">All seniority</option>
                {seniorities.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {filtering ? (
                <span className="text-sm text-steel" aria-live="polite">Showing {filtered.length} of {rows.length}</span>
              ) : null}
              {filtering ? (
                <button
                  type="button"
                  onClick={clearAll}
                  className="focus-ring inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/5 px-2.5 py-0.5 text-sm font-semibold text-coral hover:bg-coral/10"
                >
                  Clear
                </button>
              ) : null}
            </div>
            {filtered.length === 0 ? (
              <p className="mt-4 rounded-md bg-paper p-4 text-base text-steel">
                No runs match your search or filter.{" "}
                <button type="button" onClick={clearAll} className="font-semibold text-coral underline underline-offset-2">
                  Clear filters
                </button>
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border border-stone-200">
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
                    {filtered.map((row) => (
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
          </>
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
