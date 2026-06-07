"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import { formatCount } from "@/app/_lib/format";
import { Skeleton } from "@/app/_components/Skeleton";
import { JdBuilder } from "./JdBuilder";
import { LibraryJdForm } from "./LibraryJdForm";

type JdRow = {
  slug: string;
  title: string;
  preview: string;
  created_at: string;
};

export function LibraryTab() {
  const [rows, setRows] = useState<JdRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Case-insensitive client-side filter over title/slug/preview so the list
  // stays usable once the library grows past a screenful.
  const visible = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.title.toLowerCase().includes(q) ||
        row.slug.toLowerCase().includes(q) ||
        row.preview.toLowerCase().includes(q)
    );
  }, [rows, query]);

  // Single source of truth for the JD list fetch. Accepts an optional signal so
  // the mount effect can abort an in-flight request on unmount; calling it with
  // no signal (the retry button, onSaved) just re-runs the load.
  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    setRows(null);
    try {
      const response = await fetch("/api/jds", { signal });
      if (!response.ok) throw new Error(`Load failed (${response.status}).`);
      const payload = await response.json();
      if (signal?.aborted) return;
      setRows((payload.jds as JdRow[]) ?? []);
    } catch (caught) {
      // An abort is expected on unmount — don't surface it as an error.
      if (signal?.aborted || (caught instanceof DOMException && caught.name === "AbortError")) return;
      setError(caught instanceof Error ? caught.message : "Load failed.");
    }
  }, []);

  // Deferred kick-off (0 ms timer): load() resets rows/error synchronously, and a
  // sync setState in the effect body would cascade a render before the first
  // commit settles. The abort cleanup still covers the in-flight request.
  useEffect(() => {
    const controller = new AbortController();
    const t = window.setTimeout(() => load(controller.signal), 0);
    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
  }, [load]);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">Workspace</p>
        <h2 className="mt-1 font-serif text-display text-ink">Job description library</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          Describe a hiring need and let AI draft a job description — clarifying the need,
          designing the role, and researching market salary on the web. Save it as a draft, then
          <strong> source it into your Pipeline</strong> to pull in matching candidates.
        </p>
      </header>

      <div className="mt-5">
        <JdBuilder onSaved={load} />
      </div>

      <div className="mt-5">
        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
            <h3 className="font-serif text-h2 text-ink">Saved JDs</h3>
            <span className="text-sm uppercase tracking-wide text-steel">
              {formatCount(visible.length, "entry", "entries")}
            </span>
          </div>
          {error ? (
            <div className="flex flex-col items-start gap-3 px-5 py-4">
              <p className="text-base text-red-700">{error}</p>
              <button
                type="button"
                onClick={() => load()}
                className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-base font-semibold text-ink hover:bg-stone-50"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Try again
              </button>
            </div>
          ) : rows == null ? (
            <JdListSkeleton />
          ) : rows.length === 0 ? (
            <p className="px-5 py-8 text-base text-steel">No JDs saved yet. Use the form to add one.</p>
          ) : (
            <>
              <div className="border-b border-stone-200 px-5 py-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" aria-hidden />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search title, slug, or content…"
                    aria-label="Search saved JDs"
                    className="focus-ring h-10 w-full rounded-md border border-stone-300 bg-white pl-9 pr-3 text-base text-ink"
                  />
                </div>
              </div>
              {visible.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-base font-semibold text-ink">No matching JDs</p>
                  <p className="mt-1 text-base text-steel">
                    Nothing matches “{query.trim()}”. Try a different search.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-stone-200">
                  {visible.map((row) => (
                    <li key={row.slug} className="rounded-md px-5 py-4 transition-colors hover:bg-paper">
                      <div className="flex items-baseline justify-between gap-3">
                        <Link
                          href={`/jds/${row.slug}`}
                          className="text-base font-semibold text-ink hover:text-coral hover:underline"
                        >
                          {row.title}
                        </Link>
                        <span className="font-mono text-sm text-coral">{row.slug}</span>
                      </div>
                      <p className="mt-2 line-clamp-3 text-base leading-6 text-ink/80">
                        {row.preview}
                      </p>
                      <p className="mt-2 text-sm text-steel">
                        Saved {new Date(row.created_at).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      <details className="mt-5 rounded-lg border border-stone-200 bg-paper/40 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-steel">Or paste a job description manually</summary>
        <div className="mt-3">
          <LibraryJdForm onSaved={load} />
        </div>
      </details>
    </section>
  );
}

// Placeholder rows that mirror the real <li> (60% title bar, three body lines,
// a short date bar) so the real list pops in without a layout shift.
function JdListSkeleton() {
  return (
    <ul className="divide-y divide-stone-200">
      {[0, 1, 2].map((i) => (
        <li key={i} className="px-5 py-4">
          <Skeleton className="h-5 w-3/5" />
          <div className="mt-3 space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
          </div>
          <Skeleton className="mt-3 h-3 w-32" />
        </li>
      ))}
    </ul>
  );
}
