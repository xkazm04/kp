"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Briefcase, Copy, RotateCcw, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { CompletionCta } from "@/app/_components/CompletionCta";
import { Skeleton } from "@/app/_components/Skeleton";
import { JdBuilder } from "./JdBuilder";
import { LibraryJdForm } from "./LibraryJdForm";

type JdRow = {
  slug: string;
  title: string;
  preview: string;
  created_at: string;
  // W8-3 (JDL3) — the linked jd-<slug> job's lifecycle status; null = no job
  // exists yet (an analysis-only pasted JD that can't be matched or applied to).
  jobStatus?: string | null;
};

// W8-3 — make a pasted JD matchable: one click runs the existing hardened
// ingest bridge (content-hash dedup, draft lifecycle) under the shared
// "jd-<slug>" identity, landing the JD in the same draft → Source-into-Pipeline
// path as builder-authored roles.
function IngestAsJobButton({ slug, onDone }: { slug: string; onDone: (jobId: string | null) => void }) {
  const t = useTranslations("library.tab");
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const ingest = async () => {
    if (state === "busy") return;
    setState("busy");
    try {
      const r = await fetch(`/api/jds/${encodeURIComponent(slug)}/ingest-job`, { method: "POST" });
      if (!r.ok) throw new Error();
      // The route returns the (possibly pre-existing) job id — threaded up so
      // the success band can deep-link straight to the new posting.
      const payload = (await r.json().catch(() => null)) as { jobId?: string } | null;
      onDone(typeof payload?.jobId === "string" ? payload.jobId : null);
    } catch {
      setState("error");
    }
  };
  return (
    <button
      type="button"
      onClick={ingest}
      disabled={state === "busy"}
      title={t("ingestAsJobTitle")}
      className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-0.5 text-sm font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
    >
      <Briefcase size={12} aria-hidden />
      {state === "busy" ? t("ingesting") : state === "error" ? t("ingestRetry") : t("ingestAsJob")}
    </button>
  );
}

// 7159056b — clone a saved JD as a starting point: most roles are variations of
// prior ones, so fetch the full body and save a "(copy)" draft the recruiter then
// tweaks (and its jd-<slug> Job is ingested by the shared save path). One click,
// no blank builder.
function DuplicateJdButton({ slug, title, onDone }: { slug: string; title: string; onDone: () => void }) {
  const t = useTranslations("library.tab");
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const duplicate = async () => {
    if (state === "busy") return;
    setState("busy");
    try {
      const src = (await fetch(`/api/jds/${encodeURIComponent(slug)}`).then((r) => r.json())) as { body?: string } | null;
      if (!src?.body) throw new Error();
      const r = await fetch("/api/jds/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t("copyTitle", { title }), body: src.body }),
      });
      if (!r.ok) throw new Error();
      onDone();
    } catch {
      setState("error");
    }
  };
  return (
    <button
      type="button"
      onClick={duplicate}
      disabled={state === "busy"}
      title={t("duplicateTitle")}
      className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-0.5 text-sm font-semibold text-steel hover:border-coral/40 hover:text-ink disabled:opacity-50"
    >
      <Copy size={12} aria-hidden />
      {state === "busy" ? t("duplicating") : state === "error" ? t("duplicateRetry") : t("duplicate")}
    </button>
  );
}

export function LibraryTab() {
  const t = useTranslations("library.tab");
  const [rows, setRows] = useState<JdRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // The most recent ingest-as-job result: drives the completion band below so
  // the action lands somewhere visible (it used to succeed in total silence).
  const [ingested, setIngested] = useState<{ slug: string; jobId: string | null } | null>(null);

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
      if (!response.ok) throw new Error(t("loadFailedStatus", { status: response.status }));
      const payload = await response.json();
      if (signal?.aborted) return;
      setRows((payload.jds as JdRow[]) ?? []);
    } catch (caught) {
      // An abort is expected on unmount — don't surface it as an error.
      if (signal?.aborted || (caught instanceof DOMException && caught.name === "AbortError")) return;
      setError(caught instanceof Error ? caught.message : t("loadFailed"));
    }
  }, [t]);

  // Deferred kick-off (0 ms timer): load() resets rows/error synchronously, and a
  // sync setState in the effect body would cascade a render before the first
  // commit settles. The abort cleanup still covers the in-flight request.
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          {t.rich("intro", { strong: (chunks) => <strong>{chunks}</strong> })}
        </p>
      </header>

      <div className="mt-5">
        <JdBuilder onSaved={load} />
      </div>

      {ingested ? (
        <CompletionCta
          className="mt-5"
          message={t("ingestedBanner", { slug: ingested.slug })}
          links={[
            {
              label: t("ingestedBannerCta"),
              tab: "jobs",
              // ?job= auto-opens the posting modal on the Jobs tab.
              params: ingested.jobId ? { job: ingested.jobId } : undefined,
            },
          ]}
          onDismiss={() => setIngested(null)}
          dismissLabel={t("ingestedDismiss")}
        />
      ) : null}

      <div className="mt-5">
        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
            <h3 className="font-serif text-h2 text-ink">{t("savedJds")}</h3>
            <span className="text-sm uppercase tracking-wide text-steel">
              {t("entryCount", { count: visible.length })}
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
                {t("tryAgain")}
              </button>
            </div>
          ) : rows == null ? (
            <JdListSkeleton />
          ) : rows.length === 0 ? (
            <p className="px-5 py-8 text-base text-steel">{t("emptyNoJds")}</p>
          ) : (
            <>
              <div className="border-b border-stone-200 px-5 py-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" aria-hidden />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("searchPlaceholder")}
                    aria-label={t("searchAria")}
                    className="focus-ring h-10 w-full rounded-md border border-stone-300 bg-white pl-9 pr-3 text-base text-ink"
                  />
                </div>
              </div>
              {visible.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-base font-semibold text-ink">{t("noMatchTitle")}</p>
                  <p className="mt-1 text-base text-steel">
                    {t("noMatchBody", { query: query.trim() })}
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
                      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-steel">
                        {t("savedAt", { date: new Date(row.created_at).toLocaleString() })}
                        {row.jobStatus ? (
                          <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-xs font-semibold uppercase text-steel">
                            {t("jobStatusChip", { status: row.jobStatus })}
                          </span>
                        ) : (
                          <IngestAsJobButton
                            slug={row.slug}
                            onDone={(jobId) => {
                              setIngested({ slug: row.slug, jobId });
                              void load();
                            }}
                          />
                        )}
                        <DuplicateJdButton slug={row.slug} title={row.title} onDone={() => void load()} />
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
        <summary className="cursor-pointer text-sm font-semibold text-steel">{t("orPasteManually")}</summary>
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
