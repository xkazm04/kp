// State + submit logic for JobsIngestAdPanel.tsx — extracted verbatim (no
// behaviour change) so the panel file stays under the 200-line split threshold.
// Owns: the open/closed panel state, the bulk toggle, the single-ad and
// bulk-ad submit flows (both routed through the same hardened ingestOne call),
// and the abort-on-unmount teardown.
"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MIN_AD_CHARS, splitJobAds } from "@/app/_lib/split-ads";

export type RowStatus = "added" | "exists" | "failed";
const firstLine = (ad: string) => (ad.split(/\r?\n/)[0] ?? "").slice(0, 60).trim() || "—";

export type IngestResult = { jobId: string; created: boolean; title: string };

export function useIngestAdPanelLogic({
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

  const close = () => {
    abortRef.current?.abort();
    setOpen(false);
    setAdText("");
    setError(null);
    setNote(null);
    // #4: reopening the panel must not show the previous run's rows or a
    // frozen progress label — reset the transient run state on close too.
    setResults(null);
    setProgress(null);
  };

  const toggleBulk = (checked: boolean) => {
    setBulk(checked);
    // #4: switching single⇄bulk makes the prior run's results/progress
    // (and note/error) unrelated to the new mode — clear them.
    setResults(null);
    setProgress(null);
    setNote(null);
    setError(null);
  };

  return {
    t,
    open,
    setOpen,
    adText,
    setAdText,
    busy,
    error,
    note,
    bulk,
    toggleBulk,
    results,
    progress,
    bulkCount,
    submit,
    submitBulk,
    close,
  };
}
