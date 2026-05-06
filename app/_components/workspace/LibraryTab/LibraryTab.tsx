"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LibraryJdForm } from "./LibraryJdForm";

type JdRow = {
  slug: string;
  title: string;
  body: string;
  created_at: string;
};

export function LibraryTab() {
  const [rows, setRows] = useState<JdRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const response = await fetch("/api/jds");
      if (!response.ok) throw new Error(`Load failed (${response.status}).`);
      const payload = await response.json();
      setRows((payload.jds as JdRow[]) ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Load failed.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/jds")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Load failed (${response.status}).`);
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        setRows((payload.jds as JdRow[]) ?? []);
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
        <h2 className="mt-1 font-serif text-display text-ink">Job description library</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          Save the JDs you screen against. From the <strong>Analyze</strong> tab, pick one from the
          dropdown and the resulting analysis is tagged with that JD&apos;s slug — that&apos;s how the
          matrix view groups candidates.
        </p>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">
        <LibraryJdForm onSaved={load} />

        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
            <h3 className="font-serif text-h2 text-ink">Saved JDs</h3>
            <span className="text-xs uppercase tracking-wide text-steel">
              {rows?.length ?? 0} entries
            </span>
          </div>
          {error ? (
            <p className="px-5 py-4 text-sm text-red-700">{error}</p>
          ) : rows == null ? (
            <p className="px-5 py-8 text-sm text-steel">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="px-5 py-8 text-sm text-steel">No JDs saved yet. Use the form to add one.</p>
          ) : (
            <ul className="divide-y divide-stone-200">
              {rows.map((row) => (
                <li key={row.slug} className="px-5 py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/jds/${row.slug}`}
                      className="text-base font-semibold text-ink hover:text-coral hover:underline"
                    >
                      {row.title}
                    </Link>
                    <span className="font-mono text-xs text-coral">{row.slug}</span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-ink/80">
                    {row.body.slice(0, 280)}
                    {row.body.length > 280 ? "…" : ""}
                  </p>
                  <p className="mt-2 text-xs text-steel">
                    Saved {new Date(row.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
