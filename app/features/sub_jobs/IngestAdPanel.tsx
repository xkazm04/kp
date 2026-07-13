"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ClipboardPaste, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { MIN_AD_CHARS, splitJobAds } from "@/app/_lib/split-ads";
import { Checkbox } from "@/app/_components/Checkbox";
import { TextArea } from "@/app/_components/TextArea";

type RowStatus = "added" | "exists" | "failed";
const firstLine = (ad: string) => (ad.split(/\r?\n/)[0] ?? "").slice(0, 60).trim() || "—";

type IngestResult = { jobId: string; created: boolean; title: string };

// "Paste a job ad" → POST /api/jobs/ingest. The parse backend (Claude CLI →
// structured, deduped, matchable Job) was fully built but had no UI caller, so a
// recruiter could only get roles in via the seed corpus or the JD builder — never
// the ad they were handed. Self-contained like DraftsPanel; threads an
// AbortController so navigating away mid-parse SIGKILLs the child (the route
// honors request.signal). On a content-hash hit the route returns created:false,
// surfaced as "already in the catalog" rather than a phantom second add.
// onIngested fires for the SINGLE-ad path (latch the just-added job open). Bulk uses
// onBulkComplete instead — fired ONCE after the loop — so a 10-ad import doesn't trigger
// 10 corpus refetches mid-run and doesn't hijack the screen with a modal for the last
// created row while the user is still reading the per-row results table.
export function IngestAdPanel({
  onIngested,
  onBulkComplete,
}: {
  onIngested?: (result: IngestResult) => void;
  onBulkComplete?: () => void;
}) {
  const t = useTranslations("jobs.ingest");
  const [open, setOpen] = useState(false);
  const [adText, setAdText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // efb12f90 — bulk paste: many ads separated by a line of dashes, imported in one
  // pass with a per-row result table.
  const [bulk, setBulk] = useState(false);
  const [results, setResults] = useState<{ title: string; status: RowStatus }[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bulkCount = bulk ? splitJobAds(adText).length : 0;

  // Abort an in-flight parse if the panel unmounts (tab switch) — otherwise the
  // fetch + its Claude CLI child outlive a result nobody will read.
  useEffect(() => () => abortRef.current?.abort(), []);

  // The single hardened POST /api/jobs/ingest call both the single-ad and the bulk
  // paths run (bulk is just this in a loop over the split ads). Shares the fetch +
  // response decode; the abort signal is threaded through so a teardown SIGKILLs the
  // child. Returns a discriminated result — never throws — so each caller maps it to
  // its own UI (an inline note vs. a per-row status).
  const ingestOne = async (
    text: string,
    signal: AbortSignal
  ): Promise<{ ok: true; result: IngestResult } | { ok: false; error: string }> => {
    const res = await fetch("/api/jobs/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adText: text }),
      signal,
    });
    const data = (await res.json()) as { jobId?: string; created?: boolean; title?: string; error?: string };
    if (!res.ok || !data.jobId) {
      return { ok: false, error: data.error ?? t("ingestFailedStatus", { status: res.status }) };
    }
    return { ok: true, result: { jobId: data.jobId, created: Boolean(data.created), title: data.title ?? t("defaultTitle") } };
  };

  const submit = async () => {
    const text = adText.trim();
    if (text.length < MIN_AD_CHARS) {
      setError(t("minChars", { min: MIN_AD_CHARS }));
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    // bug-ui-scan-2026-07-09 (job-postings-lifecycle #4): drop any prior bulk run's
    // per-row table + progress so a single add doesn't render a stale results list
    // beneath its own note.
    setResults(null);
    setProgress(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const outcome = await ingestOne(text, controller.signal);
      if (!outcome.ok) throw new Error(outcome.error);
      const { result } = outcome;
      setNote(
        result.created
          ? t("added", { title: result.title })
          : t("alreadyExists", { title: result.title })
      );
      setAdText("");
      onIngested?.(result);
    } catch (caught) {
      if (controller.signal.aborted) return; // intentional teardown, not a failure
      setError(caught instanceof Error ? caught.message : t("ingestFailed"));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      abortRef.current = null;
    }
  };

  // efb12f90 — import each pasted ad through the SAME hardened single-ingest route
  // (content-hash dedup → "already in catalog"), sequentially, with a per-row
  // result table. Sequential keeps one Claude parse in flight at a time and lets a
  // cancel mid-run stop cleanly.
  const submitBulk = async () => {
    const ads = splitJobAds(adText);
    if (ads.length === 0) {
      setError(t("minChars", { min: MIN_AD_CHARS }));
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    setResults([]);
    const controller = new AbortController();
    abortRef.current = controller;
    const out: { title: string; status: RowStatus }[] = [];
    try {
      for (let i = 0; i < ads.length; i += 1) {
        setProgress({ done: i, total: ads.length });
        try {
          const outcome = await ingestOne(ads[i], controller.signal);
          if (!outcome.ok) {
            out.push({ title: firstLine(ads[i]), status: "failed" });
          } else {
            const { result } = outcome;
            out.push({ title: result.title, status: result.created ? "added" : "exists" });
          }
        } catch (caught) {
          if (controller.signal.aborted) return; // intentional teardown
          out.push({ title: firstLine(ads[i]), status: "failed" });
        }
        setResults([...out]);
      }
      const added = out.filter((r) => r.status === "added").length;
      const exists = out.filter((r) => r.status === "exists").length;
      const failed = out.filter((r) => r.status === "failed").length;
      setNote(t("bulkDone", { added, exists, failed }));
      setAdText("");
      // One coalesced refresh after the whole run (only if something new landed) — no
      // per-row reload storm, and no auto-open modal over the results table.
      if (added > 0) onBulkComplete?.();
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        setProgress(null);
      }
      abortRef.current = null;
    }
  };

  if (!open) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="focus-ring inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-base font-semibold text-ink hover:border-coral/40"
        >
          <ClipboardPaste size={15} className="text-coral" /> {t("pasteAd")}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-coral/30 bg-coral/5 p-3">
      <label htmlFor="ingest-ad" className="text-meta uppercase tracking-wide text-coral">
        {t("pasteAd")}
      </label>
      <p className="mt-1 text-sm text-steel">{t("pasteIntro")}</p>
      <label className="mt-2 flex items-center gap-1.5 text-sm font-medium text-steel">
        <Checkbox
          checked={bulk}
          disabled={busy}
          onChange={(e) => {
            setBulk(e.target.checked);
            // #4: switching single⇄bulk makes the prior run's results/progress
            // (and note/error) unrelated to the new mode — clear them.
            setResults(null);
            setProgress(null);
            setNote(null);
            setError(null);
          }}
        />
        {t("bulkToggle")}
        {bulk ? <span className="text-meta text-stone-400">· {t("bulkHint")}</span> : null}
      </label>
      <TextArea
        id="ingest-ad"
        value={adText}
        onChange={(e) => setAdText(e.target.value)}
        rows={bulk ? 10 : 6}
        disabled={busy}
        placeholder={bulk ? t("bulkPlaceholder") : t("pastePlaceholder")}
        sizeVariant="sm"
        className="mt-2 disabled:opacity-60"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {bulk ? (
          <button
            type="button"
            onClick={submitBulk}
            disabled={busy || bulkCount === 0}
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={14} /> {busy && progress ? t("importing", { done: progress.done, total: progress.total }) : t("importAll", { count: bulkCount })}
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={busy || adText.trim().length < MIN_AD_CHARS}
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={14} /> {busy ? t("parsing") : t("addToCatalog")}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            abortRef.current?.abort();
            setOpen(false);
            setAdText("");
            setError(null);
            setNote(null);
            // #4: reopening the panel must not show the previous run's rows or a
            // frozen progress label — reset the transient run state on close too.
            setResults(null);
            setProgress(null);
          }}
          disabled={busy}
          className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-steel hover:text-ink disabled:opacity-50"
        >
          {t("cancel")}
        </button>
        <span className="text-meta text-steel">{t("parsingNote")}</span>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
      {note ? <p aria-live="polite" className="mt-2 text-sm text-steel">{note}</p> : null}
      {results && results.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {results.map((r, i) => (
            <li key={i} className="flex items-center gap-1.5 text-sm">
              {r.status === "failed" ? (
                <X size={13} className="shrink-0 text-coral" aria-hidden />
              ) : (
                <Check size={13} className={`shrink-0 ${r.status === "added" ? "text-moss" : "text-steel"}`} aria-hidden />
              )}
              <span className="truncate text-ink">{r.title}</span>
              <span className="ml-auto shrink-0 text-meta uppercase text-steel">
                {r.status === "added" ? t("resAdded") : r.status === "exists" ? t("resExists") : t("resFailed")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
